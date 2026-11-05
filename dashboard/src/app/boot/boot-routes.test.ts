// M4-T10 integration route handler /boot/** (DB per test via resetDb, lease fixture, jam injeksi
// dengan fake Date): AC-4.8, 4.9, 4.11, 4.13–4.17, 4.23, 4.24, 4.25, 4.26 (+ AC-4.32 versi lokal).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import path from "node:path"

import { parse as parseYaml } from "yaml"

import { applyConfig } from "@/lib/server/config-service"
import { closeDb, getDb } from "@/lib/server/db"
import { peekConfig } from "@/lib/server/db/repos/configs"
import { getHost, updateHost } from "@/lib/server/db/repos/hosts"
import { getActiveJob, getJob, insertJob, listJobsForHost } from "@/lib/server/db/repos/jobs"
import { installHosts } from "@/lib/server/install-service"
import { clearLeaseCache } from "@/lib/server/leases"
import { hashToken } from "@/lib/server/tokens"
import { dbSnapshot, makeMediaRoot, tmpDir, withDb } from "@/test/db"
import { containsSecret, evalCallbackUrl } from "@/test/cmdline"
import { DUMMY_PASSWORD, SSH_ED25519 } from "@/test/fixtures"
import { getReq } from "@/test/route"

import { GET as hostsGET } from "../api/hosts/route"
import { DELETE as hostDELETE } from "../api/hosts/[id]/route"
import { GET as bootGET } from "./[name]/route"
import { GET as fileGET } from "./[name]/[token]/[file]/route"
import { POST as statusPOST } from "./[name]/[token]/status/route"

// `connection()` dari next/server di-stub (di luar request scope Next melempar error).
vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }))

const MEDIA = makeMediaRoot(tmpDir("boot-media"))
const LEASE_DIR = tmpDir("boot-leases")
const KVM_ENV = {
  PXE_MGMT_CIDR: "10.99.0.0/24",
  PXE_MGMT_GATEWAY: "10.99.0.1",
  PXE_MGMT_DNS: "10.99.0.2",
  PXE_SERVER_IP: "10.99.0.2",
  PXE_DHCP_RANGE: "10.99.0.100-10.99.0.200",
  PXE_BASE_URL: "http://10.99.0.2",
  PXE_MEDIA_ROOT: MEDIA,
  PXE_TRUST_PROXY: "1",
  // DEC-013 (M5): trust proxy tanpa file lease wajib flag dev eksplisit; test yang memerlukan
  // verifikasi lease menyetel fixture lease (`writeLeases`). Lihat .agent/runs/m5/test-migration.md.
  PXE_INSECURE_NO_LEASE_CHECK: "1",
  PXE_KERNEL_EXTRA_ARGS: "console=ttyS0,115200n8 console=tty0",
}
withDb("empty", KVM_ENV)

const MAC = "52:54:00:99:00:11"
const MAC_DASH = "52-54-00-99-00-11"
const ID = "525400990011"
const MAC2 = "52:54:00:99:00:12"
const ID2 = "525400990012"
const LEASE_IP = "10.99.0.150"
const STATIC_IP = "10.99.0.21"
const T0 = new Date("2026-11-05T10:00:00.000Z")
const TOKEN_IN_SCRIPT = /\/boot\/[0-9a-f:]{17}\/([A-Za-z0-9_-]{43})\//

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(T0)
  clearLeaseCache()
})
afterEach(() => {
  vi.useRealTimers()
})

// ---- helper ----
const p = <T extends object>(v: T) => ({ params: Promise.resolve(v) }) as never

function req(url: string, ip?: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  if (ip) headers.set("x-real-ip", ip)
  return new Request(`http://10.99.0.2${url}`, { ...init, headers })
}

async function boot(mac: string, ip: string | null = LEASE_IP, platform: string | null = "efi", extra = "") {
  const q = platform === null ? (extra ? `?${extra}` : "") : `?platform=${platform}${extra ? `&${extra}` : ""}`
  const res = await bootGET(req(`/boot/${mac}.ipxe${q}`, ip), p({ name: `${mac}.ipxe` }))
  return { res, body: await res.text() }
}

async function file(mac: string, token: string, name: string, ip: string | null = LEASE_IP) {
  const res = await fileGET(req(`/boot/${mac}/${token}/${name}`, ip), p({ name: mac, token, file: name }))
  return { res, body: await res.text() }
}

async function cb(mac: string, token: string, stage: string, ip: string | null = LEASE_IP, json = false) {
  const res = await statusPOST(
    req(`/boot/${mac}/${token}/status`, ip, {
      method: "POST",
      headers: { "content-type": json ? "application/json" : "application/x-www-form-urlencoded" },
      body: json ? JSON.stringify({ stage }) : `stage=${stage}`,
    }),
    p({ name: mac, token }),
  )
  return { res, body: await res.text() }
}

function writeLeases(lines: string[]) {
  const f = path.join(LEASE_DIR, "dnsmasq.leases")
  writeFileSync(f, lines.join("\n") + "\n")
  // mtime unik tiap tulis agar cache dibaca ulang.
  const t = Date.now() / 1000 + Math.random() * 1000
  utimesSync(f, t, t)
  process.env.PXE_DNSMASQ_LEASES = f
  clearLeaseCache()
  return f
}
const exp = () => Math.floor(Date.now() / 1000) + 3600

