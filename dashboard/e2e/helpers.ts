import path from "node:path"

import { expect, type Locator, type Page } from "@playwright/test"

export const SHOTS = (m: 1 | 2 | 3, name: string) =>
  path.resolve(__dirname, `../../.agent/runs/m${m}/screenshots/${name}.png`)

/** Tabel host utama (bukan tabel preview di Sheet). */
export function hostsTable(page: Page): Locator {
  return page.locator("main table").first()
}

export function hostRows(page: Page): Locator {
  return hostsTable(page).locator("tbody tr")
}

/** Baris tabel host berdasarkan MAC. */
export function rowByMac(page: Page, mac: string): Locator {
  return hostRows(page).filter({ has: page.getByText(mac, { exact: true }) })
}

export async function gotoHosts(page: Page, query = "") {
  await page.goto(`/hosts${query}`)
  await expect(hostRows(page).first().locator('[data-status]')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
}

/**
 * AC-1.3: untuk setiap elemen terlihat, setiap lapisan box-shadow wajib offset-x = offset-y =
 * blur = 0 (ring/hairline spread-only diizinkan). Mengembalikan daftar pelanggaran.
 */
export async function dropShadowViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = []
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const cs = getComputedStyle(el)
      if (cs.boxShadow === "none" || cs.visibility === "hidden" || cs.display === "none") continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      // Pisah lapisan pada koma di luar kurung warna.
      const layers: string[] = []
      let depth = 0
      let cur = ""
      for (const ch of cs.boxShadow) {
        if (ch === "(") depth++
        if (ch === ")") depth--
        if (ch === "," && depth === 0) {
          layers.push(cur)
          cur = ""
        } else cur += ch
      }
      layers.push(cur)
      for (const layer of layers) {
        const nums = layer
          .replace(/(rgba?|oklch|oklab|lab|lch|color|hsla?)\([^)]*\)/g, "")
          .replace("inset", "")
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .map((v) => parseFloat(v))
        const [x = 0, y = 0, blur = 0] = nums
        if (x !== 0 || y !== 0 || blur !== 0) {
          const id = `${el.tagName.toLowerCase()}[data-slot=${el.dataset.slot ?? ""}].${String(el.className).slice(0, 60)}`
          out.push(`${id}: ${cs.boxShadow}`)
          break
        }
      }
    }
    return out
  })
}

export const ORANGE = "rgb(245, 78, 0)"

/** Elemen terlihat ber-background oranye primary; harus semuanya tombol primary. */
export async function orangeElements(page: Page) {
  return page.evaluate((orange) => {
    return Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && getComputedStyle(el).backgroundColor === orange
      })
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        slot: el.dataset.slot ?? null,
        variant: el.dataset.variant ?? null,
        text: (el.textContent ?? "").trim(),
      }))
  }, ORANGE)
}
