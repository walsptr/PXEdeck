// Suite KVM M4 (M4-T13) — DIJALANKAN HANYA lewat `infra/kvm-run.sh m4` (lihat playwright.config.ts).
//  - AC-4.30 (UEFI, node11) / AC-4.33 (BIOS, node12): PXE boot → host muncul (vendor QEMU,
//    firmware) → Sheet: hostname <m>-nodeNN, IP statis 10.99.0.(10+NN)/24 gw 10.99.0.1 DNS 10.99.0.2,
//    user + password acak per run (tidak dicatat), key ed25519 sekali pakai, sudo, nonaktifkan
//    password SSH → Simpan & Install → `infra/node.sh reset` → status Booting → Installing →
//    Configuring → Done ≤ 30 menit (diamati di UI tanpa reload + API).
//  - AC-4.31: verify-node.sh lewat SSH dengan key yang di-inject; login password ditolak; reboot →
//    kembali dari disk (tanpa kernel installer kedua di serial log), status tetap Done.
//  - AC-4.32: selama job aktif, /boot/<mac>.ipxe dari host (10.99.0.1) → lokal tanpa token,
//    current_ip tidak berubah; token acak → 404.
//  - AC-4.34 (bagian harness): results.json + scan bukti (password run, token di path /boot/,
//    private key). Cleanup VM/network dilakukan kvm-run.sh (trap EXIT).
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import { expect, test, type Page } from "@playwright/test"

import {
  consoleLog,
  installerBoots,
  KVM,
  kvmNodes,
  passwordLoginRejected,
  publicKey,
  randomPassword,
  record,
  resetNode,
  scanEvidence,
  ssh,
  writeResults,
} from "./kvm-harness"

test.describe.configure({ mode: "serial" })

const INSTALL_TIMEOUT_MS = 30 * 60_000
const PASSWORD = randomPassword()
const NODES = kvmNodes()
const shot = (name: string) => path.join(KVM.runsDir, "screenshots", `${name}.png`)
const hostId = (mac: string) => mac.replaceAll(":", "")
const TOKEN_RE = /\/boot\/[0-9a-f:]{17}\/[A-Za-z0-9_-]{43}\//

async function apiHost(page: Page, mac: string) {
  const r = await page.request.get(`/api/hosts/${hostId(mac)}`)
  return r.status() === 200 ? r.json() : null
}

test.afterAll(() => {
  const findings = scanEvidence([PASSWORD])
  writeFileSync(path.join(KVM.runsDir, "evidence-scan.txt"), findings.length ? findings.join("\n") + "\n" : "bersih: tanpa password run, token /boot/, private key (teks & base64)\n")
  record({ ac: "AC-4.34-scan", status: findings.length ? "FAIL" : "PASS", note: `${findings.length} temuan`, evidence: ["evidence-scan.txt"] })
  writeResults({ nodes: NODES.map((n) => n.name) })
})

