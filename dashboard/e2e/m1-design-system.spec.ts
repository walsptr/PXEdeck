// M1 E2E: AC-1.2 (warna & font), AC-1.3 (tanpa drop shadow), AC-1.4 (bentuk & ukuran),
// AC-1.5 (tipografi), plus oranye hanya untuk tombol primary.
import { expect, test } from "@playwright/test"

import {
  dropShadowViolations,
  gotoHosts,
  hostRows,
  hostsTable,
  orangeElements,
  orangeElementsDetailed,
  SHOTS,
  waitForAnimations,
} from "./helpers"

test.describe("AC-1.2 warna dasar & font", () => {
  for (const url of ["/hosts", "/design"]) {
    test(`body bg/teks, font Inter + JetBrains Mono di ${url}`, async ({ page }) => {
      await page.goto(url)
      await page.evaluate(() => document.fonts.ready)
      const s = await page.evaluate(() => ({
        bg: getComputedStyle(document.body).backgroundColor,
        color: getComputedStyle(document.body).color,
        htmlFont: getComputedStyle(document.documentElement).fontFamily,
      }))
      expect(s.bg).toBe("rgb(247, 247, 244)")
      expect(s.color).toBe("rgb(38, 37, 30)")
      expect(s.htmlFont.startsWith('"Inter Variable"')).toBe(true)
      // Muat kedua font lalu pastikan tersedia (self-hosted fontsource).
      const fonts = await page.evaluate(async () => {
        await document.fonts.load('16px "Inter Variable"')
        await document.fonts.load('16px "JetBrains Mono Variable"')
        return {
          inter: document.fonts.check('16px "Inter Variable"'),
          mono: document.fonts.check('16px "JetBrains Mono Variable"'),
          loaded: Array.from(document.fonts)
            .filter((f) => f.status === "loaded")
            .map((f) => f.family.replaceAll('"', "")),
        }
      })
      expect(fonts.inter).toBe(true)
      expect(fonts.mono).toBe(true)
      expect(fonts.loaded).toEqual(expect.arrayContaining(["Inter Variable", "JetBrains Mono Variable"]))
    })
  }
})

test.describe("AC-1.3 tanpa drop shadow", () => {
  test("/hosts, dropdown aksi baris, dan Sheet konfigurasi", async ({ page }) => {
    await gotoHosts(page)
    expect(await dropShadowViolations(page)).toEqual([])

    await page.getByRole("button", { name: "Aksi untuk node01" }).click()
    await expect(page.getByRole("menu")).toBeVisible()
    expect(await dropShadowViolations(page)).toEqual([])
    await page.screenshot({ path: SHOTS(1, "ac-1.3-row-menu") })

    await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
    const sheet = page.getByRole("dialog", { name: /Konfigurasi node01/ })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole("tab", { name: /^OS/ })).toBeVisible()
    // CR-1-3: tunggu animasi slide-in benar-benar selesai (bukan jeda tetap).
    await waitForAnimations(page)
    await expect(sheet).toHaveAttribute("data-state", "open")
    expect(await dropShadowViolations(page)).toEqual([])
    await page.screenshot({ path: SHOTS(1, "ac-1.3-sheet") })
  })

  test("/design", async ({ page }) => {
    await page.goto("/design")
    await page.evaluate(() => document.fonts.ready)
    expect(await dropShadowViolations(page)).toEqual([])
    await page.screenshot({ path: SHOTS(1, "ac-1.3-design"), fullPage: true })
  })
})

