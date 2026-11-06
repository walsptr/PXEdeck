// M6-T12 — login, redirect `next`, desain halaman login, lockout (server `m6-auth`, tanpa storageState).
// AC-6.8 (e2e), AC-6.30, AC-6.31, AC-6.33. Password admin acak per run (e2e/support/e2e-auth.ts).
// Urutan file penting: uji lockout (AC-6.33) paling akhir karena menghabiskan kuota gagal per IP.
import { expect, test, type Page } from "@playwright/test"

import { ORANGE, SHOTS } from "./helpers"
import { E2E_ADMIN_USERNAME, e2eAdminPassword } from "./support/e2e-auth"

/** Host demo seed (lihat m2-hosts-table). */
const DEMO_HOST = "525400101011"
const DEMO_MAC = "52:54:00:10:10:11"

async function fillLogin(page: Page, username: string, password: string) {
  await page.getByLabel("Username").fill(username)
  await page.getByLabel("Password").fill(password)
}

async function login(page: Page) {
  await fillLogin(page, E2E_ADMIN_USERNAME, e2eAdminPassword())
  await page.getByTestId("login-submit").click()
}

test.describe("AC-6.8 halaman tanpa sesi → /login?next=", () => {
  const PAGES: [string, RegExp][] = [
    ["/", /\/login\?next=%2F(hosts)?$/],
    ["/hosts", /\/login\?next=%2Fhosts$/],
    [`/jobs?host=${DEMO_HOST}`, new RegExp(`/login\\?next=%2Fjobs%3Fhost%3D${DEMO_HOST}$`)],
    ["/os-images", /\/login\?next=%2Fos-images$/],
    ["/ssh-keys", /\/login\?next=%2Fssh-keys$/],
    ["/settings", /\/login\?next=%2Fsettings$/],
    ["/design", /\/login\?next=%2Fdesign$/],
  ]

  for (const [p, re] of PAGES) {
    test(`${p} → redirect ke login tanpa merender data`, async ({ page, request }) => {
      // HTTP mentah: 307 dari Proxy/redirect config, body tanpa data host.
      const raw = await request.get(p, { maxRedirects: 0 })
      expect([307, 308]).toContain(raw.status())
      expect(raw.headers()["location"]).toMatch(/\/(login\?next=|hosts$)/)
      expect(await raw.text()).not.toContain(DEMO_MAC)
      // Browser: mendarat di /login?next=…, tanpa respons API data yang sukses.
      const apiOk: string[] = []
      page.on("response", (r) => {
        const u = new URL(r.url())
        if (u.pathname.startsWith("/api/") && !u.pathname.startsWith("/api/auth/") && r.status() < 400) apiOk.push(u.pathname)
      })
      await page.goto(p)
      await expect(page).toHaveURL(re)
      await expect(page.getByLabel("Username")).toBeVisible()
      await expect(page.locator("main table")).toHaveCount(0)
      expect(await page.content()).not.toContain(DEMO_MAC)
      expect(apiOk).toEqual([])
    })
  }

  test("cookie berbentuk valid tapi palsu → layout server (lapis kedua) tetap mengalihkan tanpa data", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "pxe_session", value: "A".repeat(43), url: baseURL! }])
    // Respons mentah (cookie palsu ikut): Proxy meloloskan bentuk cookie, tetapi layout server menolak
    // sebelum shell dashboard (sidebar "Navigasi utama", konten halaman) dirender.
    const raw = await page.request.get("/settings", { maxRedirects: 0 })
    const body = await raw.text()
    expect(body).not.toContain("Navigasi utama")
    expect(body).not.toContain('data-slot="page-content"')
    expect(body).not.toContain(DEMO_MAC)
    await page.goto("/settings")
    await expect(page).toHaveURL(/\/login\?next=%2Fsettings$/)
    expect(await page.content()).not.toContain(DEMO_MAC)
  })

  test("/login, aset _next/static, font, favicon tetap 200 tanpa sesi", async ({ page, request }) => {
    const assets: { url: string; status: number }[] = []
    page.on("response", (r) => {
      if (new URL(r.url()).pathname.startsWith("/_next/static/")) assets.push({ url: r.url(), status: r.status() })
    })
    const res = await page.goto("/login")
    expect(res?.status()).toBe(200)
    await page.evaluate(() => document.fonts.ready)
    expect(assets.length).toBeGreaterThan(0)
    expect(assets.filter((a) => a.status !== 200)).toEqual([])
    expect(assets.some((a) => /\.(woff2?|ttf)(\?|$)/.test(a.url))).toBe(true)
    expect((await request.get("/favicon.ico")).status()).toBe(200)
  })

  const DANGEROUS = ["//evil.test", "/\\evil.test", "https://evil.test", "javascript:alert(1)", "/login", "/login?next=/settings"]
  for (const next of DANGEROUS) {
    test(`next berbahaya ${JSON.stringify(next)} → setelah login mendarat di /hosts`, async ({ page, baseURL }) => {
      await page.goto(`/login?next=${encodeURIComponent(next)}`)
      await login(page)
      await expect(page).toHaveURL(`${baseURL}/hosts`)
    })
  }

  test("next sah → mendarat di path itu (termasuk query)", async ({ page, baseURL }) => {
    await page.goto(`/login?next=${encodeURIComponent("/settings")}`)
    await login(page)
    await expect(page).toHaveURL(`${baseURL}/settings`)
    await page.goto("/hosts") // sesi sudah ada → tidak dialihkan
    await expect(page).toHaveURL(/\/hosts$/)
  })
})

