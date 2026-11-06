// Audit mandiri lebar layar M6-T8/T9 (data ekstrem). Hasil → results.json (AUDIT_OUT) + screenshot.
import { generateKeyPairSync } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

import { expect, test, type Page } from "@playwright/test"

const WIDTHS = [375, 414, 768, 800, 818, 1024, 1279, 1280, 1440, 1920]
const OUT = process.env.AUDIT_OUT ?? path.join(process.env.AUDIT_ROOT!, "out")
mkdirSync(path.join(OUT, "shots"), { recursive: true })
const results: Record<string, unknown> = {}
const fail: string[] = []
/** Temuan di luar cakupan T8/T9 (tabel Hosts/Jobs men-scroll di dalam kontainernya sendiri). */
const notes: string[] = []
const check = (ok: boolean, msg: string) => {
  if (!ok) fail.push(msg)
}

function sshKey(comment: string): string {
  const { publicKey } = generateKeyPairSync("ed25519")
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32)
  const str = (b: Buffer) => Buffer.concat([Buffer.from([0, 0, 0, b.length]), b])
  const blob = Buffer.concat([str(Buffer.from("ssh-ed25519")), str(raw)])
  return `ssh-ed25519 ${blob.toString("base64")} ${comment}`
}

const EXTREME_IMAGES = [
  { id: "rocky9customlabimagebuildnumber00000000000000001", name: "Rocky Custom Build", version: "9.4", seg: "rocky9-custom-lab" },
  { id: "ubuntu-24-custom-hwe-lab-rack07-node-image-0001x", name: "Ubuntu_Server_24_04_Custom_HWE_Lab_Rack07", version: "24.04", seg: "ubuntu-hyphen-media" },
  { id: "ubuntu-name-nospace-64", name: "UbuntuServerCustomHweLabRack07NodeImageEdisiPanjangTanpaSpasiXYZW".slice(0, 64), version: "24.04", seg: "ubuntu-nospace-media" },
  { id: "ubuntu-path-nobreak-110", name: "Ubuntu Path Panjang", version: "24.04", seg: `ubuntu2404customhwelabrack07nodeimagemediaroot${"x".repeat(64)}` },
]

async function login(page: Page) {
  const r = await page.request.post("/api/auth/login", {
    headers: { "content-type": "application/json" },
    data: { username: "admin-audit", password: process.env.AUDIT_ADMIN_PASSWORD },
  })
  expect(r.status()).toBe(204)
}

/** Ukuran overflow umum halaman. */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const vw = window.innerWidth
    const visible = (el: Element) => {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return cs.visibility !== "hidden" && cs.display !== "none" && r.width > 0 && r.height > 0
    }
    const scrollers: string[] = []
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el)
      if (!/(auto|scroll)/.test(cs.overflowX)) continue
      if (!visible(el)) continue
      if (el.scrollWidth > el.clientWidth + 1)
        scrollers.push(`${el.tagName.toLowerCase()}[${(el as HTMLElement).dataset.slot ?? (el as HTMLElement).dataset.testid ?? el.className.toString().slice(0, 40)}] ${el.scrollWidth}>${el.clientWidth}`)
    }
    const offenders: string[] = []
    for (const el of document.querySelectorAll("body *")) {
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      if (r.right > vw + 0.5 && !el.closest("[data-sonner-toaster]") && !el.closest(".sr-only"))
        offenders.push(`${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 50)} right=${Math.round(r.right)}`)
    }
    const header = document.querySelector("header")
    return {
      vw,
      docScrollWidth: document.documentElement.scrollWidth,
      scrollers,
      offenders: offenders.slice(0, 10),
      header: header ? { scrollWidth: header.scrollWidth, clientWidth: header.clientWidth } : null,
    }
  })
}

