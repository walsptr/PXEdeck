// M6-T2 (backend-dev): sanitizer `next` (anti open redirect, AC-6.8) + keputusan Proxy.
import { NextRequest } from "next/server"
import { describe, expect, it } from "vitest"

import { proxy, config } from "@/proxy"

import { DEFAULT_AFTER_LOGIN, isPublicPath, loginHref, proxyRedirect, safeNextPath } from "./auth-next"

const ID = "A".repeat(43)

describe("safeNextPath", () => {
  it.each([
    "//evil.test",
    "//evil.test/hosts",
    "/\\evil.test",
    "/\\/evil.test",
    "https://evil.test",
    "http:/evil.test",
    "javascript:alert(1)",
    "evil.test",
    "",
    " /hosts",
    "/hosts\n",
    "/ho sts",
    "/hosts\u0000",
    "/hosts\t",
    "/login",
    "/login?next=/hosts",
    "/login/",
    "/login#x",
    "/" + "a".repeat(2048),
  ])("berbahaya/tidak sah %j → /hosts", (raw) => {
    expect(safeNextPath(raw)).toBe(DEFAULT_AFTER_LOGIN)
  })

  it("null/undefined/bukan string → /hosts", () => {
    expect(safeNextPath(null)).toBe("/hosts")
    expect(safeNextPath(undefined)).toBe("/hosts")
    expect(safeNextPath(5 as unknown as string)).toBe("/hosts")
  })

  it.each(["/hosts", "/jobs?host=525400990011", "/jobs?host=x&job=job-1#log", "/settings", "/loginx", "/os-images/", "/%2F%2Fevil"])(
    "sah %j → path itu",
    (raw) => {
      expect(safeNextPath(raw)).toBe(raw)
    },
  )

  it("loginHref meng-encode next yang sudah disanitasi", () => {
    expect(loginHref("/jobs?host=x&a=b")).toBe("/login?next=%2Fjobs%3Fhost%3Dx%26a%3Db")
    expect(loginHref("//evil.test")).toBe("/login?next=%2Fhosts")
    expect(loginHref(null)).toBe("/login?next=%2Fhosts")
  })
})

describe("Proxy (src/proxy.ts)", () => {
  it("isPublicPath: login, api, boot, _next, aset", () => {
    for (const p of ["/login", "/login/x", "/api", "/api/hosts", "/boot", "/boot/x.ipxe", "/_next/static/a.js", "/favicon.ico", "/fonts/inter.woff2", "/logo.svg"])
      expect(isPublicPath(p), p).toBe(true)
    for (const p of ["/", "/hosts", "/jobs", "/os-images", "/ssh-keys", "/settings", "/design", "/apix", "/bootx", "/loginx"])
      expect(isPublicPath(p), p).toBe(false)
  })

  it("proxyRedirect: tanpa cookie / cookie berbentuk salah → /login?next=<path+query>; cookie berbentuk benar → lanjut", () => {
    expect(proxyRedirect("/jobs", "?host=x", undefined)).toBe("/login?next=%2Fjobs%3Fhost%3Dx")
    expect(proxyRedirect("/hosts", "", "pendek")).toBe("/login?next=%2Fhosts")
    expect(proxyRedirect("/hosts", "", `${ID}=`)).toBe("/login?next=%2Fhosts")
    expect(proxyRedirect("/hosts", "", ID)).toBeNull()
    expect(proxyRedirect("/api/hosts", "", undefined)).toBeNull()
    expect(proxyRedirect("/login", "?next=/x", undefined)).toBeNull()
  })

  it.each(["/", "/hosts", "/jobs?host=x", "/os-images", "/ssh-keys", "/settings", "/design"])(
    "proxy(): %s tanpa cookie → 307 ke /login?next=…",
    (p) => {
      const res = proxy(new NextRequest(`http://localhost${p}`))
      expect(res.status).toBe(307)
      const loc = new URL(res.headers.get("location")!)
      expect(loc.pathname).toBe("/login")
      expect(loc.searchParams.get("next")).toBe(p)
    },
  )

  it("proxy(): cookie berbentuk valid → lanjut + header x-pxe-path diteruskan ke request", () => {
    const res = proxy(new NextRequest("http://localhost/jobs?host=x", { headers: { cookie: `pxe_session=${ID}` } }))
    expect(res.status).toBe(200)
    expect(res.headers.get("location")).toBeNull()
    expect(res.headers.get("x-middleware-request-x-pxe-path")).toBe("/jobs?host=x")
  })

  it("matcher mengecualikan api, boot, _next/static, _next/image, favicon, login", () => {
    const re = new RegExp(`^${config.matcher[0]}$`)
    for (const p of ["/hosts", "/", "/jobs", "/loginx", "/apix"]) expect(re.test(p), p).toBe(true)
    for (const p of ["/api/hosts", "/api", "/boot/x.ipxe", "/_next/static/a.js", "/_next/image", "/favicon.ico", "/login", "/login/x"])
      expect(re.test(p), p).toBe(false)
  })
})