for (const node of NODES) {
  const ac = node.fw === "uefi" ? "AC-4.30" : "AC-4.33"
  const hostname = `${KVM.run}-node${node.nn}`

  test(`${ac} ${node.name} (${node.fw}) install via dashboard → Done ≤ 30 menit`, async ({ page }) => {
    const t0 = Date.now()
    const statusLog: string[] = []
    // ---- 1. discovery: node sudah PXE boot sejak dibuat kvm-run ----
    await page.goto("/hosts")
    await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true))
    const row = page.locator("main table").first().locator("tbody tr").filter({ has: page.getByText(node.mac, { exact: true }) })
    await expect(row).toHaveCount(1, { timeout: 10 * 60_000 })
    // Host bisa muncul lebih dulu dari lease dnsmasq (DHCP firmware PXE; firmware belum diketahui,
    // src/lib/server/discovery.ts) lalu firmware terisi saat iPXE meminta /boot/<mac>.ipxe?platform=.
    // Tunggu (poll) sampai keduanya tercatat; nilai yang dituntut tidak berubah.
    await expect
      .poll(async () => {
        const h = await apiHost(page, node.mac)
        return h && { vendor: h.vendor, firmware: h.firmware }
      }, { timeout: 5 * 60_000, intervals: [1_000, 2_000, 5_000] })
      .toEqual({ vendor: "QEMU/KVM", firmware: node.fw })
    await page.screenshot({ path: shot(`${node.name}-discovered`) })

    // ---- 2. konfigurasi lewat Sheet ----
    await row.getByRole("button", { name: /^Aksi untuk/ }).click()
    await page.getByRole("menuitem", { name: "Install OS" }).click()
    const sheet = page.getByRole("dialog", { name: /^Konfigurasi / })
    await sheet.locator('[id="os-ubuntu-24.04"]').click()
    await sheet.getByRole("tab", { name: /^Credentials/ }).click()
    await sheet.locator("#cred-user").fill(KVM.user)
    await sheet.locator("#cred-pass").fill(PASSWORD)
    if ((await sheet.locator("#cred-sudo").getAttribute("aria-checked")) !== "true") await sheet.locator("#cred-sudo").click()
    if ((await sheet.locator("#cred-nopw").getAttribute("aria-checked")) !== "true") await sheet.locator("#cred-nopw").click()
    await sheet.getByRole("tab", { name: /^Network/ }).click()
    await sheet.getByRole("radio", { name: "Static" }).click()
    await sheet.locator("#net-ip").fill(node.ip)
    await expect(sheet.locator("#net-gw")).toHaveValue(KVM.gateway)
    await expect(sheet.getByRole("button", { name: `Hapus DNS ${KVM.dns}` })).toBeVisible()
    await sheet.getByRole("tab", { name: /^Hostname/ }).click()
    await sheet.locator("#hn-name").fill(hostname)
    await sheet.getByRole("tab", { name: /^SSH Keys/ }).click()
    // Key run yang sama untuk semua node. Node pertama menempelnya sebagai key baru (masuk
    // library); node berikutnya WAJIB memilihnya dari library karena produk (G3-3) menolak key
    // baru ber-fingerprint sama dengan 422 (attempt4: PATCH node12 → 422, harness menggantung).
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
      await sheet.locator("#key-name-0").fill(`${KVM.run}-${node.nn}-run-key`)
    }
    await page.screenshot({ path: shot(`${node.name}-sheet`), mask: [sheet.locator("#cred-pass")] })

    await sheet.getByRole("button", { name: "Simpan & Install" }).click()
    const confirm = page.getByRole("alertdialog", { name: /^Install OS ke / })
    // Konfirmasi → PATCH (simpan) lalu POST /install. Simpan harus 200: bila ditolak, gagal cepat
    // dengan body error (bukan menunggu /install tanpa batas seperti attempt4).
    const saved = page.waitForResponse(
      (r) => r.request().method() === "PATCH" && r.url().endsWith(`/api/hosts/${hostId(node.mac)}`),
      { timeout: 60_000 },
    )
    const installed = page.waitForResponse((r) => r.url().endsWith(`/api/hosts/${hostId(node.mac)}/install`))
    await confirm.getByRole("button", { name: "Hapus disk & install" }).click()
    const savedRes = await saved
    expect(savedRes.status(), await savedRes.text()).toBe(200)
    expect((await installed).status()).toBe(200)
    const pill = row.locator("[data-status]")
    await expect(pill).toHaveAttribute("data-status", "booting")
    statusLog.push(`${new Date().toISOString()} booting (UI)`)

    // ---- 3. AC-4.32: negatif selama job aktif (dari host 10.99.0.1) ----
    const before = await apiHost(page, node.mac)
    const local = await (await page.request.get(`/boot/${node.mac}.ipxe?platform=efi`)).text()
    const forged = await page.request.get(`/boot/${node.mac}/${"A".repeat(43)}/user-data`)
    const after = await apiHost(page, node.mac)
    const neg = !/\bkernel\b/.test(local) && !TOKEN_RE.test(local) && forged.status() === 404 && after.currentIp === before.currentIp
    writeFileSync(
      path.join(KVM.runsDir, `${node.name}-negative.txt`),
      `GET /boot/${node.mac}.ipxe dari host:\n${local}\nGET /boot/${node.mac}/<token-acak>/user-data → ${forged.status()}\ncurrent_ip sebelum=${before.currentIp} sesudah=${after.currentIp}\n`,
    )
    record({ ac: "AC-4.32", node: node.name, status: neg ? "PASS" : "FAIL", evidence: [`${node.name}-negative.txt`] })
    expect(neg).toBe(true)

    // ---- 4. reboot paksa node agar PXE boot ulang → installer ----
    resetNode(node)
    const seen = new Set<string>(["booting"])
    const deadline = Date.now() + INSTALL_TIMEOUT_MS
    let last = "booting"
    while (Date.now() < deadline) {
      const st = await pill.getAttribute("data-status")
      if (st && st !== last) {
        statusLog.push(`${new Date().toISOString()} ${st} (UI)`)
        seen.add(st)
        last = st
        await page.screenshot({ path: shot(`${node.name}-${st}`) })
      }
      if (st === "done" || st === "failed") break
      await page.waitForTimeout(2_000)
    }
    writeFileSync(path.join(KVM.runsDir, `${node.name}-status.txt`), statusLog.join("\n") + "\n")
    const durationS = Math.round((Date.now() - t0) / 1000)
    const ordered = ["booting", "installing", "configuring", "done"].every((s) => seen.has(s))
    record({ ac, node: node.name, status: ordered && last === "done" ? "PASS" : "FAIL", durationS, note: [...seen].join(" → "), evidence: [`${node.name}-status.txt`, `${node.name}-console.txt`] })
    expect(last, statusLog.join("\n")).toBe("done")
    expect([...seen]).toEqual(["booting", "installing", "configuring", "done"])
    expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true)
    const done = await apiHost(page, node.mac)
    expect(done).toMatchObject({ status: "done", osInstalled: "ubuntu-24.04", osAssigned: null, hostname, mgmtIp: node.ip })
  })

  test(`AC-4.31 ${node.name}: SSH key login, verifikasi, password ditolak, reboot dari disk`, async ({ page }) => {
    const t0 = Date.now()
    const env = [
      `EXPECT_HOSTNAME=${hostname}`,
      `EXPECT_IP=${node.ip}`,
      `EXPECT_PREFIX=${KVM.prefix}`,
      `EXPECT_MAC=${node.mac}`,
      `EXPECT_GW=${KVM.gateway}`,
      `EXPECT_DNS=${KVM.dns}`,
      `EXPECT_USER=${KVM.user}`,
      `EXPECT_PUBKEY='${publicKey()}'`,
    ].join(" ")
    const script = readFileSync(path.join(__dirname, "verify-node.sh"), "utf8")
    const v1 = ssh(node.ip, `${env} bash -s`, script)
    const pw = passwordLoginRejected(node.ip)
    const installsBefore = installerBoots(node)

    // Reboot → harus kembali dari disk (boot lokal), tanpa kernel installer kedua.
    ssh(node.ip, "sudo -n systemctl reboot")
    let back = false
    const deadline = Date.now() + 10 * 60_000
    await page.waitForTimeout(20_000)
    while (Date.now() < deadline) {
      if (ssh(node.ip, "true").code === 0) {
        back = true
        break
      }
      await page.waitForTimeout(5_000)
    }
    const v2 = back ? ssh(node.ip, `${env} bash -s`, script) : { code: -1, out: "node tidak kembali" }
    const installsAfter = installerBoots(node)
    const host = await (await page.request.get(`/api/hosts/${hostId(node.mac)}`)).json()
    const script2 = await (await page.request.get(`/boot/${node.mac}.ipxe?platform=${node.fw === "uefi" ? "efi" : "pcbios"}`)).text()
    writeFileSync(
      path.join(KVM.runsDir, `${node.name}-verify-ssh.txt`),
      [
        "# verify-node.sh sebelum reboot", v1.out, `# exit=${v1.code}`,
        "# login password (PreferredAuthentications=password)", pw.out.trim(), `# ditolak=${pw.ok}`,
        `# reboot: kembali=${back}`, "# verify-node.sh sesudah reboot", v2.out, `# exit=${v2.code}`,
        `# kernel installer di serial log: sebelum reboot=${installsBefore} sesudah=${installsAfter}`,
        `# status host sesudah reboot: ${host.status} osInstalled=${host.osInstalled} osAssigned=${host.osAssigned}`,
        `# /boot/${node.mac}.ipxe sesudah reboot:`, script2,
      ].join("\n") + "\n",
    )
    const pass = v1.code === 0 && pw.ok && back && v2.code === 0 && installsAfter === installsBefore && host.status === "done" && !/\bkernel\b/.test(script2)
    record({ ac: "AC-4.31", node: node.name, status: pass ? "PASS" : "FAIL", durationS: Math.round((Date.now() - t0) / 1000), evidence: [`${node.name}-verify-ssh.txt`] })
    expect(v1.code, v1.out).toBe(0)
    expect(pw.ok, pw.out).toBe(true)
    expect(back).toBe(true)
    expect(v2.code, v2.out).toBe(0)
    expect(installsAfter).toBe(installsBefore)
    expect(host).toMatchObject({ status: "done", osInstalled: "ubuntu-24.04", osAssigned: null })
    expect(script2).not.toMatch(/\bkernel\b/)
    expect(consoleLog(node).length).toBeGreaterThan(0)
  })
}
