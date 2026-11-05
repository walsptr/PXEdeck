// Iterasi 3 — bukti test untuk perbaikan gate iter2 (server sendiri, project "iter3-ui",
// env PXE_MGMT_* = subnet lab):
//  - DR-1-2  toast Sonner tanpa drop shadow (AC-1.3 / SPEC §1), dipicu dari alur nyata M2
//            (hapus host sukses & gagal — reboot dihapus DEC-012) dan M3 (simpan konfigurasi):
//            diam, hover, focus-visible.
//  - DR-3-4  "Tambah" DNS 36px; area klik "Hapus DNS …" / "Batalkan perubahan …" ≥ 36px (hit-test).
//  - CR-3-14 IP host = gateway payload ditolak di klien ("Bentrok dengan gateway <gw>"), simpan nonaktif.
//  - I-3-13  screenshot dialog password acak yang benar-benar menampilkan dialog (password di-mask).
import { expect, test, type Locator, type Page } from "@playwright/test"

import { dropShadowViolations, gotoHosts, rowByMac, SHOTS, waitForAnimations } from "./helpers"

const TOAST = "[data-sonner-toast]"
const TOAST_SCOPE = `${TOAST}, ${TOAST} *`

type Layer = { x: number; y: number; blur: number; spread: number; alpha: number; raw: string }

/** Lapisan box-shadow terurai dari elemen (offset, blur, spread, alpha warna). */
async function shadowLayers(loc: Locator): Promise<Layer[]> {
  return loc.evaluate((el) => {
    const bs = getComputedStyle(el).boxShadow
    if (bs === "none") return []
    const parts: string[] = []
    let depth = 0
    let cur = ""
    for (const ch of bs) {
      if (ch === "(") depth++
      if (ch === ")") depth--
      if (ch === "," && depth === 0) {
        parts.push(cur)
        cur = ""
      } else cur += ch
    }
    parts.push(cur)
    return parts.map((raw) => {
      const color = raw.match(/(rgba?|oklch|oklab|lab|lch|color|hsla?)\([^)]*\)/)?.[0] ?? ""
      const nums = raw
        .replace(color, "")
        .replace("inset", "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((v) => parseFloat(v))
      const [x = 0, y = 0, blur = 0, spread = 0] = nums
      const a = color.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/)
      const slash = color.match(/\/\s*([\d.]+%?)\s*\)/)
      let alpha = 1
      if (a) alpha = parseFloat(a[1])
      else if (slash) alpha = slash[1].endsWith("%") ? parseFloat(slash[1]) / 100 : parseFloat(slash[1])
      else if (color === "transparent") alpha = 0
      return { x, y, blur, spread, alpha, raw: raw.trim() }
    })
  })
}

/**
 * DR-1-2: toast terlihat, tanpa drop shadow (helper AC-1.3 pada toast + turunannya, dan tiap lapisan
 * offset 0 & blur 0). Di luar focus-visible juga tidak ada ring spread yang terlihat.
 * Border hairline 1px warna token --border; radius 12px.
 */
async function expectFlatToast(page: Page, toast: Locator, state: string, focusVisible = false) {
  await expect(toast).toBeVisible()
  await waitForAnimations(page)
  expect(await page.locator(TOAST).count(), `${state}: toast ada`).toBeGreaterThan(0)
  expect(await dropShadowViolations(page, TOAST_SCOPE), `${state}: dropShadowViolations([data-sonner-toast])`).toEqual([])
  const layers = await shadowLayers(toast)
  for (const l of layers) {
    expect({ x: l.x, y: l.y, blur: l.blur }, `${state}: ${l.raw}`).toEqual({ x: 0, y: 0, blur: 0 })
    if (!focusVisible) expect(l.spread === 0 || l.alpha === 0, `${state}: ring spread terlihat di luar focus-visible: ${l.raw}`).toBe(true)
  }
  const box = await toast.evaluate((el) => {
    const cs = getComputedStyle(el)
    const probe = document.createElement("div")
    probe.style.cssText = "position:absolute;border:1px solid var(--border)"
    document.body.appendChild(probe)
    const tokenBorder = getComputedStyle(probe).borderTopColor
    probe.remove()
    return {
      widths: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth],
      styles: [cs.borderTopStyle, cs.borderRightStyle, cs.borderBottomStyle, cs.borderLeftStyle],
      colors: [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor],
      radii: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius],
      tokenBorder,
      focusVisible: el.matches(":focus-visible"),
    }
  })
  expect(box.widths, `${state}: border 1px`).toEqual(["1px", "1px", "1px", "1px"])
  expect(box.styles, `${state}: border solid`).toEqual(["solid", "solid", "solid", "solid"])
  expect(box.colors, `${state}: border = token --border`).toEqual(Array(4).fill(box.tokenBorder))
  expect(box.radii, `${state}: radius 12px`).toEqual(["12px", "12px", "12px", "12px"])
  expect(box.focusVisible, `${state}: focus-visible`).toBe(focusVisible)
  return layers
}

