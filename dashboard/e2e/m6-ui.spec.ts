// M6-T12 — carry-over UI & aksesibilitas (server `m6-ui`: subnet KVM, PXE_SERVER_IP=10.99.0.2, media
// palsu, 60 job sintetis dari e2e/support/m6-seed.ts; sesi dari storageState).
// AC-6.1 (e2e), AC-6.19 (e2e), AC-6.20, AC-6.34, AC-6.35, AC-6.36, AC-6.37, AC-6.38.
import { generateKeyPairSync } from "node:crypto"
import path from "node:path"

import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

import { SHOTS, waitForAnimations } from "./helpers"
import { apiInstall, hostId, leaseWriter, makeHost } from "./m5-support"
import { auditA11y, classifyContrastFinding, writeAxeEvidence } from "./support/axe"
import { E2E_ADMIN_USERNAME } from "./support/e2e-auth"
import { M6_FAILED_JOB, M6_JOB_COUNT } from "./support/m6-seed"

import { BUILTIN_SOURCES } from "../src/lib/server/db/seed"

// Urutan file tetap (workers: 1, fullyParallel: false); test seed pertama. Tanpa mode serial agar
// satu kegagalan tidak membuat test lain tidak berjalan.

const JSON_HEADERS = { "content-type": "application/json" }
const MONO = /JetBrains Mono/

function sshKey(comment: string): string {
  const { publicKey } = generateKeyPairSync("ed25519")
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32)
  const str = (b: Buffer) => Buffer.concat([Buffer.from([0, 0, 0, b.length]), b])
  const blob = Buffer.concat([str(Buffer.from("ssh-ed25519")), str(raw)])
  return `ssh-ed25519 ${blob.toString("base64")} ${comment}`
}

/** Fixture stres M5 (plan §2.8): ID 48 ber-hyphen / tanpa titik pecah, nama underscore 40, nama 64 tanpa spasi, segmen path 110. */
const STRESS_IMAGES = [
  { id: "rocky9customlabimagebuildnumber00000000000000001", name: "Rocky Custom Build", version: "9.4", seg: "rocky9-custom-lab" },
  { id: "ubuntu-24-custom-hwe-lab-rack07-node-image-0001x", name: "Ubuntu_Server_24_04_Custom_HWE_Lab_Rack07", version: "24.04", seg: "ubuntu-hyphen-media" },
  { id: "ubuntu-name-nospace-64", name: "UbuntuServerCustomHweLabRack07NodeImageEdisiPanjangTanpaSpasiXYZW".slice(0, 64), version: "24.04", seg: "ubuntu-nospace-media" },
  { id: "ubuntu-path-nobreak-110", name: "Ubuntu Path Panjang", version: "24.04", seg: `ubuntu2404customhwelabrack07nodeimagemediaroot${"x".repeat(64)}` },
]
const LONG_KEY_NAME = "k".repeat(64)
const STRESS_KEYS: [string, string][] = [
  [LONG_KEY_NAME, `budi@${"workstation-lab-rack07-".repeat(4)}`],
  ["Kunci_Operator_Lab_Rack07_Dengan_Nama_Panjang_Tanpa_Spasi_0001", "x".repeat(90)],
  ["Kunci Budi – lab", "budi@laptop"],
]
const BUILTIN_IDS = Object.keys(BUILTIN_SOURCES)

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForLoadState("networkidle").catch(() => {})
}

test("seed data stres lewat API (image ID 48 / nama 40–64 / path 110; key nama 64 + komentar panjang)", async ({ request }) => {
  for (const x of STRESS_IMAGES) {
    const r = await request.post("/api/os-images", {
      headers: JSON_HEADERS,
      data: {
        id: x.id,
        name: x.name,
        version: x.version,
        arch: "amd64",
        method: "autoinstall",
        bootable: true,
        source: { kernel: `${x.seg}/casper/hwe-vmlinuz-6.8.0-generic-panjang`, initrd: `${x.seg}/casper/hwe-initrd-6.8.0-generic-panjang`, repo: x.seg },
      },
    })
    expect(r.status(), await r.text()).toBe(201)
  }
  for (const [name, comment] of STRESS_KEYS) {
    const r = await request.post("/api/ssh-keys", { headers: JSON_HEADERS, data: { name, publicKey: sshKey(comment) } })
    expect(r.status(), await r.text()).toBe(201)
  }
})

