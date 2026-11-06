// Probe computed-style read-only (diturunkan dari harness M6 iter2; regex penting + VLAN diperluas).
import type { Page } from "@playwright/test"
export async function probe(page: Page) {
  return page.evaluate(() => {
    const cv = document.createElement("canvas"); cv.width = cv.height = 1
    const cx = cv.getContext("2d", { willReadFrequently: true })!
    const cache = new Map<string, number[]>()
    const rgba = (c: string) => {
      if (cache.has(c)) return cache.get(c)!
      cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1)
      const d = [...cx.getImageData(0, 0, 1, 1).data]; cache.set(c, d); return d
    }
    const hex = (d: number[]) => "#" + d.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("") + (d[3] < 255 ? `@${(d[3] / 255).toFixed(2)}` : "")
    const isOrange = (c: string) => { if (!c || c === "transparent" || c === "rgba(0, 0, 0, 0)") return false; const d = rgba(c); return d[3] > 0 && d[0] > 190 && d[1] > 40 && d[1] < 120 && d[2] < 60 }
    const PASTEL = ["#9fbbe0", "#dfa88f", "#c0a8dd", "#9fc9a2", "#c08532"]
    const vis = (el: Element) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.visibility !== "hidden" && cs.display !== "none" && r.width > 0 && r.height > 0 }
    const desc = (el: Element) => { const h = el as HTMLElement; const t = (h.innerText ?? "").trim().replace(/\s+/g, " ").slice(0, 60); const tid = h.closest("[data-testid]")?.getAttribute("data-testid"); return `${el.tagName.toLowerCase()}${h.dataset.slot ? `[slot=${h.dataset.slot}]` : ""}${tid ? `{tid=${tid}}` : ""} "${t}" .${el.className.toString().slice(0, 70)}` }
    const shadows: string[] = [], rings: string[] = [], orange: string[] = [], pastel: string[] = []
    for (const el of document.querySelectorAll("body *")) {
      if (!vis(el)) continue
      const cs = getComputedStyle(el)
      const bs = cs.boxShadow
      if (bs && bs !== "none") {
        // pecah per lapisan; lapisan non-nol = ada offset/blur/spread dengan warna tidak transparan
        const layers = bs.split(/,(?![^(]*\))/)
        for (const L of layers) {
          const col = (L.match(/(rgba?|oklab|oklch|color|lab|lch)\([^)]*\)/) ?? [""])[0]
          const nums = L.replace(col, "").trim().split(/\s+/).filter((x) => /px$/.test(x)).map(parseFloat)
          const a = col ? rgba(col)[3] : 255
          if (a === 0 || nums.every((n) => n === 0)) continue
          const [ox = 0, oy = 0, blur = 0] = nums
          ;(ox || oy || blur ? shadows : rings).push(`${L.trim()} :: ${desc(el)}`)
        }
      }
      const props: [string, string][] = [["color", cs.color], ["bg", cs.backgroundColor]]
      if (parseFloat(cs.borderTopWidth) > 0) props.push(["border", cs.borderTopColor])
      if (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) props.push(["outline", cs.outlineColor])
      if (bs !== "none" && /\(/.test(bs)) for (const m of bs.match(/(rgba?|oklab|oklch|color)\([^)]*\)/g) ?? []) props.push(["shadow", m])
      for (const [k, v] of props) if (isOrange(v) && (k !== "color" || ((el as HTMLElement).innerText ?? "").trim() || el.tagName === "svg")) orange.push(`${k}=${hex(rgba(v))} :: ${desc(el)}`)
      const bg = hex(rgba(cs.backgroundColor))
      if (PASTEL.includes(bg)) pastel.push(`${bg} :: ${desc(el)}`)
    }
    // mono untuk data teknis
    const RX: [string, RegExp][] = [
      ["mac", /\b([0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/i], ["ip", /\b\d{1,3}(\.\d{1,3}){3}(\/\d+)?\b/],
      ["path", /(^|[\s(“"'])\/?[\w.-]+\/[\w.-]+\/[\w./-]+/], ["hash", /SHA256:[A-Za-z0-9+/]{20,}|\b[0-9a-f]{32,}\b/i],
    ]
    const nonMono: string[] = []
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let n: Node | null
    while ((n = tw.nextNode())) {
      const p = n.parentElement!; if (!p || !vis(p) || p.closest("script,style,.sr-only")) continue
      const t = n.textContent ?? ""
      for (const [k, re] of RX) {
        const m = re.exec(t); if (!m) continue
        const ff = getComputedStyle(p).fontFamily
        if (!/JetBrains/i.test(ff)) nonMono.push(`${k}: "${m[0].trim()}" in "${t.trim().slice(0, 80)}" font=${ff.slice(0, 25)} :: ${desc(p)}`)
      }
    }
    for (const inp of document.querySelectorAll("input,textarea")) {
      const v = (inp as HTMLInputElement).value; if (!v || !vis(inp)) continue
      for (const [k, re] of RX) if (re.test(v) && !/JetBrains/i.test(getComputedStyle(inp).fontFamily)) nonMono.push(`input-${k}: "${v.slice(0, 40)}" :: ${desc(inp)}`)
    }
    // muted pada informasi penting
    const MUTED = "#807d72"
    const IMPORTANT = /gagal|failed|error|galat|tidak tersedia|ditolak|kedaluwarsa|tidak ditemukan|timeout|salah|offline|tidak bisa|melebihi|sesi berakhir|di luar subnet|tidak terdaftar|bentrok|terpakai|tidak valid|bermasalah|wajib|harus|nonaktif|^(Booting|Installing|Configuring|Done|Failed|Pending|Discovered)$/i
    const mutedImportant: string[] = []
    const mutedAll: string[] = []
    for (const el of document.querySelectorAll("body *")) {
      if (!vis(el)) continue
      const own = [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join("").trim()
      if (!own) continue
      if (hex(rgba(getComputedStyle(el).color)) !== MUTED) continue
      mutedAll.push(own.slice(0, 70))
      const inAlert = el.closest('[role=alert],[data-slot=badge],[data-status]')
      if (IMPORTANT.test(own) || inAlert) mutedImportant.push(`"${own.slice(0, 90)}" :: ${desc(el)}`)
    }
    const titles = [...document.querySelectorAll("h1")].filter(vis).map((h) => { const cs = getComputedStyle(h); return `${h.textContent?.trim()} ${cs.fontSize}/${cs.fontWeight} ls=${cs.letterSpacing} ff=${cs.fontFamily.slice(0, 14)} color=${hex(rgba(cs.color))}` })
    const offenders: string[] = []
    const vw = window.innerWidth
    for (const el of document.querySelectorAll("body *")) {
      if (!vis(el) || el.closest("[data-sonner-toaster],.sr-only")) continue
      const r = el.getBoundingClientRect()
      if (r.right > vw + 0.5) offenders.push(`${desc(el)} right=${Math.round(r.right)}`)
    }
    return {
      bodyBg: hex(rgba(getComputedStyle(document.body).backgroundColor)), vw,
      docScrollWidth: document.documentElement.scrollWidth, offenders: offenders.slice(0, 6),
      shadows: [...new Set(shadows)], rings: [...new Set(rings)].slice(0, 15), orange: [...new Set(orange)], pastel: [...new Set(pastel)],
      nonMono: [...new Set(nonMono)].slice(0, 30), mutedImportant: [...new Set(mutedImportant)], mutedSample: [...new Set(mutedAll)].slice(0, 60), titles,
    }
  })
}