async function topBar(page: Page) {
  return page.evaluate(() => {
    const vw = window.innerWidth
    const badges = [...document.querySelectorAll("header [data-service]")].map((b) => {
      const r = b.getBoundingClientRect()
      return { s: (b as HTMLElement).dataset.service, inView: r.right <= vw && r.left >= 0 && r.width > 0 }
    })
    const h1 = document.querySelector("header h1")!.getBoundingClientRect()
    const search = document.querySelector('[data-testid="global-search"]')!.getBoundingClientRect()
    return { badges, titleRight: Math.round(h1.right), searchLeft: Math.round(search.left), searchWidth: Math.round(search.width) }
  })
}

test.describe.configure({ mode: "serial" })

test("seed stres lewat API", async ({ page }) => {
  await login(page)
  for (const x of EXTREME_IMAGES) {
    const r = await page.request.post("/api/os-images", {
      headers: { "content-type": "application/json" },
      data: {
        id: x.id, name: x.name, version: x.version, arch: "amd64", method: "autoinstall", bootable: true,
        source: { kernel: `${x.seg}/casper/hwe-vmlinuz-6.8.0-generic-panjang`, initrd: `${x.seg}/casper/hwe-initrd-6.8.0-generic-panjang`, repo: x.seg },
      },
    })
    expect(r.status(), await r.text()).toBe(201)
  }
  for (const [name, comment] of [
    ["k".repeat(64), `budi@${"workstation-lab-rack07-".repeat(4)}`],
    ["Kunci_Operator_Lab_Rack07_Dengan_Nama_Panjang_Tanpa_Spasi_0001", "x".repeat(90)],
    ["Kunci Budi – lab", "budi@laptop"],
  ]) {
    const r = await page.request.post("/api/ssh-keys", {
      headers: { "content-type": "application/json" },
      data: { name, publicKey: sshKey(comment) },
    })
    expect(r.status(), await r.text()).toBe(201)
  }
})

for (const pth of ["/hosts", "/jobs", "/jobs?job=job-audit-007-xxxxxxxxxxxxxxxxxxxx", "/os-images", "/ssh-keys", "/settings"]) {
  test(`overflow ${pth}`, async ({ page }) => {
    await login(page)
    const rows: Record<string, unknown> = {}
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 })
      await page.goto(pth)
      await page.evaluate(() => document.fonts.ready)
      await page.waitForLoadState("networkidle").catch(() => {})
      await page.waitForTimeout(300)
      const o = await overflow(page)
      const t = w >= 768 ? await topBar(page) : null
      rows[w] = { ...o, topBar: t }
      check(o.docScrollWidth <= w, `${pth}@${w}: docScrollWidth ${o.docScrollWidth}`)
      check(!o.header || o.header.scrollWidth <= o.header.clientWidth, `${pth}@${w}: header overflow ${JSON.stringify(o.header)}`)
      const own = pth.startsWith("/hosts") || pth.startsWith("/jobs")
      const scrollers = o.scrollers.filter((s) => !/log-lines/.test(s))
      if (own && o.docScrollWidth <= w) {
        // Tabel Hosts/Jobs memang bisa di-scroll horizontal di dalam kontainernya (M2/M5); dicatat saja.
        if (scrollers.length) notes.push(`${pth}@${w}: ${scrollers.join(" | ")}`)
      } else {
        check(o.offenders.length === 0, `${pth}@${w}: elemen di luar viewport ${o.offenders.join(" | ")}`)
        check(scrollers.length === 0, `${pth}@${w}: kontainer scroll horizontal ${scrollers.join(" | ")}`)
      }
      if (t) {
        check(t.badges.length === 3 && t.badges.every((b) => b.inView), `${pth}@${w}: status DHCP/TFTP/HTTP tidak terlihat ${JSON.stringify(t.badges)}`)
        check(t.titleRight <= t.searchLeft, `${pth}@${w}: judul menimpa pencarian`)
      }
      if ([375, 768, 1280, 1440].includes(w))
        await page.screenshot({ path: path.join(OUT, "shots", `${pth.replace(/[/?=&]/g, "_")}-${w}.png`), fullPage: true })
    }
    results[`overflow ${pth}`] = rows
  })
}