test("AC-6.1 Settings: blok Akses read-only, username admin mono, tanpa hash", async ({ page }) => {
  await page.goto("/settings")
  const section = page.locator('[data-slot="settings-section"]').filter({ has: page.getByText("Akses", { exact: true }) })
  await expect(section).toHaveCount(1)
  await expect(section).toBeVisible()
  const user = section.locator('dd[data-label="Admin"]').getByText(E2E_ADMIN_USERNAME, { exact: true })
  await expect(user).toBeVisible()
  expect(await user.evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(MONO)
  await expect(section.getByText("Sesi idle")).toBeVisible()
  await expect(section.getByText("Batas login gagal")).toBeVisible()
  // Read-only: tanpa input/tombol edit di blok Akses; tanpa hash di halaman maupun respons API.
  await expect(section.locator("input, textarea, select")).toHaveCount(0)
  expect(await page.content()).not.toMatch(/scrypt\$/)
  const api = await page.request.get("/api/settings")
  expect(await api.text()).not.toMatch(/scrypt|PXE_ADMIN_PASSWORD_HASH/)
  await page.screenshot({ path: SHOTS(6, "settings-akses"), fullPage: true })
})

test.describe("AC-6.34 DR-5-10 SSH Keys", () => {
  test("375: kartu tanpa scroll horizontal, fingerprint utuh mono, aksi rename/hapus terlihat & dapat diklik", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 })
    await page.goto("/ssh-keys")
    await settle(page)
    const rows = page.getByTestId("ssh-key-row")
    await expect(rows).toHaveCount(STRESS_KEYS.length)
    const m = await page.evaluate(() => {
      const vw = window.innerWidth
      const table = document.querySelector('[data-testid="ssh-keys-table"]')!
      const container = table.parentElement!
      return {
        layout: getComputedStyle(table).display,
        doc: document.documentElement.scrollWidth,
        vw,
        cScroll: container.scrollWidth,
        cClient: container.clientWidth,
        keys: [...document.querySelectorAll('[data-testid="ssh-key-row"]')].map((row) => {
          const fp = row.querySelector('[data-testid="key-fingerprint"]') as HTMLElement
          const fr = fp.getBoundingClientRect()
          const name = row.querySelector('[data-testid="key-name"]') as HTMLElement
          const nr = name.getBoundingClientRect()
          return {
            fpText: fp.textContent,
            fpFull: fp.scrollWidth <= fp.clientWidth + 1 && fr.left >= 0 && fr.right <= vw,
            fpFont: getComputedStyle(fp).fontFamily,
            nameFull: name.scrollWidth <= name.clientWidth + 1 && nr.right <= vw,
            buttons: [...row.querySelectorAll("button")].map((b) => {
              const r = b.getBoundingClientRect()
              return { label: b.getAttribute("aria-label"), inView: r.left >= 0 && r.right <= vw && r.width > 0 && r.height > 0 }
            }),
          }
        }),
      }
    })
    expect(m.layout).toBe("block")
    expect(m.doc).toBe(m.vw)
    expect(m.cScroll).toBe(m.cClient)
    const api = (await (await page.request.get("/api/ssh-keys")).json()) as { name: string; fingerprint: string }[]
    for (const k of m.keys) {
      expect(api.map((a) => a.fingerprint)).toContain(k.fpText)
      expect(k.fpFull).toBe(true)
      expect(k.fpFont).toMatch(MONO)
      expect(k.nameFull).toBe(true)
      expect(k.buttons.map((b) => b.label)).toEqual(expect.arrayContaining([expect.stringMatching(/^Ubah nama /), expect.stringMatching(/^Hapus /)]))
      expect(k.buttons.every((b) => b.inView)).toBe(true)
    }
    // Dapat diklik tanpa scroll horizontal: rename membuka form, hapus membuka dialog konfirmasi.
    const longId = await rows.filter({ hasText: LONG_KEY_NAME }).getAttribute("data-key-id")
    const longRow = page.locator(`[data-testid="ssh-key-row"][data-key-id="${longId}"]`)
    await longRow.getByRole("button", { name: `Ubah nama ${LONG_KEY_NAME}` }).click()
    await expect(longRow.getByTestId("key-rename-form")).toBeVisible()
    await longRow.getByTestId("key-rename-form").locator("input").press("Escape")
    await page.getByRole("button", { name: `Hapus ${LONG_KEY_NAME}` }).click()
    await expect(page.getByRole("alertdialog")).toBeVisible()
    await page.getByRole("alertdialog").getByRole("button", { name: "Batal" }).click()
    await expect(page.getByRole("alertdialog")).toHaveCount(0)
    expect(await page.evaluate(() => window.scrollX)).toBe(0)
    await page.screenshot({ path: SHOTS(6, "ssh-keys-375"), fullPage: true })
  })

  test("1440: tetap tabel", async ({ page }) => {
    await page.goto("/ssh-keys")
    await settle(page)
    await expect(page.getByTestId("ssh-key-row")).toHaveCount(STRESS_KEYS.length)
    expect(await page.getByTestId("ssh-keys-table").evaluate((e) => getComputedStyle(e).display)).toBe("table")
    await expect(page.getByTestId("ssh-keys-table").locator("thead")).toBeVisible()
  })
})

