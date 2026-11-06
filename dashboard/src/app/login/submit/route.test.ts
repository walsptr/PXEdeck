// DEC-027 §1: route fallback submit native form login — body dibuang, 303 ke /login (next disanitasi).
import { describe, expect, it } from "vitest"

import { POST } from "./route"

function post(path: string, body = "username=admin&password=rahasia-uji-123") {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  })
}

describe("POST /login/submit", () => {
  it.each([
    ["/login/submit", "/login"],
    ["/login/submit?next=%2Fsettings", "/login?next=%2Fsettings"],
    [`/login/submit?next=${encodeURIComponent("/jobs?host=a&job=b")}`, `/login?next=${encodeURIComponent("/jobs?host=a&job=b")}`],
    ["/login/submit?next=%2F%2Fevil.test", "/login?next=%2Fhosts"],
    ["/login/submit?next=https%3A%2F%2Fevil.test", "/login?next=%2Fhosts"],
    ["/login/submit?next=%2Flogin", "/login?next=%2Fhosts"],
  ])("%s → 303 %s tanpa cookie, tanpa body, no-store", async (path, location) => {
    const req = post(path)
    const res = POST(req)
    expect(res.status).toBe(303)
    expect(res.headers.get("location")).toBe(location)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(res.headers.get("set-cookie")).toBeNull()
    expect(await res.text()).toBe("")
    // Body (kredensial) tidak dibaca sama sekali.
    expect(req.bodyUsed).toBe(false)
  })
})