test("OS Images: alasan mono, token builtin tidak terbelah, DR-5-1 ≤ 200 px di 375", async ({ page }) => {
  await login(page)
  const rows: Record<string, unknown> = {}
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto("/os-images")
    await page.evaluate(() => document.fonts.ready)
    await page.locator('[data-image-id="ubuntu-22.04"] [data-testid="img-reason"]').waitFor()
    const m = await page.evaluate(() => {
      const lines = (node: Node, sub?: string) => {
        const text = node.textContent ?? ""
        const r = document.createRange()
        const tn = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
        let n: Node | null
        const tops = new Set<number>()
        while ((n = tn.nextNode())) {
          const t = n.textContent ?? ""
          const i = sub ? t.indexOf(sub) : 0
          if (sub && i < 0) continue
          r.setStart(n, i)
          r.setEnd(n, sub ? i + sub.length : t.length)
          for (const rc of r.getClientRects()) if (rc.width > 0) tops.add(Math.round(rc.top))
        }
        return { text: sub ?? text, lines: tops.size }
      }
      const reason = document.querySelector('[data-image-id="ubuntu-22.04"] [data-testid="img-reason"]')!
      const pathEl = reason.querySelector('[data-slot="path-text"]')!
      const token = reason.querySelector('[data-slot="data-token"]')!
      const segs = [...reason.querySelectorAll('[data-slot="path-segment"]')].map((s) => lines(s))
      const cell = document.querySelector('[data-image-id="ubuntu-22.04"] [data-testid="img-available"]')!.getBoundingClientRect()
      const heights = Object.fromEntries(
        [...document.querySelectorAll('[data-testid="os-image-row"]')].map((r) => [
          (r as HTMLElement).dataset.imageId,
          Math.round(r.getBoundingClientRect().height),
        ]),
      )
      const allReasonSegs = [...document.querySelectorAll('[data-testid="img-reason"] [data-slot="path-segment"], [data-testid="img-reason"] [data-slot="data-token"]')]
        .map((s) => ({ ...lines(s), w: Math.round(s.getBoundingClientRect().width), cw: Math.round(s.closest('[data-testid="img-available"]')!.getBoundingClientRect().width) }))
        .filter((x) => x.lines > 1)
      return {
        pathFont: getComputedStyle(pathEl).fontFamily,
        tokenFont: getComputedStyle(token).fontFamily,
        reasonFont: getComputedStyle(reason).fontFamily,
        reasonOverflowWrap: getComputedStyle(reason).overflowWrap,
        vmlinuz: lines(pathEl, "vmlinuz"),
        id: lines(token, "ubuntu-22.04"),
        segs,
        multiLineSegs: allReasonSegs,
        cellWidth: Math.round(cell.width),
        heights,
        layout: getComputedStyle(document.querySelector('[data-testid="os-images-table"]')!).display,
      }
    })
    rows[w] = m
    check(/JetBrains Mono/.test(m.pathFont) && /JetBrains Mono/.test(m.tokenFont), `os-images@${w}: path/id alasan bukan mono`)
    check(m.reasonOverflowWrap !== "anywhere", `os-images@${w}: span alasan masih wrap-anywhere`)
    if (w >= 1280) check(m.vmlinuz.lines === 1, `os-images@${w}: 'vmlinuz' terbelah (${m.vmlinuz.lines} baris)`)
    if (w >= 1280) check(m.id.lines === 1, `os-images@${w}: 'ubuntu-22.04' terbelah (${m.id.lines} baris)`)
    // DR-5-14 berlaku di tabel (≥ xl). Kartu (< xl) sengaja inline (BUG-M6-L2/DR-5-8): boleh pecah di "-".
    if (w >= 1280) check(m.segs.every((s) => s.lines === 1), `os-images@${w}: segmen path builtin terbelah ${JSON.stringify(m.segs)}`)
    check(m.layout === (w >= 1280 ? "table" : "block"), `os-images@${w}: mode ${m.layout}`)
    if (w === 375) {
      for (const id of ["ubuntu-24.04", "ubuntu-22.04", "debian-12", "rocky-9", "windows-server-2022"])
        if (m.heights[id] !== undefined) check(m.heights[id] <= 200, `DR-5-1@375: ${id} tinggi ${m.heights[id]} > 200`)
    }
  }
  results["os-images reasons"] = rows
})

