// M1 E2E: AC-1.8 (layout), AC-1.9 (navigasi), AC-1.10 (pencarian global), AC-1.11 (status server).
import { expect, test } from "@playwright/test"

import { gotoHosts, hostRows, SHOTS } from "./helpers"

// Elemen konten. Iter2 (CR-1-2): SidebarInset adalah satu-satunya `<main>`; konten halaman kini
// `<div data-slot="page-content">` di dalamnya (sebelumnya `main > main` bersarang). Selector ikut
// struktur DOM baru; asersi padding/isi tidak berubah.
const CONTENT = "main[data-slot=sidebar-inset] > [data-slot=page-content]"

const NAV = [
  ["Hosts", "/hosts"],
  ["OS Images", "/os-images"],
  ["SSH Keys", "/ssh-keys"],
  ["Provisioning Jobs", "/jobs"],
  ["Settings", "/settings"],
] as const

test.describe("AC-1.8 layout", () => {
  test("sidebar 5 link, item aktif, border hairline, top bar 64px, padding main 32px", async ({ page }) => {
    await gotoHosts(page)
    const nav = page.getByRole("navigation", { name: "Navigasi utama" })
    const links = nav.getByRole("link")
    await expect(links).toHaveText(NAV.map(([l]) => l))
    for (const [label, href] of NAV) {
      const link = nav.getByRole("link", { name: label })
      await expect(link).toHaveAttribute("href", href)
      await expect(link).toHaveAttribute("data-active", label === "Hosts" ? "true" : "false")
    }
    await expect(nav.getByRole("link", { name: "Hosts" })).toHaveAttribute("aria-current", "page")

    const container = page.locator('[data-slot="sidebar-container"]')
    await expect(container).toHaveCSS("border-right-width", "1px")
    await expect(container).toHaveCSS("border-right-color", "rgb(230, 229, 224)")
    await expect(container).toHaveCSS("border-right-style", "solid")
    // Sidebar krem (canvas).
    await expect(page.locator('[data-slot="sidebar-inner"]')).toHaveCSS("background-color", "rgb(247, 247, 244)")

    const header = page.locator("header").first()
    expect((await header.boundingBox())!.height).toBe(64)
    await expect(header.locator("h1")).toHaveText("Hosts")
    await expect(page.locator(CONTENT)).toHaveCSS("padding", "32px")
    await page.screenshot({ path: SHOTS(1, "ac-1.8-layout-desktop") })
  })

  test("item aktif & judul mengikuti halaman", async ({ page }) => {
    await page.goto("/ssh-keys")
    const nav = page.getByRole("navigation", { name: "Navigasi utama" })
    await expect(nav.getByRole("link", { name: "SSH Keys" })).toHaveAttribute("data-active", "true")
    await expect(nav.getByRole("link", { name: "Hosts" })).toHaveAttribute("data-active", "false")
    await expect(page.locator("header h1")).toHaveText("SSH Keys")
    await page.goto("/design")
    await expect(page.locator("header h1")).toHaveText("Design tokens")
    await expect(nav.locator('[data-active="true"]')).toHaveCount(0)
  })

  test.describe("viewport < 768", () => {
    test.use({ viewport: { width: 390, height: 844 } })
    test("padding main 24px, top bar tetap 64px", async ({ page }) => {
      await gotoHosts(page)
      await expect(page.locator(CONTENT)).toHaveCSS("padding", "24px")
      expect((await page.locator("header").first().boundingBox())!.height).toBe(64)
      await page.screenshot({ path: SHOTS(1, "ac-1.8-layout-mobile") })
    })
  })
})

test.describe("CR-1-2 satu landmark main", () => {
  for (const url of ["/hosts", "/design", "/settings", "/ssh-keys"]) {
    test(`${url}: tepat satu <main>/role=main, konten berada di dalamnya`, async ({ page }) => {
      await page.goto(url)
      await expect(page.locator(CONTENT)).toBeVisible()
      await expect(page.locator("main")).toHaveCount(1)
      await expect(page.getByRole("main")).toHaveCount(1)
      await expect(page.locator("main main")).toHaveCount(0)
      await expect(page.locator("[data-slot=page-content]")).toHaveCount(1)
    })
  }
})

