// Audit aksesibilitas E2E (M6-T12, AC-6.38, DEC-017 §9, DEC-019 §2–3).
//
// Semua aturan axe (tag WCAG 2.0/2.1/2.2 A + AA) dijalankan; TIDAK ada aturan yang dimatikan. Hanya node
// temuan `color-contrast` yang boleh difilter, oleh SATU fungsi bernama `classifyContrastFinding`
// (dievaluasi di browser dengan getComputedStyle + elementsFromPoint, bukan selector):
//   1. `exception:<pasangan>` — warna teks/latar terhitung = pasangan token SPEC yang terdaftar sebagai
//      pengecualian 1.4.3 (DEC-017 §9 + DEC-019 §2), di mana pun letaknya;
//   2. `verified-pass` — HANYA untuk elemen di dalam Sheet (`[data-slot=sheet-content]`, efek
//      backdrop-filter overlay membuat axe menghitung warna campuran): kontras terhitung ≥ 4,5:1
//      (≥ 3:1 untuk teks besar);
//   selain itu `kept` (tetap pelanggaran), termasuk bila warna tidak bisa dihitung pasti (opacity
//   leluhur < 1, warna non-sRGB, latar tidak opak).
// Jumlah node yang difilter per kategori dicatat sebagai bukti (`.agent/runs/m6/axe-results.json`).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

import AxeBuilder from "@axe-core/playwright"
import type { Page } from "@playwright/test"

export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]

/** Pasangan pengecualian 1.4.3 (hex token SPEC, `docs/SPEC.md` §1 / globals.css). */
export const CONTRAST_EXCEPTIONS = [
  { name: "muted/white", fg: "#807d72", bg: "#ffffff" }, // DEC-017 §9
  { name: "muted/canvas", fg: "#807d72", bg: "#f7f7f4" }, // DEC-017 §9
  { name: "muted-soft-placeholder/white", fg: "#a09c92", bg: "#ffffff", placeholderOnly: true }, // DEC-017 §9
  { name: "on-primary/primary", fg: "#ffffff", bg: "#f54e00" }, // DEC-017 §9
  { name: "white/stage-done", fg: "#ffffff", bg: "#c08532" }, // DEC-019 §2
] as const

export type ContrastClass = {
  category: "kept" | "verified-pass" | `exception:${string}`
  fg: string | null
  bg: string | null
  ratio: number | null
  inSheet: boolean
  why: string
}

/**
 * Klasifikasi satu node temuan `color-contrast` (lihat header). Berjalan di browser; `selector` = target
 * axe (CSS selector satu level, tanpa iframe/shadow).
 */