test("SSH Keys: kartu < md, fingerprint utuh, aksi terlihat; tabel ≥ md", async ({ page }) => {
  await login(page)
  const rows: Record<string, unknown> = {}
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto("/ssh-keys")
    await page.evaluate(() => document.fonts.ready)
    await page.getByTestId("ssh-key-row").first().waitFor()
    const m = await page.evaluate(() => {
      const vw = window.innerWidth
      const container = document.querySelector('[data-testid="ssh-keys-table"]')!.parentElement!
      const keys = [...document.querySelectorAll('[data-testid="ssh-key-row"]')].map((row) => {
        const fp = row.querySelector('[data-testid="key-fingerprint"]') as HTMLElement
        const fr = fp.getBoundingClientRect()
        const btns = [...row.querySelectorAll("button")].map((b) => {
          const r = b.getBoundingClientRect()
          return { name: b.getAttribute("aria-label")?.slice(0, 12), inView: r.left >= 0 && r.right <= vw && r.width > 0 }
        })
        const name = row.querySelector('[data-testid="key-name"]') as HTMLElement
        return {
          fpFull: fp.scrollWidth <= fp.clientWidth + 1 && fr.right <= vw && fr.left >= 0,
          fpFont: getComputedStyle(fp).fontFamily,
          btns,
          nameTruncated: name.scrollWidth > name.clientWidth + 1,
          height: Math.round(row.getBoundingClientRect().height),
        }
      })
      return {
        containerScroll: container.scrollWidth,
        containerClient: container.clientWidth,
        layout: getComputedStyle(document.querySelector('[data-testid="ssh-keys-table"]')!).display,
        keys,
      }
    })
    rows[w] = m
    check(m.containerScroll <= m.containerClient, `ssh-keys@${w}: kontainer ${m.containerScroll}>${m.containerClient}`)
    check(m.layout === (w >= 1024 ? "table" : "block"), `ssh-keys@${w}: mode ${m.layout}`)
    for (const k of m.keys) {
      check(k.fpFull && /JetBrains Mono/.test(k.fpFont), `ssh-keys@${w}: fingerprint tidak utuh/mono`)
      check(k.btns.every((b) => b.inView), `ssh-keys@${w}: tombol aksi di luar viewport ${JSON.stringify(k.btns)}`)
      if (w < 1024) check(!k.nameTruncated, `ssh-keys@${w}: nama terpotong di kartu`)
    }
    if (w === 375 || w === 414) await page.screenshot({ path: path.join(OUT, "shots", `ssh-keys-card-${w}.png`), fullPage: true })
  }
  results["ssh-keys"] = rows
})

test("Sheet OS: alasan mono di kartu image, tanpa overflow", async ({ page }) => {
  await login(page)
  const rows: Record<string, unknown> = {}
  for (const w of [375, 768, 1280, 1440]) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.goto("/hosts")
    await page.getByRole("button", { name: /^Aksi untuk/ }).first().click()
    await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
    const sheet = page.getByRole("dialog")
    await sheet.locator('[data-available="false"]').first().waitFor()
    const m = await sheet.evaluate((el) => {
      const pathEl = el.querySelector('[data-available="false"] [data-slot="path-text"]')
      const content = el as HTMLElement
      return {
        pathFont: pathEl ? getComputedStyle(pathEl).fontFamily : null,
        sheetScroll: content.scrollWidth,
        sheetClient: content.clientWidth,
        docScrollWidth: document.documentElement.scrollWidth,
      }
    })
    rows[w] = m
    check(/JetBrains Mono/.test(m.pathFont ?? ""), `sheet@${w}: path alasan bukan mono`)
    check(m.sheetScroll <= m.sheetClient + 1, `sheet@${w}: overflow ${m.sheetScroll}>${m.sheetClient}`)
    await page.screenshot({ path: path.join(OUT, "shots", `sheet-os-${w}.png`) })
  }
  results["sheet-os"] = rows
})