/** Jumlah baris visual teks `sub` di dalam `el` (rect Range per token). */
const RANGE_LINES = `(el, sub) => {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let n, full = ""
  const nodes = []
  while ((n = walker.nextNode())) { nodes.push([n, full.length]); full += n.textContent }
  const i = sub === null ? 0 : full.indexOf(sub)
  if (i < 0) return -1
  const j = sub === null ? full.length : i + sub.length
  const tops = new Set()
  for (const [node, off] of nodes) {
    const s = Math.max(i, off), e = Math.min(j, off + node.textContent.length)
    if (s >= e) continue
    const r = document.createRange()
    r.setStart(node, s - off); r.setEnd(node, e - off)
    for (const rc of r.getClientRects()) if (rc.width > 0) tops.add(Math.round(rc.top))
  }
  return tops.size
}`

async function lines(page: Page, selector: string, sub: string | null): Promise<number> {
  return page.evaluate(
    ([selector, sub, fn]) => {
      const el = document.querySelector(selector as string)
      if (!el) return -2
      return (eval(fn as string) as (el: Element, sub: string | null) => number)(el, sub as string | null)
    },
    [selector, sub, RANGE_LINES],
  )
}

test.describe("AC-6.35 DR-5-11 + DR-5-14 alasan tidak tersedia", () => {
  test("tabel OS Images 1280 (data stres): path & id mono; `vmlinuz` dan `ubuntu-22.04` satu baris; path pecah hanya setelah /", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto("/os-images")
    await settle(page)
    const reasonSel = '[data-image-id="ubuntu-22.04"] [data-testid="img-reason"]'
    await expect(page.locator(reasonSel)).toBeVisible()
    for (const x of STRESS_IMAGES) await expect(page.locator(`[data-image-id="${x.id}"]`)).toBeVisible()
    const fonts = await page.locator(reasonSel).evaluate((r) => ({
      path: getComputedStyle(r.querySelector('[data-slot="path-text"]')!).fontFamily,
      id: getComputedStyle(r.querySelector('[data-slot="data-token"]')!).fontFamily,
      wrap: getComputedStyle(r).overflowWrap,
    }))
    expect(fonts.path).toMatch(MONO)
    expect(fonts.id).toMatch(MONO)
    expect(fonts.wrap).not.toBe("anywhere")
    expect(await lines(page, `${reasonSel} [data-slot="path-text"]`, "vmlinuz")).toBe(1)
    expect(await lines(page, `${reasonSel} [data-slot="data-token"]`, "ubuntu-22.04")).toBe(1)
    // Setiap segmen path (dipenggal per "/") yang muat di kolom berada dalam satu baris — termasuk image stres.
    const segs = await page.evaluate((fn) => {
      const f = eval(fn) as (el: Element, sub: string | null) => number
      return [...document.querySelectorAll('[data-testid="img-reason"] [data-slot="path-segment"]')].map((s) => {
        const cell = s.closest('[data-testid="img-available"]')!.getBoundingClientRect().width
        // Lebar alami segmen (jumlah lebar rect baris teksnya): segmen yang muat di kolom wajib 1 baris.
        const r = document.createRange()
        r.selectNodeContents(s)
        const natural = [...r.getClientRects()].reduce((a, rc) => a + rc.width, 0)
        return { text: s.textContent, lines: f(s, null), fits: natural <= cell, natural: Math.round(natural), cell: Math.round(cell) }
      })
    }, RANGE_LINES)
    expect(segs.length).toBeGreaterThan(0)
    const fitting = segs.filter((s) => s.fits)
    expect(fitting.length).toBeGreaterThan(0)
    for (const s of fitting) expect(s.lines, JSON.stringify(s)).toBe(1)
    // Teks alasan identik dengan alasan server.
    const imgs = (await (await page.request.get("/api/os-images")).json()) as { id: string; reason: string | null }[]
    const u22 = imgs.find((i) => i.id === "ubuntu-22.04")!
    await expect(page.locator(reasonSel)).toHaveText(u22.reason!)
    await page.screenshot({ path: SHOTS(6, "os-images-1280-reasons"), fullPage: true })
  })

  test("kartu OS di Sheet: path alasan mono, tanpa overflow", async ({ page }) => {
    await page.goto("/hosts")
    await page.getByRole("button", { name: /^Aksi untuk/ }).first().click()
    await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
    const sheet = page.getByRole("dialog")
    const card = sheet.locator('[data-available="false"]').first()
    await expect(card).toBeVisible()
    const m = await sheet.evaluate((el) => ({
      font: getComputedStyle(el.querySelector('[data-available="false"] [data-slot="path-text"]')!).fontFamily,
      scroll: (el as HTMLElement).scrollWidth,
      client: (el as HTMLElement).clientWidth,
    }))
    expect(m.font).toMatch(MONO)
    expect(m.scroll).toBeLessThanOrEqual(m.client + 1)
  })
})