/** Host ditemukan + konfigurasi lengkap untuk install (OS, credentials, network, key, hostname). */
async function readyHost(mac = MAC, id = ID, osImageId = "ubuntu-24.04", ip = STATIC_IP, ipSrc = LEASE_IP) {
  await boot(mac, ipSrc)
  const r = await applyConfig([id], {
    os: { osImageId, disk: "", partition: "lvm", timezone: "UTC", locale: "en_US.UTF-8" },
    credentials: { mode: "same", username: "ops", password: DUMMY_PASSWORD, sudo: true, disableSshPassword: true },
    network: { mode: "static", prefix: 24, gateway: "10.99.0.1", dns: ["10.99.0.2"], vlan: null, iface: { by: "mac" }, assignments: { [id]: ip } },
    hostname: { assignments: { [id]: `m4-node${id.slice(-2)}` } },
    ssh: { keyIds: [], newKeys: [{ name: "", publicKey: SSH_ED25519.publicKey, saveToLibrary: false }], user: "" },
  })
  if (!r.ok) throw new Error(JSON.stringify(r.errors))
}

/** Install + layani script installer → token plaintext dari script. */
async function installAndBoot(mac = MAC, id = ID, osImageId = "ubuntu-24.04", ipSrc = LEASE_IP) {
  await readyHost(mac, id, osImageId, id === ID ? STATIC_IP : "10.99.0.22", ipSrc)
  expect(installHosts([id]).started).toEqual([id])
  const { body } = await boot(mac, ipSrc)
  const m = TOKEN_IN_SCRIPT.exec(body)
  expect(m, body).not.toBeNull()
  return { token: m![1], script: body }
}

const NOT_FOUND = "not found\n"

// ---------------------------------------------------------------------------
describe("AC-4.8 discovery GET /boot/{mac}.ipxe", () => {
  it("MAC dash/uppercase baru → host discovered, MAC normal, vendor QEMU, firmware uefi, current_ip, last_seen jam injeksi", async () => {
    const { res, body } = await boot(MAC_DASH.toUpperCase(), LEASE_IP, "efi")
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8")
    expect(res.headers.get("cache-control")).toBe("no-store")
    expect(body.startsWith("#!ipxe\n")).toBe(true)
    expect(getHost(ID)).toEqual({
      id: ID,
      mac: MAC,
      hostname: null,
      currentIp: LEASE_IP,
      mgmtIp: null,
      vendor: "QEMU/KVM",
      firmware: "uefi",
      osInstalled: null,
      osAssigned: null,
      status: "discovered",
      statusSince: T0.toISOString(),
      lastSeen: T0.toISOString(),
    })
  })
  it("panggilan kedua tidak menduplikasi, memperbarui last_seen/current_ip/firmware; status tetap", async () => {
    await boot(MAC)
    vi.setSystemTime(new Date(T0.getTime() + 90_000))
    await boot("525400990011", "10.99.0.151", "pcbios")
    expect(getDb().prepare("SELECT count(*) AS n FROM hosts").get()).toEqual({ n: 1 })
    expect(getHost(ID)).toMatchObject({ lastSeen: "2026-11-05T10:01:30.000Z", currentIp: "10.99.0.151", firmware: "bios", status: "discovered", statusSince: T0.toISOString() })
    // Tanpa platform/IP: firmware & current_ip lama dipertahankan.
    process.env.PXE_TRUST_PROXY = "0"
    await boot(MAC, null, null)
    expect(getHost(ID)).toMatchObject({ currentIp: "10.99.0.151", firmware: "bios" })
  })
  it("platform tak dikenal → firmware null untuk host baru; vendor kosong diisi ulang", async () => {
    await boot(MAC, LEASE_IP, "arm64")
    expect(getHost(ID)!.firmware).toBeNull()
    updateHost(ID, { vendor: null })
    await boot(MAC)
    expect(getHost(ID)!.vendor).toBe("QEMU/KVM")
  })
  it("MAC invalid → 400 tanpa host baru; nama lain → 404", async () => {
    for (const bad of ["52:54:00:99:00", "zz:54:00:99:00:11", "52:54:00:99:00:11:22", "52_54_00_99_00_11", "..%2Fetc"]) {
      const { res, body } = await boot(bad)
      expect(res.status, bad).toBe(400)
      expect(body).toBe("MAC tidak valid\n")
    }
    const other = await bootGET(req("/boot/grub.cfg"), p({ name: "grub.cfg" }))
    expect(other.status).toBe(404)
    expect(getDb().prepare("SELECT count(*) AS n FROM hosts").get()).toEqual({ n: 0 })
  })
})