test("Login: desain + overflow + satu-satunya oranye", async ({ browser }) => {
  const rows: Record<string, unknown> = {}
  for (const w of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, locale: "id-ID" })
    const page = await ctx.newPage()
    await page.goto("/login?next=/jobs")
    await page.evaluate(() => document.fonts.ready)
    await page.getByLabel("Username").waitFor()
    const m = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="login-card"]')!
      const cs = getComputedStyle(card)
      const user = document.getElementById("login-username")!
      const btn = document.querySelector('[data-testid="login-submit"]')!
      const h1 = document.querySelector("h1")!
      const orange = [...document.querySelectorAll("body *")].filter((el) => {
        const s = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        if (r.width === 0 || s.display === "none") return false
        return [s.backgroundColor, s.color, s.borderTopColor].some((c) => c === "rgb(245, 78, 0)")
      })
      return {
        docScrollWidth: document.documentElement.scrollWidth,
        card: { bg: cs.backgroundColor, border: `${cs.borderTopWidth} ${cs.borderTopColor}`, radius: cs.borderTopLeftRadius, shadow: cs.boxShadow, width: Math.round(card.getBoundingClientRect().width), padding: cs.paddingTop },
        h1: { size: getComputedStyle(h1).fontSize, weight: getComputedStyle(h1).fontWeight, ls: getComputedStyle(h1).letterSpacing },
        user: { h: Math.round(user.getBoundingClientRect().height), radius: getComputedStyle(user).borderTopLeftRadius, font: getComputedStyle(user).fontFamily },
        btn: { h: Math.round(btn.getBoundingClientRect().height), bg: getComputedStyle(btn).backgroundColor },
        orangeCount: orange.length,
        orangeIsButton: orange.every((o) => o === btn),
        sidebar: document.querySelector('[data-slot="sidebar"]') !== null,
        header: document.querySelector("header") !== null && document.querySelector("header")!.closest('[data-testid="login-card"]') === null,
      }
    })
    rows[w] = m
    check(m.docScrollWidth <= w, `login@${w}: overflow ${m.docScrollWidth}`)
    check(m.card.shadow === "none", `login@${w}: shadow ${m.card.shadow}`)
    check(m.card.border === "1px rgb(230, 229, 224)" && m.card.radius === "12px" && m.card.bg === "rgb(255, 255, 255)", `login@${w}: card ${JSON.stringify(m.card)}`)
    check(m.card.width <= 400, `login@${w}: card > 400`)
    check(m.h1.size === "26px" && m.h1.weight === "400", `login@${w}: judul ${JSON.stringify(m.h1)}`)
    check(m.user.h === 44 && m.user.radius === "8px" && /JetBrains Mono/.test(m.user.font), `login@${w}: username ${JSON.stringify(m.user)}`)
    check(m.btn.h === 40 && m.btn.bg === "rgb(245, 78, 0)", `login@${w}: tombol ${JSON.stringify(m.btn)}`)
    check(m.orangeCount === 1 && m.orangeIsButton, `login@${w}: elemen oranye ${m.orangeCount}`)
    check(!m.sidebar && !m.header, `login@${w}: sidebar/top bar tampil`)
    if (w === 375 || w === 1440) await page.screenshot({ path: path.join(OUT, "shots", `login-${w}.png`), fullPage: true })
    await ctx.close()
  }
  results["login"] = rows
})

