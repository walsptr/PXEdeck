// DEC-027 §1 (jsdom): form login tidak pernah membawa kredensial di URL — `method="post"`, `action`
// ke route fallback, tombol Masuk nonaktif di HTML server dan aktif tepat setelah hydration.
import { act, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { hydrateRoot, type Root } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const nav = vi.hoisted(() => ({ params: new URLSearchParams() }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => nav.params,
}))

import { LoginForm, LOGIN_NATIVE_ACTION, loginNativeAction } from "@/components/auth/login-form"

function wrap(children: ReactNode) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
}

beforeEach(() => {
  nav.params = new URLSearchParams()
})

describe("loginNativeAction", () => {
  it("tanpa next → /login/submit; dengan next → query next ter-encode (bukan kredensial)", () => {
    expect(LOGIN_NATIVE_ACTION).toBe("/login/submit")
    expect(loginNativeAction(null)).toBe("/login/submit")
    expect(loginNativeAction("/jobs?host=a&job=b")).toBe(
      `/login/submit?next=${encodeURIComponent("/jobs?host=a&job=b")}`,
    )
  })
})

describe("LoginForm DEC-027 §1", () => {
  it("form method=post dengan action fallback yang membawa next", () => {
    nav.params = new URLSearchParams({ next: "/settings" })
    render(wrap(<LoginForm />))
    const form = screen.getByRole("button", { name: "Masuk" }).closest("form")!
    expect(form).toHaveAttribute("method", "post")
    expect(form.getAttribute("action")).toBe("/login/submit?next=%2Fsettings")
    expect(form.method).toBe("post")
  })

  describe("SSR + hydration", () => {
    let container: HTMLDivElement
    let root: Root | null = null
    afterEach(() => {
      act(() => root?.unmount())
      root = null
      container.remove()
    })

    it("HTML server: tombol nonaktif tanpa efek pudar; setelah hydration aktif + data-hydrated", async () => {
      const html = renderToString(wrap(<LoginForm />))
      container = document.createElement("div")
      container.innerHTML = html
      document.body.appendChild(container)

      const form = container.querySelector("form")!
      const btn = container.querySelector<HTMLButtonElement>('[data-testid="login-submit"]')!
      expect(form.getAttribute("method")).toBe("post")
      expect(form.getAttribute("action")).toBe("/login/submit")
      expect(form.hasAttribute("data-hydrated")).toBe(false)
      expect(btn.disabled).toBe(true)
      expect(btn.className).toContain("disabled:opacity-100")

      await act(async () => {
        root = hydrateRoot(container, wrap(<LoginForm />))
      })
      const hydratedBtn = container.querySelector<HTMLButtonElement>('[data-testid="login-submit"]')!
      expect(hydratedBtn.disabled).toBe(false)
      expect(hydratedBtn.className).not.toContain("disabled:opacity-100")
      expect(container.querySelector("form")!.hasAttribute("data-hydrated")).toBe(true)
    })
  })
})