describe("AC-4.9 verifikasi IP (lease fixture, PXE_TRUST_PROXY)", () => {
  it("IP sumber bukan IP lease MAC → boot lokal, host tidak dibuat; tanpa kernel/token", async () => {
    writeLeases([`${exp()} ${MAC} ${LEASE_IP} * *`])
    const before = dbSnapshot()
    const { res, body } = await boot(MAC, "10.99.0.1")
    expect(res.status).toBe(200)
    expect(body).toContain("sanboot --no-describe --drive 0x80")
    expect(body).not.toMatch(/\bkernel\b/)
    expect(body).not.toMatch(TOKEN_IN_SCRIPT)
    expect(dbSnapshot()).toBe(before)
    expect(getHost(ID)).toBeNull()
  })
  it("host yang sudah ada tidak diubah (current_ip, last_seen) dan tidak dilayani installer walau job aktif", async () => {
    await installAndBoot()
    writeLeases([`${exp()} ${MAC} ${LEASE_IP} * *`])
    vi.setSystemTime(new Date(T0.getTime() + 60_000))
    const before = dbSnapshot()
    const { body } = await boot(MAC, "10.99.0.1")
    expect(body).not.toMatch(/\bkernel\b/)
    expect(body).not.toMatch(TOKEN_IN_SCRIPT)
    expect(dbSnapshot()).toBe(before)
    expect(getHost(ID)!.currentIp).toBe(LEASE_IP)
  })
  it("IP lease (salah satu dari beberapa lease MAC) diterima", async () => {
    writeLeases([`${exp()} ${MAC} 10.99.0.140 * 01:aa`, `${exp()} ${MAC} ${LEASE_IP} * ff:bb`])
    await boot(MAC, LEASE_IP)
    expect(getHost(ID)!.currentIp).toBe(LEASE_IP)
  })
  it("PXE_TRUST_PROXY=0 → X-Real-IP diabaikan (IP tidak diketahui → tidak terverifikasi bila lease aktif)", async () => {
    process.env.PXE_TRUST_PROXY = "0"
    writeLeases([`${exp()} ${MAC} ${LEASE_IP} * *`])
    const { body } = await boot(MAC, LEASE_IP)
    expect(body).not.toMatch(/\bkernel\b/)
    expect(getHost(ID)).toBeNull()
    // Tanpa file lease (dev): host dibuat tetapi current_ip tidak diambil dari header.
    delete process.env.PXE_DNSMASQ_LEASES
    await boot(MAC, LEASE_IP)
    expect(getHost(ID)).toMatchObject({ currentIp: null, status: "discovered" })
  })
})

describe("AC-4.11 sinkron lease saat GET /api/hosts", () => {
  it("MAC baru di lease → host discovered + current_ip; host yang ada tidak berubah", async () => {
    await boot(MAC2, "10.99.0.160")
    updateHost(ID2, { status: "done" })
    const before = getHost(ID2)
    writeLeases([`${exp()} ${MAC} ${LEASE_IP} node11 *`, `${exp()} ${MAC2} 10.99.0.199 * *`, `${exp()} 52:54:00:99:00:13 10.99.0.170 * *`])
    vi.setSystemTime(new Date(T0.getTime() + 5_000))
    const res = await hostsGET(getReq("/api/hosts"))
    const hosts = (await res.json()).hosts as { mac: string; status: string; currentIp: string }[]
    expect(hosts.map((h) => h.mac)).toEqual([MAC, MAC2, "52:54:00:99:00:13"])
    expect(getHost(ID)).toMatchObject({ status: "discovered", currentIp: LEASE_IP, vendor: "QEMU/KVM", firmware: null, lastSeen: "2026-11-05T10:00:05.000Z" })
    expect(getHost(ID2)).toEqual(before)
    // Kedua kali: tidak ada duplikat.
    await hostsGET(getReq("/api/hosts"))
    expect(getDb().prepare("SELECT count(*) AS n FROM hosts").get()).toEqual({ n: 3 })
  })
  it("tanpa file lease / file kosong → tidak ada host baru", async () => {
    await hostsGET(getReq("/api/hosts"))
    writeLeases([])
    await hostsGET(getReq("/api/hosts"))
    expect(getDb().prepare("SELECT count(*) AS n FROM hosts").get()).toEqual({ n: 0 })
  })
})

describe("AC-4.13 GET /boot/entry.ipxe", () => {
  it("chain ke ${PXE_BASE_URL}/boot/${mac}.ipxe?platform=${platform} dengan retry terbatas", async () => {
    const res = await bootGET(req("/boot/entry.ipxe"), p({ name: "entry.ipxe" }))
    const body = await res.text()
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8")
    expect(body.startsWith("#!ipxe\n")).toBe(true)
    const chains = body.split("\n").filter((l) => l.startsWith("chain "))
    expect(chains).toHaveLength(3)
    for (const c of chains) expect(c).toMatch(/^chain --replace --autofree http:\/\/10\.99\.0\.2\/boot\/\$\{mac\}\.ipxe\?platform=\$\{platform\} \|\| goto (try\d|fail)$/)
    expect(body.trimEnd().endsWith("\nexit 1")).toBe(true)
    expect(getDb().prepare("SELECT count(*) AS n FROM hosts").get()).toEqual({ n: 0 })
  })
})