const I59_WIDTHS = [768, 800, 818, 1024, 1279, 1280, 1440]
const I59_PAGES = ["/hosts", "/jobs", "/os-images", "/ssh-keys", "/settings"]

test.describe("AC-6.36 I-5-9 tanpa overflow horizontal 768–1440; status DHCP/TFTP/HTTP terlihat", () => {
  for (const p of I59_PAGES) {
    test(`${p}`, async ({ page }) => {
      const bad: string[] = []
      for (const w of I59_WIDTHS) {
        await page.setViewportSize({ width: w, height: 900 })
        await page.goto(p)
        await settle(page)
        await expect(page.locator("header [data-service]")).toHaveCount(3)
        const m = await page.evaluate(() => {
          const vw = window.innerWidth
          return {
            doc: document.documentElement.scrollWidth,
            vw,
            badges: [...document.querySelectorAll("header [data-service]")].map((b) => {
              const r = b.getBoundingClientRect()
              const cs = getComputedStyle(b)
              return { s: (b as HTMLElement).dataset.service, ok: r.width > 0 && r.left >= 0 && r.right <= vw && cs.visibility !== "hidden" }
            }),
          }
        })
        if (m.doc !== m.vw) bad.push(`${w}: scrollWidth ${m.doc} ≠ ${m.vw}`)
        if (m.badges.map((b) => b.s).sort().join() !== "DHCP,HTTP,TFTP" || !m.badges.every((b) => b.ok)) bad.push(`${w}: status ${JSON.stringify(m.badges)}`)
      }
      expect(bad).toEqual([])
    })
  }

  test("/login", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, locale: "id-ID", storageState: { cookies: [], origins: [] } })
    const page = await ctx.newPage()
    for (const w of I59_WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 })
      await page.goto("/login")
      await settle(page)
      await expect(page.getByLabel("Username")).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${w}`).toBe(w)
    }
    await ctx.close()
  })
})

test.describe("AC-6.37 OS Images 768–1279 kartu, ≥ 1280 tabel; DR-5-1", () => {
  for (const w of [768, 1024, 1279, 1280]) {
    test(`${w}: mode ${w >= 1280 ? "tabel" : "kartu"}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 900 })
      await page.goto("/os-images")
      await settle(page)
      const table = page.getByTestId("os-images-table")
      await expect(page.getByTestId("os-image-row").first()).toBeVisible()
      const m = await table.evaluate((t) => ({
        display: getComputedStyle(t).display,
        headerHidden: getComputedStyle(t.querySelector("thead")!).display === "none",
        rowDisplay: getComputedStyle(t.querySelector('[data-testid="os-image-row"]')!).display,
      }))
      if (w >= 1280) {
        expect(m).toEqual({ display: "table", headerHidden: false, rowDisplay: "table-row" })
      } else {
        expect(m.display).toBe("block")
        expect(m.headerHidden).toBe(true)
        expect(m.rowDisplay).not.toBe("table-row")
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(w)
      if (w === 768) await page.screenshot({ path: SHOTS(6, "os-images-768"), fullPage: true })
    })
  }

  test("DR-5-1: 375 kartu image bawaan ≤ 200 px (setelah document.fonts.ready; batas tidak berubah)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 900 })
    await page.goto("/os-images")
    await expect(page.getByTestId("os-image-row").first()).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const heights = await page.evaluate((ids) => {
      const out: Record<string, number> = {}
      for (const id of ids) {
        const r = document.querySelector(`[data-testid="os-image-row"][data-image-id="${id}"]`)
        if (r) out[id] = r.getBoundingClientRect().height
      }
      return out
    }, BUILTIN_IDS)
    expect(Object.keys(heights).sort()).toEqual([...BUILTIN_IDS].sort())
    for (const [id, h] of Object.entries(heights)) expect(h, id).toBeLessThanOrEqual(200)
    await page.screenshot({ path: SHOTS(6, "os-images-375"), fullPage: true })
  })
})

