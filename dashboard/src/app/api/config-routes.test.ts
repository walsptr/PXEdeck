// AC-3.5 … AC-3.11: integration route handler M3 (PATCH /api/hosts/:id, GET config,
// POST bulk, install, bulk/install, credentials/import, GET ssh-keys).
// M4: DB SQLite di-reset per test (`resetDb("demo")`, DEC-005/DEC-007). Seed demo TIDAK lagi
// berisi credentials/hash maupun key `wals@wal` (carry-over SR-2-1/CR-3-12), jadi test yang dulu
// mengandalkan credentials/key seed menyiapkannya sendiri lewat API (`ready()`, `ADMIN_KEY`).
// Install butuh media image di PXE_MEDIA_ROOT (plan §2.4) → root media palsu per file.
import { verify } from "unixcrypt"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }))

import { peekConfig } from "@/lib/server/db/repos/configs"
import { updateHost } from "@/lib/server/db/repos/hosts"
import { getActiveJob, listJobsForHost } from "@/lib/server/db/repos/jobs"
import { createSshKey } from "@/lib/server/library-service"
import { dbSnapshot, makeMediaRoot, tmpDir, withDb } from "@/test/db"
import { DUMMY_PASSWORD, FAKE_PRIVATE_KEY, SSH_ECDSA, SSH_ED25519, SSH_ED25519_B, SSH_RSA } from "@/test/fixtures"
import { ctx, getReq, jsonReq } from "@/test/route"

import { POST as csvImport } from "./credentials/import/route"
import { POST as bulk } from "./hosts/bulk/route"
import { POST as bulkInstall } from "./hosts/bulk/install/route"
import { GET as getConfig } from "./hosts/[id]/config/route"
import { POST as install } from "./hosts/[id]/install/route"
import { GET as getHost, PATCH } from "./hosts/[id]/route"
import { GET as sshKeys } from "./ssh-keys/route"

const MEDIA = makeMediaRoot(tmpDir("media"))
withDb("demo", { PXE_MEDIA_ROOT: MEDIA })

/** Key library "Admin workstation" (pengganti key seed `key-admin-wals` M2/M3). */
let ADMIN_KEY = ""
beforeEach(async () => {
  const r = await createSshKey({ name: "Admin workstation", publicKey: SSH_ECDSA.publicKey })
  if (!r.ok) throw new Error(r.error)
  ADMIN_KEY = r.value.id
})

const NODE01 = "525400101011" // done, 10.10.10.11
const CTRL01 = "1418774a2c01" // done, 10.10.10.21
const CTRL02 = "1418774a2c02" // done, 10.10.10.22
const CTRL03 = "1418774a2c03" // installing
const DISC1 = "b083fe5c19e2" // discovered, lease 10.10.10.143
const DISC2 = "b083fe5c19e3"
const DISC3 = "a0369f0b725d"
const STORAGE02 = "9440c96e01ab" // offline, mgmt 10.10.10.42

const SHA512_CRYPT = /^\$6\$[^$]{1,16}\$[./0-9A-Za-z]{86}$/

const staticNet = (assignments: Record<string, string>) => ({
  mode: "static" as const,
  assignments,
  prefix: 24,
  gateway: "10.10.10.1",
  dns: ["10.10.10.1"],
  vlan: null,
  iface: { by: "mac" as const },
})
const same = (username: string, password: string) => ({
  mode: "same" as const,
  username,
  password,
  sudo: true,
  disableSshPassword: false,
})

const patch = (id: string, body: unknown, raw?: string) => PATCH(jsonReq(`/api/hosts/${id}`, "PATCH", body, raw), ctx(id))
const post = (body: unknown, raw?: string) => bulk(jsonReq("/api/hosts/bulk", "POST", body, raw))
const config = async (id: string) => (await getConfig(jsonReq("/x", "GET"), ctx(id))).json()
const host = async (id: string) => (await getHost(jsonReq("/x", "GET"), ctx(id))).json()

/** Credentials eksplisit (+ key) agar host siap install; seed M4 tidak membawa credentials. */
async function ready(...ids: string[]) {
  for (const id of ids) {
    const res = await patch(id, { credentials: same("ubuntu", DUMMY_PASSWORD), ssh: { keyIds: [ADMIN_KEY], newKeys: [], user: "" } })
    expect(res.status, id).toBe(200)
  }
}

