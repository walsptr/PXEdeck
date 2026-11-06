// M6-T12 — sesi habis saat di /hosts (AC-6.32) di server `m6-session` (PXE_SESSION_IDLE_MIN=1, tanpa
// storageState). DEC-019 §1: request ber-sesi (termasuk polling) memperpanjang idle, jadi AC-6.32 diuji
// lewat pencabutan sesi di sisi server: (a) logout dari konteks lain dengan cookie yang sama, (b) baris
// sesi dihapus dari DB. Test pertama mendokumentasikan perilaku DEC-019 §1 dan membuktikan idle 1 menit
// tetap berlaku untuk sesi tanpa aktivitas.
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

import { expect, test, type BrowserContext, type Page } from "@playwright/test"

import { SHOTS } from "./helpers"
import { E2E_ADMIN_USERNAME, e2eAdminPassword } from "./support/e2e-auth"

test.describe.configure({ timeout: 240_000 })

async function loginTo(page: Page, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`)
  await page.getByLabel("Username").fill(E2E_ADMIN_USERNAME)
  await page.getByLabel("Password").fill(e2eAdminPassword())
  await page.getByTestId("login-submit").click()
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[?]/g, "\\?")}$`))
}

/** Pantau request API dan navigasi dokumen halaman. */
function watch(page: Page) {
  const api: { t: number; path: string }[] = []
  const docs: string[] = []
  page.on("request", (r) => {
    const u = new URL(r.url())
    if (u.pathname.startsWith("/api/")) api.push({ t: Date.now(), path: u.pathname })
    if (r.resourceType() === "document" || (r.isNavigationRequest() && r.frame() === page.mainFrame())) docs.push(u.pathname + u.search)
  })
  return { api, docs }
}

/**
 * Setelah sesi dicabut: tepat satu redirect ke /login?next=/hosts ≤ 90 dtk, tanpa toast berulang dan
 * tanpa request polling sesudahnya (diamati 15 dtk), lalu login ulang kembali ke /hosts.
 */
async function expectSingleRedirect(page: Page, w: ReturnType<typeof watch>, revokedAt: number, shot: string) {
  await page.waitForURL(/\/login\?next=%2Fhosts$/, { timeout: 90_000 })
  const at = Date.now()
  expect(at - revokedAt).toBeLessThanOrEqual(90_000)
  await expect(page.getByLabel("Username")).toBeVisible()
  await page.waitForTimeout(15_000)
  await expect(page).toHaveURL(/\/login\?next=%2Fhosts$/)
  const loginNavs = w.docs.filter((d) => d.startsWith("/login"))
  expect(loginNavs, JSON.stringify(w.docs)).toHaveLength(1)
  const after = w.api.filter((r) => r.t > at && !r.path.startsWith("/api/auth/"))
  expect(after, JSON.stringify(after)).toEqual([])
  expect(await page.locator("[data-sonner-toast]").count()).toBeLessThanOrEqual(1)
  await page.screenshot({ path: SHOTS(6, shot), fullPage: true })
  // Login ulang → kembali ke /hosts.
  await page.getByLabel("Username").fill(E2E_ADMIN_USERNAME)
  await page.getByLabel("Password").fill(e2eAdminPassword())
  await page.getByTestId("login-submit").click()
  await expect(page).toHaveURL(/\/hosts$/)
  await expect(page.locator("main table").first()).toBeVisible()
}

async function sessionCookie(ctx: BrowserContext) {
  return (await ctx.cookies()).find((c) => c.name === "pxe_session")!.value
}

test("DEC-019 §1: polling memperpanjang idle (tab /hosts tetap masuk > 60 dtk); sesi tanpa aktivitas habis setelah idle 1 mnt", async ({ browser, baseURL }) => {
  const active = await browser.newContext({ baseURL, locale: "id-ID" })
  const idle = await browser.newContext({ baseURL, locale: "id-ID" })
  const pa = await active.newPage()
  const pi = await idle.newPage()
  await loginTo(pa, "/hosts")
  await loginTo(pi, "/settings")
  await pi.close() // konteks idle tanpa halaman → tanpa polling
  const w = watch(pa)
  await pa.waitForTimeout(75_000)
  // Tab aktif: tetap di /hosts, polling tetap 200.
  await expect(pa).toHaveURL(/\/hosts$/)
  expect(w.docs.filter((d) => d.startsWith("/login"))).toEqual([])
  expect((await active.request.get("/api/auth/session")).status()).toBe(200)
  // Sesi idle (tanpa request > 60 dtk): 401, dan halaman dialihkan ke login.
  const r = await idle.request.get("/api/hosts")
  expect(r.status()).toBe(401)
  expect(await r.json()).toEqual({ error: "Perlu login" })
  const pi2 = await idle.newPage()
  await pi2.goto("/hosts")
  await expect(pi2).toHaveURL(/\/login\?next=%2Fhosts$/)
  await active.close()
  await idle.close()
})

test("AC-6.32 (a) sesi di-logout dari konteks lain saat di /hosts → redirect sekali, tanpa polling; login ulang → /hosts", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL, locale: "id-ID" })
  const page = await ctx.newPage()
  await loginTo(page, "/hosts")
  await expect(page.locator("main table").first()).toBeVisible()
  const cookie = await sessionCookie(ctx)
  const w = watch(page)
  // Konteks lain (cookie sama, bukan halaman ini) mencabut sesi di server.
  const other = await browser.newContext({ baseURL })
  await other.addCookies([{ name: "pxe_session", value: cookie, url: baseURL! }])
  const lo = await other.request.post("/api/auth/logout")
  expect(lo.status()).toBe(204)
  const revokedAt = Date.now()
  await other.close()
  await expectSingleRedirect(page, w, revokedAt, "session-expired-logout")
  await ctx.close()
})

test("AC-6.32 (b) baris sesi dihapus di DB saat di /hosts → redirect sekali, tanpa polling; login ulang → /hosts", async ({ browser, baseURL }) => {
  const ctx = await browser.newContext({ baseURL, locale: "id-ID" })
  const page = await ctx.newPage()
  await loginTo(page, "/hosts")
  await expect(page.locator("main table").first()).toBeVisible()
  const w = watch(page)
  const dbFile = path.join(process.env.PXE_E2E_ROOT!, "db", "m6-session.db")
  const db = new DatabaseSync(dbFile)
  try {
    db.exec("PRAGMA busy_timeout = 5000")
    const n = db.prepare("DELETE FROM sessions").run().changes
    expect(Number(n)).toBeGreaterThanOrEqual(1)
  } finally {
    db.close()
  }
  const revokedAt = Date.now()
  await expectSingleRedirect(page, w, revokedAt, "session-expired-db")
  await ctx.close()
})