/** Diam → hover → focus-visible (keyboard). */
async function expectFlatToastAllStates(page: Page, toast: Locator, shot: { m: 1 | 2 | 3; name: string }) {
  // Pindahkan mouse menjauh agar keadaan "diam" tidak ter-hover.
  await page.mouse.move(10, 450)
  await expectFlatToast(page, toast, "diam")
  await page.screenshot({ path: SHOTS(shot.m, `${shot.name}-idle`) })

  await toast.hover()
  await expect.poll(() => toast.evaluate((el) => el.matches(":hover"))).toBe(true)
  await expectFlatToast(page, toast, "hover")
  await page.screenshot({ path: SHOTS(shot.m, `${shot.name}-hover`) })

  // Fokus keyboard: modality keyboard lalu fokus ke toast (tabIndex Sonner) → :focus-visible.
  await page.keyboard.press("Shift")
  await toast.evaluate((el) => (el as HTMLElement).focus())
  await expect.poll(() => toast.evaluate((el) => el.matches(":focus-visible"))).toBe(true)
  const focused = await expectFlatToast(page, toast, "focus-visible", true)
  // Ring fokus spread-only harus benar-benar ada (bukan sekadar shadow dihapus semua).
  expect(focused.some((l) => l.spread > 0 && l.alpha > 0), `ring fokus: ${focused.map((l) => l.raw).join(" | ")}`).toBe(true)
}

test.describe("DR-1-2 toast Sonner tanpa drop shadow (alur nyata M2 & M3)", () => {
  test("M2 hapus host → toast datar (diam/hover/focus-visible), border 1px, radius 12px", async ({ page }) => {
    await gotoHosts(page)
    await page.getByRole("button", { name: "Aksi untuk win-jump" }).click()
    await page.getByRole("menuitem", { name: "Hapus" }).click()
    await page.getByRole("alertdialog", { name: "Hapus host?" }).getByRole("button", { name: "Hapus" }).click()
    await expect(rowByMac(page, "00:50:56:b2:3e:91")).toHaveCount(0)
    const toast = page.locator(TOAST).filter({ hasText: "win-jump dihapus dari daftar" })
    // Carry-over DR-1-3: toast memakai Inter (bukan ui-sans-serif Sonner); DR-2-3: hostname di
    // judul toast memakai mono (`type-data`).
    await expect(toast).toBeVisible()
    expect(await toast.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"Inter Variable"/)
    const name = toast.locator(".type-data").filter({ hasText: /^win-jump$/ })
    await expect(name).toHaveCount(1)
    expect(await name.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"JetBrains Mono Variable"/)
    await expectFlatToastAllStates(page, toast, { m: 2, name: "iter3-toast-delete" })
  })

  // M4/DEC-012: aksi reboot (dan toast-nya) tidak ada lagi. Toast M2 kedua yang tersisa adalah
  // varian error (hapus gagal) — sekaligus pengukuran shadow toast.error (carry-over I-3-8).
  test("M2 hapus host gagal → toast.error datar (diam/hover/focus-visible)", async ({ page }) => {
    await gotoHosts(page)
    await page.route("**/api/hosts/3ca82a10447c", (r) =>
      r.request().method() === "DELETE" ? r.fulfill({ status: 500, json: { error: "DB terkunci (uji)" } }) : r.fallback(),
    )
    await page.getByRole("button", { name: "Aksi untuk legacy-01" }).click()
    await page.getByRole("menuitem", { name: "Hapus" }).click()
    await page.getByRole("alertdialog", { name: "Hapus host?" }).getByRole("button", { name: "Hapus" }).click()
    const toast = page.locator(TOAST).filter({ hasText: "Gagal menghapus legacy-01" })
    await expect(toast).toBeVisible()
    await expect(toast).toContainText("DB terkunci (uji)")
    await expect(toast).toHaveAttribute("data-type", "error")
    expect(await toast.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"Inter Variable"/)
    expect(await toast.locator(".type-data").filter({ hasText: /^legacy-01$/ }).evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"JetBrains Mono Variable"/)
    await expect(rowByMac(page, "3c:a8:2a:10:44:7c")).toHaveCount(1)
    await expectFlatToastAllStates(page, toast, { m: 2, name: "iter3-toast-delete-error" })
  })

  test("M3 simpan konfigurasi → toast datar (diam/hover/focus-visible); seluruh halaman tanpa drop shadow", async ({ page }) => {
    await gotoHosts(page)
    await page.getByRole("button", { name: "Aksi untuk compute-01" }).click()
    await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
    const sheet = page.getByRole("dialog", { name: "Konfigurasi compute-01" })
    await sheet.getByRole("tab", { name: /^Hostname/ }).click()
    await sheet.locator("#hn-name").fill("compute-01b")
    const res = page.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes("/api/hosts/"))
    await sheet.getByRole("button", { name: "Simpan konfigurasi" }).click()
    expect((await res).status()).toBe(200)
    const toast = page.locator(TOAST).filter({ hasText: "Konfigurasi disimpan" })
    await expect(toast).toBeVisible()
    await expect(toast).toContainText("Hostname")
    await expectFlatToastAllStates(page, toast, { m: 3, name: "iter3-toast-config-saved" })
    // Helper AC-1.3 tanpa scope: tidak ada drop shadow di mana pun saat toast tampil.
    await page.mouse.move(10, 450)
    await waitForAnimations(page)
    expect(await dropShadowViolations(page)).toEqual([])
  })
})

