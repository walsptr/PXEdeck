// Suite KVM M7 "PXE lewat VLAN" (M7-T11, docs/design/M7-plan.md §2.6/§5, DEC-023 §5, DEC-024 §8) —
// DIJALANKAN HANYA lewat
//   infra/kvm-run.sh m7 --scenario vlancore     (node "31:uefi 32:bios", Ubuntu 24.04)
//   infra/kvm-run.sh m7 --scenario vlandistro   (node "33:uefi:os=debian 34:uefi:os=rocky")
// Test hanya terdaftar untuk dua skenario itu (PXE_KVM_TOPOLOGY=vlan).
//
// Alur per node (port pxe-test-port1: VLAN 10 native, VLAN 20 ber-tag) lewat UI dashboard dengan login:
//   host muncul tanpa reload → Sheet: OS, credentials (generator untuk node pertama, sudoer, login password
//   SSH nonaktif), Network Static + VLAN 20 (tab Network VLAN-aware: gateway 10.99.20.1 terisi otomatis),
//   IP 10.99.20.(10+NN)/24, DNS 10.99.10.2, hostname, key ed25519 sekali pakai → Simpan & Install →
//   Booting → Installing → Configuring → Done ≤ 30 mnt tanpa reload.
// Lalu: pcap trunk0 (DISCOVER node ber-tag vlan 10 + OFFER/ACK server ber-tag vlan 10), log nginx (file
// konfigurasi dari IP lease 10.99.10.x, callback terakhir dari IP statis), verifikasi lewat relay di VM
// server (verify-node.sh EXPECT_VLAN=20, login password ditolak), MTU DF 1472, reboot dari disk (relay):
// tanpa kernel installer baru, iPXE menyajikan boot lokal, status tetap Done, jumlah job 1, verify ulang.
//   vlancore  : AC-7.20 (perimeter), AC-7.21 (UEFI), AC-7.22 (BIOS), AC-7.23 (validasi VLAN UI+API),
//               AC-7.29 (isolasi L3 lewat relay probe)
//   vlandistro: AC-7.24 (Debian preseed), AC-7.25 (Rocky kickstart: parent tanpa IPv4, tanpa DHCP OS
//               setelah Done, ssh di anak VLAN lewat firewalld)
// Host TIDAK PERNAH menyasar VLAN 10/20 secara langsung (tanpa route → LAN fisik): node hanya lewat
// infra/vlan/relay.sh; bukti sisi server lewat skrip di VM server (m7-shared.ts).
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test"

import {
  adminCredentials,
  consoleLog,
  KVM,
  kvmNodes,
  publicKey,
  record,
  relayAsync,
  relayCapture,
  resetNode,
  scanEvidence,
  sessionPassword,
  TOPOLOGY,
  writeResults,
  type KvmNode,
} from "./kvm-harness"
import { dhcpTransactions, INSTALLER_MARK, isBootClient, mtuCheck, nginxLinesFor, parseCapture, serverRun, type NginxLine } from "./m7-shared"

