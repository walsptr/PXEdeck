// Utilitas audit read-only M7 (login API, settle, fokus + kontras, mono VLAN).
import { expect, type Page } from "@playwright/test"

export async function login(page: Page) {
  const r = await page.request.post("/api/auth/login", {
    headers: { "content-type": "application/json" },
    data: { username: "admin-dr", password: process.env.DR_PASS },
  })
  expect(r.status()).toBe(204)
}

export async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.waitForTimeout(400)
}

type RGB = [number, number, number]
const lum = (c: RGB) => {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
}
export const ratio = (a: RGB, b: RGB) => { const l1 = lum(a), l2 = lum(b); return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100 }
const hex = (c: RGB) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")

/** Info fokus elemen aktif: border/outline/ring dikomposit di atas latar sekitar + rasio kontras. */
export async function focusInfo(page: Page) {
  await page.waitForTimeout(350) // transition-all pada tombol/input: ukur setelah transisi selesai
  const raw = await page.evaluate(() => {
    const cv = document.createElement("canvas"); cv.width = cv.height = 1
    const cx = cv.getContext("2d", { willReadFrequently: true })!
    const rgba = (c: string) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = [...cx.getImageData(0, 0, 1, 1).data]; return [d[0], d[1], d[2], d[3] / 255] }
    const a = document.activeElement as HTMLElement
    const cs = getComputedStyle(a)
    const opaqueBg = (el: Element | null) => { for (let n = el; n; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0.99) return c } return [255, 255, 255, 1] }
    const ownBg = opaqueBg(a)
    const around = opaqueBg(a.parentElement)
    const layers = cs.boxShadow === "none" ? [] : cs.boxShadow.split(/,(?![^(]*\))/).map((L) => {
      const col = (L.match(/(rgba?|oklab|oklch|color|lab|lch)\([^)]*\)/) ?? [""])[0]
      const nums = L.replace(col, "").trim().split(/\s+/).filter((x) => /px$/.test(x)).map(parseFloat)
      return { color: rgba(col || "#000"), nums, inset: /inset/.test(L) }
    })
    return {
      el: `${a.tagName.toLowerCase()}[role=${a.getAttribute("role")}][aria-label=${a.getAttribute("aria-label")}]#${a.id}`,
      fv: a.matches(":focus-visible"),
      border: { w: cs.borderTopWidth, style: cs.borderTopStyle, color: rgba(cs.borderTopColor) },
      outline: { style: cs.outlineStyle, w: cs.outlineWidth, color: rgba(cs.outlineColor) },
      layers, ownBg, around, rect: a.getBoundingClientRect().toJSON(),
      scroll: { sw: a.scrollWidth, cw: a.clientWidth, sh: a.scrollHeight, ch: a.clientHeight },
    }
  })
  const over = (c: number[], bg: number[]): RGB => [0, 1, 2].map((i) => c[i] * c[3] + bg[i] * (1 - c[3])) as RGB
  const around = raw.around.slice(0, 3) as RGB, own = raw.ownBg.slice(0, 3) as RGB
  const borderC = over(raw.border.color, own)
  const rings = raw.layers.filter((l) => l.color[3] > 0 && l.nums.some((n) => n !== 0)).map((l) => {
    const c = over(l.color, around)
    return { spread: l.nums[3] ?? 0, inset: l.inset, hex: hex(c), alpha: l.color[3], vsAround: ratio(c, around), vsOwnBg: ratio(c, own) }
  })
  return {
    el: raw.el, fv: raw.fv,
    border: { w: raw.border.w, style: raw.border.style, hex: hex(borderC), vsOwnBg: ratio(borderC, own), vsAround: ratio(borderC, around) },
    outline: raw.outline.style === "none" ? "none" : `${raw.outline.style} ${raw.outline.w} ${hex(over(raw.outline.color, around))}`,
    rings, ownBg: hex(own), around: hex(around), rect: raw.rect, scroll: raw.scroll,
  }
}

/** Tab sampai elemen aktif cocok selector (maks n). */
export async function tabTo(page: Page, selector: string, n = 60) {
  for (let i = 0; i < n; i++) {
    await page.keyboard.press("Tab")
    if (await page.evaluate((s) => document.activeElement?.matches(s) ?? false, selector)) return i + 1
  }
  return -1
}

/** Font family elemen per selector (mono VLAN). */
export async function fonts(page: Page, selectors: string[]) {
  return page.evaluate((sels) => Object.fromEntries(sels.map((s) => [s, [...document.querySelectorAll(s)].filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => `${((e as HTMLInputElement).value ?? e.textContent ?? "").toString().trim().slice(0, 40)} => ${getComputedStyle(e).fontFamily.slice(0, 22)} ${getComputedStyle(e).fontSize} ${getComputedStyle(e).color}`)])), selectors)
}

/** Deskripsi muted di Sheet: apakah tertutup elemen lain (mis. footer sticky) di titik tengahnya. */
export async function occlusion(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll('[data-slot="sheet-content"] [data-slot=field-description], [data-slot="sheet-content"] .text-muted-foreground')].map((el) => {
    const r = el.getBoundingClientRect(); if (!r.width) return null
    const x = r.left + r.width / 2, y = r.top + r.height / 2
    const top = document.elementsFromPoint(x, y)[0]
    const covered = !!top && top !== el && !el.contains(top)
    return covered ? `${(el as HTMLElement).innerText.slice(0, 50)} covered-by ${top.tagName.toLowerCase()}.${top.className.toString().slice(0, 60)} bg=${getComputedStyle(top).backgroundColor}` : null
  }).filter(Boolean))
}
