// M4-T10 integration /api/** baru + persistence: AC-4.2 (data bertahan restart, tanpa secret di
// response), AC-4.3 (atomik: PATCH paralel, bulk invalid), AC-4.6 (/api/settings), AC-4.7
// (/api/server-status), API os-images & ssh-keys (GET/POST/DELETE).
import { describe, expect, it, vi } from "vitest"

import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

import { closeDb, getDb } from "@/lib/server/db"
import { getActiveJob } from "@/lib/server/db/repos/jobs"
import { dbSnapshot, makeMediaRoot, tmpDir, withDb } from "@/test/db"
import { DUMMY_PASSWORD, FAKE_PRIVATE_KEY, SSH_ECDSA, SSH_ED25519, SSH_ED25519_B } from "@/test/fixtures"
import { ctx, jsonReq } from "@/test/route"

import { GET as hostsGET } from "./hosts/route"
import { DELETE as hostDELETE, GET as hostGET, PATCH } from "./hosts/[id]/route"
import { GET as configGET } from "./hosts/[id]/config/route"
import { POST as install } from "./hosts/[id]/install/route"
import { POST as bulkPOST } from "./hosts/bulk/route"
import { POST as bulkInstall } from "./hosts/bulk/install/route"
import { GET as networkGET } from "./network/route"
import { GET as imagesGET, POST as imagesPOST } from "./os-images/route"
import { DELETE as imageDELETE } from "./os-images/[id]/route"
import { GET as statusGET } from "./server-status/route"
import { GET as settingsGET } from "./settings/route"
import { GET as keysGET, POST as keysPOST } from "./ssh-keys/route"
import { DELETE as keyDELETE } from "./ssh-keys/[id]/route"

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }))

const MEDIA = makeMediaRoot(tmpDir("api-media"))
withDb("demo", { PXE_MEDIA_ROOT: MEDIA })

const NODE01 = "525400101011" // done, 10.10.10.11
const CTRL01 = "1418774a2c01"
const DISC1 = "b083fe5c19e2" // discovered
const DISC2 = "b083fe5c19e3"
const KVM = {
  PXE_MGMT_CIDR: "10.99.0.0/24",
  PXE_MGMT_GATEWAY: "10.99.0.1",
  PXE_MGMT_DNS: "10.99.0.2",
  PXE_SERVER_IP: "10.99.0.2",
  PXE_DHCP_RANGE: "10.99.0.100-10.99.0.200",
  PXE_DHCP_INTERFACE: "pxe0",
  PXE_BASE_URL: "http://10.99.0.2",
}
const ID = (id: string) => ctx(id)
const idp = (id: string) => ({ params: Promise.resolve({ id }) }) as never
const FORBIDDEN = /passwordHash|password_hash|"token"|token_hash|tokenHash|\$6\$/

const staticNet = (assignments: Record<string, string>) => ({
  network: { mode: "static", prefix: 24, gateway: "10.10.10.1", dns: ["10.10.10.1"], vlan: null, iface: { by: "mac" }, assignments },
})
const creds = { credentials: { mode: "same", username: "ops", password: DUMMY_PASSWORD, sudo: true, disableSshPassword: false } }
const sshNew = { ssh: { keyIds: [], newKeys: [{ name: "", publicKey: SSH_ED25519.publicKey, saveToLibrary: false }], user: "" } }
const patch = (id: string, body: unknown) => PATCH(jsonReq(`/api/hosts/${id}`, "PATCH", body), ID(id))

