// Suite KVM M6 run `distro` (M6-T14, AC-6.48/AC-6.49, DEC-018 §4, DEC-020, DEC-021) — DIJALANKAN HANYA lewat
//   infra/kvm-run.sh m6 --scenario distro      (node "23:uefi:os=debian 24:uefi:os=rocky")
// Test hanya terdaftar bila PXE_KVM_SCENARIO=distro.
// Per node: login UI → host muncul → Sheet (OS Debian 12 / Rocky 9, disk otomatis, credentials, IP statis,
// hostname, key run) → Simpan & Install → Booting → Installing → Configuring → Done ≤ 30 mnt tanpa reload;
// event installer berurutan (Debian: preseed mulai → modul disk virtio → disk target → late_command →
// konfigurasi target selesai → first-boot; Rocky: kickstart mulai → disk target → post mulai → konfigurasi
// target selesai → first-boot); verify-node.sh (termasuk target bebas token) + login password ditolak +
// fakta (locale, sudo) + DEC-021 §2 (Debian: tanpa `trusted=yes` di /etc/apt, tanpa
// 00AllowUnauthenticated) + `\EFI\BOOT\BOOTX64.EFI` (fallback UEFI) → reboot dari disk (cmdline tanpa
// parameter installer, status tetap Done, jumlah job tetap). Log installer nyata → installer-logs/.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test"

import {
  adminCredentials,
  KVM,
  kvmNodes,
  passwordLoginRejected,
  publicKey,
  record,
  resetNode,
  scanEvidence,
  sessionPassword,
  ssh,
  writeResults,
  type KvmNode,
} from "./kvm-harness"

const DISTRO = process.env.PXE_KVM_SCENARIO === "distro"
const BASE = process.env.PXE_KVM_BASE_URL ?? "http://10.99.0.2"
const INSTALL_TIMEOUT_MS = 30 * 60_000
const PASSWORD = sessionPassword()
const hostId = (mac: string) => mac.replaceAll(":", "")
const shot = (name: string) => path.join(KVM.runsDir, "screenshots", `${name}.png`)
const NO_RELOAD = () => ((window as unknown as { __noReload: boolean }).__noReload = true)
const STILL_NO_RELOAD = () => (window as unknown as { __noReload?: boolean }).__noReload === true
const OS_ID: Record<string, string> = { debian: "debian-12", rocky: "rocky-9" }
/** Urutan event installer yang wajib (subsekuens, regex terhadap baris pertama pesan). */
const EXPECTED_EVENTS: Record<string, RegExp[]> = {
  debian: [/preseed mulai/, /modul disk virtio dimuat/, /disk target dipilih/, /late_command mulai/, /konfigurasi target selesai/, /^first-boot: /],
  rocky: [/kickstart mulai/, /disk target dipilih/, /post mulai/, /konfigurasi target selesai/, /^first-boot: /],
}
const INSTALLER_LOGS: Record<string, string[]> = {
  debian: ["/var/log/installer/syslog"],
  rocky: ["/var/log/anaconda/anaconda.log", "/var/log/anaconda/program.log"],
}
const INSTALLER_CMDLINE = /\b(auto=true|priority=critical|url=http|inst\.ks=|inst\.stage2=|autoinstall)\b/

type Job = { id: string; status: string; failureReason: string | null }
type Ev = { seq: number; kind: string; message: string }

function note(node: KvmNode, msg: string) {
  appendFileSync(path.join(KVM.runsDir, `${node.name}-timeline.txt`), `${new Date().toISOString()} ${msg}\n`)
}

let ctx: BrowserContext
let page: Page

function hostRow(mac: string): Locator {
  return page.locator("main table").first().locator("tbody tr").filter({ has: page.getByText(mac, { exact: true }) })
}

async function jobs(mac: string): Promise<Job[]> {
  const r = await page.request.get(`/api/jobs?hostId=${hostId(mac)}&limit=200`)
  expect(r.status()).toBe(200)
  return ((await r.json()) as { jobs: Job[] }).jobs
}

async function jobLog(id: string): Promise<Ev[]> {
  const r = await page.request.get(`/api/jobs/${id}/logs?format=json&after=0`)
  expect(r.status()).toBe(200)
  return ((await r.json()) as { events: Ev[] }).events
}

