// M4-T11 E2E (server "m4-discovery": subnet KVM 10.99.0.0/24, DB kosong, PXE_TRUST_PROXY=1, lease
// fixture dnsmasq, media palsu). Request firmware/installer disimulasikan dengan `request` + header
// `X-Real-IP` (peran nginx di lab KVM).
//  - AC-4.9  (e2e) request dari IP yang bukan lease MAC → boot lokal, host tidak dibuat.
//  - AC-4.11 (e2e) MAC baru di file lease muncul sebagai host discovered.
//  - AC-4.12 host baru muncul di tabel tanpa refresh ≤ 10 dtk.
//  - AC-4.27 Install dari Sheet → pill Booting → Installing → Configuring → Done tanpa refresh
//            (callback disimulasikan); OS tab menonaktifkan image tidak tersedia + peringatan Windows.
import { writeFileSync } from "node:fs"

import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

import { DUMMY_PASSWORD, SSH_ED25519 } from "../src/test/fixtures"
import { hostRows, rowByMac, SHOTS } from "./helpers"
import { e2eLeaseFile } from "./support/e2e-env"

test.describe.configure({ mode: "serial" })

const LEASES = e2eLeaseFile("m4-discovery")
const leases = new Map<string, string>()
/** Tulis file lease dnsmasq (format asli: expiry mac ip hostname client-id). */
function lease(mac: string, ip: string) {
  leases.set(mac, ip)
  const exp = Math.floor(Date.now() / 1000) + 3600
  writeFileSync(LEASES, [...leases].map(([m, i]) => `${exp} ${m} ${i} * 01:${m}`).join("\n") + "\n")
}

const TOKEN_RE = /\/boot\/[0-9a-f:]{17}\/([A-Za-z0-9_-]{43})\//

async function ipxe(request: APIRequestContext, mac: string, ip: string) {
  const res = await request.get(`/boot/${mac}.ipxe?platform=efi`, { headers: { "x-real-ip": ip } })
  expect(res.status()).toBe(200)
  expect(res.headers()["content-type"]).toBe("text/plain; charset=utf-8")
  return res.text()
}

async function markNoReload(page: Page) {
  await page.evaluate(() => ((window as unknown as { __noReload: boolean }).__noReload = true))
}
async function expectNoReload(page: Page) {
  expect(await page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload)).toBe(true)
}

test("AC-4.9/4.11/4.12 discovery: IP asing ditolak; MAC di lease muncul ≤ 10 dtk tanpa refresh", async ({ page }) => {
  const MAC = "52:54:00:99:00:31"
  await page.goto("/hosts")
  await expect(page.locator('[data-slot="empty"]')).toBeVisible()
  await markNoReload(page)

  // AC-4.9: belum ada lease untuk MAC ini → request apa pun "tidak terverifikasi": boot lokal.
  lease("52:54:00:99:00:99", "10.99.0.199") // lease MAC lain saja
  const unverified = await ipxe(page.request, MAC, "10.99.0.1")
  expect(unverified).toContain("sanboot --no-describe --drive 0x80")
  expect(unverified).not.toMatch(/\bkernel\b/)
  expect(unverified).not.toMatch(TOKEN_RE)
  expect((await page.request.get("/api/hosts/525400990031")).status()).toBe(404)

  // AC-4.11 + AC-4.12: lease muncul → host discovered di tabel tanpa refresh ≤ 10 dtk.
  lease(MAC, "10.99.0.150")
  const t0 = Date.now()
  const row = rowByMac(page, MAC)
  await expect(row).toHaveCount(1, { timeout: 10_000 })
  expect(Date.now() - t0).toBeLessThanOrEqual(10_000)
  await expect(row.locator("[data-status]")).toHaveAttribute("data-status", "discovered")
  await expect(row).toContainText("10.99.0.150")

  // Request iPXE dari IP lease → terverifikasi: firmware & vendor tercatat, tetap satu baris.
  const local = await ipxe(page.request, MAC.replaceAll(":", "-").toUpperCase(), "10.99.0.150")
  expect(local).toContain("iseq ${platform} efi && exit 1 ||")
  const host = await (await page.request.get("/api/hosts/525400990031")).json()
  expect(host).toMatchObject({ mac: MAC, status: "discovered", firmware: "uefi", vendor: "QEMU/KVM", currentIp: "10.99.0.150" })
  await expect(row).toHaveCount(1)
  await expect(hostRows(page)).toHaveCount(2) // + host dari lease 52:54:00:99:00:99
  await page.screenshot({ path: SHOTS(4, "ac-4.12-discovered") })
  await expectNoReload(page)
})