/** Host baru (lease + /boot) + install → job aktif di server m6-ui. */
async function activeJob(request: APIRequestContext, mac: string, ip: string) {
  const lease = leaseWriter(path.join(process.env.PXE_E2E_ROOT!, "leases", "m6-ui.leases"))
  const id = await makeHost(request, lease, { mac, leaseIp: ip })
  await apiInstall(request, id)
  const jobs = (await (await request.get(`/api/jobs?hostId=${id}`)).json()) as { jobs: { id: string; status: string }[] }
  expect(jobs.jobs[0].status).toBe("booting")
  return { hostId: id, jobId: jobs.jobs[0].id }
}

test.describe("AC-6.19 CR-5-4 daftar Jobs > 50 selama polling", () => {
  test("> 50 job, ≥ 3 siklus polling, job baru di antara fetch: tanpa Alert error, tanpa duplikat/hilang", async ({ page, request }) => {
    const heads: string[] = []
    page.on("request", (r) => {
      const u = new URL(r.url())
      if (u.pathname === "/api/jobs") heads.push(u.search)
    })
    await page.goto("/jobs")
    const rows = page.getByTestId("job-row")
    await expect(rows).toHaveCount(50)
    await page.getByTestId("jobs-load-more").click()
    await expect(rows).toHaveCount(M6_JOB_COUNT)
    const before = heads.length
    // Job baru dibuat di antara dua fetch polling.
    const { jobId } = await activeJob(request, "52:54:00:66:00:19", "10.99.0.119")
    await page.waitForTimeout(16_000) // ≥ 3 siklus polling 5 dtk
    expect(heads.length - before).toBeGreaterThanOrEqual(3)
    // Polling hanya meminta halaman pertama (tanpa `before`).
    expect(heads.slice(before).every((q) => !q.includes("before="))).toBe(true)
    await expect(rows).toHaveCount(M6_JOB_COUNT + 1)
    const ids = await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-job-id")))
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain(jobId)
    for (let i = 0; i < M6_JOB_COUNT; i++) expect(ids).toContain(`job-m6ui-${String(i).padStart(3, "0")}`)
    await expect(page.getByText("Gagal memuat job")).toHaveCount(0)
    await expect(page.locator('[data-slot="alert"][data-variant="destructive"], [role="alert"]').filter({ hasText: /Gagal|error/i })).toHaveCount(0)
  })
})