describe("AC-4.14 boot lokal & mode wait", () => {
  const isLocal = (b: string) => b.includes("iseq ${platform} efi && exit 1 ||") && b.includes("sanboot --no-describe --drive 0x80 || exit 1") && !/\bkernel\b/.test(b)
  it("host tanpa job dan berstatus discovered/done/failed/offline → boot lokal", async () => {
    expect(isLocal((await boot(MAC)).body)).toBe(true)
    for (const st of ["discovered", "done", "failed", "offline"] as const) {
      updateHost(ID, { status: st })
      expect(isLocal((await boot(MAC)).body), st).toBe(true)
    }
  })
  it("PXE_UNKNOWN_HOST_ACTION=wait + host tanpa OS → loop sleep terbatas; host ber-OS tetap lokal", async () => {
    process.env.PXE_UNKNOWN_HOST_ACTION = "wait"
    const w = (await boot(MAC)).body
    expect(w).toContain("sleep 30")
    // CR-4-5 (M5, AC-5.21): waitScript memakai `chain --replace --autofree`.
    expect(w).toContain(`chain --replace --autofree http://10.99.0.2/boot/${MAC}.ipxe?platform=\${platform}&wait=1 || exit 1`)
    expect((await boot(MAC, LEASE_IP, "efi", "wait=5")).body).toContain("&wait=6")
    expect(isLocal((await boot(MAC, LEASE_IP, "efi", "wait=20")).body)).toBe(true)
    // wait tidak valid → 0.
    for (const bad of ["-1", "abc", "1.5", "99999"]) expect((await boot(MAC, LEASE_IP, "efi", `wait=${bad}`)).body, bad).toContain("&wait=1")
    updateHost(ID, { osInstalled: "ubuntu-24.04", status: "done" })
    expect(isLocal((await boot(MAC)).body)).toBe(true)
  })
})

describe("AC-4.15 installer Ubuntu", () => {
  it("job aktif booting → script kernel NFS + nocloud; sha256(token) = jobs.token_hash; boot_served_at + stage booting", async () => {
    await readyHost()
    installHosts([ID])
    const job0 = getActiveJob(ID)!
    vi.setSystemTime(new Date(T0.getTime() + 30_000))
    const { res, body } = await boot(MAC)
    expect(res.status).toBe(200)
    const token = TOKEN_IN_SCRIPT.exec(body)![1]
    const lines = body.trimEnd().split("\n")
    expect(lines[0]).toBe("#!ipxe")
    expect(lines[1]).toBe(
      `kernel http://10.99.0.2/media/ubuntu-24.04/casper/vmlinuz initrd=initrd ip=dhcp netboot=nfs nfsroot=10.99.0.2:${MEDIA}/ubuntu-24.04 autoinstall ` +
        `ds=nocloud-net;s=http://10.99.0.2/boot/${MAC}/${token}/ cloud-config-url=/dev/null console=ttyS0,115200n8 console=tty0 ---`,
    )
    expect(lines[2]).toBe("initrd --name initrd http://10.99.0.2/media/ubuntu-24.04/casper/initrd")
    expect(lines[3]).toBe("boot")
    expect(lines[1].split(" ").filter((a) => a.startsWith("url="))).toEqual([])
    const job = getJob(job0.id)!
    expect(job.tokenHash).toBe(hashToken(token))
    expect(job.tokenHash).not.toBe(job0.tokenHash)
    expect(job.bootServedAt).toBe("2026-11-05T10:00:30.000Z")
    expect(job.tokenExpiresAt).toBe(new Date(T0.getTime() + 30_000 + 360 * 60_000).toISOString())
    expect(job.stages).toEqual([
      { stage: "booting", at: T0.toISOString(), source: "install" },
      { stage: "booting", at: "2026-11-05T10:00:30.000Z", source: "boot-script" },
    ])
    // Boot ulang (installer belum mengambil config) → token baru, token lama tidak berlaku.
    const again = TOKEN_IN_SCRIPT.exec((await boot(MAC)).body)![1]
    expect(again).not.toBe(token)
    expect((await file(MAC, token, "user-data")).res.status).toBe(404)
    expect((await file(MAC, again, "user-data")).res.status).toBe(200)
  })
})