/** `re` muncul berurutan (subsekuens) di `msgs`. */
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

if (DISTRO) {
  const NODES = kvmNodes()

  test.beforeAll(async ({ browser }) => {
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
    const findings = scanEvidence([PASSWORD, adminPw])
    writeFileSync(
      path.join(KVM.runsDir, "evidence-scan.txt"),
      findings.length ? findings.join("\n") + "\n" : "bersih: tanpa password node/admin, token /boot/, private key (teks & base64)\n",
    )
    record({ ac: "AC-6.52-scan", status: findings.length ? "FAIL" : "PASS", note: `${findings.length} temuan (scan harness)`, evidence: ["evidence-scan.txt"] })
    writeResults({ scenario: "distro", nodes: NODES.map((n) => ({ name: n.name, os: n.os, ip: n.ip, hostname: n.hostname })) })
  })

  test("distro: konfigurasi + Simpan & Install untuk semua node lewat UI", async () => {
    test.setTimeout(20 * 60_000)
    await page.goto("/hosts")
    await page.evaluate(NO_RELOAD)
    for (const n of NODES) await expect(hostRow(n.mac)).toHaveCount(1, { timeout: 10 * 60_000 })
    for (const [i, node] of NODES.entries()) {
      const row = hostRow(node.mac)
      await row.getByRole("button", { name: /^Aksi untuk/ }).click()
      await page.getByRole("menuitem", { name: "Install OS" }).click()
      const sheet = page.getByRole("dialog", { name: /^Konfigurasi / })
      await sheet.locator(`[id="os-${OS_ID[node.os]}"]`).click()
      await sheet.locator("#os-disk").fill("")
      await sheet.getByRole("tab", { name: /^Credentials/ }).click()
      await sheet.locator("#cred-user").fill(KVM.user)
      await sheet.locator("#cred-pass").fill(PASSWORD)
      if ((await sheet.locator("#cred-sudo").getAttribute("aria-checked")) !== "true") await sheet.locator("#cred-sudo").click()
      if ((await sheet.locator("#cred-nopw").getAttribute("aria-checked")) !== "true") await sheet.locator("#cred-nopw").click()
      await sheet.getByRole("tab", { name: /^Network/ }).click()
      await sheet.getByRole("radio", { name: "Static" }).click()
      await sheet.locator("#net-ip").fill(node.ip)
      await expect(sheet.locator("#net-gw")).toHaveValue(KVM.gateway)
      await sheet.getByRole("tab", { name: /^Hostname/ }).click()
      await sheet.locator("#hn-name").fill(node.hostname)
      await sheet.getByRole("tab", { name: /^SSH Keys/ }).click()
      if (i === 0) {
        await sheet.getByRole("button", { name: "Tempel / unggah key baru" }).click()
        await sheet.locator("#key-0").fill(publicKey())
        await sheet.locator("#key-name-0").fill(`${KVM.run}-run-key`)
      } else {
        const [kType, kBlob] = publicKey().split(/\s+/)
        const lib = (await (await page.request.get("/api/ssh-keys")).json()) as { id: string; publicKey: string }[]
        const k = lib.find((x) => x.publicKey.split(/\s+/)[1] === kBlob && x.publicKey.startsWith(kType))!
        const cb = sheet.locator(`[id="lib-${k.id}"]`)
        if ((await cb.getAttribute("aria-checked")) !== "true") await cb.click()
      }
      await page.screenshot({ path: shot(`${node.name}-sheet`), mask: [sheet.locator("#cred-pass")] })
      await sheet.getByRole("button", { name: "Simpan & Install" }).click()
      const confirm = page.getByRole("alertdialog", { name: /^Install OS ke / })
      const installed = page.waitForResponse((r) => r.url().endsWith(`/api/hosts/${hostId(node.mac)}/install`), { timeout: 60_000 })
      await confirm.getByRole("button", { name: "Hapus disk & install" }).click()
      expect((await installed).status()).toBe(200)
      await expect(row.locator("[data-status]").first()).toHaveAttribute("data-status", "booting")
      note(node, `install dibuat (UI) os=${OS_ID[node.os]} disk=(otomatis)`)
      resetNode(node)
      note(node, "node.sh reset")
    }
  })

  test("distro: semua node Done ≤ 30 mnt tanpa reload, event berurutan, SSH + DEC-021 + reboot dari disk", async () => {
    test.setTimeout(75 * 60_000)
    const started = Date.now()
    const seen: Record<string, string[]> = {}
    const doneS: Record<string, number> = {}
    const pending = new Set(NODES.map((n) => n.name))
    while (pending.size && Date.now() - started < INSTALL_TIMEOUT_MS) {
      for (const n of NODES) {
        if (!pending.has(n.name)) continue
        const st = (await hostRow(n.mac).locator("[data-status]").first().getAttribute("data-status")) ?? ""
        const s = (seen[n.name] ??= [])
        if (st && s[s.length - 1] !== st) {
          s.push(st)
          note(n, `${st} (UI, +${Math.round((Date.now() - started) / 1000)} dtk)`)
          await page.screenshot({ path: shot(`${n.name}-${st}`) })
        }
        if (st === "done" || st === "failed") {
          pending.delete(n.name)
          doneS[n.name] = Math.round((Date.now() - started) / 1000)
        }
      }
      await page.waitForTimeout(3_000)
    }
    const noReload = await page.evaluate(STILL_NO_RELOAD)
    const failures: string[] = []
    for (const n of NODES) {
      const ac = n.os === "debian" ? "AC-6.48" : "AC-6.49"
      const problems: string[] = []
      const js = await jobs(n.mac)
      const evs = js[0] ? await jobLog(js[0].id) : []
      const msgs = evs.filter((e) => e.kind === "installer").map((e) => e.message.split("\n")[0])
      const order = inOrder(msgs, EXPECTED_EVENTS[n.os])
      note(n, `event installer: ${msgs.join(" | ")}`)
      if (JSON.stringify(seen[n.name]) !== JSON.stringify(["booting", "installing", "configuring", "done"])) problems.push(`urutan status ${seen[n.name]?.join(">")}`)
      if ((doneS[n.name] ?? 1e9) > INSTALL_TIMEOUT_MS / 1000) problems.push("lewat 30 mnt")
      if (!order.ok) problems.push(`event hilang/tidak berurutan: ${order.missing.join(", ")}`)
      if (!noReload) problems.push("halaman di-reload")
      let up = false
      for (let i = 0; i < 60 && !up; i++) {
        up = ssh(n.ip, "true").code === 0
        if (!up) await page.waitForTimeout(10_000)
      }
      const envs = [
        `EXPECT_HOSTNAME=${n.hostname}`, `EXPECT_IP=${n.ip}`, `EXPECT_PREFIX=${KVM.prefix}`, `EXPECT_MAC=${n.mac}`,
        `EXPECT_GW=${KVM.gateway}`, `EXPECT_DNS=${KVM.dns}`, `EXPECT_USER=${KVM.user}`, `EXPECT_PUBKEY='${publicKey()}'`,
      ].join(" ")
      const script = readFileSync(path.join(__dirname, "verify-node.sh"), "utf8")
      const v1 = ssh(n.ip, `${envs} bash -s`, script)
      const pw = passwordLoginRejected(n.ip)
      const facts = ssh(
        n.ip,
        "bash -s",
        [
          'echo "# hostname: $(hostname)"',
          "echo '# locale'; localectl status 2>&1 | head -n 3",
          "echo '# sudo'; sudo -n true && echo sudo-ok",
          "echo '# apt trusted=yes (DEC-021 §2)'; n=$(sudo -n grep -rl 'trusted=yes' /etc/apt 2>/dev/null | wc -l); echo \"trusted_files=$n\"",
          "echo '# 00AllowUnauthenticated'; if sudo -n test -e /etc/apt/apt.conf.d/00AllowUnauthenticated; then echo allow_unauth=ADA; else echo allow_unauth=tidak-ada; fi",
          "echo '# UEFI fallback'; if sudo -n test -f /boot/efi/EFI/BOOT/BOOTX64.EFI; then echo bootx64=ADA; else echo bootx64=TIDAK; fi",
          "echo '# cmdline'; cat /proc/cmdline",
          "echo '# lsblk'; lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT",
        ].join("\n") + "\n",
      )
      // Log installer nyata (bahan fixture AC-6.17; disamarkan redact-evidence.sh oleh kvm-run.sh).
      const dir = path.join(KVM.runsDir, "installer-logs")
      mkdirSync(dir, { recursive: true })
      for (const f of INSTALLER_LOGS[n.os]) {
        const r = ssh(n.ip, `sudo -n cat ${f}`, undefined, { maxBuffer: 256 * 1024 * 1024, stdoutOnly: true })
        if (r.code === 0) writeFileSync(path.join(dir, `${n.name}-${path.basename(f)}${path.extname(f) ? "" : ".log"}`), r.out)
        note(n, `log installer ${f}: exit=${r.code} bytes=${r.out.length}`)
      }
      // Reboot dari disk.
      const jobsBefore = js.length
      ssh(n.ip, "sudo -n systemctl reboot")
      await page.waitForTimeout(20_000)
      let back = false
      const deadline = Date.now() + 10 * 60_000
      while (Date.now() < deadline && !back) {
        back = ssh(n.ip, "true").code === 0
        if (!back) await page.waitForTimeout(5_000)
      }
      const after = back ? ssh(n.ip, `hostname; cat /proc/cmdline`) : { code: -1, out: "" }
      const v2 = back ? ssh(n.ip, `${envs} bash -s`, script) : { code: -1, out: "node tidak kembali" }
      const host = (await (await page.request.get(`/api/hosts/${hostId(n.mac)}`)).json()) as { status: string; hostname: string; mgmtIp: string }
      const jobsAfter = (await jobs(n.mac)).length
      const f = facts.out
      if (v1.code !== 0) problems.push(`verify-node exit ${v1.code}`)
      if (!pw.ok) problems.push("login password tidak ditolak")
      if (!f.includes(`# hostname: ${n.hostname}`)) problems.push("hostname")
      if (!f.includes("sudo-ok")) problems.push("sudo")
      if (!/en_US\.UTF-8/.test(f)) problems.push("locale")
      if (n.os === "debian" && !f.includes("trusted_files=0")) problems.push("trusted=yes tersisa di /etc/apt (DEC-021 §2)")
      if (n.os === "debian" && !f.includes("allow_unauth=tidak-ada")) problems.push("00AllowUnauthenticated tersisa (DEC-021 §2)")
      if (!f.includes("bootx64=ADA")) problems.push("\\EFI\\BOOT\\BOOTX64.EFI tidak ada")
      if (!back || !after.out.startsWith(n.hostname) || INSTALLER_CMDLINE.test(after.out) || v2.code !== 0) problems.push(`reboot: kembali=${back} v2=${v2.code}`)
      if (host.status !== "done" || jobsAfter !== jobsBefore) problems.push(`sesudah reboot status=${host.status} job ${jobsBefore}->${jobsAfter}`)
      const file = `${n.name}-verify-ssh.txt`
      writeFileSync(
        path.join(KVM.runsDir, file),
        [
          `# ${ac} ${n.name} (${n.os}): ${seen[n.name]?.join(" → ")} dalam ${doneS[n.name]} dtk; UI tanpa reload=${noReload}`,
          `# event installer berurutan: ${order.ok} ${order.missing.join(", ")}`, ...msgs.map((m) => `  ${m}`),
          "# verify-node.sh sebelum reboot", v1.out, `# exit=${v1.code}`,
          "# login password", pw.out.trim(), `# ditolak=${pw.ok}`,
          "# fakta node", f,
          `# reboot: kembali=${back}`, after.out, "# verify-node.sh sesudah reboot", v2.out, `# exit=${v2.code}`,
          `# host sesudah reboot: status=${host.status} hostname=${host.hostname} mgmtIp=${host.mgmtIp}; job ${jobsBefore}->${jobsAfter}`,
          `# masalah: ${problems.join("; ") || "tidak ada"}`,
        ].join("\n") + "\n",
      )
      record({ ac, node: n.name, status: problems.length ? "FAIL" : "PASS", durationS: doneS[n.name], note: problems.join("; ") || `${seen[n.name]?.join("→")} ${doneS[n.name]}s; verify ${v1.code}/${v2.code}`, evidence: [file, `${n.name}-timeline.txt`, "installer-logs/"] })
      if (problems.length) failures.push(`${n.name}: ${problems.join("; ")}`)
    }
    expect(failures).toEqual([])
  })
}