const SCEN = process.env.PXE_KVM_SCENARIO ?? ""
const ACTIVE = SCEN === "vlancore" || SCEN === "vlandistro"
const CORE = SCEN === "vlancore"
const BASE = process.env.PXE_KVM_BASE_URL ?? "http://10.99.0.2"
const VLAN = Number(process.env.PXE_KVM_VLAN ?? "20")
const VLAN_CIDR = "10.99.20.0/24"
const PXE_CIDR = "10.99.10.0/24"
const SERVER_TRUNK_MAC = "52:54:00:99:01:04"
const INSTALL_TIMEOUT_MS = 30 * 60_000
const PASSWORD = sessionPassword()
const generated: string[] = []
const hostId = (mac: string) => mac.replaceAll(":", "")
const shot = (name: string) => path.join(KVM.runsDir, "screenshots", `${name}.png`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const NO_RELOAD = () => ((window as unknown as { __noReload: boolean }).__noReload = true)
const STILL_NO_RELOAD = () => (window as unknown as { __noReload?: boolean }).__noReload === true
const OS_ID: Record<KvmNode["os"], string> = { ubuntu: "ubuntu-24.04", debian: "debian-12", rocky: "rocky-9" }
const CONFIG_FILE: Record<KvmNode["os"], string> = { ubuntu: "user-data", debian: "preseed.cfg", rocky: "ks.cfg" }
/** Urutan event installer wajib (subsekuens; selaras m6-distro.spec.ts). */
const EXPECTED_EVENTS: Partial<Record<KvmNode["os"], RegExp[]>> = {
  debian: [/preseed mulai/, /modul disk virtio dimuat/, /disk target dipilih/, /late_command mulai/, /konfigurasi target selesai/, /^first-boot: /],
  rocky: [/kickstart mulai/, /disk target dipilih/, /post mulai/, /konfigurasi target selesai/, /^first-boot: /],
}

type Job = { id: string; status: string; failureReason: string | null; stages: { stage: string; at: string; source: string }[] }
type Ev = { seq: number; kind: string; message: string }
type HostJson = { status: string; hostname: string | null; mgmtIp: string | null; currentIp: string | null }

let ctx: BrowserContext
let page: Page

function note(node: KvmNode | string, msg: string) {
  const name = typeof node === "string" ? node : node.name
  appendFileSync(path.join(KVM.runsDir, `${name}-timeline.txt`), `${new Date().toISOString()} ${msg}\n`)
}

function acFor(n: KvmNode): string {
  if (n.os === "debian") return "AC-7.24"
  if (n.os === "rocky") return "AC-7.25"
  return n.fw === "uefi" ? "AC-7.21" : "AC-7.22"
}

function hostRow(mac: string): Locator {
  return page.locator("main table").first().locator("tbody tr").filter({ has: page.getByText(mac, { exact: true }) })
}

async function jobs(mac: string): Promise<Job[]> {
  const r = await page.request.get(`/api/jobs?hostId=${hostId(mac)}&limit=200`)
  expect(r.status()).toBe(200)
  return ((await r.json()) as { jobs: Job[] }).jobs
}

async function jobLog(id: string): Promise<Ev[]> {
  const out: Ev[] = []
  let after = 0
  for (;;) {
    const r = await page.request.get(`/api/jobs/${id}/logs?format=json&after=${after}`)
    expect(r.status()).toBe(200)
    const b = (await r.json()) as { events: Ev[] }
    if (!b.events.length) break
    out.push(...b.events)
    after = b.events[b.events.length - 1].seq
    if (b.events.length < 1000) break
  }
  return out
}

async function hostJson(mac: string): Promise<HostJson> {
  const r = await page.request.get(`/api/hosts/${hostId(mac)}`)
  expect(r.status()).toBe(200)
  return (await r.json()) as HostJson
}

function inOrder(msgs: string[], re: RegExp[]): { ok: boolean; missing: string[] } {
  let i = 0
  const missing: string[] = []
  for (const r of re) {
    const j = msgs.findIndex((m, k) => k >= i && r.test(m))
    if (j < 0) missing.push(String(r))
    else i = j + 1
  }
  return { ok: missing.length === 0, missing }
}

async function waitSshRelay(node: KvmNode, timeoutMs: number): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if ((await relayAsync("wait-ssh", node, { WAIT_SEC: "10" }, 60_000)).code === 0) return true
    await sleep(5_000)
  }
  return false
}

function verifyEnv(node: KvmNode): Record<string, string> {
  return {
    EXPECT_HOSTNAME: node.hostname, EXPECT_IP: node.ip, EXPECT_PREFIX: String(KVM.prefix), EXPECT_MAC: node.mac,
    EXPECT_GW: KVM.gateway, EXPECT_DNS: KVM.dns, EXPECT_USER: KVM.user, EXPECT_PUBKEY: publicKey(), EXPECT_VLAN: String(VLAN),
  }
}

function pwRejected(out: string): boolean {
  const methods = (/Permission denied \(([a-z,-]*)\)/.exec(out)?.[1] ?? "").split(",")
  return !out.includes("(exit 0)") && methods.includes("publickey") && !methods.includes("password") && !methods.includes("keyboard-interactive")
}