describe("AC-4.16 installer Debian & Rocky; image tidak tersedia / Windows", () => {
  const redact = (s: string) => s.replace(TOKEN_IN_SCRIPT, "/boot/<mac>/<token>/").replace(MEDIA, "<media-root>")
  it("Debian (preseed) dan Rocky (kickstart) sesuai §2.3 (snapshot)", async () => {
    const deb = await installAndBoot(MAC, ID, "debian-12")
    expect(deb.script).toContain(`url=http://10.99.0.2/boot/${MAC}/${deb.token}/preseed.cfg`)
    expect(redact(deb.script)).toMatchInlineSnapshot(`
      "#!ipxe
      kernel http://10.99.0.2/media/debian-netboot/linux initrd=initrd auto=true priority=critical url=http://10.99.0.2/boot/<mac>/<token>/preseed.cfg interface=auto netcfg/dhcp_timeout=60 console=ttyS0,115200n8 console=tty0
      initrd --name initrd http://10.99.0.2/media/debian-netboot/initrd.gz
      boot
      "
    `)
    const rocky = await installAndBoot(MAC2, ID2, "rocky-9", "10.99.0.160")
    expect(rocky.script).toContain(`inst.ks=http://10.99.0.2/boot/${MAC2}/${rocky.token}/ks.cfg`)
    expect(redact(rocky.script)).toMatchInlineSnapshot(`
      "#!ipxe
      kernel http://10.99.0.2/media/rocky-9/images/pxeboot/vmlinuz initrd=initrd ip=dhcp inst.repo=http://10.99.0.2/media/rocky-9 inst.ks=http://10.99.0.2/boot/<mac>/<token>/ks.cfg inst.text console=ttyS0,115200n8 console=tty0
      initrd --name initrd http://10.99.0.2/media/rocky-9/images/pxeboot/initrd.img
      boot
      "
    `)
    expect((await file(MAC, deb.token, "preseed.cfg")).res.status).toBe(200)
    expect((await file(MAC2, rocky.token, "ks.cfg", "10.99.0.160")).res.status).toBe(200)
  })
  it("media hilang setelah job dibuat → boot lokal tanpa token; Windows (job langsung di DB) → boot lokal", async () => {
    await readyHost()
    installHosts([ID])
    rmSync(path.join(MEDIA, "ubuntu-24.04/casper/initrd"))
    try {
      const { body } = await boot(MAC)
      expect(body).not.toMatch(/\bkernel\b/)
      expect(body).not.toMatch(TOKEN_IN_SCRIPT)
    } finally {
      makeMediaRoot(MEDIA)
    }
    await boot(MAC2, "10.99.0.160")
    insertJob({ id: "job-win", hostId: ID2, kind: "install", osImageId: "windows-2022", status: "booting", stages: [], tokenHash: null, tokenExpiresAt: null, bootServedAt: null, createdAt: T0.toISOString(), updatedAt: T0.toISOString(), finishedAt: null })
    const { body } = await boot(MAC2, "10.99.0.160")
    expect(body).not.toMatch(/\bkernel\b/)
    expect(getJob("job-win")!.tokenHash).toBeNull()
  })
})

describe("AC-4.17 setelah configuring → boot lokal (tanpa reinstall)", () => {
  it("callback configuring → /boot/{mac}.ipxe lokal walau job belum done; token tidak diganti", async () => {
    const { token } = await installAndBoot()
    expect((await file(MAC, token, "user-data")).res.status).toBe(200)
    expect((await cb(MAC, token, "configuring")).res.status).toBe(200)
    const hash = getActiveJob(ID)!.tokenHash
    const { body } = await boot(MAC)
    expect(body).toContain("sanboot --no-describe --drive 0x80")
    expect(body).not.toMatch(/\bkernel\b/)
    expect(getActiveJob(ID)).toMatchObject({ status: "configuring", tokenHash: hash })
    // Callback done masih bisa (token belum dicabut).
    expect((await cb(MAC, token, "done", STATIC_IP)).res.status).toBe(200)
  })
})