describe("AC-4.6 GET /api/settings", () => {
  it("cidr, gateway, dns, dynamicRange, pxeServer, baseUrl, tftpRoot, interface; tanpa path DB/rahasia; no-store", async () => {
    Object.assign(process.env, KVM, { PXE_DB_PATH: ":memory:", PXE_DNSMASQ_LEASES: "/var/lib/misc/dnsmasq.leases", PXE_ALLOWED_HOSTS: "localhost" })
    const res = await settingsGET()
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    const body = await res.json()
    expect(body).toEqual({
      cidr: "10.99.0.0/24",
      prefix: 24,
      gateway: "10.99.0.1",
      dns: ["10.99.0.2"],
      dynamicRange: ["10.99.0.100", "10.99.0.200"],
      pxeServer: "10.99.0.2",
      interface: "pxe0",
      baseUrl: "http://10.99.0.2",
      mediaUrl: "http://10.99.0.2/media",
      tftpRoot: "/srv/pxe/tftp",
      tokenTtlMin: 360,
      unknownHostAction: "local",
    })
    const raw = JSON.stringify(body)
    for (const s of ["memory", "dnsmasq.leases", MEDIA, "seed", "allowed", "dbPath"]) expect(raw).not.toContain(s)
    // /api/network (kontrak M3) = subset yang sama.
    const net = await (await networkGET()).json()
    expect(net).toEqual({ cidr: body.cidr, prefix: 24, gateway: body.gateway, dns: body.dns, dynamicRange: body.dynamicRange, pxeServer: body.pxeServer })
  })
  it("env tidak valid → 500 {error} yang menyebut variabel", async () => {
    process.env.PXE_BASE_URL = "ftp://x"
    const res = await settingsGET()
    expect(res.status).toBe(500)
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect((await res.json()).error).toMatch(/PXE_BASE_URL/)
  })
})

describe("AC-4.7 GET /api/server-status", () => {
  it("env kosong → unknown ×3; pidfile hidup + TFTP → online; pidfile basi → offline; env rusak → 500", async () => {
    let body = await (await statusGET()).json()
    expect(body.services.map((s: { name: string; state: string }) => [s.name, s.state])).toEqual([
      ["DHCP", "unknown"],
      ["TFTP", "unknown"],
      ["HTTP", "online"], // PXE_MEDIA_ROOT (dir test) terbaca
    ])
    const dir = tmpDir("srvstat")
    mkdirSync(path.join(dir, "tftp"))
    for (const f of ["snponly.efi", "undionly.kpxe"]) writeFileSync(path.join(dir, "tftp", f), "x")
    writeFileSync(path.join(dir, "pid"), String(process.pid))
    Object.assign(process.env, { PXE_DNSMASQ_PIDFILE: path.join(dir, "pid"), PXE_TFTP_ROOT: path.join(dir, "tftp") })
    const res = await statusGET()
    expect(res.headers.get("cache-control")).toBe("no-store")
    body = await res.json()
    expect(body.services.map((s: { state: string }) => s.state)).toEqual(["online", "online", "online"])
    expect(body.services.map((s: { online: boolean }) => s.online)).toEqual([true, true, true])
    writeFileSync(path.join(dir, "pid"), "999999999")
    body = await (await statusGET()).json()
    expect(body.services.map((s: { state: string }) => s.state)).toEqual(["offline", "offline", "online"])
    process.env.PXE_TOKEN_TTL_MIN = "1"
    const bad = await statusGET()
    expect(bad.status).toBe(500)
    expect((await bad.json()).error).toMatch(/PXE_TOKEN_TTL_MIN/)
  })
})

