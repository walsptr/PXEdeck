// Suite KVM M6 run `core` (M6-T14, DEC-018 §4) — DIJALANKAN HANYA lewat
//   infra/kvm-run.sh m6 --scenario core          (node default "21:uefi:failpath 22:bios:destroy")
// Test hanya terdaftar bila PXE_KVM_SCENARIO=core (spec m6-* lain terdaftar untuk skenarionya sendiri).
//
// Cakupan (docs/design/M6-plan.md §4):
//  - AC-6.43 perimeter: host tanpa sesi → /api/hosts 401, /hosts → /login; dari node (SSH) /api/hosts 403
//    dan varian SR-5-6 tidak ada yang 200 berisi MAC node; server-check (ss/127.0.0.1:3000/nginx -t).
//  - AC-6.45 node21 (UEFI): disk /dev/vdz → Failed installer-error ≤ 15 mnt + event error-commands; log job
//    bebas token/hash/private key (teks & base64).
//  - AC-6.44 node21: install ulang lewat UI (disk otomatis) → Booting→Installing→Configuring→Done tanpa
//    reload; verifikasi SSH + reboot dari disk; riwayat 2 job.
//  - AC-6.46 node22 (BIOS): Installing + event installer → poweroff → start → boot lokal → Failed
//    timeout-installing di UI → install ulang → Done → SSH + reboot; 2 job.
//  - AC-6.47 (a) IP bentrok UI + API + IP lease aktif; (b) CSV credentials invalid per baris tanpa efek
//    (UI + API); (c) token per-MAC node21 (diambil di memori dari serial) dari host/node22/MAC lain → 404.
//  - AC-6.51 (a) 6 login gagal `bruteuser` → ke-6 429, login admin sesudahnya berhasil; (b) 300 POST
//    /boot/zz/zz/log dari node22 dalam 10 dtk → journal ≤ 20 `[boot] tolak` per menit + ringkasan, sebagian
//    429 nginx; node21 yang sedang menginstal tetap maju.
// Login UI dengan password admin per run (PXE_KVM_ADMIN_PASS_FILE, hanya di memori). Password node:
// node21 dari tombol "Buat password acak" (nilai dibaca di memori untuk scan), node22 password sesi.
// Token per-MAC tidak pernah ditulis ke berkas. Cleanup/verify-node oleh kvm-run.sh.
import { spawnSync } from "node:child_process"
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { expect, test, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test"

import {
  adminCredentials,
  base64Secret,
  consoleLog,
  installerBoots,
  KVM,
  kvmNodes,
  passwordLoginRejected,
  powerNode,
  publicKey,
  record,
  resetNode,
  scanEvidence,
  sessionPassword,
  ssh,
  writeResults,
  type KvmNode,
} from "./kvm-harness"

const CORE = process.env.PXE_KVM_SCENARIO === "core"
const BASE = process.env.PXE_KVM_BASE_URL ?? "http://10.99.0.2"
const SERVER_IP = "10.99.0.2"
const INSTALL_TIMEOUT_MS = 30 * 60_000
const FAIL_TIMEOUT_MS = 15 * 60_000
const PASSWORD = sessionPassword()
/** Password node21 dari generator UI (di memori; hanya untuk scan bukti). */
const generated: string[] = []
const hostId = (mac: string) => mac.replaceAll(":", "")
const shot = (name: string) => path.join(KVM.runsDir, "screenshots", `${name}.png`)
const TOKEN_RE = /\/boot\/[0-9a-f:]{17}\/[A-Za-z0-9_-]{43}\//
const NO_RELOAD = () => ((window as unknown as { __noReload: boolean }).__noReload = true)
const STILL_NO_RELOAD = () => (window as unknown as { __noReload?: boolean }).__noReload === true

type Stage = { stage: string; at: string; source: string }
type Job = { id: string; status: string; stages: Stage[]; failureReason: string | null; installerBoots: number; createdAt: string; eventCount: number }
type Ev = { seq: number; at: string; kind: string; level: string; source: string; message: string; repeat: number }

function note(node: KvmNode | string, msg: string) {
  const name = typeof node === "string" ? node : node.name
  appendFileSync(path.join(KVM.runsDir, `${name}-timeline.txt`), `${new Date().toISOString()} ${msg}\n`)
}

function serverSsh(remote: string, script?: string): { code: number; out: string } {
  const key = path.join(path.dirname(path.resolve(KVM.sshKey)), "infra_ed25519")
  if (!/\/\.agent\/keys\/infra_ed25519$/.test(key)) throw new Error(`key ${key}`)
  const r = spawnSync(
    "ssh",
    ["-i", key, "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR", "-o", "ConnectTimeout=10", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", `root@${SERVER_IP}`, remote],
    { encoding: "utf8", timeout: 120_000, input: script ?? "" },
  )
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }
}

function nginxCount(fixed: string): number {
  const r = serverSsh(`grep -cF -- '${fixed.replaceAll("'", "")}' /var/log/nginx/pxe-access.log || true`)
  const n = Number(r.out.trim().split(/\s+/).pop())
  return Number.isFinite(n) ? n : -1
}

async function jobsOf(api: APIRequestContext, mac: string): Promise<{ jobs: Job[]; skewMs: number }> {
  const t = Date.now()
  const r = await api.get(`/api/jobs?hostId=${hostId(mac)}&limit=200`)
  expect(r.status()).toBe(200)
  const body = (await r.json()) as { jobs: Job[]; serverTime: string }
  return { jobs: body.jobs, skewMs: Date.parse(body.serverTime) - (t + Date.now()) / 2 }
}

async function jobLog(api: APIRequestContext, id: string): Promise<Ev[]> {
  const out: Ev[] = []
  let after = 0
  for (;;) {
    const r = await api.get(`/api/jobs/${id}/logs?format=json&after=${after}`)
    expect(r.status()).toBe(200)
    const b = (await r.json()) as { events: Ev[] }
    if (!b.events.length) break
    out.push(...b.events)
    after = b.events[b.events.length - 1].seq
    if (b.events.length < 1000) break
  }
  return out
}

async function apiHost(api: APIRequestContext, mac: string) {
  const r = await api.get(`/api/hosts/${hostId(mac)}`)
  return r.status() === 200 ? r.json() : null
}

async function apiConfig(api: APIRequestContext, mac: string): Promise<string> {
  return (await api.get(`/api/hosts/${hostId(mac)}/config`)).text()
}

function hostRow(page: Page, mac: string): Locator {
  return page.locator("main table").first().locator("tbody tr").filter({ has: page.getByText(mac, { exact: true }) })
}

const STATIC_NET = (id: string, ip: string) => ({
  mode: "static",
  assignments: { [id]: ip },
  prefix: KVM.prefix,
  gateway: KVM.gateway,
  dns: [KVM.dns],
  vlan: null,
  iface: { by: "mac" },
})

// ---- sesi UI bersama (login sekali per worker) ----
let ctx: BrowserContext
let page: Page

async function loginUi(browser: Browser) {
  ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 }, locale: "id-ID" })
  page = await ctx.newPage()
  const [user, pw] = adminCredentials()
  await page.goto("/hosts")
  await expect(page).toHaveURL(/\/login\?next=%2Fhosts$/)
  await page.getByLabel("Username").fill(user)
  await page.getByLabel("Password", { exact: true }).fill(pw)
  await page.getByTestId("login-submit").click()
  await expect(page).toHaveURL(/\/hosts$/, { timeout: 30_000 })
  await expect(page.getByTestId("sidebar-username")).toContainText(user)
  const state = await ctx.storageState()
  expect(state.cookies.filter((c) => c.name === "pxe_session")).toHaveLength(1)
}