describe("AC-4.23 GET /boot/{mac}/{token}/{file}", () => {
  it("200 bila semua syarat O2 terpenuhi; no-store; user-data pertama → installing; meta/vendor-data tidak mengubah status", async () => {
    const { token, script } = await installAndBoot()
    const meta = await file(MAC, token, "meta-data")
    expect(meta.res.status).toBe(200)
    expect(meta.res.headers.get("cache-control")).toBe("no-store")
    expect(meta.body).toContain("local-hostname: m4-node11")
    expect((await file(MAC, token, "vendor-data")).body).toBe("#cloud-config\n{}\n")
    expect(getHost(ID)!.status).toBe("booting")
    expect(getActiveJob(ID)!.status).toBe("booting")
    vi.setSystemTime(new Date(T0.getTime() + 60_000))
    const ud = await file(MAC_DASH, token, "user-data")
    expect(ud.res.status).toBe(200)
    expect(ud.res.headers.get("content-type")).toBe("text/plain; charset=utf-8")
    expect(ud.res.headers.get("cache-control")).toBe("no-store")
    expect(ud.body.startsWith("#cloud-config\n")).toBe(true)
    // B-5: token tidak ditulis di user-data (subiquity mencetak late-commands ke console); URL
    // callback diturunkan dari cmdline kernel script iPXE yang dilayani untuk job ini.
    expect(containsSecret(ud.body, token)).toBe(false)
    const kcmd = script.split("\n").find((l) => l.startsWith("kernel "))!.split(" ").slice(2).join(" ")
    const late = (parseYaml(ud.body) as { autoinstall: { "late-commands": string[] } }).autoinstall["late-commands"]
    // M5 (DEC-014 §4): late[0] = log "late-commands mulai", callback configuring di late[1].
    expect(evalCallbackUrl(late[1], kcmd)).toBe(`http://10.99.0.2/boot/${MAC}/${token}/status`)
    expect(ud.body).not.toContain(DUMMY_PASSWORD)
    expect(ud.body).toContain(peekConfig(ID)!.passwordHash!)
    expect(getHost(ID)).toMatchObject({ status: "installing", statusSince: "2026-11-05T10:01:00.000Z" })
    const job = getActiveJob(ID)!
    expect(job.status).toBe("installing")
    expect(job.stages.at(-1)).toEqual({ stage: "installing", at: "2026-11-05T10:01:00.000Z", source: "config-fetch" })
    // Fetch ulang saat installing tetap 200, tidak menambah stage.
    expect((await file(MAC, token, "user-data")).res.status).toBe(200)
    expect(getActiveJob(ID)!.stages).toHaveLength(job.stages.length)
    // IP = current_ip host (tanpa file lease) diterima; IP lease juga (lihat bawah).
  })

  it("setiap penolakan → 404 body identik", async () => {
    const { token } = await installAndBoot()
    const other = await installAndBoot(MAC2, ID2, "ubuntu-24.04", "10.99.0.160")
    const bodies: [string, Awaited<ReturnType<typeof file>>][] = []
    const deny = async (name: string, r: Promise<Awaited<ReturnType<typeof file>>>) => bodies.push([name, await r])
    await deny("token salah", file(MAC, "A".repeat(43), "user-data"))
    await deny("token bentuk salah", file(MAC, "pendek", "user-data"))
    await deny("token host lain (MAC path beda)", file(MAC, other.token, "user-data"))
    await deny("token host lain via IP host itu", file(MAC, other.token, "user-data", "10.99.0.160"))
    await deny("MAC invalid", file("zz", token, "user-data"))
    await deny("IP bukan lease/current_ip", file(MAC, token, "user-data", "10.99.0.1"))
    await deny("header IP hilang", file(MAC, token, "user-data", null))
    await deny("file tak dikenal", file(MAC, token, "passwd"))
    await deny("network-config", file(MAC, token, "network-config"))
    await deny("file OS lain (preseed.cfg)", file(MAC, token, "preseed.cfg"))
    await deny("file OS lain (ks.cfg)", file(MAC, token, "ks.cfg"))
    // IP lease: dengan lease file aktif, IP lease diterima, IP lain ditolak.
    writeLeases([`${exp()} ${MAC} 10.99.0.140 * *`])
    expect((await file(MAC, token, "meta-data", "10.99.0.140")).res.status).toBe(200)
    expect((await file(MAC, token, "meta-data", LEASE_IP)).res.status).toBe(200) // current_ip host
    await deny("IP lease MAC lain", file(MAC, token, "meta-data", "10.99.0.160"))
    // Semua penolakan di atas tanpa efek pada status host.
    expect(getHost(ID)!.status).toBe("booting")
    // Token expired (jam injeksi). M5 (DEC-014 §2): TTL ≥ jumlah timeout tahap, jadi pada titik ini
    // watchdog (sapuan lazy) sudah menandai job gagal `timeout-booting` dan mencabut token → 404.
    vi.setSystemTime(new Date(T0.getTime() + 361 * 60_000))
    await deny("token expired", file(MAC, token, "meta-data", LEASE_IP))
    for (const [name, r] of bodies) {
      expect(r.res.status, name).toBe(404)
      expect(r.body, name).toBe(NOT_FOUND)
      expect(r.res.headers.get("content-type"), name).toBe("text/plain; charset=utf-8")
      expect(r.res.headers.get("cache-control"), name).toBe("no-store")
    }
    expect(getHost(ID)!.status).toBe("failed")
    expect(listJobsForHost(ID)[0]).toMatchObject({ status: "failed", failureReason: "timeout-booting", tokenHash: null })
  })

  it("job configuring / done / failed → 404", async () => {
    for (const final of ["configuring", "done", "failed"] as const) {
      const { token } = await installAndBoot()
      expect((await file(MAC, token, "user-data")).res.status).toBe(200)
      const ip = final === "done" ? STATIC_IP : LEASE_IP
      if (final === "done") await cb(MAC, token, "configuring")
      expect((await cb(MAC, token, final, ip)).res.status, final).toBe(200)
      const r = await file(MAC, token, "meta-data")
      expect(r.res.status, final).toBe(404)
      expect(r.body).toBe(NOT_FOUND)
      // Siapkan iterasi berikut: host bisa di-install ulang (status final) atau reset.
      getDb().exec("DELETE FROM jobs")
      updateHost(ID, { status: "discovered" })
    }
  })

  it("config host terhapus setelah token terbit → 404 (bukan 500)", async () => {
    const { token } = await installAndBoot()
    getDb().prepare("DELETE FROM host_configs WHERE host_id = ?").run(ID)
    expect((await file(MAC, token, "user-data")).body).toBe(NOT_FOUND)
  })
})

