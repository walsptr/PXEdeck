// M3 E2E Sheet single host: AC-3.12 (isi Sheet & simpan), AC-3.13 (validasi UI + 422 server).
import { expect, test } from "@playwright/test"

import { DUMMY_PASSWORD, FAKE_PRIVATE_KEY, SSH_ED25519, SSH_RSA } from "../src/test/fixtures"
import { gotoHosts, rowByMac, SHOTS } from "./helpers"

const ADMIN_FP = "SHA256:AqJ29VcE4jU7CEjFJVHo3nvu1EGE5EXwVAPnqIAwTmc"

test("AC-3.12 Sheet single host: lima tab, isi tiap tab, simpan → PATCH + toast + tabel ter-update", async ({ page }) => {
  await gotoHosts(page)
  await page.getByRole("button", { name: "Aksi untuk storage-01" }).click()
  await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
  const sheet = page.getByRole("dialog", { name: "Konfigurasi storage-01" })
  await expect(sheet).toBeVisible()
  // Sheet di sisi kanan viewport.
  const box = (await sheet.boundingBox())!
  expect(box.x + box.width).toBeGreaterThanOrEqual(1439)
  expect(box.x).toBeGreaterThan(500)
  await expect(sheet.getByRole("tab")).toHaveText(["OS", "Credentials", "Network", "Hostname", "SSH Keys"])

  // ---- OS ----
  const images = sheet.locator('button[role="radio"][id^="os-"]')
  await expect(images).toHaveCount(5)
  await expect(sheet.locator('[id="os-rocky-9.4"]')).toHaveAttribute("aria-checked", "true")
  for (const name of ["Ubuntu Server 24.04.5 LTS", "Ubuntu Server 22.04.5 LTS", "Debian 12 (bookworm)", "Rocky Linux 9.4", "Windows Server 2022"])
    await expect(sheet).toContainText(name)
  await expect(sheet.getByLabel("Disk target")).toHaveAttribute("placeholder", "otomatis — disk terbesar")
  for (const p of ["Auto", "LVM", "Custom"]) await expect(sheet.getByRole("radio", { name: p, exact: true })).toBeVisible()
  await expect(sheet.locator("#os-storage")).toHaveCount(0)
  await sheet.getByRole("radio", { name: "Custom", exact: true }).click()
  await expect(sheet.getByLabel("Konfigurasi storage")).toBeVisible()
  await sheet.getByRole("radio", { name: "LVM", exact: true }).click()
  await expect(sheet.locator("#os-storage")).toHaveCount(0)
  await expect(sheet.locator("#os-tz")).toHaveText("Asia/Jakarta")
  await expect(sheet.locator("#os-locale")).toHaveText("en_US.UTF-8")
  await expect(sheet).toContainText("Yang akan terjadi saat install")
  await expect(sheet).toContainText("Host boot dari jaringan dan menjalankan installer Rocky Linux 9.4 via kickstart")
  await page.screenshot({ path: SHOTS(3, "ac-3.12-tab-os") })
  // OS tidak ingin diubah: batalkan perubahan bagian OS.
  await sheet.getByRole("button", { name: "Batalkan perubahan OS" }).click()

  // ---- Credentials: tampil/sembunyi + generator ----
  await sheet.getByRole("tab", { name: /^Credentials/ }).click()
  const pass = sheet.locator("#cred-pass")
  await expect(pass).toHaveAttribute("type", "password")
  await sheet.getByRole("button", { name: "Buat password acak" }).click()
  await expect(pass).toHaveAttribute("type", "text")
  expect((await pass.inputValue()).length).toBe(16)
  await sheet.getByRole("button", { name: "Sembunyikan password" }).click()
  await expect(pass).toHaveAttribute("type", "password")
  await pass.fill(DUMMY_PASSWORD)
  await sheet.getByRole("button", { name: "Tampilkan password" }).click()
  await expect(pass).toHaveAttribute("type", "text")
  await expect(pass).toHaveValue(DUMMY_PASSWORD)
  await expect(sheet.locator("#cred-user")).toHaveValue("ubuntu")

  // ---- Network & Hostname ----
  await sheet.getByRole("tab", { name: /^Network/ }).click()
  await expect(sheet.locator("#net-ip")).toHaveValue("10.10.10.41")
  await sheet.locator("#net-ip").fill("10.10.10.45")
  await sheet.getByRole("tab", { name: /^Hostname/ }).click()
  await sheet.locator("#hn-name").fill("storage-01b")

  // ---- SSH Keys ----
  await sheet.getByRole("tab", { name: /^SSH Keys/ }).click()
  await expect(sheet.getByLabel(/Admin workstation/)).toBeChecked()
  await expect(sheet).toContainText(ADMIN_FP)
  await expect(sheet.locator("#ssh-user")).toHaveAttribute("placeholder", "ubuntu")
  await expect(sheet).toContainText("Kosongkan untuk memakai user dari tab Credentials (ubuntu)")
  await sheet.getByRole("button", { name: "Tempel / unggah key baru" }).click()
  const key = sheet.locator("#key-0")
  await key.fill(SSH_ED25519.publicKey)
  await expect(sheet.getByText(SSH_ED25519.fingerprint)).toBeVisible()
  // Tipe key tampil sebagai badge (library hanya berisi key ssh-rsa).
  await expect(sheet.locator('[data-slot="badge"]').filter({ hasText: /^ssh-ed25519$/ })).toBeVisible()
  await key.fill(FAKE_PRIVATE_KEY)
  await expect(sheet.getByText("Ini private key — tempel public key (.pub) saja")).toBeVisible()
  await expect(key).toHaveAttribute("aria-invalid", "true")
  await key.fill("teks acak bukan key")
  await expect(sheet.getByText("Tipe harus ssh-ed25519, ssh-rsa, atau ecdsa-sha2-nistp*")).toBeVisible()
  // Upload file .pub mengisi key (+ nama dari nama file).
  await sheet.locator('input[type="file"][accept=".pub,text/plain"]').setInputFiles({
    name: "ops-laptop.pub",
    mimeType: "text/plain",
    buffer: Buffer.from(SSH_RSA.publicKey + "\n"),
  })
  await expect(key).toHaveValue(SSH_RSA.publicKey)
  await expect(sheet.getByText(SSH_RSA.fingerprint)).toBeVisible()
  await expect(sheet.locator("#key-name-0")).toHaveValue("ops-laptop")
  await page.screenshot({ path: SHOTS(3, "ac-3.12-tab-ssh") })

  // ---- Simpan ----
  await expect(sheet).toContainText("Akan disimpan:")
  const req = page.waitForRequest((r) => r.method() === "PATCH" && r.url().endsWith("/api/hosts/9440c96e01aa"))
  const res = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().endsWith("/api/hosts/9440c96e01aa"))
  await sheet.getByRole("button", { name: "Simpan konfigurasi" }).click()
  const payload = (await req).postDataJSON()
  expect(Object.keys(payload).sort()).toEqual(["credentials", "hostname", "network", "ssh"])
  expect(payload.network.assignments).toEqual({ "9440c96e01aa": "10.10.10.45" })
  expect(payload.hostname.assignments).toEqual({ "9440c96e01aa": "storage-01b" })
  expect(payload.ssh.newKeys).toEqual([{ name: "ops-laptop", publicKey: SSH_RSA.publicKey, saveToLibrary: true }])
  const r = await res
  expect(r.status()).toBe(200)
  expect(await r.text()).not.toContain(DUMMY_PASSWORD)
  await expect(page.getByText("Konfigurasi disimpan")).toBeVisible()
  await expect(sheet).toBeHidden()
  const row = rowByMac(page, "94:40:c9:6e:01:aa")
  await expect(row.locator("td").nth(2)).toHaveText("storage-01b")
  await expect(row.locator("td").nth(3)).toContainText("mgmt 10.10.10.45")
  await page.screenshot({ path: SHOTS(3, "ac-3.12-saved") })
  const keys = await (await page.request.get("/api/ssh-keys")).json()
  expect(keys.find((k: { name: string }) => k.name === "ops-laptop")).toMatchObject({ fingerprint: SSH_RSA.fingerprint })
})