test("AC-4.27 Install dari Sheet → pill Booting → Installing → Configuring → Done tanpa refresh", async ({ page }) => {
  const MAC = "52:54:00:99:00:32"
  const ID = "525400990032"
  const LEASE_IP = "10.99.0.151"
  const STATIC_IP = "10.99.0.32"
  lease(MAC, LEASE_IP)
  expect(await ipxe(page.request, MAC, LEASE_IP)).not.toMatch(/\bkernel\b/)
  // Konfigurasi Windows boleh disimpan (generator saja, DEC-010) → Sheet menampilkan peringatan.
  const win = await page.request.patch(`/api/hosts/${ID}`, {
    headers: { "content-type": "application/json" },
    data: { os: { osImageId: "windows-2022", disk: "", partition: "auto", timezone: "UTC", locale: "en_US.UTF-8" } },
  })
  expect(win.status()).toBe(200)

  await page.goto("/hosts")
  const row = rowByMac(page, MAC)
  await expect(row.locator("[data-status]")).toHaveAttribute("data-status", "discovered")
  await markNoReload(page)

  await row.getByRole("button", { name: /^Aksi untuk/ }).click()
  await page.getByRole("menuitem", { name: "Install OS" }).click()
  const sheet = page.getByRole("dialog", { name: /^Konfigurasi / })
  await expect(sheet).toBeVisible()

  // ---- OS: image tidak tersedia nonaktif + alasan; Windows → peringatan ----
  const u22 = sheet.locator('[id="os-ubuntu-22.04"]')
  await expect(u22).toBeDisabled()
  await expect(sheet.locator('[id="os-ubuntu-22.04-note"]')).toContainText("Media ubuntu-22.04 tidak tersedia")
  for (const id of ["ubuntu-24.04", "debian-12", "rocky-9"]) await expect(sheet.locator(`[id="os-${id}"]`)).toBeEnabled()
  // Windows: tidak bootable via PXE → nonaktif + alasan + catatan password (O9); config tersimpan
  // Windows → alert peringatan di tab OS.
  const winRadio = sheet.locator('[id="os-windows-2022"]')
  await expect(winRadio).toBeDisabled()
  await expect(winRadio).toHaveAttribute("aria-checked", "true")
  await expect(sheet.locator('[id="os-windows-2022-note"]')).toContainText("Windows: hanya generator unattend.xml")
  await expect(sheet.locator('[data-slot="windows-password-note"]')).toContainText("Password dari tab Credentials tidak dipakai")
  await expect(sheet.locator('[data-slot="windows-warning"]')).toContainText("Windows: hanya generator unattend.xml")
  await expect(sheet.locator('[data-slot="windows-warning"]')).toContainText("Password dari tab Credentials tidak dipakai")
  await page.screenshot({ path: SHOTS(4, "ac-4.27-os-tab-windows") })
  await sheet.locator('[id="os-ubuntu-24.04"]').click()
  await expect(sheet.locator('[data-slot="windows-warning"]')).toHaveCount(0)
  await expect(sheet.locator('[id="os-ubuntu-24.04"]')).toHaveAttribute("aria-checked", "true")

  // ---- Credentials ----
  await sheet.getByRole("tab", { name: /^Credentials/ }).click()
  await sheet.locator("#cred-user").fill("ops")
  await sheet.locator("#cred-pass").fill(DUMMY_PASSWORD)
  await sheet.locator("#cred-nopw").click()
  await expect(sheet.locator("#cred-nopw")).toHaveAttribute("aria-checked", "true")

  // ---- Network: statis di subnet dari /api/settings (10.99.0.0/24) ----
  await sheet.getByRole("tab", { name: /^Network/ }).click()
  await sheet.getByRole("radio", { name: "Static" }).click()
  await sheet.locator("#net-ip").fill(STATIC_IP)
  await expect(sheet.locator("#net-gw")).toHaveValue("10.99.0.1")
  await expect(sheet.getByRole("button", { name: "Hapus DNS 10.99.0.2" })).toBeVisible()

  // ---- Hostname + SSH key ----
  await sheet.getByRole("tab", { name: /^Hostname/ }).click()
  await sheet.locator("#hn-name").fill("m4-e2e-32")
  await sheet.getByRole("tab", { name: /^SSH Keys/ }).click()
  await sheet.getByRole("button", { name: "Tempel / unggah key baru" }).click()
  await sheet.locator("#key-0").fill(SSH_ED25519.publicKey)
  await sheet.locator("#key-name-0").fill("e2e-m4")
  await expect(sheet.getByText(SSH_ED25519.fingerprint)).toBeVisible()

  // ---- Simpan & Install ----
  await sheet.getByRole("button", { name: "Simpan & Install" }).click()
  const confirm = page.getByRole("alertdialog", { name: /^Install OS ke / })
  await expect(confirm).toContainText("Ubuntu Server 24.04.5 LTS akan di-install")
  const installed = page.waitForResponse((r) => r.url().endsWith(`/api/hosts/${ID}/install`))
  await confirm.getByRole("button", { name: "Hapus disk & install" }).click()
  const inst = await installed
  expect(inst.status()).toBe(200)
  expect(await inst.text()).not.toMatch(/token/i)
  const pill = rowByMac(page, MAC).locator("[data-status]")
  await expect(pill).toHaveAttribute("data-status", "booting")
  await expect(pill).toHaveText("Booting")
  await page.screenshot({ path: SHOTS(4, "ac-4.27-booting") })

  // ---- Firmware PXE boot → script installer (token per job) ----
  const script = await ipxe(page.request, MAC, LEASE_IP)
  expect(script).toMatch(/^kernel http:\/\/10\.99\.0\.2\/media\/ubuntu-24\.04\/casper\/vmlinuz .*ds=nocloud-net;s=http:\/\/10\.99\.0\.2\/boot\/52:54:00:99:00:32\/[A-Za-z0-9_-]{43}\/ /m)
  const token = TOKEN_RE.exec(script)![1]
  // Config dari IP asing ditolak (404 seragam), dari IP lease diterima → Installing.
  const foreign = await page.request.get(`/boot/${MAC}/${token}/user-data`, { headers: { "x-real-ip": "10.99.0.1" } })
  expect(foreign.status()).toBe(404)
  expect(await foreign.text()).toBe("not found\n")
  const ud = await page.request.get(`/boot/${MAC}/${token}/user-data`, { headers: { "x-real-ip": LEASE_IP } })
  expect(ud.status()).toBe(200)
  expect(ud.headers()["cache-control"]).toBe("no-store")
  const userData = await ud.text()
  expect(userData).toContain("hostname: m4-e2e-32")
  expect(userData).toContain(SSH_ED25519.publicKey)
  expect(userData).toContain("allow-pw: false")
  expect(userData).not.toContain(DUMMY_PASSWORD)
  await expect(pill).toHaveAttribute("data-status", "installing", { timeout: 10_000 })
  await expect(pill).toHaveText("Installing")
  await page.screenshot({ path: SHOTS(4, "ac-4.27-installing") })

  // ---- Callback installer: configuring (IP lease) → done (IP statis host) ----
  const cb = (stage: string, ip: string) =>
    page.request.post(`/boot/${MAC}/${token}/status`, { headers: { "x-real-ip": ip, "content-type": "application/x-www-form-urlencoded" }, data: `stage=${stage}` })
  expect((await cb("configuring", LEASE_IP)).status()).toBe(200)
  await expect(pill).toHaveAttribute("data-status", "configuring", { timeout: 10_000 })
  await expect(pill).toHaveText("Configuring")
  await page.screenshot({ path: SHOTS(4, "ac-4.27-configuring") })
  // Setelah configuring, PXE berikutnya boot lokal (AC-4.17).
  expect(await ipxe(page.request, MAC, LEASE_IP)).not.toMatch(/\bkernel\b/)
  expect((await cb("installing", LEASE_IP)).status()).toBe(409)
  expect((await cb("done", STATIC_IP)).status()).toBe(200)
  await expect(pill).toHaveAttribute("data-status", "done", { timeout: 10_000 })
  await expect(pill).toHaveText("Done")
  await expect(rowByMac(page, MAC)).toContainText("Ubuntu Server 24.04")
  await page.screenshot({ path: SHOTS(4, "ac-4.27-done") })
  const host = await (await page.request.get(`/api/hosts/${ID}`)).json()
  expect(host).toMatchObject({ status: "done", osInstalled: "ubuntu-24.04", osAssigned: null, currentIp: STATIC_IP, mgmtIp: STATIC_IP, hostname: "m4-e2e-32" })
  // Token dicabut setelah done.
  expect((await cb("done", STATIC_IP)).status()).toBe(404)
  await expectNoReload(page)
})