/** Elemen di titik (x, y) adalah `target` atau turunannya. */
async function hits(page: Page, target: Locator, x: number, y: number) {
  const handle = await target.elementHandle()
  return page.evaluate(
    ([el, px, py]) => {
      const at = document.elementFromPoint(px as number, py as number)
      return !!at && (el as Element).contains(at)
    },
    [handle, x, y] as const,
  )
}

/**
 * DR-3-4: area klik ≥ 36×36 — setiap titik pada grid persegi 36px (berpusat di tombol, batas tepi
 * disisipkan 0,5px) hasil `elementFromPoint` harus tombol itu sendiri (pseudo-element tidak terpotong
 * dan tidak tertutup elemen lain).
 */
async function expectHitArea36(page: Page, button: Locator, label: string) {
  await button.scrollIntoViewIfNeeded()
  const b = (await button.boundingBox())!
  const cx = b.x + b.width / 2
  const cy = b.y + b.height / 2
  const misses: string[] = []
  const steps = [-17.5, -12, -6, 0, 6, 12, 17.5]
  for (const dx of steps)
    for (const dy of steps) if (!(await hits(page, button, cx + dx, cy + dy))) misses.push(`(${dx},${dy})`)
  expect(misses, `${label}: titik di luar area klik 36px`).toEqual([])
  // Ukuran pseudo-element ::after (area klik) dari computed style.
  const after = await button.evaluate((el) => {
    const a = getComputedStyle(el, "::after")
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    const padW = r.width - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth)
    const padH = r.height - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth)
    return { pos: a.position, w: padW - parseFloat(a.left) - parseFloat(a.right), h: padH - parseFloat(a.top) - parseFloat(a.bottom) }
  })
  expect(after.pos).toBe("absolute")
  expect(after.w, `${label}: lebar area klik`).toBeGreaterThanOrEqual(36)
  expect(after.h, `${label}: tinggi area klik`).toBeGreaterThanOrEqual(36)
}

test.describe("DR-3-4 ukuran kontrol kecil Sheet", () => {
  test("'Tambah' DNS tinggi 36px; area klik 'Hapus DNS …' dan 'Batalkan perubahan …' ≥ 36px dan berfungsi", async ({ page }) => {
    await gotoHosts(page)
    await page.getByRole("button", { name: "Aksi untuk node01" }).click()
    await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
    const sheet = page.getByRole("dialog", { name: "Konfigurasi node01" })
    await sheet.getByRole("tab", { name: /^Network/ }).click()
    await waitForAnimations(page)

    await sheet.locator("#net-dns").fill("1.1.1.1")
    const add = sheet.getByRole("button", { name: "Tambah", exact: true })
    await expect(add).toBeEnabled()
    expect(Math.round((await add.boundingBox())!.height)).toBe(36)
    await add.click()
    await expect(sheet.getByRole("button", { name: "Hapus DNS 1.1.1.1" })).toBeVisible()

    const removeDns = sheet.getByRole("button", { name: "Hapus DNS 10.10.10.1" })
    await expectHitArea36(page, removeDns, "Hapus DNS 10.10.10.1")
    await expectHitArea36(page, sheet.getByRole("button", { name: "Hapus DNS 1.1.1.1" }), "Hapus DNS 1.1.1.1")

    const undo = sheet.getByRole("button", { name: "Batalkan perubahan Network" })
    await expect(undo).toBeVisible()
    await expectHitArea36(page, undo, "Batalkan perubahan Network")
    await page.screenshot({ path: SHOTS(3, "iter3-sheet-dns-controls") })

    // Klik di tepi area klik (di luar kotak visual 24px) tetap menjalankan aksi.
    const rb = (await removeDns.boundingBox())!
    await page.mouse.click(rb.x + rb.width / 2, rb.y + rb.height / 2 - 17)
    await expect(sheet.getByRole("button", { name: "Hapus DNS 10.10.10.1" })).toHaveCount(0)
    const ub = (await undo.boundingBox())!
    await page.mouse.click(ub.x + ub.width / 2 + 17, ub.y + ub.height / 2)
    await expect(sheet.getByRole("button", { name: "Batalkan perubahan Network" })).toHaveCount(0)
    await expect(sheet.getByRole("button", { name: "Hapus DNS 10.10.10.1" })).toBeVisible()
    await expect(sheet.getByRole("button", { name: "Hapus DNS 1.1.1.1" })).toHaveCount(0)
  })
})