describe("AC-3.5 validasi struktural & semantik", () => {
  it("body bukan JSON → 400 {error}", async () => {
    for (const res of [await patch(NODE01, undefined, "{bukan json"), await post(undefined, "nope")]) {
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: "Body bukan JSON yang valid" })
    }
  })
  it("prefix 40 → 400 errors[].section = network", async () => {
    const res = await patch(NODE01, { network: { ...staticNet({ [NODE01]: "10.10.10.50" }), prefix: 40 } })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.errors[0].section).toBe("network")
  })
  it("hostIds: [] → 400 section hostIds", async () => {
    const res = await post({ hostIds: [], hostname: { assignments: {} } })
    expect(res.status).toBe(400)
    expect((await res.json()).errors[0].section).toBe("hostIds")
  })
  it("mode credentials asing → 400 section credentials", async () => {
    const res = await patch(NODE01, { credentials: { mode: "ldap", sudo: true, disableSshPassword: false } })
    expect(res.status).toBe(400)
    expect((await res.json()).errors[0].section).toBe("credentials")
  })
  it("semantik gagal → 422 errors[] per bagian", async () => {
    const res = await patch(NODE01, { os: { osImageId: "arch", disk: "", partition: "custom", timezone: "UTC", locale: "en_US.UTF-8" } })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.errors.map((e: { section: string }) => e.section)).toEqual(["os", "os"])
    expect(body.errors.map((e: { message: string }) => e.message)).toEqual([
      "OS image tidak dikenal",
      "Skema custom butuh konfigurasi storage",
    ])
  })
  it("payload tanpa bagian apa pun → 422", async () => {
    const res = await patch(NODE01, {})
    expect(res.status).toBe(422)
    expect((await res.json()).errors[0].message).toBe("Tidak ada bagian konfigurasi yang diubah")
    expect((await post({ hostIds: [NODE01] })).status).toBe(422)
  })
  it("PATCH id invalid → 400, host tak ada → 404; bulk id tak dikenal → 422 hostIds", async () => {
    expect((await patch("xyz", {})).status).toBe(400)
    expect((await patch("000000000000", { hostname: { assignments: {} } })).status).toBe(404)
    const res = await post({ hostIds: ["000000000000"], hostname: { assignments: {} } })
    expect(res.status).toBe(422)
    expect((await res.json()).errors[0]).toMatchObject({ section: "hostIds", hostId: "000000000000" })
  })
  it("GET config: id invalid → 400, tak ada → 404", async () => {
    expect((await getConfig(jsonReq("/x", "GET"), ctx("q"))).status).toBe(400)
    expect((await getConfig(jsonReq("/x", "GET"), ctx("000000000000"))).status).toBe(404)
  })
})

describe("AC-3.6 atomik", () => {
  it("network valid + hostname bentrok satu host → 422, tidak ada perubahan", async () => {
    const ids = [DISC1, DISC2, DISC3]
    const before = await Promise.all(ids.map(async (id) => [await host(id), await config(id)]))
    const res = await post({
      hostIds: ids,
      network: staticNet({ [DISC1]: "10.10.10.71", [DISC2]: "10.10.10.72", [DISC3]: "10.10.10.73" }),
      hostname: { assignments: { [DISC1]: "node-a", [DISC2]: "ctrl-01", [DISC3]: "node-c" } },
    })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.errors).toEqual([
      { section: "hostname", hostId: DISC2, message: "b0:83:fe:5c:19:e3: Sudah dipakai 14:18:77:4a:2c:01" },
    ])
    const after = await Promise.all(ids.map(async (id) => [await host(id), await config(id)]))
    expect(after).toEqual(before)
  })
  it("payload valid → 200 {updated: N} dan semua host berubah", async () => {
    const ids = [DISC1, DISC2, DISC3]
    const res = await post({
      hostIds: ids,
      network: staticNet({ [DISC1]: "10.10.10.71", [DISC2]: "10.10.10.72", [DISC3]: "10.10.10.73" }),
      hostname: { assignments: { [DISC1]: "node-a", [DISC2]: "node-b", [DISC3]: "node-c" } },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ updated: 3 })
    const hs = await Promise.all(ids.map(host))
    expect(hs.map((h) => [h.hostname, h.mgmtIp])).toEqual([
      ["node-a", "10.10.10.71"],
      ["node-b", "10.10.10.72"],
      ["node-c", "10.10.10.73"],
    ])
    const c = await config(DISC2)
    expect(c.network).toMatchObject({ mode: "static", ip: "10.10.10.72", prefix: 24 })
    expect(c.updatedAt).toEqual(expect.any(String))
  })
})

