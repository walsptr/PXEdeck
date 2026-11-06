// Suite KVM M6 run `bulk` (M6-T14, AC-6.50, DEC-018 §4, O12) — DIJALANKAN HANYA lewat
//   infra/kvm-run.sh m6 --scenario bulk --waves      (node "25:uefi 26:uefi 27:uefi")
// Test hanya terdaftar bila PXE_KVM_SCENARIO=bulk.
// Alur: kvm-run.sh membuat node per gelombang, menunggu discover (GET /boot/<mac>.ipxe) lalu
// mematikannya. Suite: login UI → ketiga host di tabel → urutkan MAC naik → pilih ketiganya →
// "Install OS" bulk: Ubuntu 24.04, credentials mode B (password acak per host, CSV diunduh sekali),
// IP mulai 10.99.0.35 + increment 1 (preview MAC → IP), hostname `m6-bulk-{index:02}` (preview tanpa
// duplikat), SSH key run → satu "Simpan & Install" → node.sh start per gelombang (PXE_KVM_WAVES) →
// Done ≤ 30 mnt sejak dinyalakan → SSH (hostname/IP sesuai preview, key, sudo, password ditolak) →
// nginx tanpa 429 untuk IP node. Verifikasi verify-node.sh per gelombang oleh kvm-run.sh.
// Password acak hanya di memori (scan bukti di afterAll); berkas CSV unduhan dihapus Playwright.
import { spawnSync } from "node:child_process"
import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { expect, test, type BrowserContext, type Page } from "@playwright/test"

import {
  adminCredentials,
  KVM,
  kvmNodes,
  passwordLoginRejected,
  powerNode,
  publicKey,
  record,
  scanEvidence,
  ssh,
  writeResults,
  type KvmNode,
} from "./kvm-harness"

const BULK = process.env.PXE_KVM_SCENARIO === "bulk"
const BASE = process.env.PXE_KVM_BASE_URL ?? "http://10.99.0.2"
const SERVER_IP = "10.99.0.2"
const INSTALL_TIMEOUT_MS = 30 * 60_000
const IP_START = "10.99.0.35"
const TEMPLATE = "m6-bulk-{index:02}"
const hostId = (mac: string) => mac.replaceAll(":", "")
const shot = (name: string) => path.join(KVM.runsDir, "screenshots", `${name}.png`)
const NO_RELOAD = () => ((window as unknown as { __noReload: boolean }).__noReload = true)
const STILL_NO_RELOAD = () => (window as unknown as { __noReload?: boolean }).__noReload === true
const generated: string[] = []

function note(msg: string) {
  appendFileSync(path.join(KVM.runsDir, "bulk-timeline.txt"), `${new Date().toISOString()} ${msg}\n`)
}

