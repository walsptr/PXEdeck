// DEC-027 §1 — form login tidak pernah menghasilkan request yang membawa kredensial di URL.
// Temuan KVM `vlandistro`: klik "Masuk" sebelum hydration → `GET /login?username=…&password=…`
// (password masuk access log nginx). Perbaikan: `method="post"` + tombol nonaktif sampai hydration.
// Server sendiri (`m7-login-no-url-creds`, fresh, tanpa storageState).
import { expect, test, type Page, type Request } from "@playwright/test"

import { E2E_ADMIN_USERNAME, e2eAdminPassword } from "./support/e2e-auth"

/** Kumpulkan semua request halaman (method + URL) untuk asersi kebocoran. */
function recordRequests(page: Page): { method: string; url: string }[] {
  const out: { method: string; url: string }[] = []
  page.on("request", (r: Request) => out.push({ method: r.method(), url: r.url() }))
  return out
}

/** Tidak ada URL (request maupun halaman) yang memuat kredensial. */
function expectNoCredsInUrls(urls: string[], password: string) {
  for (const u of urls) {
    expect(u, u).not.toContain("password=")
    expect(u, u).not.toContain("username=")
    expect(u, u).not.toContain(password)
    expect(u, u).not.toContain(encodeURIComponent(password))
  }
}

