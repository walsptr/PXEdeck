// AC-1.1: token warna SPEC §1 di `:root` globals.css + semua --shadow-* di @theme bernilai nol.
// AC-1.6 (bagian grep): kelas/token `stage-` hanya dipakai di file yang diizinkan.
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const SRC = path.resolve(__dirname, "..")
const css = readFileSync(path.join(SRC, "app/globals.css"), "utf8")

/** Isi blok pertama yang diawali `selector {` (kurung kurawal seimbang). */
function block(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`)
  expect(start, `blok ${selector} ada`).toBeGreaterThanOrEqual(0)
  let depth = 0
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++
    if (source[i] === "}" && --depth === 0)
      return source.slice(source.indexOf("{", start) + 1, i)
  }
  throw new Error(`blok ${selector} tidak ditutup`)
}

function vars(body: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))
    out.set(m[1], m[2].trim().toLowerCase())
  return out
}

const ROOT_EXPECTED: Record<string, string> = {
  "--background": "#f7f7f4",
  "--canvas-soft": "#fafaf7",
  "--card": "#ffffff",
  "--popover": "#ffffff",
  "--foreground": "#26251e",
  "--body": "#5a5852",
  "--muted-foreground": "#807d72",
  "--muted-soft": "#a09c92",
  "--border": "#e6e5e0",
  "--input": "#e6e5e0",
  "--hairline-soft": "#efeee8",
  "--hairline-strong": "#cfcdc4",
  "--secondary": "#e6e5e0",
  "--muted": "#e6e5e0",
  "--primary": "#f54e00",
  "--ring": "#f54e00",
  "--primary-active": "#d04200",
  "--primary-foreground": "#ffffff",
  "--destructive": "#cf2d56",
  "--success": "#1f8a65",
  // SPEC §1: pastel tahap provisioning.
  "--stage-discovered": "#9fbbe0",
  "--stage-booting": "#dfa88f",
  "--stage-installing": "#c0a8dd",
  "--stage-configuring": "#9fc9a2",
  "--stage-done": "#c08532",
}

/**
 * Isi SEMUA blok yang selector-list-nya memuat `:root` (termasuk yang bersarang di `@layer`/
 * `@media`), berurutan sesuai sumber (CR-1-8). Komentar dibuang lebih dulu.
 */
function allBlocks(source: string, selector: string): string[] {
  const src = source.replace(/\/\*[\s\S]*?\*\//g, "")
  const out: string[] = []
  let segStart = 0
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (ch === "{") {
      const sel = src.slice(segStart, i).trim()
      const parts = sel.split(",").map((p) => p.trim())
      if (parts.includes(selector)) {
        let depth = 0
        for (let j = i; j < src.length; j++) {
          if (src[j] === "{") depth++
          if (src[j] === "}" && --depth === 0) {
            out.push(src.slice(i + 1, j))
            break
          }
        }
      }
      segStart = i + 1
    } else if (ch === "}" || ch === ";") {
      segStart = i + 1
    }
  }
  return out
}

describe("CR-1-8 parser semua blok :root", () => {
  it("menangkap :root kedua, :root di @layer, dan selector list; nilai terakhir menang", () => {
    const sample = `:root { --a: #111; --b: #222; }
      @layer base { :root { --a: #333; } }
      /* :root { --a: #999; } */
      html, :root { --b: #444; }
      .x { --a: #555; }`
    const blocks = allBlocks(sample, ":root")
    expect(blocks).toHaveLength(3)
    const merged = new Map(blocks.flatMap((b) => [...vars(b)]))
    expect(merged.get("--a")).toBe("#333")
    expect(merged.get("--b")).toBe("#444")
  })
})

describe("AC-1.1 token globals.css", () => {
  // CR-1-8: gabungkan SEMUA blok :root (urutan sumber; deklarasi terakhir menang) agar override
  // token di blok :root kedua / @layer ikut terdeteksi.
  const rootBlocks = allBlocks(css, ":root")
  const root = new Map(rootBlocks.flatMap((b) => [...vars(b)]))

  it("minimal satu blok :root; jumlah blok = jumlah selector :root di sumber", () => {
    expect(rootBlocks.length).toBeGreaterThanOrEqual(1)
    const selectorCount = (css.replace(/\/\*[\s\S]*?\*\//g, "").match(/:root\b[^{;}]*\{/g) ?? []).length
    expect(rootBlocks.length).toBe(selectorCount)
  })

  it.each(Object.entries(ROOT_EXPECTED))(":root %s = %s", (name, value) => {
    expect(root.get(name)).toBe(value)
  })

  it("lima token --stage-* didefinisikan, tidak lebih", () => {
    expect([...root.keys()].filter((k) => k.startsWith("--stage-"))).toHaveLength(5)
  })

  it("semua --shadow-* di blok @theme bernilai nol (tanpa drop shadow)", () => {
    // Blok `@theme {` (bukan `@theme inline {`).
    const theme = vars(block(css, "@theme"))
    const shadows = [...theme.entries()].filter(([k]) => k.startsWith("--shadow"))
    expect(shadows.length).toBeGreaterThanOrEqual(8)
    for (const [name, value] of shadows) {
      // Nilai nol: semua panjang 0 dan warna transparan (#0000).
      const lengths = value.replace(/#[0-9a-f]+/g, "").trim().split(/\s+/)
      expect(lengths.every((l) => /^0(px)?$/.test(l)), `${name}: ${value}`).toBe(true)
    }
  })

  it("tidak ada token warna dark aktif (.dark) di globals.css", () => {
    expect(css).not.toMatch(/^\s*\.dark\s*\{/m)
  })
})

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

describe("AC-1.6 pemakaian stage-* terbatas", () => {
  it("`stage-` hanya muncul di globals.css, status-pill.tsx, design/page.tsx", () => {
    const allowed = new Set(
      ["app/globals.css", "components/status-pill.tsx", "app/(dashboard)/design/page.tsx"].map(
        (p) => path.join(SRC, p),
      ),
    )
    const offenders = walk(SRC)
      .filter((f) => /\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => !allowed.has(f))
      .filter((f) => readFileSync(f, "utf8").includes("stage-"))
      .map((f) => path.relative(SRC, f))
    expect(offenders).toEqual([])
  })
})

// CR-1-5: token --chart-* saat ini memakai hex pastel tahap provisioning. SPEC: pastel HANYA untuk
// status pill/timeline, jadi token chart (dan hex pastel mentah) tidak boleh dipakai di luar
// globals.css. Guard ini menangkap `bg-chart-*`, `var(--chart-*)`, dll. yang lolos dari grep `stage-`.
const PASTEL = ["#9fbbe0", "#dfa88f", "#c0a8dd", "#9fc9a2", "#c08532"]

describe("CR-1-5 / AC-1.6 pastel lewat --chart-* atau hex mentah", () => {
  const sources = () =>
    walk(SRC)
      .filter((f) => /\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f))
      .map((f) => ({ f, rel: path.relative(SRC, f), text: readFileSync(f, "utf8") }))

  it("token chart tidak dipakai di luar globals.css", () => {
    const offenders = sources()
      .filter(({ rel }) => rel !== "app/globals.css")
      .filter(({ text }) => /(?:^|[^\w-])(?:[a-z]+-)?chart-[1-9]\b|--chart-|--color-chart-/.test(text))
      .map(({ rel }) => rel)
    expect(offenders).toEqual([])
  })

  it("hex pastel hanya di globals.css, dan di sana hanya sebagai nilai --stage-* / --chart-*", () => {
    const offenders: string[] = []
    for (const { rel, text } of sources()) {
      const lower = text.toLowerCase()
      for (const hex of PASTEL) {
        if (!lower.includes(hex)) continue
        if (rel !== "app/globals.css") {
          offenders.push(`${rel}: ${hex}`)
          continue
        }
        for (const line of lower.split("\n").filter((l) => l.includes(hex)))
          if (!/^\s*--(stage-[a-z]+|chart-[1-5])\s*:\s*#[0-9a-f]{6}\s*;\s*$/.test(line)) offenders.push(`${rel}: ${line.trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