describe("AC-3.7 network", () => {
  it("IP bentrok dengan IP management host lain → 422, pesan menyebut pemakai", async () => {
    const res = await patch(DISC1, { network: staticNet({ [DISC1]: "10.10.10.21" }) })
    expect(res.status).toBe(422)
    expect((await res.json()).errors[0]).toMatchObject({ section: "network", hostId: DISC1, message: expect.stringContaining("Bentrok dengan ctrl-01") })
    // Host offline: IP management tetap dihitung.
    const off = await patch(DISC1, { network: staticNet({ [DISC1]: "10.10.10.42" }) })
    expect((await off.json()).errors[0].message).toContain("Bentrok dengan storage-02")
  })
  it("IP bentrok dengan lease aktif host lain → 422", async () => {
    updateHost(DISC2, { currentIp: "10.10.10.60" })
    const res = await patch(DISC1, { network: staticNet({ [DISC1]: "10.10.10.60" }) })
    expect(res.status).toBe(422)
    expect((await res.json()).errors[0].message).toContain("Bentrok dengan lease b0:83:fe:5c:19:e3")
  })
  it("duplikat dalam batch ditolak", async () => {
    const res = await post({ hostIds: [DISC1, DISC2], network: staticNet({ [DISC1]: "10.10.10.70", [DISC2]: "10.10.10.70" }) })
    expect(res.status).toBe(422)
    expect((await res.json()).errors[0]).toMatchObject({ hostId: DISC2, message: expect.stringContaining("Duplikat dalam batch") })
  })
  it("gateway/DNS bukan IPv4 ditolak; prefix ≠ subnet (DEC-006) ditolak", async () => {
    const res = await patch(DISC1, { network: { ...staticNet({ [DISC1]: "10.10.10.70" }), gateway: "gw", dns: ["dns.lokal"] } })
    expect(res.status).toBe(422)
    const msgs = (await res.json()).errors.map((e: { message: string }) => e.message)
    expect(msgs).toEqual(["Gateway tidak valid", "DNS tidak valid: dns.lokal"])
    const p = await patch(DISC1, { network: { ...staticNet({ [DISC1]: "10.10.10.70" }), prefix: 16 } })
    expect((await p.json()).errors[0].message).toMatch(/Prefix \/16/)
  })
  it("host tanpa assignment → 'IP wajib diisi'", async () => {
    const res = await post({ hostIds: [DISC1, DISC2], network: staticNet({ [DISC1]: "10.10.10.70" }) })
    expect((await res.json()).errors[0].message).toContain("IP wajib diisi")
  })
  it("mode DHCP menghapus mgmtIp", async () => {
    const res = await patch(CTRL01, { network: { mode: "dhcp" } })
    expect(res.status).toBe(200)
    expect((await host(CTRL01)).mgmtIp).toBeNull()
    expect((await config(CTRL01)).network).toEqual({ mode: "dhcp" })
  })
  it("host di batch tidak bentrok dengan dirinya sendiri (termasuk tukar IP)", async () => {
    expect((await patch(CTRL01, { network: staticNet({ [CTRL01]: "10.10.10.21" }) })).status).toBe(200)
    const swap = await post({ hostIds: [CTRL01, CTRL02], network: staticNet({ [CTRL01]: "10.10.10.22", [CTRL02]: "10.10.10.21" }) })
    expect(swap.status).toBe(200)
    expect((await host(CTRL01)).mgmtIp).toBe("10.10.10.22")
  })
  it("subnet dari env PXE_MGMT_* (DEC-006)", async () => {
    Object.assign(process.env, {
      PXE_MGMT_CIDR: "10.99.0.0/24",
      PXE_MGMT_GATEWAY: "10.99.0.1",
      PXE_SERVER_IP: "10.99.0.2",
      PXE_DYNAMIC_RANGE: "10.99.0.100-10.99.0.200",
    })
    const ok = await patch(DISC1, { network: { ...staticNet({ [DISC1]: "10.99.0.20" }), gateway: "10.99.0.1" } })
    expect(ok.status).toBe(200)
    const bad = await patch(DISC2, { network: { ...staticNet({ [DISC2]: "10.10.10.70" }) } })
    expect(bad.status).toBe(422)
  })
})