function serverSsh(remote: string): { code: number; out: string } {
  const key = path.join(path.dirname(path.resolve(KVM.sshKey)), "infra_ed25519")
  if (!/\/\.agent\/keys\/infra_ed25519$/.test(key)) throw new Error(`key ${key}`)
  const r = spawnSync(
    "ssh",
    ["-i", key, "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR", "-o", "ConnectTimeout=10", "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", `root@${SERVER_IP}`, remote],
    { encoding: "utf8", timeout: 60_000, input: "" },
  )
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` }
}

function waves(nodes: KvmNode[]): KvmNode[][] {
  const w = (process.env.PXE_KVM_WAVES ?? "").trim()
  if (!w) return [nodes]
  return w.split(/\s+/).map((g) => g.split(",").map((n) => nodes.find((x) => x.name === n)!))
}

let ctx: BrowserContext
let page: Page

if (BULK) {
  const NODES = kvmNodes()
  const ipOf = (i: number) => `10.99.0.${35 + i}`
  const hnOf = (i: number) => `m6-bulk-${String(i + 1).padStart(2, "0")}`

  test.beforeAll(async ({ browser }) => {
    ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 }, locale: "id-ID", acceptDownloads: true })
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
    const findings = scanEvidence([adminPw, ...generated])
    writeFileSync(
      path.join(KVM.runsDir, "evidence-scan.txt"),
      findings.length ? findings.join("\n") + "\n" : "bersih: tanpa password acak/admin, token /boot/, private key (teks & base64)\n",
    )
    record({ ac: "AC-6.52-scan", status: findings.length ? "FAIL" : "PASS", note: `${findings.length} temuan (password acak di memori: ${generated.length})`, evidence: ["evidence-scan.txt"] })
    writeResults({ scenario: "bulk", waves: waves(NODES).map((w) => w.map((n) => n.name)), maxNodes: Number(process.env.PXE_KVM_MAX_NODES ?? 0), nodes: NODES.map((n) => ({ name: n.name, ip: n.ip, hostname: n.hostname })) })
  })

  test("AC-6.50 bulk 3× UEFI Ubuntu: satu Simpan & Install (password acak, IP increment, template hostname, key) → gelombang → Done + SSH", async () => {
    test.setTimeout(100 * 60_000)
    const t0 = Date.now()
    expect(NODES).toHaveLength(3)
    NODES.forEach((n, i) => {
      expect(n.ip).toBe(ipOf(i))
      expect(n.hostname).toBe(hnOf(i))
    })
    await page.goto("/hosts")
    await page.evaluate(NO_RELOAD)
    const table = page.locator("main table").first()
    for (const n of NODES) await expect(table.locator("tbody tr").filter({ has: page.getByText(n.mac, { exact: true }) })).toHaveCount(1, { timeout: 5 * 60_000 })
    // Urutkan MAC naik → urutan tampilan = urutan --nodes (index template & IP increment).
    const macs = NODES.map((n) => n.mac)
    const order = async () => (await table.locator("tbody tr td:nth-child(2)").allTextContents()).map((t) => t.trim()).filter((t) => macs.includes(t))
    await page.getByRole("button", { name: /^MAC Address/ }).click()
    if (JSON.stringify(await order()) !== JSON.stringify(macs)) await page.getByRole("button", { name: /^MAC Address/ }).click()
    expect(await order()).toEqual(macs)
    for (const n of NODES) await page.getByRole("checkbox", { name: `Pilih ${n.mac}` }).click()
    const bar = page.getByRole("toolbar", { name: "Aksi untuk host terpilih" })
    await expect(bar).toContainText("3 host dipilih")
    await bar.getByRole("button", { name: "Install OS" }).click()
    const sheet = page.getByRole("dialog", { name: "Konfigurasi 3 host" })
    await sheet.locator('[id="os-ubuntu-24.04"]').click()
    // Credentials mode B.
    await sheet.getByRole("tab", { name: /^Credentials/ }).click()
    await sheet.getByRole("radio", { name: "Password acak per host" }).click()
    await sheet.locator("#cred-user").fill(KVM.user)
    if ((await sheet.locator("#cred-sudo").getAttribute("aria-checked")) !== "true") await sheet.locator("#cred-sudo").click()
    if ((await sheet.locator("#cred-nopw").getAttribute("aria-checked")) !== "true") await sheet.locator("#cred-nopw").click()
    // IP awal + increment.
    await sheet.getByRole("tab", { name: /^Network/ }).click()
    await sheet.getByRole("radio", { name: "Static" }).click()
    await sheet.getByRole("radio", { name: "IP awal + increment" }).click()
    await sheet.locator("#net-start").fill(IP_START)
    await sheet.locator("#net-step").fill("1")
    const ipRows = sheet.getByRole("table", { name: "Preview IP baru" }).locator("tbody tr")
    await expect(ipRows).toHaveCount(3)
    const ipPreview = (await ipRows.evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll("td")].map((td) => (td.textContent ?? "").trim())))) as string[][]
    await page.screenshot({ path: shot("bulk-ip-preview") })
    // Hostname template.
    await sheet.getByRole("tab", { name: /^Hostname/ }).click()
    await sheet.locator("#hn-template").fill(TEMPLATE)
    await sheet.locator("#hn-start").fill("1")
    const hnTable = sheet.getByRole("table", { name: "Preview Hostname baru" })
    const hnRows = hnTable.locator("tbody tr")
    await expect(hnRows).toHaveCount(3)
    await expect(hnTable.locator('tbody tr[data-state="error"]')).toHaveCount(0)
    const hnPreview = (await hnRows.evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll("td")].map((td) => (td.textContent ?? "").trim())))) as string[][]
    await page.screenshot({ path: shot("bulk-hostname-preview") })
    // SSH key run.
    await sheet.getByRole("tab", { name: /^SSH Keys/ }).click()
    await sheet.getByRole("button", { name: "Tempel / unggah key baru" }).click()
    await sheet.locator("#key-0").fill(publicKey())
    await sheet.locator("#key-name-0").fill(`${KVM.run}-run-key`)
    const ipMap = NODES.map((n) => ipPreview.find((r) => r[0] === n.mac)?.[2])
    const hnMap = NODES.map((n) => hnPreview.find((r) => r[0] === n.mac)?.[2])
    note(`preview IP ${JSON.stringify(ipPreview)}; preview hostname ${JSON.stringify(hnPreview)}`)
    expect(ipMap).toEqual(NODES.map((n) => n.ip))
    expect(hnMap.map((h) => h?.replace(/\s.*$/, ""))).toEqual(NODES.map((n) => n.hostname))

    // Satu Simpan & Install untuk 3 host.
    let bulkPosts = 0
    let installPosts = 0
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/api/hosts/bulk")) bulkPosts++
      if (r.method() === "POST" && /\/api\/hosts\/(bulk\/)?install$|\/install$/.test(r.url())) installPosts++
    })
    await sheet.getByRole("button", { name: "Simpan & Install" }).click()
    const confirm = page.getByRole("alertdialog", { name: "Install OS ke 3 host?" })
    await expect(confirm.locator("li")).toHaveCount(3)
    await confirm.getByRole("button", { name: "Hapus disk & install" }).click()
    const dlg = page.getByRole("dialog", { name: "Password acak dibuat" })
    await expect(dlg).toBeVisible({ timeout: 60_000 })
    const pwRows = dlg.getByRole("table", { name: "Password yang dibuat" }).locator("tbody tr")
    await expect(pwRows).toHaveCount(3)
    const shown = (await pwRows.locator("td:nth-child(3)").allTextContents()).map((t) => t.trim())
    generated.push(...shown)
    await page.screenshot({ path: shot("bulk-passwords-dialog"), mask: [pwRows.locator("td:nth-child(3)")] })
    const [download] = await Promise.all([page.waitForEvent("download"), dlg.getByRole("button", { name: "Unduh CSV" }).click()])
    const csv = readFileSync((await download.path())!, "utf8")
    await download.delete()
    const lines = csv.trim().split("\r\n")
    const csvOk =
      lines[0] === "mac,hostname,username,password" &&
      lines.length === 4 &&
      lines.slice(1).every((l) => {
        const [mac, hn, user, pw] = l.split(",")
        const i = macs.indexOf(mac)
        return i >= 0 && hn === NODES[i].hostname && user === KVM.user && shown.includes(pw)
      })
    await dlg.getByRole("button", { name: "Selesai" }).click()
    await expect(dlg).toBeHidden()
    // Pill Booting untuk ketiganya.
    for (const n of NODES) await expect(table.locator("tbody tr").filter({ has: page.getByText(n.mac, { exact: true }) }).locator("[data-status]").first()).toHaveAttribute("data-status", "booting", { timeout: 60_000 })
    // Password tidak tersedia lagi: API config & halaman tidak memuatnya.
    let leaked = false
    for (const n of NODES) {
      const cfg = await (await page.request.get(`/api/hosts/${hostId(n.mac)}/config`)).text()
      for (const p of shown) if (cfg.includes(p)) leaked = true
    }
    for (const p of shown) if ((await page.locator("body").textContent())?.includes(p)) leaked = true
    note(`satu aksi: POST bulk=${bulkPosts} install=${installPosts}; password unik=${new Set(shown).size}; CSV ok=${csvOk}; password tersisa di UI/API=${leaked}`)

    // Gelombang: start → Done → poweroff (bila ada gelombang berikutnya).
    const ws = waves(NODES)
    const doneIn: Record<string, number> = {}
    const seenBy: Record<string, string[]> = {}
    for (const [wi, w] of ws.entries()) {
      const started = Date.now()
      for (const n of w) powerNode(n, "start")
      note(`gelombang ${wi + 1}/${ws.length} start: ${w.map((n) => n.name).join(",")}`)
      const pending = new Set(w.map((n) => n.mac))
      while (pending.size && Date.now() - started < INSTALL_TIMEOUT_MS) {
        for (const n of w) {
          if (!pending.has(n.mac)) continue
          const st = (await table.locator("tbody tr").filter({ has: page.getByText(n.mac, { exact: true }) }).locator("[data-status]").first().getAttribute("data-status")) ?? ""
          const s = (seenBy[n.name] ??= [])
          if (st && s[s.length - 1] !== st) {
            s.push(st)
            note(`${n.name}: ${st} (UI, +${Math.round((Date.now() - started) / 1000)} dtk sejak start)`)
          }
          if (st === "done" || st === "failed") {
            pending.delete(n.mac)
            doneIn[n.name] = Math.round((Date.now() - started) / 1000)
          }
        }
        await page.waitForTimeout(3_000)
      }
      await page.screenshot({ path: shot(`bulk-wave${wi + 1}-final`) })
      if (wi + 1 < ws.length) for (const n of w) powerNode(n, "poweroff")
    }
    const noReload = await page.evaluate(STILL_NO_RELOAD)

    // SSH ringkas per node (verify-node.sh lengkap per gelombang oleh kvm-run.sh).
    const sshLines: string[] = []
    let sshOk = true
    for (const [wi, w] of ws.entries()) {
      if (wi + 1 < ws.length) for (const n of w) powerNode(n, "start")
      for (const n of w) {
        let r = { code: -1, out: "" }
        for (let i = 0; i < 30 && r.code !== 0; i++) {
          r = ssh(n.ip, `echo "hostname=$(hostname) ip=$(ip -4 -o addr show scope global | awk '{print $4}' | tr '\\n' ' ')"; sudo -n true && echo sudo-ok`)
          if (r.code !== 0) await page.waitForTimeout(10_000)
        }
        const pw = passwordLoginRejected(n.ip)
        const ok = r.code === 0 && r.out.includes(`hostname=${n.hostname} `) && r.out.includes(`${n.ip}/24`) && r.out.includes("sudo-ok") && pw.ok
        if (!ok) sshOk = false
        sshLines.push(`${n.name}: ${r.out.trim().replace(/\n/g, " | ")} ; password ditolak=${pw.ok} → ${ok ? "OK" : "FAIL"}`)
      }
      if (wi + 1 < ws.length) for (const n of w) powerNode(n, "poweroff")
    }
    // nginx: tidak ada 429 untuk IP node (lease dinamis + IP statis).
    const n429 = serverSsh("awk '$0 ~ /\" 429 / {print $1}' /var/log/nginx/pxe-access.log | sort | uniq -c").out.trim()
    const leaseIps = (await Promise.all(NODES.map(async (n) => ((await (await page.request.get(`/api/hosts/${hostId(n.mac)}`)).json()) as { currentIp: string | null }).currentIp))).filter(Boolean)
    const nodeIps = new Set([...NODES.map((n) => n.ip), ...(leaseIps as string[])])
    const node429 = n429.split("\n").filter((l) => nodeIps.has(l.trim().split(/\s+/)[1] ?? ""))
    const jobs = await Promise.all(NODES.map(async (n) => ((await (await page.request.get(`/api/jobs?hostId=${hostId(n.mac)}`)).json()) as { jobs: { status: string }[] }).jobs.map((j) => j.status)))

    writeFileSync(
      path.join(KVM.runsDir, "bulk-ac-6.50.txt"),
      [
        `# urutan tabel (MAC naik): ${macs.join(", ")}`,
        `# preview IP: ${JSON.stringify(ipPreview)}`,
        `# preview hostname: ${JSON.stringify(hnPreview)}`,
        `# satu aksi: POST /api/hosts/bulk=${bulkPosts}, POST install=${installPosts}`,
        `# password acak: ${shown.length} ditampilkan, unik=${new Set(shown).size}, panjang=${shown.map((p) => p.length).join(",")}; CSV unduhan valid=${csvOk}; tersisa di UI/API sesudah dialog ditutup=${leaked}`,
        `# gelombang (max_nodes=${process.env.PXE_KVM_MAX_NODES}): ${ws.map((w) => w.map((n) => n.name).join(",")).join(" | ")}`,
        ...NODES.map((n) => `# ${n.name}: ${(seenBy[n.name] ?? []).join(" → ")} dalam ${doneIn[n.name] ?? -1} dtk sejak start; job ${JSON.stringify(jobs[NODES.indexOf(n)])}`),
        `# UI tanpa reload: ${noReload}`,
        "# SSH", ...sshLines,
        `# nginx 429 per IP (semua): ${n429 || "tidak ada"}`,
        `# nginx 429 untuk IP node (${[...nodeIps].join(",")}): ${node429.length ? node429.join("; ") : "tidak ada"}`,
      ].join("\n") + "\n",
    )
    const allDone = NODES.every((n) => JSON.stringify(seenBy[n.name]?.slice(-1)) === '["done"]' && (doneIn[n.name] ?? 1e9) <= INSTALL_TIMEOUT_MS / 1000)
    const pass = bulkPosts === 1 && new Set(shown).size === 3 && csvOk && !leaked && allDone && noReload && sshOk && node429.length === 0
    record({ ac: "AC-6.50", status: pass ? "PASS" : "FAIL", durationS: Math.round((Date.now() - t0) / 1000), note: `gelombang ${ws.map((w) => w.length).join("+")}; ${NODES.map((n) => `${n.hostname} ${doneIn[n.name] ?? -1}s`).join(", ")}; SSH ${sshOk}; 429 node ${node429.length}`, evidence: ["bulk-ac-6.50.txt", "bulk-timeline.txt", "screenshots/bulk-ip-preview.png", "screenshots/bulk-hostname-preview.png"] })
    expect(bulkPosts).toBe(1)
    expect(new Set(shown).size).toBe(3)
    expect(csvOk).toBe(true)
    expect(leaked).toBe(false)
    for (const n of NODES) {
      expect(seenBy[n.name]?.slice(-1), n.name).toEqual(["done"])
      expect(doneIn[n.name], n.name).toBeLessThanOrEqual(INSTALL_TIMEOUT_MS / 1000)
    }
    expect(noReload).toBe(true)
    expect(sshOk, sshLines.join("\n")).toBe(true)
    expect(node429).toEqual([])
  })
}