test("Login: alur keyboard, error fokus, next, logout, Back tanpa data", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "id-ID" })
  const page = await ctx.newPage()
  await page.goto("/jobs?host=525400990011")
  await expect(page).toHaveURL(/\/login\?next=%2Fjobs%3Fhost%3D525400990011/)
  // Tab order: username (fokus awal) → password → toggle → Masuk.
  await expect(page.getByLabel("Username")).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(page.getByLabel("Password")).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(page.getByRole("button", { name: "Tampilkan kata sandi" })).toBeFocused()
  await page.keyboard.press("Tab")
  await expect(page.getByTestId("login-submit")).toBeFocused()
  const focusRing = await page.getByTestId("login-submit").evaluate((e) => getComputedStyle(e).boxShadow + " | " + getComputedStyle(e).outlineStyle)
  await page.getByLabel("Username").fill("admin-audit")
  await page.getByLabel("Password").fill("password-salah-12")
  await page.getByLabel("Password").press("Enter")
  const alert = page.getByRole("alert").filter({ hasText: "Gagal masuk" })
  await expect(alert).toContainText("Username atau password salah")
  await expect(alert).toBeFocused()
  await page.getByLabel("Password").fill(process.env.AUDIT_ADMIN_PASSWORD!)
  await page.getByLabel("Password").press("Enter")
  await expect(page).toHaveURL(/\/jobs\?host=525400990011$/)
  await expect(page.getByTestId("sidebar-username")).toHaveText(/admin-audit/)
  const userFont = await page.getByTestId("sidebar-username").evaluate((e) => getComputedStyle(e).fontFamily)
  // Navigasi klien ke halaman lain dulu agar ada entri riwayat dashboard sebelum logout.
  await page.getByRole("link", { name: "Hosts" }).click()
  await expect(page).toHaveURL(/\/hosts$/)
  await page.getByRole("table").first().waitFor()
  await page.getByTestId("logout").click()
  await expect(page).toHaveURL(/\/login$/)
  await page.goBack()
  await expect(page).toHaveURL(/\/login\?next=/)
  await page.getByLabel("Username").waitFor()
  const leaked = await page.locator('[data-testid="jobs-page"]').count()
  results["login-flow"] = { focusRing, userFont, leakedAfterBack: leaked, finalUrl: page.url() }
  check(leaked === 0, "Back setelah logout menampilkan halaman jobs")
  await ctx.close()
})

test("Sesi dihapus saat di /hosts → redirect sekali ke /login?next=/hosts tanpa polling setelahnya", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "id-ID" })
  const page = await ctx.newPage()
  await login(page)
  await page.goto("/hosts")
  await page.getByRole("table").first().waitFor()
  const api: string[] = []
  const navs: string[] = []
  const docs: string[] = []
  page.on("request", (r) => {
    if (r.url().includes("/api/")) api.push(`${Date.now()} ${new URL(r.url()).pathname}`)
    if (r.resourceType() === "document") docs.push(r.url())
  })
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) navs.push(f.url())
  })
  // Simulasi sesi habis: logout dari luar halaman (cookie sama) → API berikutnya 401.
  const r = await ctx.request.post("/api/auth/logout")
  expect(r.status()).toBe(204)
  await page.waitForURL(/\/login\?next=%2Fhosts/, { timeout: 30_000 })
  const at = Date.now()
  await page.waitForTimeout(12_000)
  const after = api.filter((l) => Number(l.split(" ")[0]) > at)
  results["session-expiry"] = { navs, documentRequests: docs, apiAfterRedirect: after, toasts: await page.locator("[data-sonner-toast]").count() }
  check(docs.filter((u) => u.includes("/login")).length === 1, `sesi habis: dokumen /login dimuat ${docs.length}×`)
  check(after.length === 0, `sesi habis: request API setelah redirect ${after.join(",")}`)
  await ctx.close()
})

test.afterAll(() => {
  writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ widths: WIDTHS, failures: fail, notes, results }, null, 2))
})

test("ringkasan: tidak ada pelanggaran", () => {
  expect(fail, fail.join("\n")).toEqual([])
})