test.describe("AC-6.20 CR-5-5 log job tidak ada / terhapus", () => {
  test("job tidak ada → 'Job tidak ditemukan'; tanpa request ke job itu 15 dtk berikutnya", async ({ page }) => {
    const id = "job-tidak-ada-m6"
    const reqs: number[] = []
    page.on("request", (r) => {
      if (new URL(r.url()).pathname.startsWith(`/api/jobs/${id}`)) reqs.push(Date.now())
    })
    await page.goto(`/jobs?job=${id}`)
    const err = page.getByTestId("job-detail-error")
    await expect(err).toBeVisible()
    await expect(err.locator('[data-slot="alert-title"]')).toHaveText("Job tidak ditemukan")
    const at = Date.now()
    await page.waitForTimeout(15_000)
    expect(reqs.filter((t) => t > at)).toEqual([])
  })

  test("job terhapus saat log terbuka → status final 'Job tidak ditemukan'; tanpa polling log 15 dtk berikutnya", async ({ page, request }) => {
    const { hostId: hid, jobId } = await activeJob(request, "52:54:00:66:00:20", "10.99.0.120")
    const reqs: { t: number; p: string }[] = []
    page.on("request", (r) => {
      const p = new URL(r.url()).pathname
      if (p.startsWith(`/api/jobs/${jobId}`)) reqs.push({ t: Date.now(), p })
    })
    await page.goto(`/jobs?job=${jobId}`)
    const conn = page.getByTestId("log-connection")
    await expect(conn).toHaveAttribute("data-state", "live")
    const del = await request.delete(`/api/hosts/${hid}`)
    expect(del.status()).toBe(204)
    await expect(conn).toHaveAttribute("data-state", "not-found", { timeout: 15_000 })
    await expect(conn).toHaveText(/Job tidak ditemukan/)
    expect(await conn.evaluate((e) => getComputedStyle(e).color)).not.toBe("rgb(128, 125, 114)")
    const at = Date.now()
    await page.waitForTimeout(15_000)
    expect(reqs.filter((r) => r.t > at && r.p.endsWith("/logs"))).toEqual([])
    await page.screenshot({ path: SHOTS(6, "job-log-not-found"), fullPage: true })
    expect(hostId("52:54:00:66:00:20")).toBe(hid)
  })
})