describe("API ssh-keys (GET/POST/DELETE)", () => {
  it("POST 201 → GET memuat key; fingerprint sama → 409; private key/invalid → 422; skema → 400", async () => {
    const res = await keysPOST(jsonReq("/api/ssh-keys", "POST", { name: "Laptop", publicKey: SSH_ED25519.publicKey }))
    expect(res.status).toBe(201)
    const k = await res.json()
    expect(k).toMatchObject({ name: "Laptop", type: "ssh-ed25519", fingerprint: SSH_ED25519.fingerprint, comment: SSH_ED25519.comment, publicKey: SSH_ED25519.publicKey })
    const list = await keysGET()
    expect(list.headers.get("cache-control")).toBe("no-store")
    expect(await list.json()).toEqual([k])
    const dup = await keysPOST(jsonReq("/api/ssh-keys", "POST", { name: "Lagi", publicKey: `${SSH_ED25519.publicKey.split(" ").slice(0, 2).join(" ")} komentar-lain` }))
    expect(dup.status).toBe(409)
    expect((await dup.json()).error).toMatch(/sudah ada di library sebagai "Laptop"/)
    const priv = await keysPOST(jsonReq("/api/ssh-keys", "POST", { name: "x", publicKey: FAKE_PRIVATE_KEY }))
    expect(priv.status).toBe(422)
    expect(JSON.stringify(await priv.json())).not.toContain("OPENSSH PRIVATE KEY-----\nb3B")
    expect((await keysPOST(jsonReq("/api/ssh-keys", "POST", { name: "", publicKey: SSH_ECDSA.publicKey }))).status).toBe(400)
    expect((await keysPOST(jsonReq("/api/ssh-keys", "POST", { publicKey: SSH_ECDSA.publicKey }))).status).toBe(400)
  })
  it("DELETE: 204; dipakai host → 409; tidak ada → 404; lintas-origin → 403", async () => {
    const a = await (await keysPOST(jsonReq("/api/ssh-keys", "POST", { name: "A", publicKey: SSH_ED25519.publicKey }))).json()
    const b = await (await keysPOST(jsonReq("/api/ssh-keys", "POST", { name: "B", publicKey: SSH_ED25519_B.publicKey }))).json()
    expect((await patch(NODE01, { ssh: { keyIds: [a.id], newKeys: [], user: "" } })).status).toBe(200)
    const used = await keyDELETE(jsonReq(`/api/ssh-keys/${a.id}`, "DELETE"), idp(a.id))
    expect(used.status).toBe(409)
    expect((await used.json()).error).toMatch(/dipakai 1 host/)
    const cross = await keyDELETE(new Request(`http://localhost/api/ssh-keys/${b.id}`, { method: "DELETE", headers: { origin: "http://evil.example" } }), idp(b.id))
    expect(cross.status).toBe(403)
    expect((await keyDELETE(jsonReq(`/api/ssh-keys/${b.id}`, "DELETE"), idp(b.id))).status).toBe(204)
    expect((await keyDELETE(jsonReq(`/api/ssh-keys/${b.id}`, "DELETE"), idp(b.id))).status).toBe(404)
    expect((await (await keysGET()).json()).map((k: { id: string }) => k.id)).toEqual([a.id])
    // Hapus host → join dilepas → key bisa dihapus.
    expect((await hostDELETE(jsonReq(`/api/hosts/${NODE01}`, "DELETE"), ID(NODE01))).status).toBe(204)
    expect((await keyDELETE(jsonReq(`/api/ssh-keys/${a.id}`, "DELETE"), idp(a.id))).status).toBe(204)
  })
})