test.describe("DEC-027 §1 login tanpa kredensial di URL", () => {
  test("JavaScript nonaktif: HTML server sudah aman (method=post, action fallback, tombol nonaktif)", async ({ browser, baseURL }) => {
    // Tanpa JS, isi Suspense yang di-stream tetap tersembunyi (tidak bisa diisi pengguna); yang diuji
    // di sini: markup form dari server sendiri sudah aman sebelum skrip apa pun berjalan.
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL })
    const page = await context.newPage()
    try {
      const reqs = recordRequests(page)
      await page.goto("/login?next=%2Fhosts")
      const form = page.locator("form[aria-labelledby='login-title']")
      await expect(form).toHaveCount(1)
      await expect(form).toHaveAttribute("method", "post")
      await expect(form).toHaveAttribute("action", "/login/submit?next=%2Fhosts")
      await expect(page.getByTestId("login-submit")).toBeDisabled()
      expect(page.url()).toBe(`${baseURL}/login?next=%2Fhosts`)
      expectNoCredsInUrls(reqs.map((r) => r.url), e2eAdminPassword())
    } finally {
      await context.close()
    }
  })

  test("sebelum hydration: tombol nonaktif, klik/Enter tidak mengirim apa pun; dipaksa aktif → POST ke fallback, 303 ke /login tanpa kredensial", async ({ page, baseURL }) => {
    // Bundel JS klien diblokir → React tidak pernah hydrate (keadaan "sebelum hydration" yang stabil;
    // skrip inline streaming tetap jalan sehingga form terlihat seperti di run KVM).
    await page.route("**/_next/static/**/*.js", (r) => r.abort())
    const password = e2eAdminPassword()
    await page.goto("/login?next=%2Fhosts")
    const submit = page.getByTestId("login-submit")
    await expect(page.getByLabel("Username")).toBeVisible()
    await expect(submit).toBeDisabled()
    await expect(page.locator("form[data-hydrated]")).toHaveCount(0)
    // Sebelum hydration tombol tidak tampak pudar (DR-6-11): opacity 1.
    expect(await submit.evaluate((el) => getComputedStyle(el).opacity)).toBe("1")

    const reqs = recordRequests(page)
    await page.getByLabel("Username").fill(E2E_ADMIN_USERNAME)
    await page.getByLabel("Password").fill(password)
    // Lapis 1: implicit submission (Enter) dan klik paksa pada tombol nonaktif → tidak ada submit.
    await page.getByLabel("Password").press("Enter")
    await submit.click({ force: true })
    await page.waitForTimeout(1_000)
    expect(reqs.filter((r) => r.method !== "GET" || new URL(r.url).pathname.startsWith("/login"))).toEqual([])
    expect(page.url()).toBe(`${baseURL}/login?next=%2Fhosts`)

    // Lapis 2: andaikan tombol aktif sebelum hydration, `method="post"` + action fallback mencegah query
    // berisi kredensial; server membuang body dan mengalihkan (303) ke GET /login.
    await submit.evaluate((el) => el.removeAttribute("disabled"))
    const [nav] = await Promise.all([
      page.waitForRequest((r) => r.isNavigationRequest() && new URL(r.url()).pathname === "/login/submit"),
      submit.click(),
    ])
    const res = await nav.response()
    await page.waitForURL(`${baseURL}/login?next=%2Fhosts`)
    await page.waitForLoadState("load")

    expect(nav.method()).toBe("POST")
    expect(new URL(nav.url()).search).toBe("?next=%2Fhosts")
    expect(res?.status()).toBe(303)
    expect(res?.headers()["location"]).toBe("/login?next=%2Fhosts")
    // Halaman login dirender ulang dengan input kosong; tidak ada pantulan kredensial, sesi tidak dibuat.
    await expect(page.getByLabel("Username")).toHaveValue("")
    await expect(page.getByLabel("Password")).toHaveValue("")
    const html = await page.content()
    expect(html).not.toContain(password)
    expect(html).not.toContain(E2E_ADMIN_USERNAME)
    expect((await page.context().cookies()).filter((c) => c.name === "pxe_session")).toEqual([])
    expectNoCredsInUrls([...reqs.map((r) => r.url), page.url()], password)
  })

  test("POST urlencoded langsung ke fallback: body dibuang, 303 ke /login dengan next disanitasi", async ({ request }) => {
    const password = e2eAdminPassword()
    const cases: [string, string][] = [
      ["/login/submit", "/login"],
      ["/login/submit?next=%2Fsettings", "/login?next=%2Fsettings"],
      ["/login/submit?next=%2F%2Fevil.test", "/login?next=%2Fhosts"],
    ]
    for (const [url, location] of cases) {
      const res = await request.post(url, {
        form: { username: E2E_ADMIN_USERNAME, password },
        maxRedirects: 0,
      })
      expect(res.status(), url).toBe(303)
      expect(res.headers()["location"], url).toBe(location)
      expect(res.headers()["cache-control"], url).toContain("no-store")
      expect(res.headers()["set-cookie"], url).toBeUndefined()
      const body = await res.text()
      expect(body).not.toContain(password)
      expect(body).not.toContain(E2E_ADMIN_USERNAME)
    }
    // GET ke fallback tidak didukung (form tidak pernah menghasilkannya).
    expect((await request.get("/login/submit", { maxRedirects: 0 })).status()).toBe(405)
  })

  test("setelah hydration: tombol aktif, login normal lewat fetch JSON, tanpa kredensial di URL", async ({ page, baseURL }) => {
    const reqs = recordRequests(page)
    const password = e2eAdminPassword()
    await page.goto("/login?next=%2Fsettings")
    const submit = page.getByTestId("login-submit")
    await expect(submit).toBeEnabled()
    await expect(page.locator("form[data-hydrated]")).toHaveCount(1)
    expect(await submit.evaluate((el) => getComputedStyle(el).opacity)).toBe("1")
    await page.getByLabel("Username").fill(E2E_ADMIN_USERNAME)
    await page.getByLabel("Password").fill(password)
    await submit.click()
    await expect(page).toHaveURL(`${baseURL}/settings`)
    const login = reqs.filter((r) => new URL(r.url).pathname === "/api/auth/login")
    expect(login).toEqual([{ method: "POST", url: `${baseURL}/api/auth/login` }])
    expect(reqs.filter((r) => r.method === "POST" && new URL(r.url).pathname === "/login")).toEqual([])
    expectNoCredsInUrls([...reqs.map((r) => r.url), page.url()], password)
  })
})