test("AC-3.13 validasi UI per tab menonaktifkan simpan; 422 server tampil di tab yang benar", async ({ page }) => {
  await gotoHosts(page)
  await page.getByRole("button", { name: "Aksi untuk node01" }).click()
  await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
  const sheet = page.getByRole("dialog", { name: "Konfigurasi node01" })
  const save = sheet.getByRole("button", { name: "Simpan konfigurasi" })
  const install = sheet.getByRole("button", { name: /^(Simpan & )?Install$/ })

  // Hostname invalid.
  await sheet.getByRole("tab", { name: /^Hostname/ }).click()
  await sheet.locator("#hn-name").fill("bad_name")
  await expect(sheet.locator('[data-slot="field-error"]')).toHaveText("Hanya a–z, 0–9 dan '-', tidak diawali/diakhiri '-'")
  await expect(sheet.getByRole("tab", { name: /^Hostname/ })).toContainText("(ada error)")
  await expect(save).toBeDisabled()
  await expect(install).toBeDisabled()
  await page.screenshot({ path: SHOTS(3, "ac-3.13-hostname-invalid") })
  await sheet.locator("#hn-name").fill("node01")
  await expect(save).toBeEnabled()
  await sheet.getByRole("button", { name: "Batalkan perubahan Hostname" }).click()

  // IP statis bentrok dengan host lain.
  await sheet.getByRole("tab", { name: /^Network/ }).click()
  await sheet.locator("#net-ip").fill("10.10.10.21")
  await expect(sheet.locator('[data-slot="field-error"]').first()).toHaveText("Bentrok dengan ctrl-01")
  await expect(sheet.getByRole("tab", { name: /^Network/ })).toContainText("(ada error)")
  await expect(save).toBeDisabled()
  await expect(install).toBeDisabled()
  await page.screenshot({ path: SHOTS(3, "ac-3.13-ip-conflict") })
  await sheet.getByRole("button", { name: "Batalkan perubahan Network" }).click()

  // Username invalid.
  await sheet.getByRole("tab", { name: /^Credentials/ }).click()
  await sheet.locator("#cred-user").fill("Root")
  await expect(sheet.getByRole("alert").filter({ hasText: "Perlu diperbaiki" })).toContainText("Huruf kecil/angka/_/-, diawali huruf, maks 32 karakter")
  await expect(save).toBeDisabled()
  await sheet.getByRole("button", { name: "Batalkan perubahan Credentials" }).click()
  await expect(save).toBeDisabled() // tidak ada perubahan

  // 422 dari server: key baru yang sudah ada di library (UI tidak mengecek duplikat fingerprint).
  const admin = (await (await page.request.get("/api/ssh-keys")).json()).find((k: { id: string }) => k.id === "key-admin-wals")
  await sheet.getByRole("tab", { name: /^SSH Keys/ }).click()
  await sheet.getByRole("button", { name: "Tempel / unggah key baru" }).click()
  await sheet.locator("#key-0").fill(admin.publicKey)
  await sheet.locator("#key-name-0").fill("duplikat")
  await sheet.getByRole("tab", { name: /^OS/ }).click() // pindah tab: server harus membawa kembali ke SSH
  const res = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().endsWith("/api/hosts/525400101011"))
  await save.click()
  expect((await res).status()).toBe(422)
  await expect(sheet.getByRole("tab", { name: /^SSH Keys/ })).toHaveAttribute("aria-selected", "true")
  const alert = sheet.getByRole("tabpanel").getByRole("alert").filter({ hasText: "Ditolak server" })
  await expect(alert).toContainText('Key baru #1: sudah ada di library sebagai "Admin workstation"')
  await expect(sheet.getByRole("tab", { name: /^SSH Keys/ })).toContainText("(ada error)")
  await expect(page.getByText("Konfigurasi ditolak server")).toBeVisible()
  await expect(sheet).toBeVisible()
  await page.screenshot({ path: SHOTS(3, "ac-3.13-server-422") })
})