export async function classifyContrastFinding(page: Page, selector: string): Promise<ContrastClass> {
  return page.evaluate(
    ({ selector, exceptions }) => {
      type RGBA = [number, number, number, number]
      const out = (category: string, why: string, extra: Partial<ContrastClass> = {}) =>
        ({ category, why, fg: null, bg: null, ratio: null, inSheet: false, ...extra }) as ContrastClass
      const el = document.querySelector(selector) as HTMLElement | null
      if (!el) return out("kept", "elemen tidak ditemukan")
      const inSheet = el.closest('[data-slot="sheet-content"]') !== null
      const alpha = (v: string | undefined) => (v === undefined ? 1 : v.endsWith("%") ? Number(v.slice(0, -1)) / 100 : Number(v))
      // OKLab → sRGB 0..255 (matriks Björn Ottosson, sama dengan CSS Color 4).
      const fromOklab = (L: number, A: number, B: number, a: number): RGBA => {
        const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
        const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
        const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
        const lin = [
          4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
          -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
          -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
        ]
        const enc = (v: number) => {
          const c = Math.min(1, Math.max(0, v))
          return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
        }
        return [enc(lin[0]), enc(lin[1]), enc(lin[2]), a]
      }
      const parse = (c: string): RGBA | null => {
        const ok = /^(oklab|oklch)\(\s*([-\d.]+%?)\s+([-\d.]+)\s+([-\d.]+)(?:deg)?(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(c)
        if (ok) {
          const L = ok[2].endsWith("%") ? Number(ok[2].slice(0, -1)) / 100 : Number(ok[2])
          if (ok[1] === "oklab") return fromOklab(L, Number(ok[3]), Number(ok[4]), alpha(ok[5]))
          const h = (Number(ok[4]) * Math.PI) / 180
          return fromOklab(L, Number(ok[3]) * Math.cos(h), Number(ok[3]) * Math.sin(h), alpha(ok[5]))
        }
        let m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(c)
        if (!m) m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(c)
        if (!m) return null
        const srgb = c.startsWith("color(")
        const ch = (v: string) => (srgb ? Number(v) * 255 : Number(v))
        return [ch(m[1]), ch(m[2]), ch(m[3]), alpha(m[4])]
      }
      const over = (top: RGBA, bottom: RGBA): RGBA => {
        const a = top[3] + bottom[3] * (1 - top[3])
        if (a === 0) return [0, 0, 0, 0]
        const mix = (i: number) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a
        return [mix(0), mix(1), mix(2), a]
      }
      const hex = (c: RGBA) => "#" + c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")
      const lum = (c: RGBA) => {
        const f = (v: number) => {
          const s = v / 255
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        }
        return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
      }
      // Opacity leluhur < 1 → warna efektif tidak pasti → jangan difilter.
      for (let n: HTMLElement | null = el; n; n = n.parentElement)
        if (Number(getComputedStyle(n).opacity) < 1) return out("kept", "opacity leluhur < 1", { inSheet })
      const cs = getComputedStyle(el)
      const fgRaw = parse(cs.color)
      if (!fgRaw) return out("kept", `warna teks tidak terbaca: ${cs.color}`, { inSheet })
      // Latar: tumpukan elementsFromPoint di tengah elemen, dari atas; dicampur sampai opak.
      const r = el.getBoundingClientRect()
      const x = Math.min(Math.max(r.left + r.width / 2, 0), window.innerWidth - 1)
      const y = Math.min(Math.max(r.top + r.height / 2, 0), window.innerHeight - 1)
      const stack = document.elementsFromPoint(x, y)
      const idx = stack.indexOf(el)
      const layers = (idx >= 0 ? stack.slice(idx) : [el, ...stack]) as HTMLElement[]
      let bg: RGBA = [0, 0, 0, 0]
      for (const layer of layers) {
        const lcs = getComputedStyle(layer)
        if (lcs.backgroundImage !== "none") return out("kept", "latar ber-gambar/gradien", { inSheet })
        const c = parse(lcs.backgroundColor)
        if (!c) return out("kept", `latar tidak terbaca: ${lcs.backgroundColor}`, { inSheet })
        // Lapisan di bawah sebelumnya: tumpuk `bg` (atas) di atas `c` (bawah).
        bg = over(bg, c)
        if (bg[3] >= 0.999) break
      }
      if (bg[3] < 0.999) bg = over(bg, [255, 255, 255, 1]) // kanvas browser
      const fg = fgRaw[3] < 1 ? over(fgRaw, bg) : fgRaw
      const l1 = lum(fg)
      const l2 = lum(bg)
      const ratio = Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100
      const size = parseFloat(cs.fontSize)
      const bold = Number(cs.fontWeight) >= 700
      const large = size >= 24 || (bold && size >= 18.66)
      const need = large ? 3 : 4.5
      const fgHex = hex(fg)
      const bgHex = hex(bg)
      const near = (a: string, b: string) =>
        [1, 3, 5].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 1)
      const isField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      for (const e of exceptions)
        if (near(fgHex, e.fg) && near(bgHex, e.bg) && (!("placeholderOnly" in e) || isField))
          return out(`exception:${e.name}`, "pasangan token terdaftar", { fg: fgHex, bg: bgHex, ratio, inSheet })
      if (inSheet && ratio >= need)
        return out("verified-pass", `kontras terhitung ${ratio} ≥ ${need}`, { fg: fgHex, bg: bgHex, ratio, inSheet })
      return out("kept", inSheet ? `kontras terhitung ${ratio} < ${need}` : "di luar Sheet dan bukan pasangan pengecualian", {
        fg: fgHex,
        bg: bgHex,
        ratio,
        inSheet,
      })
    },
    { selector, exceptions: CONTRAST_EXCEPTIONS as unknown as { name: string; fg: string; bg: string; placeholderOnly?: boolean }[] },
  )
}

export type AxeAudit = {
  label: string
  /** Pelanggaran tersisa (semua aturan non-contrast + node contrast `kept`). */
  violations: { id: string; impact: string | null | undefined; targets: string[]; detail?: ContrastClass[] }[]
  filtered: (ContrastClass & { target: string })[]
}

/**
 * Bukti per audit ditambahkan ke JSONL di direktori run E2E (worker Playwright di-restart setiap test
 * gagal, jadi state modul tidak cukup); `writeAxeEvidence` meringkasnya ke `.agent/runs/m6/axe-results.json`.
 */
const evidenceFile = () => path.join(process.env.PXE_E2E_ROOT ?? path.resolve(__dirname, "../../.e2e-data"), "axe-audits.jsonl")

/**
 * Jalankan axe pada halaman, terapkan `classifyContrastFinding` ke node color-contrast saja.
 * `include` (opsional) membatasi KONTEKS audit ke satu region — dipakai hanya untuk dialog modal
 * terbuka (Sheet): konten di belakang overlay modal inert (Radix: `aria-hidden` + `pointer-events:none`)
 * dan tertutup overlay, sementara halaman yang sama diaudit utuh tanpa modal di test terpisah. Semua
 * aturan tetap aktif di region itu.
 */
export async function auditA11y(page: Page, label: string, opts: { include?: string } = {}): Promise<AxeAudit> {
  let builder = new AxeBuilder({ page }).withTags(AXE_TAGS)
  if (opts.include) builder = builder.include(opts.include)
  const res = await builder.analyze()
  const audit: AxeAudit = { label: opts.include ? `${label} [konteks: ${opts.include}]` : label, violations: [], filtered: [] }
  for (const v of res.violations) {
    if (v.id !== "color-contrast") {
      audit.violations.push({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target.join(" ")) })
      continue
    }
    const kept: { target: string; c: ContrastClass }[] = []
    for (const n of v.nodes) {
      const target = n.target.join(" ")
      const c = n.target.length === 1 ? await classifyContrastFinding(page, String(n.target[0])) : null
      if (c && c.category !== "kept") audit.filtered.push({ ...c, target })
      else kept.push({ target, c: c ?? { category: "kept", fg: null, bg: null, ratio: null, inSheet: false, why: "target bertingkat" } })
    }
    if (kept.length)
      audit.violations.push({ id: v.id, impact: v.impact, targets: kept.map((k) => k.target), detail: kept.map((k) => k.c) })
  }
  mkdirSync(path.dirname(evidenceFile()), { recursive: true })
  appendFileSync(evidenceFile(), JSON.stringify(audit) + "\n")
  return audit
}

/** Tulis bukti audit (dipanggil afterAll spec). */
export function writeAxeEvidence(file = path.resolve(__dirname, "../../../.agent/runs/m6/axe-results.json")) {
  if (!existsSync(evidenceFile())) return
  const evidence = readFileSync(evidenceFile(), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as AxeAudit)
  const summary = {
    generatedAt: new Date().toISOString(),
    tags: AXE_TAGS,
    exceptions: CONTRAST_EXCEPTIONS,
    filteredCount: {
      total: evidence.reduce((n, a) => n + a.filtered.length, 0),
      byCategory: evidence
        .flatMap((a) => a.filtered)
        .reduce<Record<string, number>>((m, f) => ({ ...m, [f.category]: (m[f.category] ?? 0) + 1 }), {}),
    },
    audits: evidence,
  }
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(summary, null, 2) + "\n")
}