test.describe("AC-6.38 aksesibilitas (axe, filter kontras DEC-019 §3)", () => {
  test.afterAll(() => writeAxeEvidence())

  test("filter `classifyContrastFinding`: kontrol positif & negatif (halaman sintetis)", async ({ page }) => {
    await page.setContent(`<!doctype html><html lang="id"><head><title>uji filter</title></head><body style="margin:0;background:#f7f7f4;font:14px sans-serif">
      <main>
      <p id="muted-white" style="background:#fff;color:#807d72">muted/white</p>
      <p id="muted-canvas" style="color:#807d72">muted/canvas</p>
      <p id="muted-canvas-soft" style="background:#fafaf7;color:#807d72">muted/canvas-soft (bukan pengecualian)</p>
      <p id="white-done" style="background:#c08532;color:#fff">Done</p>
      <p id="white-primary" style="background:#f54e00;color:#fff">Masuk</p>
      <p id="low-outside" style="background:#fff;color:#bbbbbb">kontras rendah di luar Sheet</p>
      <p id="good-outside" style="background:#fff;color:#26251e">kontras baik di luar Sheet</p>
      <div data-slot="sheet-content" style="background:#fff">
        <p id="good-in-sheet" style="color:#26251e">kontras baik di Sheet</p>
        <p id="low-in-sheet" style="color:#bbbbbb">kontras rendah di Sheet</p>
        <div style="opacity:.5"><p id="opacity-in-sheet" style="color:#26251e">opacity leluhur</p></div>
        <p id="large-in-sheet" style="color:#8a8a8a;font-size:24px">teks besar 3,4:1</p>
        <p id="oklab-in-sheet" style="color:oklab(0.2631 -0.0023 0.0125)">oklab ≈ #26251e</p>
        <p id="oklab-alpha-in-sheet" style="color:oklab(0.2631 -0.0023 0.0125 / 0.3)">oklab 30% (kontras rendah)</p>
      </div>
      </main></body></html>`)
    const cat = async (id: string) => (await classifyContrastFinding(page, `#${id}`)).category
    expect(await cat("muted-white")).toBe("exception:muted/white")
    expect(await cat("muted-canvas")).toBe("exception:muted/canvas")
    expect(await cat("muted-canvas-soft")).toBe("kept")
    expect(await cat("white-done")).toBe("exception:white/stage-done")
    expect(await cat("white-primary")).toBe("exception:on-primary/primary")
    expect(await cat("low-outside")).toBe("kept")
    // Kontras baik di luar Sheet tidak boleh "difilter" (axe tidak melaporkannya; filter tidak memberi jalan).
    expect(await cat("good-outside")).toBe("kept")
    expect(await cat("good-in-sheet")).toBe("verified-pass")
    expect(await cat("low-in-sheet")).toBe("kept")
    expect(await cat("opacity-in-sheet")).toBe("kept")
    expect(await cat("large-in-sheet")).toBe("verified-pass")
    expect(await cat("oklab-in-sheet")).toBe("verified-pass")
    const okl = await classifyContrastFinding(page, "#oklab-in-sheet")
    expect(okl.fg).toMatch(/^#2[56]2[45]1[de]$/) // ≈ #26251e (pembulatan konversi)
    expect(await cat("oklab-alpha-in-sheet")).toBe("kept")
    // Ujung ke ujung: axe sungguhan + filter → yang kontras rendah tetap jadi pelanggaran.
    const a = await auditA11y(page, "self-test sintetis")
    const contrast = a.violations.find((v) => v.id === "color-contrast")
    // #opacity-in-sheet: axe benar melaporkannya (opacity menurunkan kontras) dan filter TIDAK membuangnya.
    expect(contrast?.targets.sort()).toEqual(["#low-in-sheet", "#low-outside", "#muted-canvas-soft", "#oklab-alpha-in-sheet", "#opacity-in-sheet"].sort())
    expect(a.filtered.map((f) => f.target).sort()).toEqual(["#muted-canvas", "#muted-white", "#white-done", "#white-primary"].sort())
    expect(Object.fromEntries(a.filtered.map((f) => [f.target, f.category]))).toEqual({
      "#muted-canvas": "exception:muted/canvas",
      "#muted-white": "exception:muted/white",
      "#white-done": "exception:white/stage-done",
      "#white-primary": "exception:on-primary/primary",
    })
  })

  /**
   * Audit lalu kumpulkan pelanggaran per label; `expectNoViolations()` di akhir setiap test mengasersi
   * semuanya, sehingga semua lebar/state tetap diaudit dan tercatat di bukti walau yang pertama gagal.
   */
  let found: Record<string, unknown> = {}
  async function expectClean(page: Page, label: string, include?: string) {
    const a = await auditA11y(page, label, { include })
    if (a.violations.length) found[label] = a.violations
  }
  function expectNoViolations() {
    const f = found
    found = {}
    expect(f, JSON.stringify(f, null, 1)).toEqual({})
  }

  test("/login (tanpa sesi) 1440 & 375", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, locale: "id-ID", storageState: { cookies: [], origins: [] } })
    const page = await ctx.newPage()
    for (const w of [1440, 375]) {
      await page.setViewportSize({ width: w, height: 900 })
      await page.goto("/login")
      await settle(page)
      await expectClean(page, `/login@${w}`)
    }
    // Error state juga diaudit.
    await page.getByLabel("Username").fill("bukan-admin")
    await page.getByLabel("Password").fill("password-salah-axe")
    await page.getByTestId("login-submit").click()
    await expect(page.getByTestId("login-error")).toBeVisible()
    await expectClean(page, "/login error@375")
    await ctx.close()
    expectNoViolations()
  })

  for (const p of ["/hosts", "/os-images", "/ssh-keys", "/settings"]) {
    test(`${p} 1440 & 375`, async ({ page }) => {
      for (const w of [1440, 375]) {
        await page.setViewportSize({ width: w, height: 900 })
        await page.goto(p)
        await settle(page)
        await expectClean(page, `${p}@${w}`)
      }
      expectNoViolations()
    })
  }

  test("/hosts dengan Sheet terbuka (1440 & 375)", async ({ page }) => {
    for (const w of [1440, 375]) {
      await page.setViewportSize({ width: w, height: 900 })
      await page.goto("/hosts")
      await settle(page)
      await page.getByRole("button", { name: /^Aksi untuk/ }).first().click()
      await page.getByRole("menuitem", { name: "Edit konfigurasi" }).click()
      await expect(page.getByRole("dialog").locator('[data-available="false"]').first()).toBeVisible()
      await waitForAnimations(page)
      // Konteks = Sheet (modal); halaman /hosts sendiri diaudit utuh di test "/hosts 1440 & 375".
      expect(await page.locator('[data-slot="sheet-content"]').count()).toBe(1)
      await expectClean(page, `/hosts sheet@${w}`, '[data-slot="sheet-content"]')
      await page.keyboard.press("Escape")
      await expect(page.getByRole("dialog")).toHaveCount(0)
    }
    expectNoViolations()
  })

  test("/jobs detail job failed (1440 & 375)", async ({ page }) => {
    for (const w of [1440, 375]) {
      await page.setViewportSize({ width: w, height: 900 })
      await page.goto(`/jobs?job=${M6_FAILED_JOB}`)
      await expect(page.getByTestId("job-detail")).toBeVisible()
      await settle(page)
      await expectClean(page, `/jobs detail@${w}`)
    }
    expectNoViolations()
  })

  test("navigasi keyboard login: Tab → username → password → toggle → Masuk, fokus terlihat", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL, locale: "id-ID", storageState: { cookies: [], origins: [] } })
    const page = await ctx.newPage()
    await page.goto("/login")
    const user = page.getByLabel("Username")
    await expect(user).toBeFocused()
    // Mulai dari awal dokumen: klik kanvas kosong di pojok kiri atas (titik awal navigasi fokus sebelum
    // card), lalu Tab pertama mendarat di username.
    await page.mouse.click(2, 2)
    await expect(user).not.toBeFocused()
    await page.keyboard.press("Tab")
    await expect(user).toBeFocused()
    const order = [page.getByLabel("Password"), page.getByRole("button", { name: "Tampilkan kata sandi" }), page.getByTestId("login-submit")]
    for (const el of order) {
      await page.keyboard.press("Tab")
      await expect(el).toBeFocused()
      // Fokus terlihat: ring (box-shadow) atau outline saat :focus-visible.
      const vis = await el.evaluate((e) => {
        const cs = getComputedStyle(e)
        return e.matches(":focus-visible") && (cs.boxShadow !== "none" || (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0))
      })
      expect(vis).toBe(true)
    }
    await ctx.close()
  })
})