describe("AC-3.8 credentials & keamanan password", () => {
  it("mode same: hash SHA-512 crypt terverifikasi, salt berbeda antar host", async () => {
    const res = await post({ hostIds: [DISC1, DISC2], credentials: same("ops", DUMMY_PASSWORD) })
    expect(res.status).toBe(200)
    const text = JSON.stringify(await res.json())
    expect(text).not.toContain(DUMMY_PASSWORD)
    const h1 = peekConfig(DISC1)!.passwordHash!
    const h2 = peekConfig(DISC2)!.passwordHash!
    expect(h1).toMatch(SHA512_CRYPT)
    expect(h2).toMatch(SHA512_CRYPT)
    expect(verify(DUMMY_PASSWORD, h1)).toBe(true)
    expect(verify("salah-password", h1)).toBe(false)
    expect(h1.split("$")[2]).not.toBe(h2.split("$")[2])
    expect(h1).not.toBe(h2)
    expect(peekConfig(DISC1)!.username).toBe("ops")
  })
  it("password kosong ditolak bila ada host tanpa password; diterima bila semua punya", async () => {
    // M4: NODE01 tidak lagi punya password dari seed → beri password lebih dulu.
    expect((await config(NODE01)).hasPassword).toBe(false)
    await ready(NODE01)
    const res = await post({ hostIds: [NODE01, DISC1], credentials: same("ops", "") })
    expect(res.status).toBe(422)
    expect((await res.json()).errors[0].message).toBe("Password wajib: 1 host belum punya password")
    const keep = await patch(NODE01, { credentials: same("admin", "") })
    expect(keep.status).toBe(200)
    expect((await config(NODE01)).username).toBe("admin")
    expect((await config(NODE01)).hasPassword).toBe(true)
  })
  it("username/password invalid → 422", async () => {
    const res = await patch(NODE01, { credentials: same("root", "pendek") })
    expect(res.status).toBe(422)
    expect((await res.json()).errors.map((e: { message: string }) => e.message)).toEqual([
      '"root" adalah user sistem',
      "Minimal 8 karakter",
    ])
  })
  it("mode random: generatedPasswords satu per host, unik, panjang sesuai — hanya sekali", async () => {
    const ids = [DISC1, DISC2, DISC3]
    const res = await post({
      hostIds: ids,
      credentials: { mode: "random", username: "ops", length: 20, sudo: false, disableSshPassword: true },
      hostname: { assignments: { [DISC1]: "r-1", [DISC2]: "r-2", [DISC3]: "r-3" } },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.updated).toBe(3)
    const gen = body.generatedPasswords as { mac: string; hostname: string; username: string; password: string }[]
    expect(gen).toHaveLength(3)
    expect(new Set(gen.map((g) => g.password)).size).toBe(3)
    for (const g of gen) expect(g.password).toHaveLength(20)
    // Hostname diambil setelah semua bagian diterapkan.
    expect(gen.map((g) => g.hostname)).toEqual(["r-1", "r-2", "r-3"])
    gen.forEach((g, i) => expect(verify(g.password, peekConfig(ids[i])!.passwordHash!)).toBe(true))
    expect(peekConfig(DISC1)).toMatchObject({ sudo: false, disableSshPassword: true })
    // Tidak ada respons lain yang memuat password.
    for (const id of ids) {
      const c = JSON.stringify(await config(id))
      for (const g of gen) expect(c).not.toContain(g.password)
    }
    const again = await post({ hostIds: ids, hostname: { assignments: { [DISC1]: "r-1", [DISC2]: "r-2", [DISC3]: "r-3" } } })
    expect((await again.json()).generatedPasswords).toBeUndefined()
  })
  it("GET config tidak pernah memuat passwordHash/password (hanya hasPassword)", async () => {
    await patch(DISC1, { credentials: same("ops", DUMMY_PASSWORD) })
    const raw = await (await getConfig(jsonReq("/x", "GET"), ctx(DISC1))).text()
    expect(raw).not.toContain("passwordHash")
    expect(raw).not.toContain("$6$")
    expect(raw).not.toContain(DUMMY_PASSWORD)
    expect(JSON.parse(raw).hasPassword).toBe(true)
    expect((await config(DISC2)).hasPassword).toBe(false)
    const list = await (await getHost(jsonReq("/x", "GET"), ctx(DISC1))).text()
    expect(list).not.toContain(DUMMY_PASSWORD)
  })
})

describe("AC-3.9 CSV import", () => {
  const imp = (csv: string, hostIds: string[]) => csvImport(jsonReq("/api/credentials/import", "POST", { csv, hostIds }))

  it("hasil per baris (nomor baris memperhitungkan header) dengan error tiap kasus", async () => {
    const csv = [
      "mac,username,password",
      `b0:83:fe:5c:19:e2,ops,${DUMMY_PASSWORD}`,
      `zz:zz,ops,${DUMMY_PASSWORD}`,
      `52:54:00:10:10:11,ops,${DUMMY_PASSWORD}`,
      `B0-83-FE-5C-19-E2,ops,${DUMMY_PASSWORD}`,
      `b0:83:fe:5c:19:e3,ops`,
      `a0:36:9f:0b:72:5d,Root,pendek`,
    ].join("\r\n")
    const res = await imp(csv, [DISC1, DISC2, DISC3])
    expect(res.status).toBe(200)
    const raw = await res.text()
    expect(raw).not.toContain(DUMMY_PASSWORD)
    const body = JSON.parse(raw)
    expect(body.valid).toBe(1)
    expect(body.invalid).toBe(5)
    const byLine = Object.fromEntries(body.rows.map((r: { line: number; errors: string[] }) => [r.line, r.errors]))
    expect(byLine[2]).toEqual([])
    expect(byLine[3]).toEqual(["MAC tidak valid"])
    expect(byLine[4]).toEqual(["MAC bukan host terpilih"])
    expect(byLine[5]).toEqual(["MAC muncul lebih dari sekali"])
    expect(byLine[6]).toEqual(["Harus 3 kolom, ada 2", "Password: Minimal 8 karakter"])
    expect(byLine[7][0]).toMatch(/Huruf kecil/)
    expect(byLine[7][1]).toBe("Password: Minimal 8 karakter")
    expect(body.rows[0]).toMatchObject({ line: 2, mac: "b0:83:fe:5c:19:e2", username: "ops", hostId: DISC1 })
  })
  it("tanpa header: baris mulai 1; CSV kosong → error", async () => {
    const body = await (await imp(`b0:83:fe:5c:19:e2,ops,${DUMMY_PASSWORD}`, [DISC1])).json()
    expect(body.rows[0].line).toBe(1)
    const empty = await (await imp("\n\n", [DISC1])).json()
    expect(empty.rows).toEqual([{ line: 1, mac: "", username: "", hostId: null, errors: ["CSV kosong"] }])
  })
  it("payload invalid → 400", async () => {
    expect((await csvImport(jsonReq("/x", "POST", { csv: "a", hostIds: [] }))).status).toBe(400)
  })
  it("bulk mode csv dengan ≥ 1 baris invalid → 422 tanpa efek (termasuk baris valid)", async () => {
    const snap = () => Promise.all([DISC1, DISC2].map(async (id) => [await host(id), await config(id)]))
    const before = await snap()
    const csv = `mac,username,password\nb0:83:fe:5c:19:e2,ops,${DUMMY_PASSWORD}\nb0:83:fe:5c:19:e3,ops,x`
    const res = await post({ hostIds: [DISC1, DISC2], credentials: { mode: "csv", csv, sudo: true, disableSshPassword: false } })
    expect(res.status).toBe(422)
    expect((await res.json()).errors[0].message).toBe("1 baris CSV tidak valid (baris 3)")
    // Baris 2 (valid) juga tidak diterapkan.
    expect((await config(DISC1)).hasPassword).toBe(false)
    expect((await config(DISC1)).username).toBeNull()
    expect(await snap()).toEqual(before)
  })
  it("bulk mode csv valid → hash per host", async () => {
    const csv = `mac,username,password\nb0:83:fe:5c:19:e2,ops,${DUMMY_PASSWORD}\nb0:83:fe:5c:19:e3,dev,${DUMMY_PASSWORD}x`
    const res = await post({ hostIds: [DISC1, DISC2, DISC3], credentials: { mode: "csv", csv, sudo: true, disableSshPassword: false } })
    expect(res.status).toBe(200)
    expect(peekConfig(DISC2)!.username).toBe("dev")
    expect(verify(`${DUMMY_PASSWORD}x`, peekConfig(DISC2)!.passwordHash!)).toBe(true)
    // Host tanpa baris CSV tidak diubah.
    expect(peekConfig(DISC3)?.passwordHash ?? null).toBeNull()
    expect((await config(DISC3)).hasPassword).toBe(false)
  })
})

describe("AC-3.10 hostname & SSH", () => {
  const ssh = (keyIds: string[], newKeys: { name: string; publicKey: string; saveToLibrary: boolean }[], user = "") => ({
    ssh: { keyIds, newKeys, user },
  })

  it("hostname invalid/duplikat/dipakai host lain → 422 per host", async () => {
    const res = await post({
      hostIds: [DISC1, DISC2, DISC3],
      hostname: { assignments: { [DISC1]: "Bad_Name", [DISC2]: "dup", [DISC3]: "dup" } },
    })
    expect(res.status).toBe(422)
    const errs = (await res.json()).errors
    expect(errs.map((e: { hostId: string }) => e.hostId)).toEqual([DISC1, DISC3])
    expect(errs[1].message).toContain("Duplikat dalam batch")
    const taken = await patch(DISC1, { hostname: { assignments: { [DISC1]: "node01" } } })
    expect((await taken.json()).errors[0]).toMatchObject({ section: "hostname", hostId: DISC1 })
  })
  it("keyIds tidak ada di library → 422", async () => {
    const res = await patch(NODE01, ssh(["key-tidak-ada"], []))
    expect(res.status).toBe(422)
    expect((await res.json()).errors[0]).toEqual({ section: "ssh", message: "Key key-tidak-ada tidak ada di library" })
  })
  it("key baru invalid → 422 dengan nomor key", async () => {
    const res = await patch(NODE01, ssh([ADMIN_KEY], [{ name: "", publicKey: FAKE_PRIVATE_KEY, saveToLibrary: false }]))
    expect(res.status).toBe(422)
    expect((await res.json()).errors[0].message).toMatch(/^Key baru #1: Ini private key/)
  })
  it("saveToLibrary tanpa nama → 422", async () => {
    const res = await patch(NODE01, ssh([], [{ name: "  ", publicKey: SSH_ED25519.publicKey, saveToLibrary: true }]))
    expect(res.status).toBe(422)
    expect((await res.json()).errors[0].message).toBe("Key baru #1: nama wajib untuk disimpan ke library")
  })
  it("key valid + saveToLibrary → muncul di GET /api/ssh-keys dengan fingerprint benar", async () => {
    const res = await patch(NODE01, ssh([ADMIN_KEY, ADMIN_KEY], [{ name: "Laptop ops", publicKey: SSH_ED25519.publicKey, saveToLibrary: true }], "ops"))
    expect(res.status).toBe(200)
    const keys = await (await sshKeys(getReq("/api/ssh-keys"))).json()
    expect(keys.map((k: { name: string }) => k.name)).toEqual(["Admin workstation", "Laptop ops"])
    const k = keys[1]
    expect(k).toMatchObject({ type: "ssh-ed25519", fingerprint: SSH_ED25519.fingerprint, comment: SSH_ED25519.comment })
    expect(k.fingerprint).toMatch(/^SHA256:/)
    const c = await config(NODE01)
    expect(c.sshKeyIds).toEqual([ADMIN_KEY, k.id])
    expect(c.sshUser).toBe("ops")
  })
  it("key valid tanpa saveToLibrary → extraKeys, library tetap", async () => {
    expect((await patch(NODE01, ssh([], [{ name: "", publicKey: SSH_RSA.publicKey, saveToLibrary: false }]))).status).toBe(200)
    expect((await config(NODE01)).extraKeys).toEqual([SSH_RSA.publicKey])
    expect(await (await sshKeys(getReq("/api/ssh-keys"))).json()).toHaveLength(1)
  })
  it("fingerprint duplikat (library / dalam request) → 422 (G3-3)", async () => {
    await patch(NODE01, ssh([], [{ name: "A", publicKey: SSH_ED25519.publicKey, saveToLibrary: true }]))
    const dupLib = await patch(NODE01, ssh([], [{ name: "B", publicKey: SSH_ED25519.publicKey, saveToLibrary: true }]))
    expect(dupLib.status).toBe(422)
    expect((await dupLib.json()).errors[0].message).toMatch(/sudah ada di library sebagai "A"/)
    const dupReq = await patch(NODE01, ssh([], [
      { name: "", publicKey: SSH_ED25519_B.publicKey, saveToLibrary: false },
      { name: "", publicKey: SSH_ED25519_B.publicKey, saveToLibrary: false },
    ]))
    expect((await dupReq.json()).errors[0].message).toBe("Key baru #2: sama dengan key baru #1")
  })
  it("tanpa key sama sekali → 422; user target invalid → 422", async () => {
    const none = await patch(NODE01, ssh([], []))
    expect((await none.json()).errors[0].message).toBe("Pilih atau tambahkan minimal satu key")
    const user = await patch(NODE01, ssh([ADMIN_KEY], [], "Root"))
    expect((await user.json()).errors[0].message).toMatch(/^User target: /)
  })
})

describe("AC-3.11 install", () => {
  it("POST /api/hosts/:id/install: host siap → 200 started, status booting", async () => {
    await ready(NODE01)
    const res = await install(jsonReq("/x", "POST"), ctx(NODE01))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ started: [NODE01], failed: [] })
    const h = await host(NODE01)
    expect(h.status).toBe("booting")
    // Id OS kanonik M4 (ubuntu-24.04.5 → ubuntu-24.04, plan §2.2).
    expect(h.osAssigned).toBe("ubuntu-24.04")
    // M4 (AC-4.25): job install `booting` dibuat dalam transaksi yang sama.
    expect(getActiveJob(NODE01)).toMatchObject({ kind: "install", status: "booting", osImageId: "ubuntu-24.04" })
  })
  it("host tanpa OS/credentials, sedang provisioning, id tak dikenal → failed + 422", async () => {
    const a = await install(jsonReq("/x", "POST"), ctx(DISC1))
    expect(a.status).toBe(422)
    expect((await a.json()).failed).toEqual([{ hostId: DISC1, message: "b0:83:fe:5c:19:e2: belum ada OS image dan credentials" }])
    await ready(CTRL03) // M4: tanpa credentials pesan "belum ada credentials" didahulukan
    const b = await install(jsonReq("/x", "POST"), ctx(CTRL03))
    expect((await b.json()).failed[0].message).toBe("ctrl-03: instalasi sedang berjalan")
    const c = await install(jsonReq("/x", "POST"), ctx("000000000000"))
    expect(c.status).toBe(422)
    expect((await c.json()).failed[0].message).toBe("Host tidak ditemukan")
    expect((await install(jsonReq("/x", "POST"), ctx("nope"))).status).toBe(400)
  })
  it("host dengan OS tapi tanpa credentials → failed 'belum ada credentials'", async () => {
    await patch(DISC1, { os: { osImageId: "debian-12", disk: " /dev/sda ", partition: "auto", timezone: "UTC", locale: "en_US.UTF-8" } })
    const c = await config(DISC1)
    expect(c.os.disk).toBe("/dev/sda")
    expect((await host(DISC1)).osAssigned).toBe("debian-12")
    const res = await install(jsonReq("/x", "POST"), ctx(DISC1))
    expect((await res.json()).failed[0].message).toBe("b0:83:fe:5c:19:e2: belum ada credentials")
  })
  it("OS tidak mengubah osAssigned host yang sedang provisioning", async () => {
    await patch(CTRL03, { os: { osImageId: "debian-12", disk: "", partition: "auto", timezone: "UTC", locale: "en_US.UTF-8" } })
    expect((await host(CTRL03)).osAssigned).toBe("ubuntu-24.04")
  })
  it("bulk install: campuran → 200 dengan started & failed; tidak ada yang mulai → 422", async () => {
    await ready(NODE01, CTRL01, CTRL03)
    const res = await bulkInstall(jsonReq("/x", "POST", { hostIds: [NODE01, CTRL01, DISC1, CTRL03, "000000000000", NODE01] }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.started).toEqual([NODE01, CTRL01])
    expect(body.failed.map((f: { hostId: string }) => f.hostId)).toEqual([DISC1, CTRL03, "000000000000"])
    expect((await host(CTRL01)).status).toBe("booting")
    const none = await bulkInstall(jsonReq("/x", "POST", { hostIds: [DISC1] }))
    expect(none.status).toBe(422)
    expect((await bulkInstall(jsonReq("/x", "POST", { hostIds: [] }))).status).toBe(400)
  })
  it("storage-02 (offline, terpasang) bisa install ulang", async () => {
    await ready(STORAGE02)
    const res = await install(jsonReq("/x", "POST"), ctx(STORAGE02))
    expect(res.status).toBe(200)
    expect((await host(STORAGE02)).osAssigned).toBe("rocky-9") // id kanonik (rocky-9.4 → rocky-9)
  })

  // ---- M4 (AC-4.25, carry-over SR-2-1/CR-3-12) ----
  it("SR-2-1: host demo tanpa credentials eksplisit ditolak install; tidak ada job", async () => {
    for (const id of [NODE01, CTRL01, STORAGE02]) {
      const res = await install(jsonReq("/x", "POST"), ctx(id))
      expect(res.status, id).toBe(422)
      expect((await res.json()).failed[0].message).toMatch(/: belum ada (OS image dan )?credentials$/)
      expect(listJobsForHost(id)).toEqual([])
    }
  })
  it("media image tidak tersedia → gagal 'Media … tidak tersedia' tanpa efek", async () => {
    await ready(DISC1)
    await patch(DISC1, { os: { osImageId: "ubuntu-22.04", disk: "", partition: "lvm", timezone: "UTC", locale: "en_US.UTF-8" } })
    const before = dbSnapshot()
    const res = await install(jsonReq("/x", "POST"), ctx(DISC1))
    expect(res.status).toBe(422)
    expect((await res.json()).failed[0].message).toMatch(/Media ubuntu-22\.04 tidak tersedia/)
    expect(dbSnapshot()).toBe(before)
  })
  it("Windows → gagal 'hanya generator' (DEC-010)", async () => {
    await ready(DISC1)
    await patch(DISC1, { os: { osImageId: "windows-2022", disk: "", partition: "lvm", timezone: "UTC", locale: "en_US.UTF-8" } })
    const res = await install(jsonReq("/x", "POST"), ctx(DISC1))
    expect(res.status).toBe(422)
    expect((await res.json()).failed[0].message).toMatch(/hanya generator/)
    expect(getActiveJob(DISC1)).toBeNull()
  })
  it("bulk: semua host yang lolos mendapat job booting + osAssigned dalam satu transaksi", async () => {
    await ready(NODE01, CTRL01)
    const res = await bulkInstall(jsonReq("/x", "POST", { hostIds: [NODE01, CTRL01, DISC1] }))
    expect(res.status).toBe(200)
    for (const id of [NODE01, CTRL01]) {
      expect(getActiveJob(id)).toMatchObject({ status: "booting", osImageId: "ubuntu-24.04" })
      expect(await host(id)).toMatchObject({ status: "booting", osAssigned: "ubuntu-24.04" })
    }
    expect(getActiveJob(DISC1)).toBeNull()
    // Token plaintext tidak pernah dikembalikan API.
    expect(JSON.stringify(await (await install(jsonReq("/x", "POST"), ctx(NODE01))).json())).not.toMatch(/token/i)
  })
})