test.describe("CR-3-14 IP host = gateway payload ditolak di UI", () => {
  test("single host: pesan 'Bentrok dengan gateway <gw>', simpan & install nonaktif, tanpa request", async ({ page }) => {
    await gotoHosts(page)
    const writes: string[] = []
    page.on("request", (r) => ["PATCH", "POST"].includes(r.method()) && writes.push(`${r.method()} ${r.url()}`))
    await page.getByRole("button", { name: "Aksi untuk ctrl-02" }).click()
    await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
    const sheet = page.getByRole("dialog", { name: "Konfigurasi ctrl-02" })
    await sheet.getByRole("tab", { name: /^Network/ }).click()
    const save = sheet.getByRole("button", { name: "Simpan konfigurasi" })
    const install = sheet.getByRole("button", { name: /^(Simpan & )?Install$/ })

    await sheet.locator("#net-gw").fill("10.10.10.5")
    await sheet.locator("#net-ip").fill("10.10.10.5")
    await expect(sheet.locator('[data-slot="field-error"]').first()).toHaveText("Bentrok dengan gateway 10.10.10.5")
    await expect(sheet.locator("#net-ip")).toHaveAttribute("aria-invalid", "true")
    await expect(sheet.getByRole("tab", { name: /^Network/ })).toContainText("(ada error)")
    await expect(save).toBeDisabled()
    await expect(install).toBeDisabled()
    await page.screenshot({ path: SHOTS(3, "iter3-cr-3-14-gateway-conflict") })

    // IP lain → valid kembali, simpan aktif (gateway .5 tetap).
    await sheet.locator("#net-ip").fill("10.10.10.6")
    await expect(sheet.locator('[data-slot="field-error"]')).toHaveCount(0)
    await expect(save).toBeEnabled()
    expect(writes).toEqual([])
  })
})

test.describe("I-3-13 bukti dialog password acak", () => {
  test("screenshot dialog password terlihat penuh (opacity 1), kolom password di-mask", async ({ page }) => {
    await gotoHosts(page)
    for (const m of ["storage-02", "ctrl-03"]) await page.getByRole("checkbox", { name: `Pilih ${m}` }).click()
    const bar = page.getByRole("toolbar", { name: "Aksi untuk host terpilih" })
    await expect(bar).toContainText("2 host dipilih")
    await bar.getByRole("button", { name: "Set Credentials" }).click()
    const sheet = page.getByRole("dialog", { name: "Konfigurasi 2 host" })
    await sheet.getByRole("radio", { name: "Password acak per host" }).click()
    await sheet.locator("#cred-user").fill("opsiter3")
    const res = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/api/hosts/bulk"))
    await sheet.getByRole("button", { name: "Simpan konfigurasi" }).click()
    expect((await res).status()).toBe(200)
    const dlg = page.getByRole("dialog", { name: "Password acak dibuat" })
    await expect(dlg).toBeVisible()
    const pwCells = dlg.getByRole("table", { name: "Password yang dibuat" }).locator("tbody td:nth-child(3)")
    await expect(pwCells).toHaveCount(2)
    await waitForAnimations(page)
    // Dialog benar-benar tampil: opacity penuh, tanpa transform skala, di dalam viewport.
    const shown = await dlg.evaluate((el) => {
      let op = 1
      for (let n: Element | null = el; n; n = n.parentElement) op *= parseFloat(getComputedStyle(n).opacity)
      const r = el.getBoundingClientRect()
      return { op, transform: getComputedStyle(el).transform, inView: r.top >= 0 && r.bottom <= innerHeight && r.width > 300 }
    })
    expect(shown.op).toBe(1)
    expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(shown.transform)
    expect(shown.inView).toBe(true)
    await expect(dlg).toContainText("opsiter3")
    await page.screenshot({ path: SHOTS(3, "iter3-passwords-dialog"), mask: [pwCells] })
  })
})