describe("AC-4.24 siklus token", () => {
  it("token 43 char base64url; DB (file + WAL) hanya menyimpan hash; install ulang setelah failed mencabut token lama", async () => {
    const dir = tmpDir("tokdb")
    process.env.PXE_DB_PATH = path.join(dir, "pxe.db")
    try {
      const { token } = await installAndBoot()
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
      const raw = () =>
        readdirSync(dir)
          .map((f) => readFileSync(path.join(dir, f)).toString("latin1"))
          .join("")
      expect(raw()).toContain(hashToken(token))
      expect(raw()).not.toContain(token)
      const cols = getDb().prepare("SELECT * FROM jobs").all()
      expect(JSON.stringify(cols)).not.toContain(token)
      // failed → install ulang → token baru; URL lama 404.
      expect((await cb(MAC, token, "failed")).res.status).toBe(200)
      expect(getJob(listJobsForHost(ID)[0].id)!.tokenHash).toBeNull()
      expect(installHosts([ID]).started).toEqual([ID])
      const second = TOKEN_IN_SCRIPT.exec((await boot(MAC)).body)![1]
      expect(second).not.toBe(token)
      expect((await file(MAC, token, "user-data")).res.status).toBe(404)
      expect((await file(MAC, second, "user-data")).res.status).toBe(200)
      expect(listJobsForHost(ID)).toHaveLength(2)
      expect(raw()).not.toContain(second)
      closeDb()
    } finally {
      closeDb()
      delete process.env.PXE_DB_PATH
    }
  })

  it("done / hapus host mencabut token; log server (console) tidak memuat token", async () => {
    const logs: string[] = []
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) =>
      vi.spyOn(console, k).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" "))),
    )
    vi.stubEnv("VITEST", "") // aktifkan logBootDenied
    try {
      const { token } = await installAndBoot()
      await file(MAC, token, "user-data")
      await file(MAC, token, "user-data", "10.99.0.9") // ditolak → dicatat
      await cb(MAC, token, "configuring")
      await cb(MAC, token, "done", STATIC_IP)
      expect(getJob(listJobsForHost(ID)[0].id)).toMatchObject({ tokenHash: null, tokenExpiresAt: null })
      expect((await cb(MAC, token, "done", STATIC_IP)).res.status).toBe(404)
      const t2 = (await installAndBoot(MAC2, ID2, "ubuntu-24.04", "10.99.0.160")).token
      const del = await hostDELETE(new Request(`http://localhost/api/hosts/${ID2}`, { method: "DELETE" }), p({ id: ID2 }))
      expect(del.status).toBe(204)
      expect((await file(MAC2, t2, "user-data", "10.99.0.160")).res.status).toBe(404)
      expect(logs.some((l) => l.includes("[boot] tolak"))).toBe(true)
      for (const t of [token, t2]) expect(logs.join("\n")).not.toContain(t)
    } finally {
      vi.unstubAllEnvs()
      for (const s of spies) s.mockRestore()
    }
  })
})

describe("AC-4.25 install (service)", () => {
  it("job install booting + host booting + osAssigned; host sedang berjalan → gagal per host; tak dikenal", async () => {
    await readyHost()
    await readyHost(MAC2, ID2, "debian-12", "10.99.0.22", "10.99.0.160")
    const r = installHosts([ID, ID2, ID, "ffffffffffff"], new Date(T0.getTime() + 1000))
    expect(r.started).toEqual([ID, ID2])
    expect(r.failed).toEqual([{ hostId: "ffffffffffff", message: "Host tidak ditemukan" }])
    expect(getHost(ID)).toMatchObject({ status: "booting", osAssigned: "ubuntu-24.04", statusSince: "2026-11-05T10:00:01.000Z" })
    expect(getActiveJob(ID2)).toMatchObject({ kind: "install", status: "booting", osImageId: "debian-12", bootServedAt: null })
    const again = installHosts([ID])
    expect(again.started).toEqual([])
    expect(again.failed[0].message).toBe("m4-node11: instalasi sedang berjalan")
    expect(listJobsForHost(ID)).toHaveLength(1)
  })
  it("skema partisi custom / user SSH berbeda → ditolak dengan alasan", async () => {
    await readyHost()
    const cfg = peekConfig(ID)!
    getDb().prepare("UPDATE host_configs SET os_profile = ? WHERE host_id = ?").run(JSON.stringify({ ...cfg.os, partition: "custom", customStorage: "x" }), ID)
    expect(installHosts([ID]).failed[0].message).toMatch(/custom belum didukung/)
    getDb().prepare("UPDATE host_configs SET os_profile = ?, ssh_user = 'other' WHERE host_id = ?").run(JSON.stringify(cfg.os), ID)
    expect(installHosts([ID]).failed[0].message).toMatch(/user target SSH berbeda/)
    getDb().prepare("UPDATE host_configs SET os_profile = ? WHERE host_id = ?").run(JSON.stringify({ ...cfg.os, osImageId: "tidak-ada" }), ID)
    expect(installHosts([ID]).failed[0].message).toMatch(/OS image tidak-ada tidak dikenal/)
    expect(getActiveJob(ID)).toBeNull()
  })
})