async function openHosts() {
  await page.goto("/hosts")
  await page.evaluate(NO_RELOAD)
}

/** Sheet konfigurasi lengkap satu host (UI) → Simpan & Install. Mengembalikan pill status. */
async function configureInstall(node: KvmNode, opts: { disk: string; generator: boolean }) {
  await openHosts()
  const row = hostRow(page, node.mac)
  await expect(row).toHaveCount(1, { timeout: 10 * 60_000 })
  await row.getByRole("button", { name: /^Aksi untuk/ }).click()
  await page.getByRole("menuitem", { name: "Install OS" }).click()
  const sheet = page.getByRole("dialog", { name: /^Konfigurasi / })
  await sheet.locator('[id="os-ubuntu-24.04"]').click()
  await sheet.locator("#os-disk").fill(opts.disk)
  await sheet.getByRole("tab", { name: /^Credentials/ }).click()
  await sheet.locator("#cred-user").fill(KVM.user)
  if (opts.generator) {
    await sheet.getByRole("button", { name: "Buat password acak" }).click()
    const v = await sheet.locator("#cred-pass").inputValue()
    expect(v.length).toBeGreaterThanOrEqual(12)
    generated.push(v)
  } else {
    await sheet.locator("#cred-pass").fill(PASSWORD)
  }
  if ((await sheet.locator("#cred-sudo").getAttribute("aria-checked")) !== "true") await sheet.locator("#cred-sudo").click()
  if ((await sheet.locator("#cred-nopw").getAttribute("aria-checked")) !== "true") await sheet.locator("#cred-nopw").click()
  await sheet.getByRole("tab", { name: /^Network/ }).click()
  await sheet.getByRole("radio", { name: "Static" }).click()
  await sheet.locator("#net-ip").fill(node.ip)
  await expect(sheet.locator("#net-gw")).toHaveValue(KVM.gateway)
  await expect(sheet.getByRole("button", { name: `Hapus DNS ${KVM.dns}` })).toBeVisible()
  await sheet.getByRole("tab", { name: /^Hostname/ }).click()
  await sheet.locator("#hn-name").fill(node.hostname)
  await sheet.getByRole("tab", { name: /^SSH Keys/ }).click()
  const [kType, kBlob] = publicKey().split(/\s+/)
  const lib = (await (await page.request.get("/api/ssh-keys")).json()) as { id: string; publicKey: string }[]
  const inLib = lib.find((k) => k.publicKey.split(/\s+/)[1] === kBlob && k.publicKey.startsWith(kType))
  if (inLib) {
    const cb = sheet.locator(`[id="lib-${inLib.id}"]`)
    if ((await cb.getAttribute("aria-checked")) !== "true") await cb.click()
    await expect(cb).toHaveAttribute("aria-checked", "true")
  } else {
    await sheet.getByRole("button", { name: "Tempel / unggah key baru" }).click()
    await sheet.locator("#key-0").fill(publicKey())
    await sheet.locator("#key-name-0").fill(`${KVM.run}-run-key`)
  }
  await page.screenshot({ path: shot(`${node.name}-sheet`), mask: [sheet.locator("#cred-pass")] })
  await sheet.getByRole("button", { name: "Simpan & Install" }).click()
  const confirm = page.getByRole("alertdialog", { name: /^Install OS ke / })
  const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().endsWith(`/api/hosts/${hostId(node.mac)}`), { timeout: 60_000 })
  const installed = page.waitForResponse((r) => r.url().endsWith(`/api/hosts/${hostId(node.mac)}/install`), { timeout: 60_000 })
  await confirm.getByRole("button", { name: "Hapus disk & install" }).click()
  const s = await saved
  expect(s.status(), await s.text()).toBe(200)
  expect((await installed).status()).toBe(200)
  const pill = row.locator("[data-status]").first()
  await expect(pill).toHaveAttribute("data-status", "booting")
  note(node, `install dibuat (UI) disk=${opts.disk || "(otomatis)"} generator=${opts.generator}`)
  resetNode(node)
  note(node, "node.sh reset")
  return pill
}

/** Install ulang lewat UI dengan konfigurasi tersimpan (disk diganti bila `disk` diberikan). */
async function reinstallUi(node: KvmNode, disk?: string) {
  await openHosts()
  const row = hostRow(page, node.mac)
  const pill = row.locator("[data-status]").first()
  await row.getByRole("button", { name: /^Aksi untuk/ }).click()
  await page.getByRole("menuitem", { name: "Install OS" }).click()
  const sheet = page.getByRole("dialog", { name: /^Konfigurasi / })
  await sheet.locator('[id="os-ubuntu-24.04"]').click()
  if (disk !== undefined) await sheet.locator("#os-disk").fill(disk)
  await sheet.getByRole("button", { name: /^(Simpan & Install|Install)$/ }).click()
  const confirm = page.getByRole("alertdialog", { name: /^Install OS ke / })
  const installed = page.waitForResponse((r) => r.url().endsWith(`/api/hosts/${hostId(node.mac)}/install`), { timeout: 60_000 })
  await confirm.getByRole("button", { name: "Hapus disk & install" }).click()
  expect((await installed).status()).toBe(200)
  await expect(pill).toHaveAttribute("data-status", "booting")
  note(node, `install ulang (UI) disk=${disk === undefined ? "(tetap)" : disk || "(otomatis)"}`)
  resetNode(node)
  note(node, "node.sh reset (install ulang)")
  return pill
}