test.describe("AC-1.4 bentuk & ukuran di /design", () => {
  test("Button 40px/8px, Input 44px/8px border hairline, Card 12px putih, pill 9999px, placeholder muted-soft", async ({ page }) => {
    await page.goto("/design")
    const btn = page.locator('button[data-slot="button"][data-variant="default"][data-size="default"]').first()
    const b = await btn.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { h: el.getBoundingClientRect().height, r: cs.borderTopLeftRadius, bg: cs.backgroundColor }
    })
    expect(b).toEqual({ h: 40, r: "8px", bg: "rgb(245, 78, 0)" })

    const input = page.locator("#ds-host")
    const i = await input.evaluate((el) => {
      const cs = getComputedStyle(el)
      const ph = getComputedStyle(el, "::placeholder")
      return {
        h: el.getBoundingClientRect().height,
        r: cs.borderTopLeftRadius,
        border: cs.borderTopColor,
        borderW: cs.borderTopWidth,
        placeholder: ph.color,
      }
    })
    expect(i).toEqual({ h: 44, r: "8px", border: "rgb(230, 229, 224)", borderW: "1px", placeholder: "rgb(160, 156, 146)" })
    // InputGroup (pencarian) juga memakai placeholder muted-soft (G1-1).
    const ph2 = await page.locator("#ds-search").evaluate((el) => getComputedStyle(el, "::placeholder").color)
    expect(ph2).toBe("rgb(160, 156, 146)")

    const card = page.locator('[data-slot="card"]').first()
    const c = await card.evaluate((el) => {
      const cs = getComputedStyle(el)
      return { r: cs.borderTopLeftRadius, bg: cs.backgroundColor }
    })
    expect(c).toEqual({ r: "12px", bg: "rgb(255, 255, 255)" })

    const pills = page.locator("[data-status]")
    await expect(pills).toHaveCount(7)
    for (const radius of await pills.evaluateAll((els) => els.map((el) => getComputedStyle(el).borderTopLeftRadius)))
      expect(parseFloat(radius)).toBeGreaterThanOrEqual(9999)
    // Warna pill done/failed: teks putih di atas stage-done / destructive.
    const done = await page.locator('[data-status="done"]').evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color])
    expect(done).toEqual(["rgb(192, 133, 50)", "rgb(255, 255, 255)"])
    const failed = await page.locator('[data-status="failed"]').evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color])
    expect(failed).toEqual(["rgb(207, 45, 86)", "rgb(255, 255, 255)"])
    await page.screenshot({ path: SHOTS(1, "ac-1.4-design-components"), fullPage: true })
  })

  test("G1-3: pemetaan varian tombol ke SPEC terdokumentasi", async ({ page }) => {
    await page.goto("/design")
    const dl = page.getByLabel("Pemetaan varian tombol ke SPEC")
    await expect(dl).toContainText('SPEC: primary variant="default"')
    await expect(dl).toContainText('SPEC: secondary (putih + hairline) variant="outline"')
    const outline = await dl.locator('button[data-variant="outline"]').evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).borderTopColor])
    expect(outline).toEqual(["rgb(255, 255, 255)", "rgb(230, 229, 224)"])
  })
})

test.describe("AC-1.5 tipografi", () => {
  test("judul top bar, label kolom tabel, sel MAC mono", async ({ page }) => {
    await gotoHosts(page)
    const title = await page.locator("header h1").evaluate((el) => {
      const cs = getComputedStyle(el)
      return { text: el.textContent, size: cs.fontSize, weight: cs.fontWeight, ls: cs.letterSpacing }
    })
    expect(title).toEqual({ text: "Hosts", size: "26px", weight: "400", ls: "-0.325px" })

    const ths = hostsTable(page).locator("thead th")
    const labels = await ths.evaluateAll((els) =>
      els.map((el) => {
        const cs = getComputedStyle(el)
        return { size: cs.fontSize, weight: cs.fontWeight, tt: cs.textTransform, ls: cs.letterSpacing, color: cs.color }
      }),
    )
    expect(labels.length).toBe(9)
    for (const l of labels)
      expect(l).toEqual({ size: "11px", weight: "600", tt: "uppercase", ls: "0.88px", color: "rgb(128, 125, 114)" })
    // Label yang belum di-sort tetap berwarna muted.
    const macHeader = ths.nth(1).getByRole("button", { name: /MAC Address/ })
    await expect(macHeader).toHaveCSS("color", "rgb(128, 125, 114)")
    await expect(macHeader).toHaveCSS("text-transform", "uppercase")

    const macFont = await hostRows(page).first().locator("td").nth(1).locator(".type-data").first().evaluate((el) => getComputedStyle(el).fontFamily)
    expect(macFont.startsWith('"JetBrains Mono Variable"')).toBe(true)
  })
})

test("oranye hanya pada tombol primary (/hosts, /design)", async ({ page }) => {
  await gotoHosts(page)
  // Tanpa seleksi tidak ada CTA primary di /hosts.
  expect(await orangeElements(page)).toEqual([])
  await page.getByRole("checkbox", { name: "Pilih node01" }).click()
  const withBar = await orangeElements(page)
  expect(withBar).toEqual([{ tag: "button", slot: "button", variant: "default", text: "Install OS" }])
  await page.goto("/design")
  await page.evaluate(() => document.fonts.ready)
  const design = await orangeElementsDetailed(page)
  // CR-1-4: selain tepat satu Button default, satu-satunya elemen oranye yang boleh adalah swatch
  // token "primary" (div bg-primary dengan caption "primary" + hex #f54e00) — bukan div sembarang.
  const buttons = design.filter((e) => e.tag === "button")
  expect(buttons).toHaveLength(1)
  expect(buttons[0]).toMatchObject({ slot: "button", variant: "default" })
  const others = design.filter((e) => e.tag !== "button")
  expect(others).toEqual([
    { tag: "div", slot: null, variant: null, text: "", classes: expect.stringMatching(/(^|\s)bg-primary(\s|$)/), caption: "primary#f54e00" },
  ])
})