test.describe("AC-1.9 navigasi", () => {
  test("GET / redirect ke /hosts", async ({ page, request }) => {
    const res = await request.get("/", { maxRedirects: 0 })
    expect([307, 308]).toContain(res.status())
    expect(res.headers()["location"]).toMatch(/\/hosts$/)
    await page.goto("/")
    await expect(page).toHaveURL(/\/hosts$/)
    await expect(page).toHaveTitle("Hosts · PXE Lab")
  })

  test("klik tiap item sidebar membuka halaman benar dengan <title> dan isi", async ({ page }) => {
    await gotoHosts(page)
    const nav = page.getByRole("navigation", { name: "Navigasi utama" })
    for (const [label, href] of [...NAV.slice(1), NAV[0]]) {
      await nav.getByRole("link", { name: label }).click()
      await expect(page).toHaveURL(new RegExp(`${href}$`))
      await expect(page).toHaveTitle(`${label} · PXE Lab`)
      await expect(page.locator("header h1")).toHaveText(label)
    }
  })

  const PLACEHOLDERS = [
    ["/os-images", "OS Images — dibangun di tahap 4", /Daftar image installer/],
    ["/ssh-keys", "SSH Keys — dibangun di tahap 4", /Library public key dengan fingerprint SHA256/],
  ] as const
  for (const [url, title, desc] of PLACEHOLDERS) {
    test(`placeholder ${url} menampilkan judul + deskripsi`, async ({ page }) => {
      await page.goto(url)
      const empty = page.locator(CONTENT).locator('[data-slot="empty"]')
      await expect(empty).toBeVisible()
      await expect(empty.locator('[data-slot="empty-title"]')).toHaveText(title)
      const d = empty.locator('[data-slot="empty-description"]')
      await expect(d).toHaveText(desc)
      expect(((await d.textContent()) ?? "").trim().length).toBeGreaterThan(10)
    })
  }

  // M5 (DR-4-7, AC-5.32): halaman pendukung yang sudah dibangun bukan lagi placeholder — konten
  // nyata (penanda halaman terlihat), tanpa empty state placeholder dan tanpa "dibangun di tahap".
  const BUILT_PAGES = [["/jobs", '[data-testid="jobs-page"]']] as const
  for (const [url, marker] of BUILT_PAGES) {
    test(`${url}: konten nyata (bukan placeholder)`, async ({ page }) => {
      await page.goto(url)
      const content = page.locator(CONTENT)
      await expect(content.locator(marker)).toBeVisible()
      await expect(content).not.toContainText("dibangun di tahap")
      await expect(content.locator('[data-slot="empty-title"]').filter({ hasText: /dibangun/ })).toHaveCount(0)
    })
  }

  // M4-T8 (AC-4.6): /settings bukan lagi placeholder — halaman read-only dari GET /api/settings.
  test("/settings: halaman Settings read-only (bukan placeholder) dengan nilai dari API", async ({ page }) => {
    const api = await (await page.request.get("/api/settings")).json()
    await page.goto("/settings")
    const content = page.locator(CONTENT)
    await expect(content.locator('[data-slot="empty"]')).toHaveCount(0)
    await expect(content).toContainText("Read-only")
    for (const v of [api.cidr, api.gateway, api.pxeServer, api.tftpRoot, api.baseUrl, api.interface]) await expect(content).toContainText(v)
    await expect(content.locator("input, textarea, select")).toHaveCount(0)
  })
})

test.describe("AC-1.10 pencarian global", () => {
  test("Ctrl+K buka dialog, cari halaman + Enter bernavigasi, Escape menutup", async ({ page }) => {
    await gotoHosts(page)
    await page.keyboard.press("Control+k")
    const dlg = page.getByRole("dialog", { name: "Pencarian global" })
    await expect(dlg).toBeVisible()
    await page.screenshot({ path: SHOTS(1, "ac-1.10-command") })
    await page.keyboard.press("Escape")
    await expect(dlg).toBeHidden()

    await page.keyboard.press("Control+k")
    await expect(dlg).toBeVisible()
    await dlg.getByPlaceholder("Cari MAC, hostname, IP, atau halaman…").fill("Settings")
    await page.keyboard.press("Enter")
    await expect(page).toHaveURL(/\/settings$/)
    await expect(dlg).toBeHidden()
    await expect(page.locator("header h1")).toHaveText("Settings")
  })

  test("memilih host → /hosts?q=<mac> dan tabel terfilter ke host itu", async ({ page }) => {
    await page.goto("/settings")
    await page.locator("header").getByRole("button", { name: /Cari MAC, hostname, IP/ }).click()
    const dlg = page.getByRole("dialog", { name: "Pencarian global" })
    await dlg.getByPlaceholder("Cari MAC, hostname, IP, atau halaman…").fill("storage-01")
    const item = dlg.getByRole("option", { name: /94:40:c9:6e:01:aa/ })
    await expect(item).toBeVisible()
    await item.click()
    await expect(page).toHaveURL(/\/hosts\?q=94%3A40%3Ac9%3A6e%3A01%3Aaa$/)
    await expect(hostRows(page)).toHaveCount(1)
    await expect(hostRows(page).first()).toContainText("94:40:c9:6e:01:aa")
    await expect(page.getByLabel("Cari host")).toHaveValue("94:40:c9:6e:01:aa")
  })
})

test.describe("AC-1.11 status server PXE", () => {
  // M4 (CR-1-7): status berasal dari GET /api/server-status (tiga nilai: online/offline/tidak
  // diketahui). Teks aksesibel & warna titik harus sesuai state dari API; variasi ketiga state
  // dibuktikan deterministik di e2e/m4-settings.spec.ts (page.route, AC-4.7).
  test("top bar menampilkan DHCP, TFTP, HTTP dengan teks aksesibel sesuai status server", async ({ page }) => {
    await gotoHosts(page)
    const api = (await (await page.request.get("/api/server-status")).json()) as { services: { name: string; state: string }[] }
    const LABEL: Record<string, string> = { online: "online", offline: "offline", unknown: "tidak diketahui" }
    const group = page.locator("header").getByRole("group", { name: "Status server PXE" })
    await expect(group).toBeVisible()
    for (const name of ["DHCP", "TFTP", "HTTP"]) {
      const badge = group.locator(`[data-service="${name}"]`)
      const state = api.services.find((s) => s.name === name)!.state
      await expect(badge).toBeVisible()
      await expect(badge).toContainText(name)
      await expect(badge).toHaveAttribute("data-state", state)
      const sr = (await badge.textContent())!.replace(name, "").trim()
      expect(sr).toBe(LABEL[state])
      await expect(badge).toHaveAttribute("data-online", String(state === "online"))
      if (state !== "unknown")
        await expect(badge.locator('[data-slot="status-dot"]')).toHaveCSS(
          "background-color",
          state === "online" ? "rgb(31, 138, 101)" : "rgb(207, 45, 86)",
        )
    }
    await expect(group).toHaveAccessibleName("Status server PXE")
  })
})

