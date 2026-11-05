// M4-T11 E2E (server "m4-settings": subnet KVM 10.99.0.0/24 dari env, DB demo):
//  - AC-4.6 halaman Settings read-only menampilkan nilai GET /api/settings; tab Network memakai
//           subnet 10.99.0.0/24 dan preview menandai 10.10.10.5 di luar subnet.
//  - AC-4.7 top bar menampilkan status DHCP/TFTP/HTTP sesuai response (page.route), tiga state.
import { expect, test } from "@playwright/test"

import { gotoHosts, SHOTS } from "./helpers"

test("AC-4.6 GET /api/settings + halaman Settings read-only", async ({ page }) => {
  const res = await page.request.get("/api/settings")
  expect(res.status()).toBe(200)
  expect(res.headers()["cache-control"]).toBe("no-store")
  const s = await res.json()
  expect(s).toEqual({
    cidr: "10.99.0.0/24",
    prefix: 24,
    gateway: "10.99.0.1",
    dns: ["10.99.0.2"],
    dynamicRange: ["10.99.0.100", "10.99.0.200"],
    pxeServer: "10.99.0.2",
    interface: "pxe0",
    baseUrl: "http://10.99.0.2",
    mediaUrl: "http://10.99.0.2/media",
    tftpRoot: "/srv/pxe/tftp",
    tokenTtlMin: 360,
    unknownHostAction: "local",
    // M5 (AC-5.1, test-migration #16): pengaturan job non-rahasia.
    jobTimeouts: { bootingMin: 60, installingMin: 120, configuringMin: 60 },
    maxInstallerBoots: 3,
    insecureNoLeaseCheck: false,
  })
  // Tanpa path DB / seed / allowlist (non-rahasia saja).
  expect(JSON.stringify(s)).not.toMatch(/\.db|seed|allowed|PXE_DB/i)

  await page.goto("/settings")
  const main = page.locator("main")
  await expect(page.locator("header h1")).toHaveText("Settings")
  await expect(main).toContainText("Read-only")
  for (const v of ["pxe0", "10.99.0.0/24", "10.99.0.1", "10.99.0.2", "10.99.0.100–10.99.0.200", "/srv/pxe/tftp", "http://10.99.0.2", "http://10.99.0.2/media", "360 menit"])
    await expect(main).toContainText(v)
  // Read-only: tidak ada kontrol input maupun tombol simpan.
  await expect(main.locator("input, textarea, select, [role=switch], [role=combobox]")).toHaveCount(0)
  await expect(main.getByRole("button", { name: /simpan/i })).toHaveCount(0)
  await page.screenshot({ path: SHOTS(4, "ac-4.6-settings") })
})

test("AC-4.6 tab Network memakai subnet server 10.99.0.0/24; 10.10.10.5 ditandai di luar subnet", async ({ page }) => {
  await gotoHosts(page)
  await page.getByRole("button", { name: "Aksi untuk node01" }).click()
  await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
  const sheet = page.getByRole("dialog", { name: /Konfigurasi node01/ })
  await sheet.getByRole("tab", { name: /^Network/ }).click()
  await expect(sheet).toContainText("10.99.0.0/24")
  await sheet.locator("#net-ip").fill("10.10.10.5")
  await expect(sheet.locator('[data-slot="field-error"]').first()).toHaveText("Di luar subnet 10.99.0.0/24")
  await expect(sheet.getByRole("button", { name: "Simpan konfigurasi" })).toBeDisabled()
  await sheet.locator("#net-ip").fill("10.99.0.150")
  await expect(sheet.locator('[data-slot="field-error"]').first()).toHaveText("Di dalam range DHCP dinamis 10.99.0.100–10.99.0.200")
  await sheet.locator("#net-ip").fill("10.99.0.21")
  await expect(sheet.locator('[data-slot="field-error"]')).toHaveCount(0)
  await expect(sheet).toContainText("Di dalam 10.99.0.0/24, di luar range dinamis 10.99.0.100–10.99.0.200")
  await page.screenshot({ path: SHOTS(4, "ac-4.6-network-tab") })
  // Server menolak IP di luar subnet yang sama (UI dan API konsisten).
  const r = await page.request.patch("/api/hosts/525400101011", {
    headers: { "content-type": "application/json" },
    data: { network: { mode: "static", prefix: 24, gateway: "10.99.0.1", dns: ["10.99.0.2"], vlan: null, iface: { by: "mac" }, assignments: { "525400101011": "10.10.10.5" } } },
  })
  expect(r.status()).toBe(422)
  expect(JSON.stringify(await r.json())).toContain("Di luar subnet 10.99.0.0/24")
})

test("AC-4.7 top bar mengikuti GET /api/server-status (online / offline / tidak diketahui)", async ({ page }) => {
  const body = {
    services: [
      { name: "DHCP", state: "online", online: true, detail: "dnsmasq · pxe0:67/udp" },
      { name: "TFTP", state: "offline", online: false, detail: "file hilang di /srv/pxe/tftp: undionly.kpxe" },
      { name: "HTTP", state: "unknown", online: false, detail: "media /srv/pxe/media tidak ada" },
    ],
    checkedAt: "2026-11-05T10:00:00.000Z",
  }
  await page.route("**/api/server-status", (r) => r.fulfill({ json: body, headers: { "cache-control": "no-store" } }))
  await gotoHosts(page)
  const group = page.locator("header").getByRole("group", { name: "Status server PXE" })
  const expected = [
    ["DHCP", "online", "online", "rgb(31, 138, 101)"],
    ["TFTP", "offline", "offline", "rgb(207, 45, 86)"],
    ["HTTP", "unknown", "tidak diketahui", null],
  ] as const
  for (const [name, state, label, color] of expected) {
    const badge = group.locator(`[data-service="${name}"]`)
    await expect(badge).toHaveAttribute("data-state", state)
    await expect(badge).toHaveAttribute("data-online", String(state === "online"))
    expect((await badge.textContent())!.replace(name, "").trim()).toBe(label)
    const dot = badge.locator('[data-slot="status-dot"]')
    if (color) await expect(dot).toHaveCSS("background-color", color)
    else {
      // unknown: abu-abu (bukan hijau/merah).
      const bg = await dot.evaluate((el) => getComputedStyle(el).backgroundColor)
      expect(bg).not.toBe("rgb(31, 138, 101)")
      expect(bg).not.toBe("rgb(207, 45, 86)")
    }
  }
  await group.locator('[data-service="TFTP"]').hover()
  await expect(page.getByRole("tooltip")).toContainText("file hilang di /srv/pxe/tftp: undionly.kpxe")
  await page.screenshot({ path: SHOTS(4, "ac-4.7-top-bar") })

  // Perubahan status diikuti (polling/refetch saat fokus) tanpa reload.
  await page.unroute("**/api/server-status")
  await page.route("**/api/server-status", (r) =>
    r.fulfill({ json: { ...body, services: body.services.map((s) => ({ ...s, state: "offline", online: false })) } }),
  )
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  await expect(group.locator('[data-service="DHCP"]')).toHaveAttribute("data-state", "offline", { timeout: 20_000 })
})
