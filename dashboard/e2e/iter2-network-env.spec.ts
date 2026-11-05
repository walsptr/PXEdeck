// Iterasi 2 — CR-3-2 / DEC-006 end-to-end: server E2E dengan env PXE_MGMT_* subnet KVM
// (10.99.0.0/24, project "iter2-network-env", lihat playwright.config.ts). Form konfigurasi harus
// memakai subnet dari GET /api/network sehingga UI dan API menerima/menolak IP yang sama.
import { expect, test } from "@playwright/test"

import { gotoHosts, rowByMac, SHOTS } from "./helpers"

const BULK = ["b0:83:fe:5c:19:e2", "b0:83:fe:5c:19:e3", "a0:36:9f:0b:72:5d"]

test("GET /api/network mencerminkan env server (subnet KVM)", async ({ request }) => {
  const res = await request.get("/api/network")
  expect(res.status()).toBe(200)
  expect(res.headers()["cache-control"]).toBe("no-store")
  expect(await res.json()).toEqual({
    cidr: "10.99.0.0/24",
    prefix: 24,
    gateway: "10.99.0.1",
    dns: ["10.99.0.1"],
    dynamicRange: ["10.99.0.100", "10.99.0.200"],
    pxeServer: "10.99.0.2",
  })
})

test("bulk Set IP: default & preview dari subnet env, simpan diterima server (200) dengan IP 10.99.0.x", async ({ page }) => {
  await gotoHosts(page)
  await expect(page.locator('[data-slot="sidebar"]').getByText("10.99.0.2", { exact: true })).toBeVisible()
  for (const mac of BULK) await page.getByRole("checkbox", { name: `Pilih ${mac}` }).click()
  const bar = page.getByRole("toolbar", { name: "Aksi untuk host terpilih" })
  await bar.getByRole("button", { name: "Set IP" }).click()
  const sheet = page.getByRole("dialog", { name: "Konfigurasi 3 host" })
  await expect(sheet.locator("#net-start")).toHaveValue("10.99.0.11")
  await expect(sheet.locator("#net-end")).toHaveValue("10.99.0.99")
  await expect(sheet.locator("#net-gw")).toHaveValue("10.99.0.1")
  await expect(sheet.getByRole("button", { name: "Hapus DNS 10.99.0.1" })).toBeVisible()
  const ipTable = sheet.getByRole("table", { name: "Preview IP baru" })
  const expected = ["10.99.0.11", "10.99.0.12", "10.99.0.13"]
  await expect(ipTable.locator("tbody tr td:nth-child(3)")).toHaveText(expected)
  await expect(ipTable.locator('tbody tr[data-state="ok"]')).toHaveCount(3)
  const macs = (await ipTable.locator("tbody tr td:first-child").allTextContents()).map((t) => t.trim())
  await page.screenshot({ path: SHOTS(3, "iter2-kvm-env-bulk-ip") })

  const req = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/api/hosts/bulk"))
  const res = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/api/hosts/bulk"))
  await sheet.getByRole("button", { name: "Simpan konfigurasi" }).click()
  const body = (await req).postDataJSON()
  expect(body.network).toMatchObject({ mode: "static", prefix: 24, gateway: "10.99.0.1", dns: ["10.99.0.1"] })
  expect(Object.values(body.network.assignments).sort()).toEqual(expected)
  const r = await res
  expect(r.status()).toBe(200)
  expect(await r.json()).toMatchObject({ updated: 3 })
  await expect(sheet).toBeHidden()
  // Tabel & API menampilkan IP baru sesuai pemetaan preview.
  for (const [i, mac] of macs.entries()) {
    await expect(rowByMac(page, mac).locator("td").nth(3)).toContainText(`mgmt ${expected[i]}`)
    const cfg = await (await page.request.get(`/api/hosts/${mac.replaceAll(":", "")}/config`)).json()
    expect(cfg.network).toMatchObject({ mode: "static", ip: expected[i], gateway: "10.99.0.1", prefix: 24 })
  }
})

test("single host: IP lab ditolak UI ('Di luar subnet 10.99.0.0/24') dan API (422); IP KVM diterima keduanya", async ({ page }) => {
  await gotoHosts(page)
  await page.getByRole("button", { name: "Aksi untuk node01" }).click()
  await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
  const sheet = page.getByRole("dialog", { name: /Konfigurasi node01/ })
  await sheet.getByRole("tab", { name: /^Network/ }).click()
  const ip = sheet.locator("#net-ip")
  const save = sheet.getByRole("button", { name: "Simpan konfigurasi" })
  await ip.fill("")
  await expect(ip).toHaveAttribute("placeholder", "10.99.0.11")
  await ip.fill("10.10.10.45")
  await expect(sheet.locator('[data-slot="field-error"]').first()).toHaveText("Di luar subnet 10.99.0.0/24")
  await expect(save).toBeDisabled()
  // API menolak IP yang sama (aturan identik).
  const api = await page.request.patch("/api/hosts/525400101011", {
    data: {
      network: { mode: "static", assignments: { "525400101011": "10.10.10.45" }, prefix: 24, gateway: "10.99.0.1", dns: ["10.99.0.1"], vlan: null, iface: { by: "mac" } },
    },
  })
  expect(api.status()).toBe(422)
  expect((await api.json()).errors[0].message).toMatch(/Di luar subnet 10\.99\.0\.0\/24$/)

  await ip.fill("10.99.0.45")
  await expect(sheet).toContainText("Di dalam 10.99.0.0/24, di luar range dinamis 10.99.0.100–10.99.0.200")
  // Config seed node01 memakai gateway lab → ganti ke gateway subnet aktif agar valid.
  await sheet.locator("#net-gw").fill("10.99.0.1")
  await expect(save).toBeEnabled()
  const res = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().endsWith("/api/hosts/525400101011"))
  await save.click()
  expect((await res).status()).toBe(200)
  await expect(rowByMac(page, "52:54:00:10:10:11").locator("td").nth(3)).toContainText("10.99.0.45")
})