describe("AC-4.26 callback POST /boot/{mac}/{token}/status", () => {
  it("transisi maju tercatat di jobs.stages + status_since; sama → 200 tanpa perubahan; mundur → 409; tak dikenal → 400", async () => {
    const { token } = await installAndBoot()
    vi.setSystemTime(new Date(T0.getTime() + 10_000))
    let r = await cb(MAC, token, "installing")
    expect(r.res.status).toBe(200)
    expect(r.body).toBe("ok\n")
    expect(getHost(ID)).toMatchObject({ status: "installing", statusSince: "2026-11-05T10:00:10.000Z" })
    const snap = dbSnapshot()
    vi.setSystemTime(new Date(T0.getTime() + 20_000))
    r = await cb(MAC, token, "installing", LEASE_IP, true)
    expect(r.res.status).toBe(200)
    expect(dbSnapshot()).toBe(snap)
    r = await cb(MAC, token, "configuring")
    expect(r.res.status).toBe(200)
    expect(getHost(ID)).toMatchObject({ status: "configuring", statusSince: "2026-11-05T10:00:20.000Z" })
    const before = dbSnapshot()
    r = await cb(MAC, token, "installing")
    expect(r.res.status).toBe(409)
    expect(r.body).toBe("conflict\n")
    for (const bad of ["booting", "rebooting", "", "DONE"]) {
      r = await cb(MAC, token, bad)
      expect(r.res.status, bad).toBe(400)
      expect(r.body).toBe("bad request\n")
    }
    expect(dbSnapshot()).toBe(before)
    expect(getActiveJob(ID)!.stages.map((s) => [s.stage, s.source])).toEqual([
      ["booting", "install"],
      ["booting", "boot-script"],
      ["installing", "callback"],
      ["configuring", "callback"],
    ])
  })
  it("done dari IP statis host → host done, osInstalled, osAssigned null, current_ip = IP sumber, job selesai, token dicabut", async () => {
    const { token } = await installAndBoot()
    await file(MAC, token, "user-data")
    await cb(MAC, token, "configuring")
    vi.setSystemTime(new Date(T0.getTime() + 600_000))
    const foreign = await cb(MAC, token, "done", "10.99.0.77")
    expect(foreign.res.status).toBe(404)
    expect(foreign.body).toBe(NOT_FOUND)
    const r = await cb(MAC, token, "done", STATIC_IP)
    expect(r.res.status).toBe(200)
    const at = "2026-11-05T10:10:00.000Z"
    expect(getHost(ID)).toMatchObject({ status: "done", osInstalled: "ubuntu-24.04", osAssigned: null, currentIp: STATIC_IP, statusSince: at, lastSeen: at })
    const job = listJobsForHost(ID)[0]
    expect(job).toMatchObject({ status: "done", finishedAt: at, tokenHash: null, tokenExpiresAt: null })
    expect(job.stages.at(-1)).toEqual({ stage: "done", at, source: "callback" })
    // Token dicabut: callback berikut 404; boot berikutnya lokal tanpa job baru.
    expect((await cb(MAC, token, "done", STATIC_IP)).res.status).toBe(404)
    expect((await boot(MAC, STATIC_IP)).body).toContain("sanboot")
    expect(listJobsForHost(ID)).toHaveLength(1)
    expect(getHost(ID)!.status).toBe("done")
  })
  it("failed dari mana pun → host failed + boot lokal; token dicabut", async () => {
    const { token } = await installAndBoot()
    const r = await cb(MAC, token, "failed")
    expect(r.res.status).toBe(200)
    expect(getHost(ID)!.status).toBe("failed")
    expect(listJobsForHost(ID)[0]).toMatchObject({ status: "failed", tokenHash: null })
    const { body } = await boot(MAC)
    expect(body).toContain("sanboot --no-describe --drive 0x80")
    expect(body).not.toMatch(/\bkernel\b/)
  })
  it("token salah/expired/MAC lain, body rusak/terlalu besar", async () => {
    const { token } = await installAndBoot()
    expect((await cb(MAC, "B".repeat(43), "installing")).res.status).toBe(404)
    expect((await cb(MAC2, token, "installing")).res.status).toBe(404)
    expect((await cb(MAC, token, "installing", null)).res.status).toBe(404)
    const big = await statusPOST(
      req(`/boot/${MAC}/${token}/status`, LEASE_IP, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `stage=done&x=${"a".repeat(2000)}` }),
      p({ name: MAC, token }),
    )
    expect(big.status).toBe(400)
    const badJson = await statusPOST(
      req(`/boot/${MAC}/${token}/status`, LEASE_IP, { method: "POST", headers: { "content-type": "application/json" }, body: "{" }),
      p({ name: MAC, token }),
    )
    expect(badJson.status).toBe(400)
    const numJson = await statusPOST(
      req(`/boot/${MAC}/${token}/status`, LEASE_IP, { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: '{"stage":3}' }),
      p({ name: MAC, token }),
    )
    expect(numJson.status).toBe(400)
    expect(getHost(ID)!.status).toBe("booting")
    vi.setSystemTime(new Date(T0.getTime() + 361 * 60_000))
    expect((await cb(MAC, token, "installing")).res.status).toBe(404)
  })
})

describe("AC-4.32 (lokal) negatif selama job aktif", () => {
  it("request dari 10.99.0.1 → script lokal tanpa token, current_ip tetap; token acak → 404", async () => {
    await installAndBoot()
    writeLeases([`${exp()} ${MAC} ${LEASE_IP} * *`])
    const { body } = await boot(MAC, "10.99.0.1")
    expect(body).not.toMatch(TOKEN_IN_SCRIPT)
    expect(body).not.toMatch(/\bkernel\b/)
    expect(getHost(ID)!.currentIp).toBe(LEASE_IP)
    const rnd = (await file(MAC, "x".repeat(43), "user-data")).res
    expect(rnd.status).toBe(404)
  })
})
