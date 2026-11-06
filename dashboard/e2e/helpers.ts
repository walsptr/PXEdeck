import path from "node:path"

import { expect, type Locator, type Page } from "@playwright/test"

/**
 * Screenshot bukti run milestone aktif (`PXE_E2E_MILESTONE`, default 6 = milestone aktif) →
 * `.agent/runs/m<aktif>/screenshots/`. Screenshot regresi milik milestone lain diberi awalan `m<n>-`
 * di direktori yang sama, sehingga bukti milestone yang sudah di-approve tidak tertimpa.
 *
 * BUG-M6-L4: screenshot milik milestone aktif (`EVIDENCE_MILESTONE`, spec `m6-*`) selalu ditulis ke
 * `.agent/runs/m6/screenshots/` tanpa awalan, apa pun nilai env — jadi tidak pernah mencemari
 * direktori bukti M1–M5 yang sudah di-approve.
 */
export const EVIDENCE_MILESTONE = 6
const RUN_MILESTONE = Number(process.env.PXE_E2E_MILESTONE ?? EVIDENCE_MILESTONE)
const RUNS_DIR = path.resolve(__dirname, "../../.agent/runs")
export const SHOTS = (m: 1 | 2 | 3 | 4 | 5 | 6, name: string) =>
  m === EVIDENCE_MILESTONE
    ? path.join(RUNS_DIR, `m${EVIDENCE_MILESTONE}`, "screenshots", `${name}.png`)
    : path.join(RUNS_DIR, `m${RUN_MILESTONE}`, "screenshots", `${m === RUN_MILESTONE ? "" : `m${m}-`}${name}.png`)

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
 * `scope` (iter3, DR-1-2): selector elemen yang diperiksa; default seluruh `body *`.
 */
export async function dropShadowViolations(page: Page, scope = "body *"): Promise<string[]> {
  return page.evaluate((scope) => {
    const out: string[] = []
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(scope))) {
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
  }, scope)
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

/**
 * CR-1-4: seperti `orangeElements`, plus kelas elemen dan caption swatch (teks elemen saudara
 * berikutnya) agar pengecualian di /design bisa dibatasi ke swatch token primary.
 */
export async function orangeElementsDetailed(page: Page) {
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
        classes: typeof el.className === "string" ? el.className : "",
        caption: (el.nextElementSibling?.textContent ?? "").replace(/\s+/g, ""),
      }))
  }, ORANGE)
}

/** CR-1-3: tunggu semua animasi/transisi Web Animations di dokumen selesai (tanpa jeda tetap). */
export async function waitForAnimations(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const running = document.getAnimations().filter((a) => a.playState === "running" || a.pending)
          await Promise.all(running.map((a) => a.finished.catch(() => undefined)))
          return document.getAnimations().filter((a) => a.playState === "running" || a.pending).length
        }),
      { timeout: 5_000 },
    )
    .toBe(0)
}

/**
 * Flake DR-5-5/DR-5-6 (gate M6 iter2, `.agent/runs/m6/final-iter2/flaky-dr55-diagnosis.txt`): tunggu semua
 * animasi/transisi berhingga pada elemen `loc` dan turunannya (mis. Dialog `zoom-in-95`, Sheet `slide-in-*`)
 * selesai sebelum geometri diukur. Dua panggilan `boundingBox()` terpisah selama animasi buka dapat
 * mengambil sampel dari frame berbeda (skala berbeda), sehingga selisih tepi bawah dialog vs footer
 * terlihat > 1 px walau layout final rata. Animasi tak berhingga (spinner) diabaikan agar tidak menggantung.
 */
export async function waitForLocatorAnimations(loc: Locator) {
  await expect
    .poll(
      () =>
        loc.evaluate(async (el) => {
          const active = () =>
            el
              .getAnimations({ subtree: true })
              .filter((a) => (a.playState === "running" || a.pending) && a.effect?.getComputedTiming().iterations !== Infinity)
          await Promise.all(active().map((a) => a.finished.catch(() => undefined)))
          return active().length
        }),
      { timeout: 5_000 },
    )
    .toBe(0)
}