async function watchUntilFinal(pill: Locator, node: KvmNode, label: string, timeoutMs: number, onStatus?: (st: string) => Promise<void>) {
  const seen: string[] = []
  const deadline = Date.now() + timeoutMs
  let last = ""
  while (Date.now() < deadline) {
    const st = (await pill.getAttribute("data-status")) ?? ""
    if (st && st !== last) {
      seen.push(st)
      last = st
      note(node, `${label}: ${st} (UI)`)
      await page.screenshot({ path: shot(`${node.name}-${label}-${st}`) })
      if (onStatus) await onStatus(st)
    }
    if (st === "done" || st === "failed") break
    await page.waitForTimeout(2_000)
  }
  return { seen, last }
}

/** verify-node.sh + login password ditolak + reboot dari disk (paritas AC-5.40). */
async function verifySshAndReboot(node: KvmNode) {
  const envs = [
    `EXPECT_HOSTNAME=${node.hostname}`, `EXPECT_IP=${node.ip}`, `EXPECT_PREFIX=${KVM.prefix}`, `EXPECT_MAC=${node.mac}`,
    `EXPECT_GW=${KVM.gateway}`, `EXPECT_DNS=${KVM.dns}`, `EXPECT_USER=${KVM.user}`, `EXPECT_PUBKEY='${publicKey()}'`,
  ].join(" ")
  const script = readFileSync(path.join(__dirname, "verify-node.sh"), "utf8")
  let up = false
  for (let i = 0; i < 60 && !up; i++) {
    up = ssh(node.ip, "true").code === 0
    if (!up) await page.waitForTimeout(10_000)
  }
  const v1 = ssh(node.ip, `${envs} bash -s`, script)
  const pw = passwordLoginRejected(node.ip)
  const kernelsBefore = installerBoots(node)
  const jobsBefore = (await jobsOf(page.request, node.mac)).jobs.length
  ssh(node.ip, "sudo -n systemctl reboot")
  let back = false
  await page.waitForTimeout(20_000)
  const deadline = Date.now() + 10 * 60_000
  while (Date.now() < deadline) {
    if (ssh(node.ip, "true").code === 0) {
      back = true
      break
    }
    await page.waitForTimeout(5_000)
  }
  const v2 = back ? ssh(node.ip, `${envs} bash -s`, script) : { code: -1, out: "node tidak kembali" }
  const kernelsAfter = installerBoots(node)
  const host = await apiHost(page.request, node.mac)
  const jobsAfter = (await jobsOf(page.request, node.mac)).jobs
  const file = `${node.name}-verify-ssh.txt`
  writeFileSync(
    path.join(KVM.runsDir, file),
    [
      "# verify-node.sh sebelum reboot", v1.out, `# exit=${v1.code}`,
      "# login password (PreferredAuthentications=password)", pw.out.trim(), `# ditolak=${pw.ok}`,
      `# reboot: kembali=${back}`, "# verify-node.sh sesudah reboot", v2.out, `# exit=${v2.code}`,
      `# kernel installer di serial log: sebelum reboot=${kernelsBefore} sesudah=${kernelsAfter}`,
      `# status host sesudah reboot: ${host?.status} osInstalled=${host?.osInstalled}`,
      `# jumlah job: sebelum reboot=${jobsBefore} sesudah=${jobsAfter.length} (${jobsAfter.map((j) => `${j.status}${j.failureReason ? `/${j.failureReason}` : ""}`).join(", ")})`,
    ].join("\n") + "\n",
  )
  return { up, v1, pw, back, v2, kernelsBefore, kernelsAfter, host, jobsBefore, jobsAfter, file }
}

/** Token per-MAC dari serial (ds=nocloud-net;s=…/<mac>/<token>/) — hanya di memori. */
function tokenFromConsole(node: KvmNode): string | null {
  const re = new RegExp(`/boot/${node.mac}/([A-Za-z0-9_-]{43})/`, "g")
  let last: string | null = null
  for (const m of consoleLog(node).matchAll(re)) last = m[1]
  return last
}

function secretFindings(text: string, secrets: string[]): string[] {
  const out: string[] = []
  if (TOKEN_RE.test(text)) out.push("token /boot/")
  if (/\$6\$[./A-Za-z0-9]{1,16}\$[./A-Za-z0-9]{20,}/.test(text)) out.push("hash $6$")
  if (/PRIVATE KEY/.test(text)) out.push("private key")
  for (const s of secrets) if (s && text.includes(s)) out.push("password")
  for (const blob of new Set(text.match(/[A-Za-z0-9+/]{40,}={0,2}/g) ?? [])) {
    const hit = base64Secret(blob, secrets)
    if (hit) out.push(hit)
  }
  return out
}