describe("API os-images (GET/POST/DELETE)", () => {
  it("GET: katalog + available/reason sesuai media; Windows tidak tersedia + alasan", async () => {
    const res = await imagesGET()
    expect(res.headers.get("cache-control")).toBe("no-store")
    const imgs = (await res.json()) as { id: string; available: boolean; reason: string | null; bootable: boolean }[]
    expect(Object.fromEntries(imgs.map((i) => [i.id, i.available]))).toEqual({
      "debian-12": true,
      "rocky-9": true,
      "ubuntu-22.04": false,
      "ubuntu-24.04": true,
      "windows-2022": false,
    })
    expect(imgs.find((i) => i.id === "ubuntu-22.04")!.reason).toMatch(/Media ubuntu-22\.04 tidak tersedia/)
    expect(imgs.find((i) => i.id === "windows-2022")).toMatchObject({ bootable: false, reason: expect.stringMatching(/hanya generator/) })
    expect(JSON.stringify(imgs)).not.toContain(MEDIA)
  })
  it("POST 201 / 409 duplikat / 400 path & aturan bootable; DELETE 204 / 409 dipakai / 404", async () => {
    const body = { id: "ubuntu-24.10", name: "Ubuntu", version: "24.10", arch: "amd64", method: "autoinstall", bootable: true, source: { kernel: "u/vmlinuz", initrd: "u/initrd", repo: "u" } }
    const res = await imagesPOST(jsonReq("/api/os-images", "POST", body))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ id: "ubuntu-24.10", available: false, builtin: false })
    expect((await imagesPOST(jsonReq("/api/os-images", "POST", body))).status).toBe(409)
    for (const bad of [
      { ...body, id: "x2", source: { ...body.source, kernel: "../etc/passwd" } },
      { ...body, id: "x3", source: { ...body.source, kernel: "/abs" } },
      { ...body, id: "x4", source: { ...body.source, kernel: "" } },
      { ...body, id: "x5", method: "unattend" },
      { ...body, id: "UPPER" },
    ])
      expect((await imagesPOST(jsonReq("/api/os-images", "POST", bad))).status, JSON.stringify(bad)).toBe(400)
    expect((await imagesPOST(jsonReq("/api/os-images", "POST", { ...body, id: "win-x", method: "unattend", bootable: false, source: { kernel: "", initrd: "", repo: "w" } }))).status).toBe(201)
    // dipakai host (osAssigned/config) → 409
    const used = await imageDELETE(jsonReq("/api/os-images/ubuntu-24.04", "DELETE"), idp("ubuntu-24.04"))
    expect(used.status).toBe(409)
    expect((await used.json()).error).toMatch(/dipakai \d+ host\/job/)
    expect((await imageDELETE(jsonReq("/api/os-images/ubuntu-24.10", "DELETE"), idp("ubuntu-24.10"))).status).toBe(204)
    expect((await imageDELETE(jsonReq("/api/os-images/ubuntu-24.10", "DELETE"), idp("ubuntu-24.10"))).status).toBe(404)
    expect((await imageDELETE(new Request("http://evil.example/api/os-images/win-x", { method: "DELETE" }), idp("win-x"))).status).toBe(403)
  })
})