/** Sheet lengkap satu host lewat UI (tab Network VLAN-aware) → Simpan & Install. */
async function configureInstall(node: KvmNode, first: boolean): Promise<Locator> {
  const row = hostRow(node.mac)
  await expect(row).toHaveCount(1, { timeout: 10 * 60_000 })
  await row.getByRole("button", { name: /^Aksi untuk/ }).click()
  await page.getByRole("menuitem", { name: "Install OS" }).click()
  const sheet = page.getByRole("dialog", { name: /^Konfigurasi / })
  await sheet.locator(`[id="os-${OS_ID[node.os]}"]`).click()
  await sheet.locator("#os-disk").fill("")
  await sheet.getByRole("tab", { name: /^Credentials/ }).click()
  await sheet.locator("#cred-user").fill(KVM.user)
  if (first) {
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
  // Tab Network VLAN-aware (M7-T6): VLAN terdaftar → prefix & gateway jaringan VLAN terisi otomatis.
  await sheet.locator("#net-vlan").fill(String(VLAN))
  await expect(sheet.locator("#net-gw")).toHaveValue(KVM.gateway)
  await expect(sheet.locator("#net-prefix")).toHaveValue(String(KVM.prefix))
  await sheet.locator("#net-ip").fill(node.ip)
  await expect(sheet.locator('[data-slot="field-error"]')).toHaveCount(0)
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
  await sheet.getByRole("tab", { name: /^Network/ }).click()
  await page.screenshot({ path: shot(`${node.name}-sheet-network`), mask: [sheet.locator("#cred-pass")] })
  await sheet.getByRole("button", { name: "Simpan & Install" }).click()
  const confirm = page.getByRole("alertdialog", { name: /^Install OS ke / })
  const saved = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().endsWith(`/api/hosts/${hostId(node.mac)}`), { timeout: 60_000 })
  const installed = page.waitForResponse((r) => r.url().endsWith(`/api/hosts/${hostId(node.mac)}/install`), { timeout: 60_000 })
  await confirm.getByRole("button", { name: "Hapus disk & install" }).click()
  const s = await saved
  const sentBody = s.request().postDataJSON() as { network?: { vlan?: number; gateway?: string; prefix?: number } }
  expect(s.status(), await s.text()).toBe(200)
  expect((await installed).status()).toBe(200)
  const pill = row.locator("[data-status]").first()
  await expect(pill).toHaveAttribute("data-status", "booting")
  note(node, `install dibuat (UI) os=${OS_ID[node.os]} ip=${node.ip}/${KVM.prefix} vlan=${sentBody.network?.vlan} gw=${sentBody.network?.gateway} generator=${first}`)
  resetNode(node)
  note(node, "node.sh reset")
  return pill
}

type Watch = { seen: string[]; last: string; doneS: number }

/** Jejak status dari API (job terakhir) bila worker di-restart setelah test sebelumnya gagal. */
async function watchFromApi(n: KvmNode): Promise<Watch> {
  const j = (await jobs(n.mac))[0]
  if (!j) return { seen: [], last: "", doneS: -1 }
  const seen: string[] = []
  for (const s of j.stages) if (seen[seen.length - 1] !== s.stage) seen.push(s.stage)
  const first = j.stages[0] ? Date.parse(j.stages[0].at) : NaN
  const lastAt = j.stages.length ? Date.parse(j.stages[j.stages.length - 1].at) : NaN
  note(n, `jejak status dari API (worker di-restart): ${seen.join(">")}`)
  return { seen, last: j.status, doneS: Number.isFinite(first) && Number.isFinite(lastAt) ? Math.round((lastAt - first) / 1000) : -1 }
}