if (CORE) {
  const NODES = kvmNodes()
  const n21 = NODES.find((n) => n.role === "failpath")!
  const n22 = NODES.find((n) => n.role === "destroy")!
  if (!n21 || !n22) throw new Error("run core butuh node failpath dan destroy")

  test.beforeAll(async ({ browser }) => {
    await loginUi(browser)
  })
  test.afterAll(async () => {
    await ctx?.close()
    const [, adminPw] = adminCredentials()
    const findings = scanEvidence([PASSWORD, adminPw, ...generated])
    writeFileSync(
      path.join(KVM.runsDir, "evidence-scan.txt"),
      findings.length ? findings.join("\n") + "\n" : "bersih: tanpa password node/admin/generator, token /boot/, private key (teks & base64)\n",
    )
    record({ ac: "AC-6.52-scan", status: findings.length ? "FAIL" : "PASS", note: `${findings.length} temuan (scan harness; generator=${generated.length})`, evidence: ["evidence-scan.txt"] })
    writeResults({ scenario: "core", nodes: NODES.map((n) => ({ name: n.name, fw: n.fw, role: n.role, hostname: n.hostname, ip: n.ip })) })
  })

  test("AC-6.43a perimeter host tanpa sesi: /api/hosts 401, /hosts → /login", async ({ playwright }) => {
    const anon = await playwright.request.newContext({ baseURL: BASE })
    const a = await anon.get("/api/hosts")
    const h = await anon.get("/hosts", { maxRedirects: 0 })
    const loc = h.headers()["location"] ?? ""
    await anon.dispose()
    const check = existsSync(path.join(KVM.runsDir, "server-check.txt")) ? readFileSync(path.join(KVM.runsDir, "server-check.txt"), "utf8") : ""
    const serverOk =
      /^RESULT: PASS$/m.test(check) && /^# server-check exit=0$/m.test(check) && /127\.0\.0\.1:3000/.test(check) &&
      !/0\.0\.0\.0:3000|\*:3000/.test(check) && /test is successful/.test(check)
    writeFileSync(
      path.join(KVM.runsDir, "perimeter-host.txt"),
      `GET /api/hosts tanpa sesi: ${a.status()}\nGET /hosts tanpa sesi: ${h.status()} location=${loc}\nserver-check (ss/127.0.0.1:3000/nginx -t): ${serverOk}\n`,
    )
    const ok = a.status() === 401 && [302, 303, 307, 308].includes(h.status()) && /\/login/.test(loc) && serverOk
    record({ ac: "AC-6.43-host", status: ok ? "PASS" : "FAIL", note: `401=${a.status()} /hosts=${h.status()} → ${loc}`, evidence: ["perimeter-host.txt", "server-check.txt"] })
    expect(a.status()).toBe(401)
    expect([302, 303, 307, 308]).toContain(h.status())
    expect(loc).toMatch(/\/login/)
    expect(serverOk, check.slice(-1500)).toBe(true)
  })

  test(`AC-6.45 (mulai) ${n21.name}: login UI, host muncul, Sheet lengkap disk /dev/vdz → Simpan & Install`, async () => {
    test.setTimeout(20 * 60_000)
    const t0 = Date.now()
    await openHosts()
    await expect(hostRow(page, n21.mac)).toHaveCount(1, { timeout: 10 * 60_000 })
    await expect(hostRow(page, n22.mac)).toHaveCount(1, { timeout: 10 * 60_000 })
    for (const n of [n21, n22]) {
      await expect.poll(async () => (await apiHost(page.request, n.mac))?.firmware, { timeout: 5 * 60_000 }).toBe(n.fw)
      note(n, `muncul di tabel tanpa reload; firmware=${n.fw}`)
    }
    expect(await page.evaluate(STILL_NO_RELOAD)).toBe(true)
    await page.screenshot({ path: shot("core-hosts-discovered") })
    await configureInstall(n21, { disk: "/dev/vdz", generator: true })
    const j = (await jobsOf(page.request, n21.mac)).jobs
    record({ ac: "AC-6.45-start", node: n21.name, status: j.length === 1 && j[0].status === "booting" ? "PASS" : "FAIL", durationS: Math.round((Date.now() - t0) / 1000), note: `job ${j[0]?.status}`, evidence: [`${n21.name}-timeline.txt`, `screenshots/${n21.name}-sheet.png`] })
    expect(j).toHaveLength(1)
    expect(j[0].status).toBe("booting")
  })

  test(`AC-6.47 (a)(b) IP bentrok UI+API, IP lease aktif, CSV invalid per baris tanpa efek`, async () => {
    test.setTimeout(15 * 60_000)
    const t0 = Date.now()
    const id21 = hostId(n21.mac)
    const id22 = hostId(n22.mac)
    const before21 = await apiConfig(page.request, n21.mac)
    const before22 = await apiConfig(page.request, n22.mac)
    // (a) UI: IP node22 = IP node21 → error field, simpan nonaktif, tanpa PATCH.
    await openHosts()
    const row22 = hostRow(page, n22.mac)
    let patches = 0
    page.on("request", (r) => {
      if (r.method() === "PATCH" || (r.method() === "POST" && /\/api\/hosts\/bulk$/.test(r.url()))) patches++
    })
    await row22.getByRole("button", { name: /^Aksi untuk/ }).click()
    await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
    const sheet = page.getByRole("dialog", { name: /^Konfigurasi / })
    await sheet.getByRole("tab", { name: /^Network/ }).click()
    await sheet.getByRole("radio", { name: "Static" }).click()
    await sheet.locator("#net-ip").fill(n21.ip)
    const fieldErr = sheet.locator('[data-slot="field-error"]').first()
    await expect(fieldErr).toContainText(/Bentrok/)
    const uiErr = (await fieldErr.textContent())?.trim() ?? ""
    await expect(sheet.getByRole("button", { name: "Simpan konfigurasi" })).toBeDisabled()
    await page.screenshot({ path: shot("core-ac-6.47a-ip-conflict-ui") })
    await page.keyboard.press("Escape")
    await expect(sheet).toBeHidden()
    // API: PATCH sama → 409/422.
    const apiConflict = await page.request.patch(`/api/hosts/${id22}`, { data: { network: STATIC_NET(id22, n21.ip) } })
    const apiConflictBody = await apiConflict.text()
    // IP lease aktif node21 (currentIp dari dnsmasq) → ditolak.
    const h21 = await apiHost(page.request, n21.mac)
    const leaseIp: string = h21?.currentIp ?? ""
    const apiLease = leaseIp ? await page.request.patch(`/api/hosts/${id22}`, { data: { network: STATIC_NET(id22, leaseIp) } }) : null
    const apiLeaseBody = apiLease ? await apiLease.text() : "tanpa currentIp"
    // (b) CSV: pilih kedua host → Set Credentials → Import CSV (MAC invalid + MAC tak dikenal + baris valid).
    await openHosts()
    for (const n of [n21, n22]) await hostRow(page, n.mac).getByRole("checkbox").click()
    const bar = page.getByRole("toolbar", { name: "Aksi untuk host terpilih" })
    await expect(bar).toContainText("2 host dipilih")
    await bar.getByRole("button", { name: "Set Credentials" }).click()
    const bsheet = page.getByRole("dialog", { name: "Konfigurasi 2 host" })
    await bsheet.getByRole("radio", { name: "Import CSV" }).click()
    const csv = ["mac,username,password", `zz:zz:zz:00:00:01,ops,${PASSWORD}`, `52:54:00:99:00:99,ops,${PASSWORD}`, `${n22.mac},ops,${PASSWORD}`].join("\n")
    await bsheet.locator("#cred-csv").fill(csv)
    await bsheet.getByRole("button", { name: "Validasi CSV" }).click()
    const table = bsheet.getByRole("table", { name: "Preview CSV credentials" })
    await expect(table.locator("tbody tr")).toHaveCount(3)
    const states = await table.locator("tbody tr").evaluateAll((rows) => rows.map((r) => `${r.getAttribute("data-line")}:${r.getAttribute("data-state")}:${(r.textContent ?? "").replace(/\s+/g, " ").trim()}`))
    const saveDisabled = await bsheet.getByRole("button", { name: "Simpan konfigurasi" }).isDisabled()
    await page.screenshot({ path: shot("core-ac-6.47b-csv-preview") })
    await page.keyboard.press("Escape")
    const apiCsv = await page.request.post("/api/hosts/bulk", { data: { hostIds: [id21, id22], credentials: { mode: "csv", csv, sudo: true, disableSshPassword: true } } })
    const apiCsvBody = await apiCsv.text()
    const after21 = await apiConfig(page.request, n21.mac)
    const after22 = await apiConfig(page.request, n22.mac)
    const identical = before21 === after21 && before22 === after22
    writeFileSync(
      path.join(KVM.runsDir, "negative-ip-csv.txt"),
      [
        `# (a) UI node22 IP=${n21.ip}: field-error="${uiErr}" simpan nonaktif; PATCH/bulk terkirim dari UI: ${patches}`,
        `# (a) API PATCH node22 IP=${n21.ip}: ${apiConflict.status()} ${apiConflictBody.slice(0, 400)}`,
        `# (a) API PATCH node22 IP lease aktif node21 (${leaseIp}): ${apiLease?.status()} ${apiLeaseBody.slice(0, 400)}`,
        `# (b) preview CSV (line:state:teks): ${states.map((s) => s.replace(PASSWORD, "<pw>")).join(" | ")}`,
        `# (b) tombol Simpan konfigurasi nonaktif: ${saveDisabled}`,
        `# (b) API POST /api/hosts/bulk csv: ${apiCsv.status()} ${apiCsvBody.replaceAll(PASSWORD, "<pw>").slice(0, 600)}`,
        `# konfigurasi node21/node22 identik sebelum/sesudah: ${identical}`,
      ].join("\n") + "\n",
    )
    const okA = /Bentrok/.test(uiErr) && patches === 0 && [409, 422].includes(apiConflict.status()) && !!apiLease && [409, 422].includes(apiLease.status())
    const okB =
      states.length === 3 && states[0].includes(":error:") && states[1].includes(":error:") && states[2].includes(":ok:") && saveDisabled && apiCsv.status() === 422 && identical
    record({ ac: "AC-6.47a", status: okA ? "PASS" : "FAIL", durationS: Math.round((Date.now() - t0) / 1000), note: `UI "${uiErr}", API ${apiConflict.status()}, lease ${leaseIp} → ${apiLease?.status()}`, evidence: ["negative-ip-csv.txt", "screenshots/core-ac-6.47a-ip-conflict-ui.png"] })
    record({ ac: "AC-6.47b", status: okB ? "PASS" : "FAIL", durationS: Math.round((Date.now() - t0) / 1000), note: `preview ${states.map((s) => s.split(":").slice(0, 2).join(":")).join(",")}, simpan nonaktif=${saveDisabled}, API ${apiCsv.status()}, identik=${identical}`, evidence: ["negative-ip-csv.txt", "screenshots/core-ac-6.47b-csv-preview.png"] })
    expect(uiErr).toMatch(/Bentrok/)
    expect(patches).toBe(0)
    expect([409, 422]).toContain(apiConflict.status())
    expect(apiLease).not.toBeNull()
    expect([409, 422]).toContain(apiLease!.status())
    expect(states[0]).toContain(":error:")
    expect(states[1]).toContain(":error:")
    expect(states[2]).toContain(":ok:")
    expect(saveDisabled).toBe(true)
    expect(apiCsv.status()).toBe(422)
    expect(identical).toBe(true)
  })

  test(`AC-6.46 (bagian 1) ${n22.name} (BIOS): Installing + event installer → poweroff → start → boot lokal`, async () => {
    test.setTimeout(25 * 60_000)
    const t0 = Date.now()
    const pill = await configureInstall(n22, { disk: "", generator: false })
    const job = (await jobsOf(page.request, n22.mac)).jobs[0]
    await expect(pill).toHaveAttribute("data-status", "installing", { timeout: 15 * 60_000 })
    note(n22, "installing (UI)")
    await expect
      .poll(async () => (await jobLog(page.request, job.id)).some((e) => e.kind === "installer" && e.message.includes("autoinstall mulai")), { timeout: 10 * 60_000, intervals: [2_000, 5_000] })
      .toBe(true)
    const j1 = (await jobsOf(page.request, n22.mac)).jobs[0]
    const kBefore = installerBoots(n22)
    const ngxBefore = nginxCount(`GET /boot/${n22.mac}.ipxe`)
    powerNode(n22, "poweroff")
    note(n22, "node.sh poweroff (virsh destroy)")
    await page.waitForTimeout(5_000)
    powerNode(n22, "start")
    note(n22, "node.sh start")
    await expect
      .poll(async () => (await jobLog(page.request, job.id)).filter((e) => e.level === "warn" && e.source === "boot-script").length, { timeout: 5 * 60_000, intervals: [2_000, 5_000] })
      .toBeGreaterThan(0)
    const ngxAfter = nginxCount(`GET /boot/${n22.mac}.ipxe`)
    const j2 = (await jobsOf(page.request, n22.mac)).jobs[0]
    const local = await (await page.request.get(`/boot/${n22.mac}.ipxe?platform=pcbios`)).text()
    note(n22, `sebelum destroy installerBoots=${j1.installerBoots} kernelSerial=${kBefore} nginx=${ngxBefore}; sesudah start status=${j2.status} installerBoots=${j2.installerBoots} kernelSerial=${installerBoots(n22)} nginx=${ngxAfter}`)
    const ok = j1.status === "installing" && j1.installerBoots === 1 && j2.status === "installing" && j2.installerBoots === 1 && ngxAfter > ngxBefore && !/\bkernel\b/.test(local) && !TOKEN_RE.test(local) && installerBoots(n22) === kBefore
    record({ ac: "AC-6.46-destroy", node: n22.name, status: ok ? "PASS" : "FAIL", durationS: Math.round((Date.now() - t0) / 1000), note: `installerBoots ${j1.installerBoots}→${j2.installerBoots}, kernel serial ${kBefore}→${installerBoots(n22)}, nginx .ipxe ${ngxBefore}→${ngxAfter}`, evidence: [`${n22.name}-timeline.txt`] })
    expect(j1).toMatchObject({ status: "installing", installerBoots: 1 })
    expect(j2).toMatchObject({ status: "installing", installerBoots: 1 })
    expect(ngxAfter).toBeGreaterThan(ngxBefore)
    expect(local).not.toMatch(/\bkernel\b/)
    expect(installerBoots(n22)).toBe(kBefore)
  })

  test(`AC-6.45 ${n21.name}: /dev/vdz → Failed installer-error ≤ 15 mnt, event error-commands, log bersih`, async () => {
    test.setTimeout(20 * 60_000)
    const j0 = (await jobsOf(page.request, n21.mac)).jobs
    const job = j0[j0.length - 1]
    const created = Date.parse(job.createdAt)
    let j = job
    while (Date.now() - created < FAIL_TIMEOUT_MS + 60_000) {
      j = (await jobsOf(page.request, n21.mac)).jobs.find((x) => x.id === job.id)!
      if (j.status === "failed" || j.status === "done") break
      await page.waitForTimeout(10_000)
    }
    const evs = await jobLog(page.request, job.id)
    const errEv = evs.filter((e) => e.kind === "installer" && /installer gagal/.test(e.message))
    const text = JSON.stringify(evs)
    const [, adminPw] = adminCredentials()
    const findings = secretFindings(text, [PASSWORD, adminPw, ...generated])
    const failAt = j.stages[j.stages.length - 1]?.at
    const elapsedS = failAt ? Math.round((Date.parse(failAt) - created) / 1000) : -1
    writeFileSync(
      path.join(KVM.runsDir, `${n21.name}-job1-failpath.txt`),
      [`# job ${job.id}: ${j.status}/${j.failureReason} dalam ${elapsedS} dtk sejak dibuat`, `# event installer error-commands: ${errEv.length}`, `# temuan secret di log job (teks & base64): ${findings.join(", ") || "tidak ada"}`, ...evs.map((e) => `${e.seq} ${e.at} ${e.level} ${e.kind}/${e.source} ${e.message}`)].join("\n") + "\n",
    )
    await openHosts()
    await page.screenshot({ path: shot(`${n21.name}-job1-failed`) })
    note(n21, `job1 ${j.status}/${j.failureReason} +${elapsedS} dtk; error-commands=${errEv.length}; temuan=${findings.length}`)
    const ok = j.status === "failed" && j.failureReason === "installer-error" && elapsedS <= FAIL_TIMEOUT_MS / 1000 && errEv.length >= 1 && findings.length === 0
    record({ ac: "AC-6.45", node: n21.name, status: ok ? "PASS" : "FAIL", durationS: elapsedS, note: `${j.status}/${j.failureReason} +${elapsedS}s, error-commands ${errEv.length}, temuan ${findings.length}`, evidence: [`${n21.name}-job1-failpath.txt`, `screenshots/${n21.name}-job1-failed.png`] })
    expect(j).toMatchObject({ status: "failed", failureReason: "installer-error" })
    expect(elapsedS).toBeLessThanOrEqual(FAIL_TIMEOUT_MS / 1000)
    expect(errEv.length).toBeGreaterThanOrEqual(1)
    expect(findings).toEqual([])
  })

  test(`AC-6.46 (bagian 2) ${n22.name}: Failed timeout-installing di UI tanpa reload → install ulang → Done → SSH + reboot, 2 job`, async () => {
    test.setTimeout(55 * 60_000)
    const t0 = Date.now()
    await openHosts()
    const pill = hostRow(page, n22.mac).locator("[data-status]").first()
    await expect(pill).toHaveAttribute("data-status", "failed", { timeout: 25 * 60_000 })
    const noReload = await page.evaluate(STILL_NO_RELOAD)
    const jf = (await jobsOf(page.request, n22.mac)).jobs[0]
    note(n22, `Failed di UI tanpa reload=${noReload}: ${jf.status}/${jf.failureReason} installerBoots=${jf.installerBoots}`)
    await page.screenshot({ path: shot(`${n22.name}-job1-failed`) })
    const okFail = jf.status === "failed" && jf.failureReason === "timeout-installing" && jf.installerBoots === 1 && noReload
    record({ ac: "AC-6.46-timeout", node: n22.name, status: okFail ? "PASS" : "FAIL", durationS: Math.round((Date.now() - t0) / 1000), note: `${jf.failureReason}, installerBoots ${jf.installerBoots}, tanpa reload ${noReload}`, evidence: [`${n22.name}-timeline.txt`, `screenshots/${n22.name}-job1-failed.png`] })
    expect(jf).toMatchObject({ status: "failed", failureReason: "timeout-installing", installerBoots: 1 })
    expect(noReload).toBe(true)

    const t1 = Date.now()
    const pill2 = await reinstallUi(n22)
    const { seen, last } = await watchUntilFinal(pill2, n22, "job2", INSTALL_TIMEOUT_MS)
    const installS = Math.round((Date.now() - t1) / 1000)
    const v = await verifySshAndReboot(n22)
    const jobs = v.jobsAfter.map((j) => [j.status, j.failureReason])
    const ok =
      JSON.stringify(seen) === JSON.stringify(["booting", "installing", "configuring", "done"]) && last === "done" && installS <= INSTALL_TIMEOUT_MS / 1000 &&
      v.v1.code === 0 && v.pw.ok && v.back && v.v2.code === 0 && v.kernelsAfter === v.kernelsBefore && v.host?.status === "done" &&
      JSON.stringify(jobs) === JSON.stringify([["done", null], ["failed", "timeout-installing"]])
    record({ ac: "AC-6.46", node: n22.name, status: ok ? "PASS" : "FAIL", durationS: Math.round((Date.now() - t0) / 1000), note: `install ulang ${seen.join(" → ")} ${installS}s; verify ${v.v1.code}/${v.v2.code}; pw ditolak ${v.pw.ok}; kernel ${v.kernelsBefore}→${v.kernelsAfter}; job ${JSON.stringify(jobs)}`, evidence: [v.file, `${n22.name}-timeline.txt`] })
    expect(seen).toEqual(["booting", "installing", "configuring", "done"])
    expect(installS).toBeLessThanOrEqual(INSTALL_TIMEOUT_MS / 1000)
    expect(v.v1.code, v.v1.out).toBe(0)
    expect(v.pw.ok, v.pw.out).toBe(true)
    expect(v.back).toBe(true)
    expect(v.v2.code, v.v2.out).toBe(0)
    expect(v.kernelsAfter).toBe(v.kernelsBefore)
    expect(v.host).toMatchObject({ status: "done", hostname: n22.hostname, mgmtIp: n22.ip })
    expect(jobs).toEqual([["done", null], ["failed", "timeout-installing"]])
  })

  test(`AC-6.44 + AC-6.47c + AC-6.51b ${n21.name}: install ulang UI → token per-MAC ditolak, banjir /boot dari ${n22.name}, Done → SSH + reboot`, async () => {
    test.setTimeout(55 * 60_000)
    const t0 = Date.now()
    const pill = await reinstallUi(n21, "")
    const job2 = (await jobsOf(page.request, n21.mac)).jobs[0]
    let negDone = false
    let negOk = false
    let floodOk = false
    const negLines: string[] = []
    const floodLines: string[] = []
    const onStatus = async (st: string) => {
      if (st !== "installing" || negDone) return
      negDone = true
      // ---- AC-6.47c: token node21 (memori) ----
      let token: string | null = null
      for (let i = 0; i < 30 && !token; i++) {
        token = tokenFromConsole(n21)
        if (!token) await page.waitForTimeout(2_000)
      }
      const evBefore = (await jobLog(page.request, job2.id)).length
      const ngx404Before = nginxCount('" 404 ')
      const rnd = "A".repeat(20) + "b".repeat(23)
      const hostReq = token ? (await page.request.get(`/boot/${n21.mac}/${token}/user-data`)).status() : -1
      const crossReq = token ? (await page.request.get(`/boot/${n22.mac}/${token}/user-data`)).status() : -1
      const rndReq = (await page.request.get(`/boot/${n21.mac}/${rnd}/user-data`)).status()
      const fromNode = token
        ? ssh(n22.ip, "bash -s", `curl -s -o /dev/null -w '%{http_code}\\n' "http://${SERVER_IP}/boot/${n21.mac}/$(cat)/user-data"\n`.replace("$(cat)", token))
        : { code: -1, out: "tanpa token" }
      token = null
      const evAfter = await jobLog(page.request, job2.id)
      const leaked = evAfter.slice(evBefore).filter((e) => e.message.includes("10.99.0.1 ") || e.message.includes(`IP ${n22.ip}`) || e.message.includes("IP 10.99.0.1"))
      const ngx404After = nginxCount('" 404 ')
      negLines.push(
        `token diambil dari serial (memori): ${hostReq !== -1}`,
        `GET /boot/<mac21>/<token21>/user-data dari host 10.99.0.1: ${hostReq}`,
        `GET /boot/<mac22>/<token21>/user-data dari host: ${crossReq}`,
        `GET /boot/<mac21>/<token acak>/user-data: ${rndReq}`,
        `GET /boot/<mac21>/<token21>/user-data dari ${n22.name} (SSH): ${fromNode.out.trim()} (ssh exit=${fromNode.code})`,
        `event job node21 baru yang menyebut host/node22: ${leaked.length}`,
        `nginx 404 total: ${ngx404Before} → ${ngx404After}`,
      )
      negOk = hostReq === 404 && crossReq === 404 && rndReq === 404 && /^404$/m.test(fromNode.out) && leaked.length === 0 && ngx404After >= ngx404Before + 4
      // ---- AC-6.51b: banjir /boot/zz/zz/log dari node22 ----
      const since = serverSsh("date -u +%Y-%m-%dT%H:%M:%S").out.trim()
      const flood = ssh(
        n22.ip,
        "bash -s",
        `for i in $(seq 1 300); do curl -s -o /dev/null -w '%{http_code}\\n' -m 5 -X POST --data-binary x -H 'Content-Type: text/plain' http://${SERVER_IP}/boot/zz/zz/log & if [ $((i % 30)) = 0 ]; then sleep 1; fi; done | sort | uniq -c; wait\n`,
      )
      floodLines.push(`# 300 POST /boot/zz/zz/log dari ${n22.name} (±10 dtk), kode → jumlah:`, flood.out.trim())
      await page.waitForTimeout(75_000)
      const j = serverSsh(`journalctl -u pxe-dashboard --since '${since}' --no-pager -o short-iso | grep -F '[boot]' || true`)
      // Format boot-http.ts: `[boot] tolak <jalur> mac=… alasan=…` dengan jalur `ipxe|file|status|log`.
      const tolak = j.out.split("\n").filter((l) => /\[boot\] tolak log /.test(l))
      const perMin = new Map<string, number>()
      for (const l of tolak) {
        const m = /^(\S+T\d{2}:\d{2})/.exec(l)
        if (m) perMin.set(m[1], (perMin.get(m[1]) ?? 0) + 1)
      }
      const summary = j.out.split("\n").filter((l) => /\[boot\] \d+ penolakan log ditekan/.test(l))
      floodLines.push(`# journal [boot] sejak ${since}: ${tolak.length} baris tolak log; per menit ${JSON.stringify([...perMin])}; ringkasan ${summary.length}`, ...summary, "# contoh baris", ...tolak.slice(0, 3))
      const n429 = Number(/(\d+)\s+429/.exec(flood.out)?.[1] ?? 0)
      floodOk = tolak.length >= 1 && Math.max(0, ...perMin.values()) <= 20 && summary.length >= 1 && n429 > 0
      note(n21, `AC-6.47c neg ok=${negOk}; AC-6.51b flood ok=${floodOk} (429=${n429})`)
    }
    const { seen, last } = await watchUntilFinal(pill, n21, "job2", INSTALL_TIMEOUT_MS, onStatus)
    const installS = Math.round((Date.now() - t0) / 1000)
    writeFileSync(path.join(KVM.runsDir, "negative-token.txt"), negLines.join("\n") + "\n")
    writeFileSync(path.join(KVM.runsDir, "flood-boot.txt"), floodLines.join("\n") + `\n# ${n21.name} tetap maju selama banjir: ${seen.join(" → ")}\n`)
    record({ ac: "AC-6.47c", node: n21.name, status: negOk ? "PASS" : "FAIL", note: negLines.slice(1).join("; "), evidence: ["negative-token.txt", "server-nginx.txt"] })
    const progressed = last === "done"
    record({ ac: "AC-6.51b", node: n22.name, status: floodOk && progressed ? "PASS" : "FAIL", note: `${floodLines[1]?.replace(/\n/g, " ")}; node21 ${seen.join("→")}`, evidence: ["flood-boot.txt", "server-pxe-dashboard-journal.txt"] })
    const v = await verifySshAndReboot(n21)
    const jobs = v.jobsAfter.map((j) => [j.status, j.failureReason])
    const ok =
      JSON.stringify(seen) === JSON.stringify(["booting", "installing", "configuring", "done"]) && installS <= INSTALL_TIMEOUT_MS / 1000 && (await page.evaluate(STILL_NO_RELOAD)) &&
      v.v1.code === 0 && v.pw.ok && v.back && v.v2.code === 0 && v.kernelsAfter === v.kernelsBefore && v.host?.status === "done" &&
      JSON.stringify(jobs) === JSON.stringify([["done", null], ["failed", "installer-error"]])
    record({ ac: "AC-6.44", node: n21.name, status: ok ? "PASS" : "FAIL", durationS: installS, note: `${seen.join(" → ")} ${installS}s; verify ${v.v1.code}/${v.v2.code}; pw ditolak ${v.pw.ok}; kernel ${v.kernelsBefore}→${v.kernelsAfter}; job ${JSON.stringify(jobs)}`, evidence: [v.file, `${n21.name}-timeline.txt`] })
    expect(negOk, negLines.join("\n")).toBe(true)
    expect(floodOk, floodLines.join("\n")).toBe(true)
    expect(seen).toEqual(["booting", "installing", "configuring", "done"])
    expect(installS).toBeLessThanOrEqual(INSTALL_TIMEOUT_MS / 1000)
    expect(v.v1.code, v.v1.out).toBe(0)
    expect(v.pw.ok, v.pw.out).toBe(true)
    expect(v.back).toBe(true)
    expect(v.v2.code, v.v2.out).toBe(0)
    expect(v.kernelsAfter).toBe(v.kernelsBefore)
    expect(v.host).toMatchObject({ status: "done", hostname: n21.hostname, mgmtIp: n21.ip })
    expect(jobs).toEqual([["done", null], ["failed", "installer-error"]])
  })

  test(`AC-6.43b perimeter dari ${n22.name}: /api/hosts 403, varian SR-5-6 tidak 200 berisi MAC`, async () => {
    const variants = ["/api/hosts", "/api/settings", "/boot/%2e%2e/api/hosts", "/boot/..%2Fapi/hosts", "/boot/..\\api/hosts", "//api/hosts", "/api/../api/hosts", "/%61pi/hosts"]
    const script = [
      "set -u",
      ...variants.map(
        (v) => `c=$(curl -s --path-as-is -o /tmp/pxe-b -w '%{http_code}' 'http://${SERVER_IP}${v}'); m=$(grep -ciF '${n22.mac}' /tmp/pxe-b || true); echo "${v.replace(/\\/g, "\\\\")} $c mac=$m"`,
      ),
      "rm -f /tmp/pxe-b",
    ].join("\n")
    const r = ssh(n22.ip, "bash -s", script + "\n")
    writeFileSync(path.join(KVM.runsDir, "perimeter-node.txt"), `# dari ${n22.name} (${n22.ip}) via SSH, exit=${r.code}\n${r.out}\n`)
    const lines = r.out.trim().split("\n").filter((l) => / \d{3} mac=/.test(l))
    const apiHosts = lines.find((l) => l.startsWith("/api/hosts "))
    const leak = lines.filter((l) => / 200 mac=[1-9]/.test(l))
    const ok = lines.length === variants.length && /\/api\/hosts 403 /.test(apiHosts ?? "") && leak.length === 0
    record({ ac: "AC-6.43-node", node: n22.name, status: ok ? "PASS" : "FAIL", note: lines.join("; "), evidence: ["perimeter-node.txt"] })
    expect(lines).toHaveLength(variants.length)
    expect(apiHosts).toMatch(/ 403 /)
    expect(leak).toEqual([])
  })

  test("AC-6.51a 6 login gagal bruteuser → ke-6 429; login admin sesudahnya berhasil", async ({ playwright }) => {
    test.setTimeout(10 * 60_000)
    const anon = await playwright.request.newContext({ baseURL: BASE })
    const codes: number[] = []
    for (let i = 0; i < 6; i++) {
      const r = await anon.post("/api/auth/login", { data: { username: "bruteuser", password: `salah-${i}-xxxxxxxx` }, headers: { Origin: BASE } })
      codes.push(r.status())
    }
    const [user, pw] = adminCredentials()
    const admin: string[] = []
    let ok = false
    const t0 = Date.now()
    while (Date.now() - t0 < 3 * 60_000) {
      const r = await anon.post("/api/auth/login", { data: { username: user, password: pw }, headers: { Origin: BASE } })
      admin.push(`${Math.round((Date.now() - t0) / 1000)}s:${r.status()}`)
      if (r.status() === 204) {
        ok = (await anon.get("/api/settings")).status() === 200
        break
      }
      await new Promise((res) => setTimeout(res, 15_000))
    }
    await anon.dispose()
    writeFileSync(path.join(KVM.runsDir, "rate-limit-login.txt"), `bruteuser 6x: ${codes.join(",")}\nadmin sesudahnya (detik:kode): ${admin.join(" ")}\n/api/settings dengan sesi baru 200: ${ok}\n`)
    const pass = codes.slice(0, 5).every((c) => c === 401 || c === 429) && codes[5] === 429 && ok
    record({ ac: "AC-6.51a", status: pass ? "PASS" : "FAIL", note: `bruteuser ${codes.join(",")}; admin ${admin.join(" ")}`, evidence: ["rate-limit-login.txt"] })
    expect(codes[5]).toBe(429)
    expect(ok).toBe(true)
  })
}