describe("AC-4.2 persistence & tanpa secret di response", () => {
  it("host/config/key/job yang ditulis via API terbaca sama setelah DB dibuka ulang dari file", async () => {
    const dir = tmpDir("persist")
    process.env.PXE_DB_PATH = path.join(dir, "pxe.db")
    process.env.PXE_SEED = "demo"
    closeDb()
    try {
      const key = await (await keysPOST(jsonReq("/api/ssh-keys", "POST", { name: "Ops", publicKey: SSH_ECDSA.publicKey }))).json()
      const res = await patch(DISC1, {
        os: { osImageId: "ubuntu-24.04", disk: "/dev/vda", partition: "lvm", timezone: "UTC", locale: "en_US.UTF-8" },
        ...creds,
        ...staticNet({ [DISC1]: "10.10.10.71" }),
        hostname: { assignments: { [DISC1]: "persist-01" } },
        ssh: { keyIds: [key.id], newKeys: [{ name: "", publicKey: SSH_ED25519.publicKey, saveToLibrary: false }], user: "" },
      })
      expect(res.status).toBe(200)
      expect((await install(jsonReq("/x", "POST"), ID(DISC1))).status).toBe(200)
      const read = async () => ({
        host: await (await hostGET(jsonReq("/x", "GET"), ID(DISC1))).json(),
        config: await (await configGET(jsonReq("/x", "GET"), ID(DISC1))).json(),
        keys: await (await keysGET()).json(),
        hosts: (await (await hostsGET()).json()).hosts.length,
        job: getActiveJob(DISC1),
      })
      const before = await read()
      expect(before.host).toMatchObject({ hostname: "persist-01", mgmtIp: "10.10.10.71", status: "booting", osAssigned: "ubuntu-24.04" })
      expect(before.config).toMatchObject({ username: "ops", hasPassword: true, sshKeyIds: [key.id], extraKeys: [SSH_ED25519.publicKey] })
      expect(before.job).toMatchObject({ status: "booting" })
      const snap = dbSnapshot()
      closeDb()
      const after = await read()
      expect(after).toEqual(before)
      expect(dbSnapshot()).toBe(snap)
    } finally {
      closeDb()
      delete process.env.PXE_DB_PATH
      delete process.env.PXE_SEED
    }
  })

  it("tidak ada response /api/** yang memuat passwordHash/password_hash/token/token_hash/$6$", async () => {
    expect((await patch(DISC1, { ...creds, ...sshNew, os: { osImageId: "ubuntu-24.04", disk: "", partition: "lvm", timezone: "UTC", locale: "en_US.UTF-8" } })).status).toBe(200)
    const bodies: [string, Response][] = [
      ["install", await install(jsonReq("/x", "POST"), ID(DISC1))],
      ["hosts", await hostsGET()],
      ["host", await hostGET(jsonReq("/x", "GET"), ID(DISC1))],
      ["config", await configGET(jsonReq("/x", "GET"), ID(DISC1))],
      ["patch", await patch(DISC2, { ...creds, ...sshNew })],
      ["bulk", await bulkPOST(jsonReq("/api/hosts/bulk", "POST", { hostIds: [DISC1, DISC2], credentials: { mode: "random", username: "ops", length: 16, sudo: true, disableSshPassword: false } }))],
      ["bulk-install", await bulkInstall(jsonReq("/api/hosts/bulk/install", "POST", { hostIds: [DISC2] }))],
      ["keys", await keysGET()],
      ["images", await imagesGET()],
      ["settings", await settingsGET()],
      ["status", await statusGET()],
    ]
    for (const [name, r] of bodies) {
      const text = await r.text()
      expect(text, name).not.toMatch(FORBIDDEN)
    }
    expect(getActiveJob(DISC1)!.tokenHash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("AC-4.3 atomik (G3-2)", () => {
  it("dua PATCH paralel memberi IP statis yang sama ke dua host → tepat satu 200, satu 422", async () => {
    for (let round = 0; round < 5; round++) {
      const ip = `10.10.10.${80 + round}`
      const [a, b] = await Promise.all([patch(DISC1, staticNet({ [DISC1]: ip })), patch(DISC2, staticNet({ [DISC2]: ip }))])
      expect([a.status, b.status].sort()).toEqual([200, 422])
      const loser = a.status === 422 ? a : b
      expect(JSON.stringify(await loser.json())).toMatch(/Bentrok|sudah dipakai/)
      const owners = getDb().prepare("SELECT host_id FROM host_configs WHERE ip = ?").all(ip)
      expect(owners).toHaveLength(1)
    }
  })
  it("dua PATCH paralel hostname sama (beda huruf) → satu 200, satu 422", async () => {
    const [a, b] = await Promise.all([
      patch(DISC1, { hostname: { assignments: { [DISC1]: "dup-host" } } }),
      patch(DISC2, { hostname: { assignments: { [DISC2]: "dup-host" } } }),
    ])
    expect([a.status, b.status].sort()).toEqual([200, 422])
  })
  it("bulk dengan satu host invalid → tidak ada perubahan tersimpan untuk host mana pun", async () => {
    const before = dbSnapshot()
    const res = await bulkPOST(
      jsonReq("/api/hosts/bulk", "POST", {
        hostIds: [DISC1, DISC2, CTRL01],
        ...creds,
        ...staticNet({ [DISC1]: "10.10.10.90", [DISC2]: "10.10.10.91", [CTRL01]: "10.10.10.150" }), // .150 di range DHCP
        hostname: { assignments: { [DISC1]: "bulk-a", [DISC2]: "bulk-b", [CTRL01]: "ctrl-01" } },
      }),
    )
    expect(res.status).toBe(422)
    expect(dbSnapshot()).toBe(before)
  })
  it("constraint unik sebagai pertahanan kedua → 422 yang sama (bukan 500)", async () => {
    expect((await patch(DISC1, staticNet({ [DISC1]: "10.10.10.95" }))).status).toBe(200)
    // Bypass validasi: IP DISC1 tidak terlihat di mgmt_ip host → hanya constraint DB yang menolak.
    getDb().prepare("UPDATE hosts SET mgmt_ip = NULL WHERE id = ?").run(DISC1)
    const res = await patch(DISC2, staticNet({ [DISC2]: "10.10.10.95" }))
    expect(res.status).toBe(422)
    expect((await res.json()).errors).toEqual([{ section: "network", message: "IP sudah dipakai host lain" }])
  })
})