if (ACTIVE) {
  if (TOPOLOGY !== "vlan") throw new Error("m7-vlan: PXE_KVM_TOPOLOGY harus vlan")
  const NODES = kvmNodes()
  const pills = new Map<string, Locator>()
  const watched = new Map<string, Watch>()
  // Tanpa mode serial: test gagal (mis. AC-7.20) tidak boleh menghentikan instalasi/verifikasi node lain.
  // Setelah worker di-restart, status dibaca ulang dari tabel/API (watchOrApi).

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 }, locale: "id-ID" })
    page = await ctx.newPage()
    const [user, pw] = adminCredentials()
    await page.goto("/hosts")
    await expect(page).toHaveURL(/\/login\?next=%2Fhosts$/)
    await page.getByLabel("Username").fill(user)
    await page.getByLabel("Password", { exact: true }).fill(pw)
    await page.getByTestId("login-submit").click()
    await expect(page).toHaveURL(/\/hosts$/, { timeout: 30_000 })
  })

  test.afterAll(async () => {
    await ctx?.close()
    const [, adminPw] = adminCredentials()
    const findings = scanEvidence([PASSWORD, adminPw, ...generated])
    writeFileSync(
      path.join(KVM.runsDir, "evidence-scan.txt"),
      findings.length ? findings.join("\n") + "\n" : "bersih: tanpa password node/admin/generator, token /boot/, private key (teks & base64)\n",
    )
    record({ ac: "AC-7.30-scan", status: findings.length ? "FAIL" : "PASS", note: `${findings.length} temuan (scan harness)`, evidence: ["evidence-scan.txt"] })
    writeResults({ scenario: SCEN, vlan: VLAN, nodes: NODES.map((n) => ({ name: n.name, fw: n.fw, os: n.os, ip: n.ip, hostname: n.hostname })) })
  })

  if (CORE) {
    test("AC-7.20 perimeter & topologi: switch-check, server-listen-vlan, VLAN server, settings, host tanpa route VLAN", async ({ playwright }) => {
      const t0 = Date.now()
      const problems: string[] = []
      const anon = await playwright.request.newContext({ baseURL: BASE })
      const login = await anon.get("/login")
      const noSess = await anon.get("/api/settings")
      const media = await anon.head("/media/ubuntu-24.04/casper/vmlinuz")
      await anon.dispose()
      const set = (await (await page.request.get("/api/settings")).json()) as { cidr?: string; vlanNetworks?: { vlan: number; cidr: string; gateway: string; prefix: number }[] }
      if (login.status() !== 200) problems.push(`GET /login ${login.status()}`)
      if (noSess.status() !== 401) problems.push(`/api/settings tanpa sesi ${noSess.status()}`)
      if (media.status() !== 200) problems.push(`HEAD vmlinuz ${media.status()}`)
      if (set.cidr !== PXE_CIDR) problems.push(`cidr ${set.cidr}`)
      if (!set.vlanNetworks?.some((v) => v.vlan === VLAN && v.cidr === VLAN_CIDR && v.gateway === KVM.gateway && v.prefix === 24)) problems.push(`vlanNetworks ${JSON.stringify(set.vlanNetworks)}`)
      const rd = (f: string) => (existsSync(path.join(KVM.runsDir, f)) ? readFileSync(path.join(KVM.runsDir, f), "utf8") : "")
      const sw = rd("switch-check.txt")
      for (const want of ["sw-p1 10 pvid-untagged", "sw-p1 20 tagged", "sw-up 10 tagged", "sw-up 20 tagged", "sw-p2 20 pvid-untagged", "OK   br0 vlan_filtering 1", "OK   br0 vlan_default_pvid 0", "RESULT: PASS"]) {
        if (!sw.includes(want)) problems.push(`switch-check tanpa "${want}"`)
      }
      const lv = rd("server-listen-vlan.txt")
      if (!/RESULT: PASS/.test(lv) || !/OK +dnsmasq DHCP listen udp %pxe10:67/.test(lv)) problems.push("server-listen-vlan.txt bukan PASS / tanpa %pxe10:67")
      const srv = serverRun(String.raw`
echo "# ip -d link pxe10/mgmt20"; ip -d -o link show pxe10; ip -d -o link show mgmt20
echo "# ip -br addr"; ip -br addr
echo "# ip_forward=$(cat /proc/sys/net/ipv4/ip_forward)"
echo "# ss -lunp"; ss -lunp
echo "# ss -ltnp"; ss -ltnp`)
      writeFileSync(path.join(KVM.runsDir, "ac-7.20-server-net.txt"), srv.out)
      if (!/pxe10@trunk0:.* vlan protocol 802\.1Q id 10 /.test(srv.out)) problems.push("pxe10 bukan VLAN 10 di trunk0")
      if (!/mgmt20@trunk0:.* vlan protocol 802\.1Q id 20 /.test(srv.out)) problems.push("mgmt20 bukan VLAN 20 di trunk0")
      if (!/# ip_forward=0/.test(srv.out)) problems.push("ip_forward bukan 0")
      // dnsmasq hanya di pxe10/10.99.10.2 (DEC-023 §3).
      const dnsmasqSock = srv.out.split("\n").filter((l) => /"dnsmasq"/.test(l))
      // Sah: alamat 10.99.10.2 (53/69) atau terikat device pxe10 (`0.0.0.0%pxe10:67`, link-local `%pxe10`).
      const badSock = dnsmasqSock.filter((l) => !/\s(10\.99\.10\.2:(53|67|69)|\S*%pxe10\]?:\d+)\s/.test(l))
      if (!dnsmasqSock.length || badSock.length) problems.push(`socket dnsmasq di luar pxe10: ${badSock.join(" | ") || "tidak ada socket"}`)
      const pre = rd("kvm-run-preflight.txt")
      const route = (pre.split("# ip route get 10.99.10.2")[1] ?? "").split("\n").slice(0, 3).join(" ").trim()
      if (!route) problems.push("preflight tanpa `ip route get 10.99.10.2`")
      // Host tidak pernah menyasar VLAN 10/20: kvm-run.txt (sampai tahap ini) tanpa alamat VLAN.
      const kr = rd("kvm-run.txt")
      if (/10\.99\.(10|20)\.\d/.test(kr)) problems.push("kvm-run.txt memuat alamat 10.99.10/20")
      const file = "ac-7.20-perimeter.txt"
      writeFileSync(
        path.join(KVM.runsDir, file),
        [
          `GET /login (tanpa sesi): ${login.status()}`, `GET /api/settings tanpa sesi: ${noSess.status()}`, `HEAD /media/ubuntu-24.04/casper/vmlinuz: ${media.status()}`,
          `GET /api/settings (sesi): cidr=${set.cidr} vlanNetworks=${JSON.stringify(set.vlanNetworks)}`,
          `host ip route get 10.99.10.2 (baca saja, preflight): ${route}`,
          `socket dnsmasq: ${dnsmasqSock.map((l) => l.replace(/\s+/g, " ")).join(" | ")}`,
          `switch-check.txt RESULT PASS: ${/RESULT: PASS/.test(sw)}; server-listen-vlan.txt RESULT PASS: ${/RESULT: PASS/.test(lv)}`,
          `masalah: ${problems.join("; ") || "tidak ada"}`,
        ].join("\n") + "\n",
      )
      record({ ac: "AC-7.20", status: problems.length ? "FAIL" : "PASS", durationS: Math.round((Date.now() - t0) / 1000), note: problems.join("; ") || "topologi & perimeter sesuai §2.1–2.3", evidence: [file, "ac-7.20-server-net.txt", "switch-check.txt", "server-listen-vlan.txt", "kvm-run-preflight.txt"] })
      expect(problems).toEqual([])
    })
  }

  test(`${SCEN}: host muncul tanpa reload → Sheet VLAN 20 → Simpan & Install (UI) untuk semua node`, async () => {
    test.setTimeout(20 * 60_000)
    await page.goto("/hosts")
    await page.evaluate(NO_RELOAD)
    for (const n of NODES) {
      await expect(hostRow(n.mac)).toHaveCount(1, { timeout: 10 * 60_000 })
      const h = await hostJson(n.mac)
      note(n, `host muncul (tanpa reload) currentIp=${h.currentIp}`)
      await page.screenshot({ path: shot(`${n.name}-discovered`) })
    }
    for (const [i, n] of NODES.entries()) pills.set(n.name, await configureInstall(n, i === 0))
    expect(await page.evaluate(STILL_NO_RELOAD)).toBe(true)
  })

  test(`${SCEN}: Booting → Installing → Configuring → Done ≤ 30 mnt tanpa reload`, async () => {
    test.setTimeout(35 * 60_000)
    const started = Date.now()
    for (const n of NODES) watched.set(n.name, { seen: [], last: "", doneS: -1 })
    const pending = new Set(NODES.map((n) => n.name))
    while (pending.size && Date.now() - started < INSTALL_TIMEOUT_MS) {
      for (const n of NODES) {
        if (!pending.has(n.name)) continue
        const w = watched.get(n.name)!
        const st = (await (pills.get(n.name) ?? hostRow(n.mac).locator("[data-status]").first()).getAttribute("data-status")) ?? ""
        if (st && st !== w.last) {
          w.seen.push(st)
          w.last = st
          note(n, `${st} (UI, +${Math.round((Date.now() - started) / 1000)} dtk)`)
          await page.screenshot({ path: shot(`${n.name}-${st}`) })
        }
        if (st === "done" || st === "failed") {
          pending.delete(n.name)
          w.doneS = Math.round((Date.now() - started) / 1000)
        }
      }
      await page.waitForTimeout(2_000)
    }
    const noReload = await page.evaluate(STILL_NO_RELOAD)
    const bad = NODES.filter((n) => JSON.stringify(watched.get(n.name)!.seen) !== JSON.stringify(["booting", "installing", "configuring", "done"]))
    writeResults({ statusTrail: Object.fromEntries([...watched.entries()].map(([k, v]) => [k, v])) })
    expect(noReload, "halaman tidak di-reload").toBe(true)
    expect(bad.map((n) => `${n.name}: ${watched.get(n.name)!.seen.join(">")}`)).toEqual([])
  })

  test(`${SCEN}: pcap trunk0, log nginx, relay verify, MTU, reboot dari disk per node`, async () => {
    test.setTimeout(60 * 60_000)
    // pcap trunk0 (dimulai kvm-run.sh sebelum node dibuat): ringkasan sampai semua node Done, lalu
    // capture dimulai lagi untuk boot ulang (kvm-run.sh menulis capture-trunk0.txt di akhir).
    const cap = relayCapture("capture-stop", "trunk0")
    writeFileSync(path.join(KVM.runsDir, "capture-trunk0-install.txt"), cap.out)
    const restart = relayCapture("capture-start", "trunk0")
    note(SCEN, `capture trunk0: stop exit=${cap.code}; start ulang exit=${restart.code}`)
    const pkts = parseCapture(cap.out)
    const failures: string[] = []
    for (const n of NODES) {
      const t0 = Date.now()
      const ac = acFor(n)
      const problems: string[] = []
      const w = watched.get(n.name) ?? (await watchFromApi(n))
      if (w.last !== "done") problems.push(`status akhir ${w.last} (${w.seen.join(">")})`)
      if (JSON.stringify(w.seen) !== JSON.stringify(["booting", "installing", "configuring", "done"])) problems.push(`urutan status ${w.seen.join(">")}`)
      if (w.doneS > INSTALL_TIMEOUT_MS / 1000 || w.doneS < 0) problems.push(`durasi ${w.doneS} dtk`)
      // pcap: DISCOVER node ber-tag vlan 10, OFFER/ACK server ber-tag vlan 10 untuk MAC node.
      const disc = pkts.filter((p) => p.src === n.mac && p.vlan === 10 && p.msgType === "Discover").length
      const offer = pkts.filter((p) => p.src === SERVER_TRUNK_MAC && p.vlan === 10 && p.msgType === "Offer" && p.client === n.mac).length
      const ack = pkts.filter((p) => p.src === SERVER_TRUNK_MAC && p.vlan === 10 && p.msgType === "ACK" && p.client === n.mac).length
      const otherVlan = pkts.filter((p) => (p.src === n.mac || p.client === n.mac) && p.vlan !== 10).length
      if (!(disc >= 1 && offer >= 1 && ack >= 1) || otherVlan) problems.push(`pcap trunk0 discover=${disc} offer=${offer} ack=${ack} non-vlan10=${otherVlan}`)
      // dnsmasq: lease di pxe10.
      const txs = dhcpTransactions(n.mac)
      const leaseIp = (await hostJson(n.mac)).currentIp
      // nginx: file konfigurasi dari IP lease VLAN 10; callback status terakhir dari IP statis VLAN 20.
      const ng = nginxLinesFor(n.mac)
      const cfg = ng.filter((l) => l.method === "GET" && l.uri.endsWith(`/${CONFIG_FILE[n.os]}`) && l.status === 200)
      const st = ng.filter((l) => l.method === "POST" && /\/status$/.test(l.uri))
      const lastSt: NginxLine | undefined = st[st.length - 1]
      if (!cfg.length || !cfg.every((l) => l.ip.startsWith("10.99.10."))) problems.push(`${CONFIG_FILE[n.os]} dari ${cfg.map((l) => l.ip).join(",") || "—"}`)
      if (!lastSt || lastSt.ip !== n.ip) problems.push(`callback status terakhir dari ${lastSt?.ip ?? "—"} (harap ${n.ip})`)
      // Event installer (distro).
      const js = await jobs(n.mac)
      const evs = js[0] ? await jobLog(js[0].id) : []
      const msgs = evs.filter((e) => e.kind === "installer").map((e) => e.message.split("\n")[0])
      const order = EXPECTED_EVENTS[n.os] ? inOrder(msgs, EXPECTED_EVENTS[n.os]!) : { ok: true, missing: [] as string[] }
      if (!order.ok) problems.push(`event installer hilang/tidak berurutan: ${order.missing.join(", ")}`)
      if (js.length !== 1) problems.push(`jumlah job ${js.length}`)
      // Verifikasi lewat relay (sebelum reboot).
      let v1 = { code: -1, out: "SSH relay tidak siap" }
      let pw = { code: -1, out: "" }
      let mtu = { ok: false, out: "" }
      let probe = { code: -1, out: "" }
      let rebootLine = "reboot tidak dijalankan"
      let v2 = { code: -1, out: "" }
      let dhcpAfterOs: string[] = []
      const up = w.last === "done" && (await waitSshRelay(n, 10 * 60_000))
      note(n, `ssh (relay) key yang di-inject: ${up}`)
      if (!up) problems.push("SSH relay gagal")
      if (up) {
        v1 = await relayAsync("verify", n, verifyEnv(n), 5 * 60_000)
        pw = await relayAsync("pwcheck", n, {}, 60_000)
        if (v1.code !== 0) problems.push(`verify-node (relay) exit ${v1.code}`)
        if (!pwRejected(pw.out)) problems.push("login password tidak ditolak")
        mtu = mtuCheck(n.ip)
        if (!mtu.ok) problems.push("MTU VLAN 20 (DF 1472)")
        if (CORE) probe = await relayAsync("probe", n, {}, 120_000)
        // Reboot dari disk.
        const jobsBefore = (await jobs(n.mac)).length
        const marksBefore = (consoleLog(n).match(INSTALLER_MARK) ?? []).length
        const consLen = consoleLog(n).length
        const ipxeBefore = nginxLinesFor(n.mac).filter((l) => l.method === "GET" && l.uri.startsWith(`/boot/${n.mac}.ipxe`)).length
        await relayAsync("reboot", n, {}, 60_000)
        await sleep(30_000)
        const back = await waitSshRelay(n, 12 * 60_000)
        if (back) v2 = await relayAsync("verify", n, verifyEnv(n), 5 * 60_000)
        const cons = consoleLog(n)
        const marksAfter = (cons.match(INSTALLER_MARK) ?? []).length
        const serialLocal = /boot dari disk lokal|Tidak ada instalasi aktif/.test(cons.slice(consLen))
        const ipxeAfter = nginxLinesFor(n.mac).filter((l) => l.method === "GET" && l.uri.startsWith(`/boot/${n.mac}.ipxe`)).length
        const h = await hostJson(n.mac)
        const jobsAfter = (await jobs(n.mac)).length
        rebootLine = `reboot: kembali=${back} verify2=${v2.code} status=${h.status} currentIp=${h.currentIp} job ${jobsBefore}->${jobsAfter} penanda-installer-serial ${marksBefore}->${marksAfter} iPXE-script ${ipxeBefore}->${ipxeAfter} serial-boot-lokal=${serialLocal}`
        note(n, rebootLine)
        if (!back || v2.code !== 0 || h.status !== "done" || jobsAfter !== 1 || jobsBefore !== 1 || marksAfter !== marksBefore || ipxeAfter <= ipxeBefore) problems.push(rebootLine)
        // AC-7.25: DHCP setelah Done hanya dari boot PXE ulang (firmware/iPXE), bukan OS terpasang.
        dhcpAfterOs = dhcpTransactions(n.mac).filter((t) => !txs.some((b) => b.xid === t.xid) && !isBootClient(t)).map((t) => `${t.at} ${t.xid} ${t.msgs.join(",")} vendor=${t.vendor}`)
        if (dhcpAfterOs.length) problems.push(`DHCP dari OS terpasang setelah Done: ${dhcpAfterOs.join(" | ")}`)
      }
      const vf = `${n.name}-relay-verify.txt`
      writeFileSync(
        path.join(KVM.runsDir, vf),
        [
          `# ${ac} ${n.name} (${n.os}, ${n.fw}) VLAN ${VLAN} ${n.ip}/${KVM.prefix}: ${w.seen.join(" → ")} dalam ${w.doneS} dtk (UI tanpa reload)`,
          `# lease VLAN 10 (currentIp sebelum reboot): ${leaseIp}`,
          `# pcap trunk0 (capture-trunk0-install.txt): DISCOVER node vlan10=${disc} OFFER server vlan10=${offer} ACK server vlan10=${ack} frame non-vlan10=${otherVlan}`,
          "# nginx (token disamarkan): file konfigurasi", ...cfg.map((l) => `  ${l.ip} ${l.at} ${l.method} ${l.uri} ${l.status}`),
          "# nginx: callback status", ...st.map((l) => `  ${l.ip} ${l.at} ${l.method} ${l.uri} ${l.status}`),
          `# event installer berurutan: ${order.ok} ${order.missing.join(", ")}`, ...msgs.map((m) => `  ${m}`),
          "# dnsmasq: transaksi DHCP sebelum verifikasi", ...txs.map((t) => `  ${t.at} ${t.xid} ${t.msgs.join(",")} vendor=${t.vendor} user=${t.user}`),
          "# verify-node.sh lewat relay (sebelum reboot)", v1.out.trim(), `# exit=${v1.code}`,
          "# pwcheck (relay)", pw.out.trim(), `# password ditolak=${pwRejected(pw.out)}`,
          "# MTU", mtu.out.trim(), `# mtu ok=${mtu.ok}`,
          ...(CORE ? ["# probe (relay, dari node)", probe.out.trim()] : []),
          `# ${rebootLine}`,
          "# verify-node.sh lewat relay (sesudah reboot)", v2.out.trim(), `# exit=${v2.code}`,
          `# DHCP dari OS terpasang setelah Done: ${dhcpAfterOs.join(" | ") || "tidak ada"}`,
          `# masalah: ${problems.join("; ") || "tidak ada"}`,
        ].join("\n") + "\n",
      )
      const evidence = [vf, `${n.name}-timeline.txt`, "capture-trunk0-install.txt", `screenshots/${n.name}-sheet-network.png`]
      record({ ac, node: n.name, status: problems.length ? "FAIL" : "PASS", durationS: w.doneS, note: problems.join("; ") || `${w.seen.join("→")} ${w.doneS}s; verify ${v1.code}/${v2.code}; MTU ok; job 1`, evidence })
      if (CORE) {
        // AC-7.29: isolasi L3 — server ip_forward=0 (AC-7.20), probe dari node lewat relay, host → 200.
        const fwd = serverRun("cat /proc/sys/net/ipv4/ip_forward").out.trim()
        const hostApi = (await page.request.get("/api/hosts")).status()
        const pOk = /probe ping 10\.99\.0\.1: unreachable/.test(probe.out) && /probe GET http:\/\/10\.99\.10\.2\/api\/hosts: 403/.test(probe.out) && /probe GET http:\/\/10\.99\.0\.2\/api\/hosts: 403/.test(probe.out)
        const ok29 = pOk && fwd === "0" && hostApi === 200
        record({ ac: "AC-7.29", node: n.name, status: ok29 ? "PASS" : "FAIL", note: `ip_forward=${fwd}; host GET /api/hosts (sesi)=${hostApi}; ${probe.out.trim().replace(/\n/g, "; ")}`, evidence: [vf] })
        if (!ok29) problems.push("AC-7.29 isolasi L3")
      }
      note(n, `${ac} selesai dalam ${Math.round((Date.now() - t0) / 1000)} dtk; masalah: ${problems.join("; ") || "tidak ada"}`)
      if (problems.length) failures.push(`${n.name}: ${problems.join("; ")}`)
    }
    expect(failures).toEqual([])
  })

  if (CORE) {
    test("AC-7.23 validasi VLAN di server nyata: IP bentrok (UI+API), di luar subnet VLAN, VLAN tidak terdaftar → 422, konfigurasi tidak berubah", async () => {
      test.setTimeout(10 * 60_000)
      const [n31, n32] = NODES
      const id32 = hostId(n32.mac)
      const cfg = async (n: KvmNode) => (await page.request.get(`/api/hosts/${hostId(n.mac)}/config`)).text()
      const b31 = await cfg(n31)
      const b32 = await cfg(n32)
      const problems: string[] = []
      // UI: node32 IP = IP node31 (VLAN 20) → error field, Simpan nonaktif, tanpa PATCH.
      await page.goto("/hosts")
      let patches = 0
      const onReq = (r: { method: () => string }) => {
        if (r.method() === "PATCH") patches++
      }
      page.on("request", onReq)
      const row = hostRow(n32.mac)
      await row.getByRole("button", { name: /^Aksi untuk/ }).click()
      await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
      const sheet = page.getByRole("dialog", { name: /^Konfigurasi / })
      await sheet.getByRole("tab", { name: /^Network/ }).click()
      await expect(sheet.locator("#net-vlan")).toHaveValue(String(VLAN))
      await sheet.locator("#net-ip").fill(n31.ip)
      const fieldErr = sheet.locator('[data-slot="field-error"]').first()
      await expect(fieldErr).toContainText(/Bentrok/)
      const uiErr = (await fieldErr.textContent())?.trim() ?? ""
      const saveDisabled = await sheet.getByRole("button", { name: "Simpan konfigurasi" }).isDisabled()
      await page.screenshot({ path: shot("ac-7.23-ip-conflict-ui") })
      await page.keyboard.press("Escape")
      await expect(sheet).toBeHidden()
      page.off("request", onReq)
      if (!saveDisabled) problems.push("tombol Simpan tidak nonaktif")
      if (patches) problems.push(`${patches} PATCH terkirim dari UI`)
      const net = (ip: string, vlan: number) => ({ network: { mode: "static", assignments: { [id32]: ip }, prefix: 24, gateway: KVM.gateway, dns: [KVM.dns], vlan, iface: { by: "mac" } } })
      const cases: [string, string, number, RegExp | null][] = [
        ["IP bentrok node31", n31.ip, VLAN, /Bentrok/],
        ["di luar subnet VLAN 20", "10.99.30.5", VLAN, /Di luar subnet 10\.99\.20\.0\/24 \(VLAN 20\)/],
        ["VLAN 99 tidak terdaftar", "10.99.20.50", 99, null],
      ]
      const lines = [`UI: IP ${n31.ip} VLAN ${VLAN} untuk ${n32.name} → "${uiErr}", Simpan nonaktif=${saveDisabled}, PATCH terkirim=${patches}`]
      for (const [label, ip, vlan, re] of cases) {
        const r = await page.request.patch(`/api/hosts/${id32}`, { data: net(ip, vlan) })
        const body = await r.text()
        lines.push(`API PATCH ${label} (ip=${ip} vlan=${vlan}): ${r.status()} ${body.slice(0, 300)}`)
        if (r.status() !== 422) problems.push(`${label}: ${r.status()}`)
        if (re && !re.test(body)) problems.push(`${label}: pesan ${body.slice(0, 120)}`)
      }
      const a31 = await cfg(n31)
      const a32 = await cfg(n32)
      lines.push(`konfigurasi identik sebelum/sesudah: ${n31.name}=${a31 === b31} ${n32.name}=${a32 === b32}`)
      if (a31 !== b31 || a32 !== b32) problems.push("konfigurasi berubah")
      lines.push(`masalah: ${problems.join("; ") || "tidak ada"}`)
      writeFileSync(path.join(KVM.runsDir, "ac-7.23-validation.txt"), lines.join("\n") + "\n")
      record({ ac: "AC-7.23", status: problems.length ? "FAIL" : "PASS", note: problems.join("; ") || "UI error field + 3× API 422, konfigurasi tidak berubah", evidence: ["ac-7.23-validation.txt", "screenshots/ac-7.23-ip-conflict-ui.png"] })
      expect(problems).toEqual([])
    })
  }
}
