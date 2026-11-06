// DEC-021 §2 / DEC-022 §2 (gate-iter1 R4): pemeriksaan `/etc/apt` target di suite KVM m6-distro tidak
// boleh hampa. Script yang sama dengan yang dikirim ke node dijalankan terhadap root palsu (tanpa sudo).
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { aptTrustScript, evalAptTrust } from "../../../e2e-kvm/apt-trust"

const roots: string[] = []
function root(files: Record<string, string> = {}, withApt = true): string {
  const r = mkdtempSync(path.join(tmpdir(), "m6-apt-"))
  roots.push(r)
  if (withApt) mkdirSync(path.join(r, "etc/apt/apt.conf.d"), { recursive: true })
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(r, f)), { recursive: true })
    writeFileSync(path.join(r, f), c)
  }
  return r
}
const run = (r: string, pre = "") => execFileSync("bash", ["-s"], { input: aptTrustScript(r, pre), encoding: "utf8" })
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

describe("m6-distro: /etc/apt target tanpa trusted=yes / AllowUnauthenticated (fail-closed)", () => {
  const CLEAN = { "etc/apt/sources.list": "deb http://deb.debian.org/debian bookworm main\n", "etc/apt/apt.conf.d/70debconf": "// x\n" }
  it("target bersih → tanpa masalah (Debian)", () => {
    expect(evalAptTrust(run(root(CLEAN)), true)).toEqual({ aptDir: true, problems: [] })
  })
  it("trusted=yes di sources.list.d → FAIL", () => {
    const out = run(root({ ...CLEAN, "etc/apt/sources.list.d/media.list": "deb [trusted=yes] http://10.99.0.2/media/debian-12 bookworm main\n" }))
    expect(evalAptTrust(out, true).problems.join()).toMatch(/trusted=yes/)
  })
  it("00AllowUnauthenticated ada (isi apa pun) → FAIL (file dan grep)", () => {
    const out = run(root({ ...CLEAN, "etc/apt/apt.conf.d/00AllowUnauthenticated": 'APT::Get::AllowUnauthenticated "true";\n' }))
    const p = evalAptTrust(out, true).problems
    expect(p.some((x) => x.startsWith("00AllowUnauthenticated"))).toBe(true)
    expect(p.some((x) => x.startsWith("grep -ri AllowUnauthenticated"))).toBe(true)
  })
  it("AllowUnauthenticated (huruf apa pun) di berkas lain → FAIL lewat grep -ri", () => {
    const out = run(root({ ...CLEAN, "etc/apt/apt.conf.d/99pxe": 'acquire::allowunauthenticated "true";\n' }))
    expect(evalAptTrust(out, true).problems).toEqual([expect.stringMatching(/^grep -ri AllowUnauthenticated/)])
  })
  it("sudo/akses gagal (pre = false) → FAIL, tidak dianggap bersih", () => {
    const out = run(root(CLEAN), "false")
    expect(evalAptTrust(out, true).problems.length).toBeGreaterThanOrEqual(3)
  })
  it("/etc/apt tidak ada: Debian → FAIL; Rocky → tidak relevan", () => {
    const r = root({}, false)
    expect(evalAptTrust(run(r), true).problems).toEqual(["/etc/apt tidak ada di target"])
    expect(evalAptTrust(run(r), false)).toEqual({ aptDir: false, problems: [] })
  })
  it("keluaran kosong (ssh gagal) → FAIL", () => {
    expect(evalAptTrust("", true).problems).toEqual(["penanda apt_dir tidak ada", "/etc/apt tidak ada di target"])
  })
})
