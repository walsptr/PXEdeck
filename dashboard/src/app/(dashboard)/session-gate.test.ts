// M6 (backend-dev): SessionGate wajib menunggu `connection()` SEBELUM validasi sesi (jam + DB
// sinkron) — tanpa itu Next 16 (Cache Components) memperingatkan "unstable value new Date() while
// prerendering" dan keputusan auth bisa ikut prerender/prefetch. Juga: sesi tidak valid → redirect.
import { beforeEach, describe, expect, it, vi } from "vitest"

const calls: string[] = []
let cookieValue: string | undefined
let pathHeader: string | null = null

vi.mock("next/server", () => ({
  connection: vi.fn(async () => {
    calls.push("connection")
  }),
}))
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => (cookieValue === undefined ? undefined : { value: cookieValue }) })),
  headers: vi.fn(async () => ({ get: (k: string) => (k === "x-pxe-path" ? pathHeader : null) })),
}))
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    calls.push(`redirect:${url}`)
    throw new Error("NEXT_REDIRECT")
  }),
}))
vi.mock("@/lib/server/auth/session", () => ({
  sessionFromId: vi.fn((id: string | undefined) => {
    calls.push("sessionFromId")
    return id === "valid" ? { idHash: "h", username: "u", createdAt: "a", expiresAt: "b" } : null
  }),
}))

import { SessionGate } from "./session-gate"

beforeEach(() => {
  calls.length = 0
  cookieValue = undefined
  pathHeader = null
})

describe("SessionGate", () => {
  it("menunggu connection() sebelum validasi sesi; sesi valid → children", async () => {
    cookieValue = "valid"
    const el = await SessionGate({ children: "konten" })
    expect(calls).toEqual(["connection", "sessionFromId"])
    expect(el.props.children).toBe("konten")
  })

  it("sesi tidak valid → redirect /login?next=<x-pxe-path tersanitasi>, setelah connection()", async () => {
    cookieValue = "palsu"
    pathHeader = "/jobs?host=x"
    await expect(SessionGate({ children: "konten" })).rejects.toThrow("NEXT_REDIRECT")
    expect(calls).toEqual(["connection", "sessionFromId", "redirect:/login?next=%2Fjobs%3Fhost%3Dx"])
  })

  it("tanpa cookie + header next berbahaya → redirect ke /login?next=/hosts", async () => {
    pathHeader = "//evil.test"
    await expect(SessionGate({ children: "konten" })).rejects.toThrow("NEXT_REDIRECT")
    expect(calls.at(-1)).toBe("redirect:/login?next=%2Fhosts")
    expect(calls[0]).toBe("connection")
  })
})
