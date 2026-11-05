// M5-T13 E2E (server "m5-library": subnet KVM, DB kosong + image bawaan, lease fixture, media palsu
// tanpa ubuntu-22.04). Satu host memakai ubuntu-24.04 + key A dari library (→ "dipakai").
//  - AC-5.27 OS Images: seed (id/sumber/URL mono), image tanpa media "tidak tersedia" muted (bukan
//            #cf2d56); dialog daftar: error server per field, 409 id ganda, valid → baris baru; hapus
//            terpakai → 409, tidak terpakai → hilang setelah konfirmasi
//  - AC-5.28 SSH Keys: tambah via paste & unggah .pub (fingerprint = `ssh-keygen -lf`), invalid →
//            error, duplikat → 409, rename tersimpan setelah reload, hapus terpakai → 409, tidak
//            terpakai → hilang; key baru muncul di library tab SSH Keys Sheet
//  - AC-5.32 /os-images, /ssh-keys judul 26 px + konten nyata
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

import { expect, test, type Locator, type Page } from "@playwright/test"

import { SSH_ED25519, SSH_ED25519_B, SSH_RSA } from "../src/test/fixtures"
import { dropShadowViolations, rowByMac, SHOTS } from "./helpers"
import { HEX, leaseWriter, makeHost } from "./m5-support"
import { e2eLeaseFile, e2eRoot } from "./support/e2e-env"

test.describe.configure({ mode: "serial" })

const lease = leaseWriter(e2eLeaseFile("m5-library"))
const HOST = { mac: "52:54:00:99:00:61", leaseIp: "10.99.0.161", staticIp: "10.99.0.61", hostname: "m5-lib-61" }
const mono = (page: Page, sel: string) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).fontFamily)