test.describe("AC-6.30 desain halaman login", () => {
  for (const width of [375, 1440]) {
    test(`login @${width}: card, judul, input, tombol oranye satu-satunya, tanpa sidebar/top bar, tanpa overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto("/login")
      await page.evaluate(() => document.fonts.ready)
      await expect(page.getByLabel("Username")).toBeVisible()
      const m = await page.evaluate((orange) => {
        const card = document.querySelector('[data-testid="login-card"]')!
        const cs = getComputedStyle(card)
        const user = document.getElementById("login-username")!
        const pw = document.getElementById("login-password")!
        const btn = document.querySelector('[data-testid="login-submit"]')!
        const h1 = document.querySelector("h1")!
        const orangeEls = [...document.querySelectorAll("body *")].filter((el) => {
          const s = getComputedStyle(el)
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0 || s.display === "none" || s.visibility === "hidden") return false
          return [s.backgroundColor, s.color, s.borderTopColor].includes(orange)
        })
        return {
          doc: document.documentElement.scrollWidth,
          vw: window.innerWidth,
          bg: cs.backgroundColor,
          border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
          radius: cs.borderTopLeftRadius,
          shadow: cs.boxShadow,
          cardW: card.getBoundingClientRect().width,
          h1: { size: getComputedStyle(h1).fontSize, weight: getComputedStyle(h1).fontWeight, text: h1.textContent },
          userH: user.getBoundingClientRect().height,
          userR: getComputedStyle(user).borderTopLeftRadius,
          userFont: getComputedStyle(user).fontFamily,
          userAc: user.getAttribute("autocomplete"),
          pwAc: pw.getAttribute("autocomplete"),
          pwH: pw.closest('[data-slot="input-group"]')?.getBoundingClientRect().height ?? pw.getBoundingClientRect().height,
          pwR: getComputedStyle(pw.closest('[data-slot="input-group"]') ?? pw).borderTopLeftRadius,
          btnH: btn.getBoundingClientRect().height,
          btnBg: getComputedStyle(btn).backgroundColor,
          orangeCount: orangeEls.length,
          orangeIsButton: orangeEls.every((e) => e === btn),
          sidebar: document.querySelectorAll('[data-slot="sidebar"]').length,
          // Top bar dashboard = <header> di luar card login (card boleh punya header sendiri), dan
          // badge status layanan top bar.
          header: [...document.querySelectorAll("header")].filter((h) => !h.closest('[data-testid="login-card"]')).length,
          statusBadges: document.querySelectorAll("[data-service]").length,
        }
      }, ORANGE)
      expect(m.doc).toBe(m.vw)
      expect(m.bg).toBe("rgb(255, 255, 255)")
      expect(m.border).toBe("1px solid rgb(230, 229, 224)")
      expect(m.radius).toBe("12px")
      expect(m.shadow).toBe("none")
      expect(m.cardW).toBeLessThanOrEqual(400)
      expect(m.h1).toEqual({ size: "26px", weight: "400", text: "Masuk" })
      expect(m.userH).toBe(44)
      expect(m.userR).toBe("8px")
      expect(m.userFont).toMatch(/JetBrains Mono/)
      expect(m.pwH).toBe(44)
      expect(m.pwR).toBe("8px")
      expect(m.userAc).toBe("username")
      expect(m.pwAc).toBe("current-password")
      expect(m.btnH).toBe(40)
      expect(m.btnBg).toBe(ORANGE)
      expect(m.orangeCount).toBe(1)
      expect(m.orangeIsButton).toBe(true)
      expect(m.sidebar).toBe(0)
      expect(m.header).toBe(0)
      expect(m.statusBadges).toBe(0)
      // Label terasosiasi.
      await expect(page.getByLabel("Username")).toHaveAttribute("id", "login-username")
      await expect(page.getByLabel("Password")).toHaveAttribute("id", "login-password")
      await page.screenshot({ path: SHOTS(6, `login-${width}`), fullPage: true })
    })
  }
})

test.describe("AC-6.31 alur login", () => {
  test("password salah → Alert fokus; Enter mengirim; dari /jobs?host= kembali ke URL itu; username mono di sidebar", async ({ page, baseURL }) => {
    await page.goto(`/jobs?host=${DEMO_HOST}`)
    await expect(page).toHaveURL(new RegExp(`/login\\?next=%2Fjobs%3Fhost%3D${DEMO_HOST}$`))
    await fillLogin(page, E2E_ADMIN_USERNAME, "password-salah-e2e")
    await page.getByLabel("Password").press("Enter")
    const alert = page.getByTestId("login-error")
    await expect(alert).toHaveAttribute("role", "alert")
    await expect(alert).toContainText("Username atau password salah")
    await expect(alert).toBeFocused()
    await page.screenshot({ path: SHOTS(6, "login-error"), fullPage: true })
    await page.getByLabel("Password").fill(e2eAdminPassword())
    await page.getByLabel("Password").press("Enter")
    await expect(page).toHaveURL(`${baseURL}/jobs?host=${DEMO_HOST}`)
    const user = page.getByTestId("sidebar-username")
    await expect(user).toHaveText(new RegExp(`${E2E_ADMIN_USERNAME}$`))
    expect(await user.evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/JetBrains Mono/)
  })

  test("login benar tanpa next → /hosts; Keluar → /login; Back tidak menampilkan data", async ({ page, context, baseURL }) => {
    await page.goto("/login")
    await login(page)
    await expect(page).toHaveURL(`${baseURL}/hosts`)
    await expect(page.locator("main table").first()).toBeVisible()
    await page.getByRole("link", { name: "Settings" }).click()
    await expect(page).toHaveURL(/\/settings$/)
    await page.getByTestId("logout").click()
    await expect(page).toHaveURL(`${baseURL}/login`)
    expect((await context.cookies()).filter((c) => c.name === "pxe_session")).toEqual([])
    const apiOk: string[] = []
    page.on("response", (r) => {
      const u = new URL(r.url())
      if (u.pathname.startsWith("/api/") && !u.pathname.startsWith("/api/auth/") && r.status() < 400) apiOk.push(u.pathname)
    })
    await page.goBack()
    await expect(page).toHaveURL(/\/login(\?next=.*)?$/)
    await expect(page.getByLabel("Username")).toBeVisible()
    await expect(page.locator("main table")).toHaveCount(0)
    expect(await page.content()).not.toContain(DEMO_MAC)
    expect(apiOk).toEqual([])
  })
})

test.describe("AC-6.33 lockout UI (paling akhir: menghabiskan kuota gagal per IP)", () => {
  async function failUntilLocked(page: Page, username: string) {
    await page.goto("/login")
    for (let i = 1; i <= 5; i++) {
      await fillLogin(page, username, `salah-${i}-xxxxxx`)
      const res = page.waitForResponse((r) => r.url().endsWith("/api/auth/login"))
      await page.getByTestId("login-submit").click()
      expect((await res).status()).toBe(401)
      await expect(page.getByTestId("login-error")).toContainText("Username atau password salah")
    }
    // Percobaan ke-6 — untuk admin dengan password BENAR — tetap 429.
    await fillLogin(page, username, username === E2E_ADMIN_USERNAME ? e2eAdminPassword() : "salah-6-xxxxxx")
    const res6 = page.waitForResponse((r) => r.url().endsWith("/api/auth/login"))
    await page.getByTestId("login-submit").click()
    const r6 = await res6
    expect(r6.status()).toBe(429)
    const retry = Number(r6.headers()["retry-after"])
    expect(retry).toBeGreaterThan(0)
    const n = Math.max(1, Math.ceil(retry / 60))
    const alert = page.getByTestId("login-error")
    await expect(alert).toContainText(`Terlalu banyak percobaan. Coba lagi dalam ${n} menit.`)
    await expect(alert).toBeFocused()
    await expect(page.getByTestId("login-submit")).toBeEnabled()
    await expect(page).toHaveURL(/\/login$/)
    return (await alert.textContent())!.replace(/\d+ menit/, "N menit")
  }

  test("5 password salah → ke-6 (password benar) menampilkan lockout N menit; tombol tetap aktif; username tak dikenal identik", async ({ page }) => {
    const admin = await failUntilLocked(page, E2E_ADMIN_USERNAME)
    await page.screenshot({ path: SHOTS(6, "login-lockout"), fullPage: true })
    const unknown = await failUntilLocked(page, "bruteuser")
    // Tidak membocorkan apakah username ada: teks (dengan N dinormalisasi) identik.
    expect(unknown).toBe(admin)
  })
})
