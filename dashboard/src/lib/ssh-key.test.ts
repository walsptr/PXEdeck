// AC-3.4: parseSshKey + sshFingerprint (= ssh-keygen -lf, nilai di-hardcode di fixture).
import { describe, expect, it } from "vitest"

import { FAKE_PRIVATE_KEY, SSH_ECDSA, SSH_ED25519, SSH_RSA } from "@/test/fixtures"

import { parseSshKey, sshFingerprint } from "./ssh-key"

function ok(input: string) {
  const r = parseSshKey(input)
  if ("error" in r) throw new Error(r.error)
  return r
}

describe("AC-3.4 parseSshKey", () => {
  it.each([
    ["ssh-ed25519", SSH_ED25519],
    ["ssh-rsa", SSH_RSA],
    ["ecdsa-sha2-nistp256", SSH_ECDSA],
  ])("menerima %s", (type, fx) => {
    const k = ok(fx.publicKey)
    expect(k.type).toBe(type)
    expect(k.comment).toBe(fx.comment)
    expect(k.normalized).toBe(fx.publicKey)
  })

  it("tanpa komentar + spasi berlebih dinormalisasi", () => {
    const [t, b64] = SSH_ED25519.publicKey.split(" ")
    expect(ok(`  ${t}   ${b64}  `).normalized).toBe(`${t} ${b64}`)
  })

  it("menolak private key", () => {
    expect(parseSshKey(FAKE_PRIVATE_KEY)).toEqual({ error: expect.stringMatching(/private key/) })
  })
  it("menolak tipe lain (ssh-dss) dan input kosong", () => {
    expect(parseSshKey("ssh-dss AAAAB3NzaC1kc3MAAACBAP= x")).toEqual({ error: expect.stringMatching(/Tipe harus/) })
    expect(parseSshKey("   ")).toEqual({ error: "Public key kosong" })
    expect(parseSshKey("ssh-ed25519")).toEqual({ error: "Data key (base64) tidak ada" })
  })
  it("menolak base64 rusak", () => {
    expect(parseSshKey("ssh-ed25519 !!!bukan-base64!!!")).toEqual({ error: "Data key bukan base64 yang valid" })
    expect(parseSshKey("ssh-ed25519 AAAA")).toEqual({ error: "Data key bukan base64 yang valid" })
  })
  it("menolak blob yang tipe dalamnya tidak cocok dengan prefix", () => {
    const b64 = SSH_ED25519.publicKey.split(" ")[1]
    expect(parseSshKey(`ssh-rsa ${b64}`)).toEqual({ error: "Isi key bertipe ssh-ed25519, bukan ssh-rsa" })
  })
})

describe("AC-3.4 sshFingerprint = ssh-keygen -lf", () => {
  it.each([
    ["ed25519", SSH_ED25519],
    ["rsa", SSH_RSA],
    ["ecdsa", SSH_ECDSA],
  ])("%s", async (_n, fx) => {
    expect(await sshFingerprint(ok(fx.publicKey).blob)).toBe(fx.fingerprint)
  })
})