/** Fingerprint SHA256 menurut `ssh-keygen -lf` (file .pub di direktori data E2E dalam project). */
function sshKeygenFingerprint(pub: string, name: string): { file: string; fp: string } {
  const dir = path.join(e2eRoot(), "keys")
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${name}.pub`)
  writeFileSync(file, `${pub}\n`)
  const out = execFileSync("ssh-keygen", ["-lf", file], { encoding: "utf8" })
  return { file, fp: /(SHA256:[A-Za-z0-9+/]+)/.exec(out)![1] }
}

let keyA = ""
test.beforeAll(async ({ request }) => {
  const r = await request.post("/api/ssh-keys", { headers: { "content-type": "application/json" }, data: { name: "kunci-a", publicKey: SSH_ED25519.publicKey } })
  expect(r.status()).toBe(201)
  keyA = (await r.json()).id
  await makeHost(request, lease, { ...HOST, sshKeyIds: [keyA] })
})

test("AC-5.27/5.32 OS Images: tabel seed, mono, tidak tersedia muted, judul 26 px", async ({ page }) => {
  await page.goto("/os-images")
  await expect(page.getByTestId("os-images-page")).toBeVisible()
  await expect(page.locator("header h1")).toHaveCSS("font-size", "26px")
  await expect(page.locator("main")).not.toContainText("dibangun di tahap")
  const rows = page.getByTestId("os-image-row")
  for (const id of ["ubuntu-24.04", "ubuntu-22.04", "debian-12", "rocky-9"]) await expect(page.locator(`[data-testid="os-image-row"][data-image-id="${id}"]`)).toBeVisible()
  const u24 = page.locator('[data-testid="os-image-row"][data-image-id="ubuntu-24.04"]')
  expect(await u24.getByText("ubuntu-24.04", { exact: true }).first().evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/JetBrains Mono/)
  await expect(u24.getByTestId("img-source")).toContainText("ubuntu-24.04/casper/vmlinuz")
  expect(await u24.getByTestId("img-source").locator(".type-data").first().evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/JetBrains Mono/)
  await expect(u24.getByTestId("img-repo-url")).toHaveText("http://10.99.0.2/media/ubuntu-24.04")
  expect(await u24.getByTestId("img-repo-url").evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/JetBrains Mono/)
  await expect(u24.getByTestId("img-available")).toHaveAttribute("data-available", "true")
  await expect(u24.getByTestId("img-used-by")).toContainText("1")
  // Tanpa media → tidak tersedia, muted (bukan merah).
  const u22 = page.locator('[data-testid="os-image-row"][data-image-id="ubuntu-22.04"]').getByTestId("img-available")
  await expect(u22).toHaveAttribute("data-available", "false")
  await expect(u22).toHaveCSS("color", HEX.muted)
  expect(await u22.evaluate((e) => getComputedStyle(e).color)).not.toBe(HEX.failed)
  expect(await rows.count()).toBeGreaterThanOrEqual(4)
  expect(await dropShadowViolations(page)).toEqual([])
  await page.screenshot({ path: SHOTS(5, "ac-5.27-os-images") })
})

test("AC-5.27 Daftarkan image: error per field, 409 id ganda, valid → baris baru; hapus 409 / hapus berhasil", async ({ page }) => {
  await page.goto("/os-images")
  await page.getByTestId("img-register").click()
  const dlg = page.getByRole("dialog", { name: "Daftarkan OS image" })
  await dlg.locator("#img-id").fill("Bad ID")
  await dlg.locator("#img-name").fill("Ubuntu E2E")
  await dlg.locator("#img-version").fill("24.04")
  await dlg.locator("#img-kernel").fill("../etc/passwd")
  await dlg.locator("#img-initrd").fill("ubuntu-24.04/casper/initrd")
  await dlg.locator("#img-repo").fill("ubuntu-24.04")
  const r1 = page.waitForResponse((r) => r.url().endsWith("/api/os-images") && r.request().method() === "POST")
  await dlg.getByTestId("img-submit").click()
  expect((await r1).status()).toBe(400)
  await expect(dlg.getByTestId("img-error-id")).toBeVisible()
  await expect(dlg.getByTestId("img-error-source.kernel")).toBeVisible()
  await expect(dlg.getByTestId("img-error-name")).toHaveCount(0)
  await page.screenshot({ path: SHOTS(5, "ac-5.27-register-errors") })
  // Id ganda → 409 pada field id.
  await dlg.locator("#img-id").fill("debian-12")
  await dlg.locator("#img-kernel").fill("ubuntu-24.04/casper/vmlinuz")
  const r2 = page.waitForResponse((r) => r.url().endsWith("/api/os-images") && r.request().method() === "POST")
  await dlg.getByTestId("img-submit").click()
  expect((await r2).status()).toBe(409)
  await expect(dlg.getByTestId("img-error-id")).toContainText("sudah ada")
  // Valid.
  await dlg.locator("#img-id").fill("ubuntu-24.04-e2e")
  const r3 = page.waitForResponse((r) => r.url().endsWith("/api/os-images") && r.request().method() === "POST")
  await dlg.getByTestId("img-submit").click()
  expect((await r3).status()).toBe(201)
  await expect(dlg).toBeHidden()
  const newRow = page.locator('[data-testid="os-image-row"][data-image-id="ubuntu-24.04-e2e"]')
  await expect(newRow).toBeVisible()
  await expect(newRow.getByTestId("img-available")).toHaveAttribute("data-available", "true")
  await expect(newRow.getByTestId("img-used-by")).toContainText("0")

  // Hapus terpakai → 409 tampil di dialog.
  const u24UsedBy = (await page.locator('[data-testid="os-image-row"][data-image-id="ubuntu-24.04"]').getByTestId("img-used-by").innerText()).trim()
  const usedN = /^(\d+) host$/.exec(u24UsedBy)?.[1]
  expect(usedN, `kolom usedBy: "${u24UsedBy}"`).toBe("1")
  await page.getByRole("button", { name: "Hapus ubuntu-24.04", exact: true }).click()
  const conf = page.getByRole("alertdialog")
  await conf.getByRole("button", { name: "Hapus" }).click()
  // Pesan 409 dari server ("OS image dipakai N host/job"): N = usedBy di tabel (host unik;
  // regresi BUG-M5-1 — sebelumnya host + config + job dijumlah sehingga satu host terhitung 2×).
  await expect(conf.getByTestId("delete-error")).toContainText(/OS image dipakai \d+ host/)
  await expect(conf.getByTestId("delete-error")).toContainText(new RegExp(`OS image dipakai ${usedN} host/job`))
  await page.screenshot({ path: SHOTS(5, "ac-5.27-delete-409") })
  await conf.getByRole("button", { name: "Batal", exact: true }).click()
  await expect(page.locator('[data-testid="os-image-row"][data-image-id="ubuntu-24.04"]')).toBeVisible()
  // Hapus tidak terpakai → hilang.
  await page.getByRole("button", { name: "Hapus ubuntu-24.04-e2e", exact: true }).click()
  const del = page.waitForResponse((r) => r.url().endsWith("/api/os-images/ubuntu-24.04-e2e") && r.request().method() === "DELETE")
  await page.getByRole("alertdialog").getByRole("button", { name: "Hapus" }).click()
  expect((await del).status()).toBe(204)
  await expect(newRow).toHaveCount(0)
})

// ---- iter2: regresi temuan design review M5 iter1 ----

/** Jumlah baris visual (line-height `text-xs` = 16 px) setiap path di kolom Sumber (kernel/initrd/repo/URL) satu baris image. */
async function sourceLineCounts(row: Locator) {
  return row.getByTestId("img-source").locator(".type-data").evaluateAll((els) =>
    els.map((e) => ({ text: e.textContent ?? "", lines: Math.round(e.getBoundingClientRect().height / 16) })),
  )
}

test("DR-5-1 OS Images 375×812: kartu per image ≤ 200 px, path dipenggal di '/', tanpa scroll horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto("/os-images")
  const rows = page.getByTestId("os-image-row")
  await expect(rows.first()).toBeVisible()
  const n = await rows.count()
  expect(n).toBeGreaterThanOrEqual(5)
  const heights: number[] = []
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i)
    const box = (await row.boundingBox())!
    heights.push(Math.round(box.height))
    expect(box.height, `tinggi kartu ${await row.getAttribute("data-image-id")}`).toBeLessThanOrEqual(200)
    expect(box.x + box.width, "kartu tidak melebihi viewport").toBeLessThanOrEqual(375)
    // Path tidak dipecah per karakter: setiap path ≤ 2 baris visual.
    for (const { text, lines } of await sourceLineCounts(row))
      expect(lines, `path "${text}" dipecah ${lines} baris`).toBeLessThanOrEqual(2)
    // Data inti tetap terlihat di kartu: id, sumber, aksi hapus.
    await expect(row.getByTestId("img-source")).toBeVisible()
    await expect(row.getByRole("button", { name: /^Hapus / })).toBeVisible()
  }
  const doc = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    tableOverflow: (() => {
      const c = document.querySelector('[data-testid="os-images-page"] [data-slot="table-container"]') as HTMLElement
      return c.scrollWidth - c.clientWidth
    })(),
  }))
  // Ukuran terukur dicatat di laporan (bukti DR-5-1 untuk design-reviewer).
  test.info().annotations.push({ type: "dr-5-1-375", description: JSON.stringify({ cardHeights: heights, ...doc }) })
  expect(doc.scrollWidth, "scroll horizontal di level halaman").toBeLessThanOrEqual(375)
  expect(doc.tableOverflow, "scroll horizontal di dalam tabel").toBeLessThanOrEqual(0)
  // iter1: 4.032 px untuk 5 image. Batas: header + intro (~300 px) + 200 px per image.
  expect(doc.scrollHeight, `tinggi halaman (kartu: ${heights.join("/")} px)`).toBeLessThanOrEqual(300 + 200 * n)
  // ID & path tetap mono di layout kartu.
  const u24 = page.locator('[data-testid="os-image-row"][data-image-id="ubuntu-24.04"]')
  expect(await u24.getByTestId("img-repo-url").evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/JetBrains Mono/)
  await expect(u24.getByTestId("img-repo-url")).toHaveText("http://10.99.0.2/media/ubuntu-24.04")
  await expect(u24.getByTestId("img-used-by")).toContainText("1 host")
  await page.screenshot({ path: SHOTS(5, "dr-5-1-os-images-375"), fullPage: true })
})

test("DR-5-1 OS Images 1440×900: path Sumber tidak terpotong per karakter, tabel tanpa scroll horizontal", async ({ page }) => {
  await page.goto("/os-images")
  const rows = page.getByTestId("os-image-row")
  await expect(rows.first()).toBeVisible()
  for (let i = 0; i < (await rows.count()); i++)
    for (const { text, lines } of await sourceLineCounts(rows.nth(i)))
      expect(lines, `path "${text}" dipecah ${lines} baris`).toBeLessThanOrEqual(2)
  // Kernel Ubuntu muat satu baris di desktop.
  const kernel = (await sourceLineCounts(page.locator('[data-testid="os-image-row"][data-image-id="ubuntu-24.04"]')))[0]
  expect(kernel.lines, kernel.text).toBe(1)
  const overflow = await page.locator('[data-testid="os-images-page"] [data-slot="table-container"]').evaluate((c) => c.scrollWidth - c.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  await expect(page.getByRole("button", { name: "Hapus ubuntu-24.04", exact: true })).toBeInViewport()
  await page.screenshot({ path: SHOTS(5, "dr-5-1-os-images-1440") })
})

test("DR-5-5/DR-5-6 Daftarkan image: error bahasa Indonesia, hint ID disembunyikan saat invalid, footer sticky terlihat di 1440×900", async ({ page }) => {
  await page.goto("/os-images")
  await page.getByTestId("img-register").click()
  const dlg = page.getByRole("dialog", { name: "Daftarkan OS image" })
  const submit = dlg.getByTestId("img-submit")
  // DR-5-6: tombol submit di dalam viewport tanpa scroll.
  await expect(submit).toBeInViewport({ ratio: 1 })
  const footer = dlg.getByTestId("img-dialog-footer")
  await expect(footer).toHaveCSS("position", "sticky")
  expect((await footer.boundingBox())!.y + (await footer.boundingBox())!.height).toBeLessThanOrEqual(900)
  // Footer rata di tepi bawah dialog (konten yang di-scroll tidak terlihat di bawahnya).
  const flush = async () => {
    const d = (await dlg.boundingBox())!
    const f = (await footer.boundingBox())!
    return Math.abs(d.y + d.height - (f.y + f.height))
  }
  expect(await flush()).toBeLessThanOrEqual(1)
  await expect(dlg.getByTestId("img-hint-id")).toBeVisible()
  // Semua field kosong → server 400 → pesan per field berbahasa Indonesia.
  const r = page.waitForResponse((x) => x.url().endsWith("/api/os-images") && x.request().method() === "POST")
  await submit.click()
  expect((await r).status()).toBe(400)
  for (const f of ["id", "name", "version", "source.repo"]) await expect(dlg.getByTestId(`img-error-${f}`)).toHaveText("Wajib diisi")
  await expect(dlg).not.toContainText(/Too small|Too big|expected|Invalid/)
  // Hint ID tidak tampil bersamaan dengan error ID (tidak duplikat).
  await expect(dlg.getByTestId("img-hint-id")).toHaveCount(0)
  // Footer tetap terlihat (dan rata bawah) setelah error menambah tinggi form.
  await expect(submit).toBeInViewport({ ratio: 1 })
  expect(await flush()).toBeLessThanOrEqual(1)
  // Id tidak valid (bukan kosong) → pesan server (bahasa Indonesia), hint tetap tersembunyi.
  await dlg.locator("#img-id").fill("Bad ID")
  const r2 = page.waitForResponse((x) => x.url().endsWith("/api/os-images") && x.request().method() === "POST")
  await submit.click()
  expect((await r2).status()).toBe(400)
  await expect(dlg.getByTestId("img-error-id")).toContainText("huruf kecil")
  await expect(dlg.getByTestId("img-hint-id")).toHaveCount(0)
  await page.screenshot({ path: SHOTS(5, "dr-5-5-register-errors") })
  await dlg.getByRole("button", { name: "Batal", exact: true }).click()
  await expect(dlg).toBeHidden()
})

test("AC-5.28/5.32 SSH Keys: paste + unggah .pub (fingerprint = ssh-keygen), invalid, 409, rename, hapus, Sheet library", async ({ page }) => {
  await page.goto("/ssh-keys")
  await expect(page.getByTestId("ssh-keys-page")).toBeVisible()
  await expect(page.locator("header h1")).toHaveCSS("font-size", "26px")
  await expect(page.locator("main")).not.toContainText("dibangun di tahap")
  const rowA = page.locator(`[data-testid="ssh-key-row"][data-key-id="${keyA}"]`)
  await expect(rowA.getByTestId("key-used-by")).toContainText("1")

  // ---- paste ----
  const fpB = sshKeygenFingerprint(SSH_ED25519_B.publicKey, "b")
  await page.getByTestId("key-add").click()
  let dlg = page.getByRole("dialog", { name: "Tambah SSH key" })
  await dlg.locator("#key-new-name").fill("kunci-b")
  await dlg.locator("#key-new-public").fill("ssh-ed25519 bukan-base64!!")
  await expect(dlg.getByTestId("key-new-error")).toBeVisible()
  await expect(dlg.getByTestId("key-new-submit")).toBeDisabled()
  await dlg.locator("#key-new-public").fill(SSH_ED25519_B.publicKey)
  await expect(dlg.getByTestId("key-new-fingerprint")).toHaveText(fpB.fp)
  await page.screenshot({ path: SHOTS(5, "ac-5.28-add-paste") })
  const p1 = page.waitForResponse((r) => r.url().endsWith("/api/ssh-keys") && r.request().method() === "POST")
  await dlg.getByTestId("key-new-submit").click()
  const created = await p1
  expect(created.status()).toBe(201)
  const keyB = (await created.json()).id
  await expect(dlg).toBeHidden()
  const rowB = page.locator(`[data-testid="ssh-key-row"][data-key-id="${keyB}"]`)
  await expect(rowB.getByTestId("key-fingerprint")).toHaveText(fpB.fp)
  expect(await rowB.getByTestId("key-fingerprint").evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/JetBrains Mono/)
  await expect(rowB.getByTestId("key-used-by")).toContainText("0")

  // ---- duplikat → 409 ----
  await page.getByTestId("key-add").click()
  dlg = page.getByRole("dialog", { name: "Tambah SSH key" })
  await dlg.locator("#key-new-name").fill("duplikat")
  await dlg.locator("#key-new-public").fill(SSH_ED25519.publicKey)
  const p2 = page.waitForResponse((r) => r.url().endsWith("/api/ssh-keys") && r.request().method() === "POST")
  await dlg.getByTestId("key-new-submit").click()
  expect((await p2).status()).toBe(409)
  await expect(dlg.getByTestId("key-new-error")).toContainText(/sudah ada|duplikat|terdaftar/i)
  await page.screenshot({ path: SHOTS(5, "ac-5.28-duplicate-409") })
  await dlg.getByRole("button", { name: "Batal", exact: true }).click()

  // ---- unggah .pub ----
  const rsa = sshKeygenFingerprint(SSH_RSA.publicKey, "rsa")
  await page.getByTestId("key-add").click()
  dlg = page.getByRole("dialog", { name: "Tambah SSH key" })
  await dlg.getByTestId("key-new-file").setInputFiles(rsa.file)
  await expect(dlg.locator("#key-new-public")).toHaveValue(SSH_RSA.publicKey)
  await expect(dlg.getByTestId("key-new-fingerprint")).toHaveText(rsa.fp)
  await dlg.locator("#key-new-name").fill("kunci-rsa")
  const p3 = page.waitForResponse((r) => r.url().endsWith("/api/ssh-keys") && r.request().method() === "POST")
  await dlg.getByTestId("key-new-submit").click()
  expect((await p3).status()).toBe(201)
  const keyRsa = (await (await p3).json()).id
  await expect(page.locator(`[data-testid="ssh-key-row"][data-key-id="${keyRsa}"]`).getByTestId("key-fingerprint")).toHaveText(rsa.fp)

  // ---- rename inline → tersimpan setelah reload ----
  await rowB.getByRole("button", { name: "Ubah nama kunci-b" }).click()
  const form = rowB.getByTestId("key-rename-form")
  await form.getByRole("textbox").fill("kunci-b-baru")
  const pa = page.waitForResponse((r) => r.url().endsWith(`/api/ssh-keys/${keyB}`) && r.request().method() === "PATCH")
  await form.getByRole("button", { name: "Simpan" }).click()
  expect((await pa).status()).toBe(200)
  await page.reload()
  await expect(page.locator(`[data-testid="ssh-key-row"][data-key-id="${keyB}"]`).getByTestId("key-name")).toHaveText("kunci-b-baru")

  // ---- hapus terpakai → 409; tidak terpakai → hilang ----
  await page.getByRole("button", { name: "Hapus kunci-a", exact: true }).click()
  let conf = page.getByRole("alertdialog")
  await conf.getByRole("button", { name: "Hapus" }).click()
  await expect(conf.getByTestId("delete-error")).toBeVisible()
  await expect(conf.getByTestId("delete-error")).toContainText(/dipakai/)
  await conf.getByRole("button", { name: "Batal", exact: true }).click()
  await expect(page.locator(`[data-testid="ssh-key-row"][data-key-id="${keyA}"]`)).toBeVisible()
  await page.getByRole("button", { name: "Hapus kunci-b-baru", exact: true }).click()
  conf = page.getByRole("alertdialog")
  const d = page.waitForResponse((r) => r.url().endsWith(`/api/ssh-keys/${keyB}`) && r.request().method() === "DELETE")
  await conf.getByRole("button", { name: "Hapus" }).click()
  expect((await d).status()).toBe(204)
  await expect(page.locator(`[data-testid="ssh-key-row"][data-key-id="${keyB}"]`)).toHaveCount(0)
  await page.screenshot({ path: SHOTS(5, "ac-5.28-ssh-keys") })

  // ---- key baru muncul di library tab SSH Keys Sheet ----
  await page.goto("/hosts")
  await rowByMac(page, HOST.mac).getByRole("button", { name: /^Aksi untuk/ }).click()
  await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
  const sheet = page.getByRole("dialog", { name: /^Konfigurasi / })
  await sheet.getByRole("tab", { name: /^SSH Keys/ }).click()
  await expect(sheet.locator(`[id="lib-${keyRsa}"]`)).toBeVisible()
  await expect(sheet.locator(`[id="lib-${keyA}"]`)).toHaveAttribute("aria-checked", "true")
  await expect(sheet.locator(`[id="lib-${keyB}"]`)).toHaveCount(0)
  await expect(sheet).toContainText("kunci-rsa")
  expect(await mono(page, '[data-testid="key-fingerprint"], [role=dialog] .type-data')).toMatch(/JetBrains Mono/)
})

test("DR-5-2 SSH Keys 1280/1440: kolom Dipakai + tombol Hapus terlihat tanpa scroll horizontal (nama panjang dipotong + title)", async ({ page, request }) => {
  const longName = "ci-runner-rsa-panjang-sekali-namanya-untuk-uji-layout"
  const r = await request.post("/api/ssh-keys", { headers: { "content-type": "application/json" }, data: { name: longName, publicKey: SSH_ED25519_B.publicKey } })
  expect(r.status()).toBe(201)
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/ssh-keys")
    const rows = page.getByTestId("ssh-key-row")
    await expect(rows.first()).toBeVisible()
    const container = page.locator('[data-testid="ssh-keys-page"] [data-slot="table-container"]')
    const c = (await container.boundingBox())!
    expect(await container.evaluate((e) => e.scrollWidth - e.clientWidth), `overflow tabel @${width}`).toBeLessThanOrEqual(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    for (let i = 0; i < (await rows.count()); i++) {
      const row = rows.nth(i)
      for (const target of [row.getByTestId("key-used-by"), row.getByRole("button", { name: /^Hapus / })]) {
        await expect(target).toBeVisible()
        const b = (await target.boundingBox())!
        expect(b.x + b.width, `@${width}: kolom aksi di luar container`).toBeLessThanOrEqual(c.x + c.width)
      }
    }
    const name = page.getByTestId("key-name").filter({ hasText: longName })
    await expect(name).toHaveAttribute("title", new RegExp(`^${longName}`))
    await page.screenshot({ path: SHOTS(5, `dr-5-2-ssh-keys-${width}`) })
  }
})
