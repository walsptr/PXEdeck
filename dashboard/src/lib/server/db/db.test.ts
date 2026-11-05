// M4 (migrasi dari mock-hosts.test.ts): DB SQLite `node:sqlite` (DEC-007) + seam resetDb (DEC-005).
// - AC-4.1 migrasi idempoten, constraint (MAC/IP statis/hostname case-insensitive/job aktif), cascade.
// - AC-4.4 (statis): tidak ada impor `mock-hosts` dan tidak ada route `__test__` di src/.
// - AC-2.3 (pengganti): seed demo 14 host, id = MAC tanpa ':', vendor = OUI; repo mengembalikan salinan.
// - AC-2.4 deleteHost (cascade). Reboot ke PXE kini 501 (DEC-012) → diuji di hosts-routes.test.ts.
// - defaultConfig + G-SEC-2/SR-2-1: seed/DB tidak membawa hash password maupun key `wals@wal`.
// Alasan test lama yang tidak lagi relevan (simulasi tahap & discovery mock dihapus, plan §1.1):
// lihat .agent/runs/m4/test-migration.md.
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import type { DatabaseSync } from "node:sqlite"

import { lookupVendor } from "@/lib/oui"
import { OS_IMAGES } from "@/lib/os-images"
import { tmpDir, withDb } from "@/test/db"

import { closeDb, getDb, isUniqueViolation, openDbAt, tx, uniqueViolationTarget } from "./index"
import { MIGRATIONS, runMigrations } from "./migrations"
import { resetDb } from "./reset"
import { configOrDefault, defaultConfig, peekConfig, saveConfig } from "./repos/configs"
import {
  deleteHost,
  getHost,
  getHostByMac,
  hostIdFromMac,
  insertHost,
  listHosts,
  setHostStatus,
  updateHost,
} from "./repos/hosts"
import {
  getActiveJob,
  getJob,
  getJobByTokenHash,
  insertJob,
  listJobsForHost,
  revokeFinishedTokens,
  supersedeActiveJobs,
  updateJob,
  type Job,
} from "./repos/jobs"
import { getImage, imageAvailability, imageHostCount, imageUsage, listImages } from "./repos/os-images"
import { hostKeyIds, insertKey, keyUsage, listKeys, setHostKeyIds } from "./repos/ssh-keys"
import { DEMO_HOSTS } from "./seed"

const SRC_ROOT = path.resolve(__dirname, "../../..")
const REPO_ROOT = path.resolve(SRC_ROOT, "../..")
const NODE01 = "525400101011"
const LEGACY01 = "3ca82a10447c"
const DISC1 = "b083fe5c19e2"
const T = "2026-11-05T10:00:00.000Z"

// M5: migrasi 2 menambah `job_events` (DEC-014, lihat .agent/runs/m5/test-migration.md).
const TABLES = ["schema_migrations", "meta", "settings", "hosts", "host_configs", "ssh_keys", "host_ssh_keys", "os_images", "jobs", "job_events"]

const DB_DIR = tmpDir("db")
withDb("demo")

function tables(db: DatabaseSync): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name)
}

function rawHost(db: DatabaseSync, id: string, mac: string, hostname: string | null = null) {
  db.prepare(
    `INSERT INTO hosts (id, mac, hostname, status, status_since, first_seen, last_seen)
     VALUES (?, ?, ?, 'discovered', ?, ?, ?)`,
  ).run(id, mac, hostname, T, T, T)
}

function rawConfig(db: DatabaseSync, hostId: string, mode: "dhcp" | "static", ip: string | null) {
  db.prepare("INSERT INTO host_configs (host_id, network_mode, ip) VALUES (?, ?, ?)").run(hostId, mode, ip)
}

function rawJob(db: DatabaseSync, id: string, hostId: string, status: string) {
  db.prepare(
    `INSERT INTO jobs (id, host_id, os_image_id, status, created_at, updated_at)
     VALUES (?, ?, 'ubuntu-24.04', ?, ?, ?)`,
  ).run(id, hostId, status, T, T)
}

function job(id: string, hostId: string, over: Partial<Job> = {}): Job {
  return {
    id,
    hostId,
    kind: "install",
    osImageId: "ubuntu-24.04",
    status: "booting",
    stages: [{ stage: "booting", at: T, source: "install" }],
    tokenHash: `hash-${id}`,
    tokenExpiresAt: "2026-11-05T16:00:00.000Z",
    bootServedAt: null,
    createdAt: T,
    updatedAt: T,
    finishedAt: null,
    // M5 (migrasi 2): kolom baru dengan default DB.
    failureReason: null,
    installerBoots: 0,
    eventSeq: 0,
    ...over,
  }
}

describe("AC-4.1 migrasi", () => {
  it("DB kosong → semua tabel + indeks unik dibuat; schema_migrations berisi versi 1", () => {
    const db = openDbAt(":memory:", "empty")
    expect(tables(db)).toEqual([...TABLES].sort())
    const idx = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name)
    expect(idx).toEqual(expect.arrayContaining(["hosts_hostname_uq", "host_configs_ip_uq", "jobs_active_uq", "host_ssh_keys_key", "jobs_host"]))
    expect(db.prepare("SELECT version, name FROM schema_migrations").all()).toEqual([
      { version: 1, name: "init" },
      { version: 2, name: "job-events" }, // M5 (DEC-014)
    ])
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 })
    db.close()
  })

  it("migrasi dua kali: tidak error, tidak ada versi baru, schema_migrations tidak berubah", () => {
    const db = openDbAt(":memory:", "empty")
    const before = JSON.stringify(db.prepare("SELECT * FROM schema_migrations").all())
    expect(runMigrations(db)).toEqual([])
    expect(runMigrations(db)).toEqual([])
    expect(JSON.stringify(db.prepare("SELECT * FROM schema_migrations").all())).toBe(before)
    db.close()
  })

  it("file DB dibuka ulang: migrasi tidak diulang, WAL aktif, seed tidak diterapkan dua kali", () => {
    const file = path.join(DB_DIR, "reopen", "pxe.db")
    const a = openDbAt(file, "demo")
    expect(existsSync(file)).toBe(true)
    expect(a.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" })
    const migs = JSON.stringify(a.prepare("SELECT * FROM schema_migrations").all())
    expect((a.prepare("SELECT count(*) AS n FROM hosts").get() as { n: number }).n).toBe(DEMO_HOSTS.length)
    a.prepare("DELETE FROM hosts WHERE id = ?").run(NODE01)
    a.close()
    const b = openDbAt(file, "demo")
    expect(JSON.stringify(b.prepare("SELECT * FROM schema_migrations").all())).toBe(migs)
    // Seed hanya sekali (flag meta.seeded): host yang dihapus tidak muncul lagi.
    expect((b.prepare("SELECT count(*) AS n FROM hosts").get() as { n: number }).n).toBe(DEMO_HOSTS.length - 1)
    expect(b.prepare("SELECT value FROM meta WHERE key = 'seeded'").get()).toEqual({ value: "demo" })
    b.close()
  })

  it("migrasi yang gagal di-rollback dan tidak tercatat", () => {
    const db = openDbAt(":memory:", "empty")
    // Versi 99 (versi 2 sudah dipakai migrasi M5 `job-events`).
    const bad = [...MIGRATIONS, { version: 99, name: "rusak", sql: "CREATE TABLE x (a INTEGER); INSERT INTO tidak_ada VALUES (1);" }]
    expect(() => runMigrations(db, bad)).toThrow()
    expect(tables(db)).not.toContain("x")
    expect((db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]).map((r) => r.version)).toEqual([1, 2])
    db.close()
  })

  describe("constraint", () => {
    let db: DatabaseSync
    beforeEach(() => {
      db = openDbAt(":memory:", "empty")
      rawHost(db, "aaaaaaaaaa01", "aa:aa:aa:aa:aa:01", "Node-A")
      rawHost(db, "aaaaaaaaaa02", "aa:aa:aa:aa:aa:02")
    })
    afterEach(() => db.close())

    it("MAC duplikat ditolak", () => {
      expect(() => rawHost(db, "aaaaaaaaaa03", "aa:aa:aa:aa:aa:01")).toThrow(/UNIQUE constraint failed: hosts\.mac/)
    })
    it("hostname duplikat beda huruf besar ditolak; NULL boleh berulang", () => {
      expect(() => rawHost(db, "aaaaaaaaaa03", "aa:aa:aa:aa:aa:03", "node-a")).toThrow(/UNIQUE constraint failed/)
      expect(() => rawHost(db, "aaaaaaaaaa04", "aa:aa:aa:aa:aa:04", null)).not.toThrow()
    })
    it("IP statis duplikat ditolak; DHCP (ip NULL) boleh banyak; static tanpa IP ditolak (CHECK)", () => {
      rawConfig(db, "aaaaaaaaaa01", "static", "10.99.0.21")
      expect(() => rawConfig(db, "aaaaaaaaaa02", "static", "10.99.0.21")).toThrow(/UNIQUE constraint failed: host_configs\.ip/)
      rawHost(db, "aaaaaaaaaa03", "aa:aa:aa:aa:aa:03")
      expect(() => rawConfig(db, "aaaaaaaaaa03", "static", null)).toThrow(/CHECK constraint failed/)
      rawConfig(db, "aaaaaaaaaa02", "dhcp", null)
      rawConfig(db, "aaaaaaaaaa03", "dhcp", null)
    })
    it("job aktif kedua untuk host yang sama ditolak; job final tidak menghalangi", () => {
      rawJob(db, "j1", "aaaaaaaaaa01", "booting")
      for (const st of ["booting", "installing", "configuring"])
        expect(() => rawJob(db, `j2-${st}`, "aaaaaaaaaa01", st), st).toThrow(/UNIQUE constraint failed: jobs\.host_id/)
      rawJob(db, "j3", "aaaaaaaaaa01", "done")
      rawJob(db, "j4", "aaaaaaaaaa01", "failed")
      rawJob(db, "j5", "aaaaaaaaaa02", "installing")
    })
    it("status/firmware/method di luar enum ditolak (CHECK), FK host job wajib ada", () => {
      expect(() =>
        db.prepare("INSERT INTO hosts (id, mac, status, status_since, first_seen, last_seen) VALUES ('aaaaaaaaaa09','aa:aa:aa:aa:aa:09','rebooting',?,?,?)").run(T, T, T),
      ).toThrow(/CHECK constraint failed/)
      expect(() => rawJob(db, "jx", "ffffffffffff", "booting")).toThrow(/FOREIGN KEY constraint failed/)
    })
    it("hapus host meng-cascade config, join key, dan job; key library tetap", () => {
      rawConfig(db, "aaaaaaaaaa01", "static", "10.99.0.21")
      db.prepare("INSERT INTO ssh_keys (id, name, type, public_key, fingerprint, created_at) VALUES ('k1','k','ssh-ed25519','x','SHA256:x',?)").run(T)
      db.prepare("INSERT INTO host_ssh_keys (host_id, key_id, position) VALUES ('aaaaaaaaaa01','k1',0)").run()
      rawJob(db, "j1", "aaaaaaaaaa01", "installing")
      rawJob(db, "j0", "aaaaaaaaaa01", "done")
      db.prepare("DELETE FROM hosts WHERE id = 'aaaaaaaaaa01'").run()
      const count = (t: string) => (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n
      expect(count("host_configs")).toBe(0)
      expect(count("host_ssh_keys")).toBe(0)
      expect(count("jobs")).toBe(0)
      expect(count("ssh_keys")).toBe(1)
      // IP statis yang dilepas boleh dipakai host lain.
      rawConfig(db, "aaaaaaaaaa02", "static", "10.99.0.21")
    })
  })
})

describe("getDb / tx / resetDb (seam DEC-005)", () => {
  it("Vitest tanpa PXE_DB_PATH → :memory:; PXE_DB_PATH baru → koneksi dibuka ulang", () => {
    const a = getDb()
    expect(getDb()).toBe(a)
    process.env.PXE_DB_PATH = path.join(DB_DIR, "switch.db")
    process.env.PXE_SEED = "empty"
    const b = getDb()
    expect(b === a).toBe(false)
    expect(() => a.prepare("SELECT 1")).toThrow(/not open/)
    expect(existsSync(path.join(DB_DIR, "switch.db"))).toBe(true)
    expect(listHosts()).toEqual([])
    closeDb()
    closeDb() // idempoten
  })

  it("tx: error → ROLLBACK; bertingkat ikut transaksi luar; fn async ditolak + rollback", () => {
    expect(() =>
      tx(() => {
        updateHost(NODE01, { hostname: "diubah" })
        throw new Error("gagal")
      }),
    ).toThrow("gagal")
    expect(getHost(NODE01)!.hostname).toBe("node01")

    expect(() =>
      tx(() => {
        tx(() => updateHost(NODE01, { hostname: "dalam" }))
        expect(getDb().isTransaction).toBe(true)
        throw new Error("luar gagal")
      }),
    ).toThrow("luar gagal")
    expect(getHost(NODE01)!.hostname).toBe("node01")

    const out = tx(() => tx(() => (updateHost(NODE01, { hostname: "ok" }), 42)))
    expect(out).toBe(42)
    expect(getHost(NODE01)!.hostname).toBe("ok")

    expect(() =>
      tx(() => {
        updateHost(NODE01, { hostname: "async" })
        return Promise.resolve(1)
      }),
    ).toThrow(/harus sinkron/)
    expect(getHost(NODE01)!.hostname).toBe("ok")
    expect(getDb().isTransaction).toBe(false)
  })

  it("isUniqueViolation / uniqueViolationTarget", () => {
    let err: unknown
    try {
      insertHost({ ...getHost(NODE01)!, id: "ffffffffffff", hostname: null })
    } catch (e) {
      err = e
    }
    expect(isUniqueViolation(err)).toBe(true)
    expect(uniqueViolationTarget(err)).toBe("hosts.mac")
    expect(isUniqueViolation(new Error("lain"))).toBe(false)
    expect(uniqueViolationTarget(new Error("lain"))).toBeNull()
    expect(uniqueViolationTarget("bukan error")).toBeNull()
  })

  it("resetDb: kosongkan semua tabel lalu seed; default = PXE_SEED", () => {
    insertKey({ id: "key-x", name: "x", type: "ssh-ed25519", publicKey: "ssh-ed25519 AAAA x", fingerprint: "SHA256:x", comment: "", createdAt: T })
    insertJob(job("j1", NODE01))
    resetDb("empty")
    expect(listHosts()).toEqual([])
    expect(listKeys()).toEqual([])
    expect(getJob("j1")).toBeNull()
    expect(listImages().map((i) => i.id)).toEqual(OS_IMAGES.map((i) => i.id).sort())
    process.env.PXE_SEED = "demo"
    resetDb()
    expect(listHosts()).toHaveLength(14)
    expect(getDb().prepare("SELECT value FROM meta WHERE key = 'seeded'").get()).toEqual({ value: "demo" })
  })
})

describe("AC-2.3 (M4) seed demo & repo hosts", () => {
  it("seed demo: 14 host, id = MAC tanpa ':', vendor = OUI, id unik", () => {
    const hosts = listHosts()
    expect(hosts).toHaveLength(14)
    for (const h of hosts) {
      expect(h.id).toBe(h.mac.replaceAll(":", ""))
      expect(h.id).toMatch(/^[0-9a-f]{12}$/)
      expect(h.vendor).toBe(lookupVendor(h.mac))
      expect(hostIdFromMac(h.mac)).toBe(h.id)
      expect(getHostByMac(h.mac)).toEqual(h)
    }
    expect(new Set(hosts.map((h) => h.id)).size).toBe(14)
    // Urutan stabil (MAC) dan status seed sesuai data M2.
    expect(hosts.map((h) => h.mac)).toEqual([...hosts.map((h) => h.mac)].sort())
    expect(getHost("0cc47a915e10")!.status).toBe("booting")
    expect(getHost(DISC1)).toMatchObject({ status: "discovered", hostname: null, firmware: "uefi" })
  })

  it("seed demo memakai id OS kanonik M4 dan OS image bawaan (5) ada di semua seed", () => {
    const ids = new Set(OS_IMAGES.map((i) => i.id))
    for (const h of listHosts()) {
      if (h.osInstalled) expect(ids.has(h.osInstalled), h.osInstalled).toBe(true)
      if (h.osAssigned) expect(ids.has(h.osAssigned), h.osAssigned).toBe(true)
    }
    expect(listImages()).toHaveLength(5)
    expect(getImage("windows-2022")).toMatchObject({ bootable: false, method: "unattend", builtin: true })
    expect(getImage("ubuntu-24.04")!.source).toEqual({ kernel: "ubuntu-24.04/casper/vmlinuz", initrd: "ubuntu-24.04/casper/initrd", repo: "ubuntu-24.04" })
    resetDb("empty")
    expect(listImages()).toHaveLength(5)
  })

  it("listHosts/getHost mengembalikan salinan (mutasi hasil tidak mengubah DB)", () => {
    const hosts = listHosts()
    hosts[0].hostname = "diubah"
    hosts[0].status = "failed"
    hosts.pop()
    const again = listHosts()
    expect(again).toHaveLength(14)
    expect(again[0].hostname).not.toBe("diubah")
    const one = getHost(again[0].id)!
    one.hostname = "x"
    expect(getHost(again[0].id)!.hostname).not.toBe("x")
  })

  it("updateHost / setHostStatus: kolom berubah; host tak dikenal → false; patch kosong = cek ada", () => {
    expect(updateHost(NODE01, { currentIp: "10.10.10.99", firmware: "bios" })).toBe(true)
    expect(getHost(NODE01)).toMatchObject({ currentIp: "10.10.10.99", firmware: "bios" })
    expect(updateHost("ffffffffffff", { currentIp: "10.10.10.99" })).toBe(false)
    expect(updateHost(NODE01, {})).toBe(true)
    expect(updateHost("ffffffffffff", {})).toBe(false)
    expect(setHostStatus(NODE01, "failed", T, { lastSeen: T })).toBe(true)
    expect(getHost(NODE01)).toMatchObject({ status: "failed", statusSince: T, lastSeen: T })
  })

  it("seed empty: tanpa host, key, maupun job", () => {
    resetDb("empty")
    expect(listHosts()).toEqual([])
    expect(listKeys()).toEqual([])
    expect(getDb().prepare("SELECT count(*) AS n FROM jobs").get()).toEqual({ n: 0 })
  })
})

describe("AC-2.4 (M4) deleteHost", () => {
  it("menghapus host + config + join key + job (token ikut hilang)", () => {
    const k = { id: "key-del", name: "k", type: "ssh-ed25519", publicKey: "ssh-ed25519 AAAA k", fingerprint: "SHA256:del", comment: "", createdAt: T }
    insertKey(k)
    tx(() => saveConfig(NODE01, { ...configOrDefault(getHost(NODE01)!), sshKeyIds: [k.id] }))
    insertJob(job("j-del", NODE01))
    expect(peekConfig(NODE01)).not.toBeNull()
    expect(keyUsage(k.id)).toBe(1)
    expect(deleteHost(NODE01)).toBe(true)
    expect(getHost(NODE01)).toBeNull()
    expect(peekConfig(NODE01)).toBeNull()
    expect(keyUsage(k.id)).toBe(0)
    expect(getJob("j-del")).toBeNull()
    expect(getJobByTokenHash("hash-j-del")).toBeNull()
    expect(listHosts()).toHaveLength(13)
  })

  it("id tak dikenal → false, tidak ada yang terhapus", () => {
    expect(deleteHost("000000000000")).toBe(false)
    expect(listHosts()).toHaveLength(14)
  })
})

describe("repo jobs & ssh-keys", () => {
  it("insert/get/update job; stages JSON; job aktif; token hash", () => {
    insertJob(job("j1", NODE01))
    expect(getActiveJob(NODE01)).toMatchObject({ id: "j1", status: "booting", stages: [{ stage: "booting", at: T, source: "install" }] })
    expect(getJobByTokenHash("hash-j1")!.id).toBe("j1")
    updateJob("j1", { status: "installing", stages: [...getJob("j1")!.stages, { stage: "installing", at: T, source: "x" }] }, "2026-11-05T10:01:00.000Z")
    expect(getJob("j1")).toMatchObject({ status: "installing", updatedAt: "2026-11-05T10:01:00.000Z" })
    expect(getJob("j1")!.stages).toHaveLength(2)
    expect(getJob("tidak-ada")).toBeNull()
    expect(getActiveJob(LEGACY01)).toBeNull()
  })

  it("supersedeActiveJobs: job aktif → failed, token dicabut, job final tidak berubah", () => {
    insertJob(job("old", NODE01, { status: "done", tokenHash: "hash-old-final", finishedAt: T }))
    insertJob(job("j1", NODE01))
    supersedeActiveJobs(NODE01, "2026-11-05T11:00:00.000Z")
    expect(getJob("j1")).toMatchObject({ status: "failed", tokenHash: null, tokenExpiresAt: null, finishedAt: "2026-11-05T11:00:00.000Z" })
    expect(getActiveJob(NODE01)).toBeNull()
    expect(getJob("old")!.tokenHash).toBe("hash-old-final")
    revokeFinishedTokens()
    expect(getJob("old")!.tokenHash).toBeNull()
    expect(listJobsForHost(NODE01).map((j) => j.id)).toEqual(["j1", "old"].sort())
  })

  it("setHostKeyIds menyimpan urutan dan menyatukan duplikat", () => {
    for (const id of ["key-b", "key-a"])
      insertKey({ id, name: id, type: "ssh-ed25519", publicKey: `ssh-ed25519 AAAA ${id}`, fingerprint: `SHA256:${id}`, comment: "", createdAt: T })
    setHostKeyIds(NODE01, ["key-b", "key-a", "key-b"])
    expect(hostKeyIds(NODE01)).toEqual(["key-b", "key-a"])
    expect(listKeys().map((k) => k.id)).toEqual(["key-a", "key-b"])
  })

  it("imageUsage menghitung host assigned, config, dan job aktif", () => {
    const base = imageUsage("ubuntu-24.04") // host demo dengan osAssigned ubuntu-24.04
    expect(base).toBe(DEMO_HOSTS.filter((h) => h.osAssigned === "ubuntu-24.04").length)
    insertJob(job("j1", LEGACY01))
    expect(imageUsage("ubuntu-24.04")).toBe(base + 1)
    expect(imageUsage("debian-12")).toBe(0)
  })

  it("imageUsage menghitung host unik = imageHostCount/usedBy (regresi BUG-M5-1)", () => {
    const CTRL03 = "1418774a2c03" // demo: osAssigned ubuntu-24.04
    const base = imageUsage("ubuntu-24.04")
    expect(base).toBe(imageHostCount("ubuntu-24.04"))
    // Host yang sama: os_assigned + config + job aktif untuk image yang sama → tetap dihitung 1×.
    const os = { osImageId: "ubuntu-24.04", disk: "/dev/sda", partition: "lvm", timezone: "UTC", locale: "en_US.UTF-8" } as const
    tx(() => saveConfig(CTRL03, { ...configOrDefault(getHost(CTRL03)!), os, updatedAt: T }))
    insertJob(job("j-dup", CTRL03))
    expect(imageUsage("ubuntu-24.04")).toBe(base)
    expect(imageUsage("ubuntu-24.04")).toBe(imageHostCount("ubuntu-24.04"))
    // Host lain hanya lewat config → +1.
    tx(() => saveConfig(LEGACY01, { ...configOrDefault(getHost(LEGACY01)!), os, updatedAt: T }))
    expect(imageUsage("ubuntu-24.04")).toBe(base + 1)
    expect(imageUsage("ubuntu-24.04")).toBe(imageHostCount("ubuntu-24.04"))
  })

  it("imageAvailability: non-bootable/Windows, file media hilang, tersedia", () => {
    const win = getImage("windows-2022")!
    expect(imageAvailability(win, "/media", () => true)).toEqual({ available: false, reason: expect.stringMatching(/Windows: hanya generator unattend\.xml/) })
    const ub = getImage("ubuntu-24.04")!
    expect(imageAvailability({ ...ub, method: "kickstart", bootable: false }, "/media", () => true).reason).toBe("Image tidak bootable via PXE")
    expect(imageAvailability(ub, "/media", (p) => p.endsWith("vmlinuz"))).toEqual({
      available: false,
      reason: "Media ubuntu-24.04 tidak tersedia (ubuntu-24.04/casper/initrd tidak ada)",
    })
    expect(imageAvailability({ ...ub, source: { ...ub.source, kernel: "" } }, "/media", () => true).reason).toMatch(/\(kernel tidak ada\)/)
    expect(imageAvailability(ub, "/media", () => true)).toEqual({ available: true, reason: null })
  })
})

describe("defaultConfig / peekConfig (CR-3-4, SR-2-1/CR-3-12)", () => {
  it("host terpasang: OS kanonik, network statis dari subnet management, TANPA user/hash/key", () => {
    const c = defaultConfig(getHost(NODE01)!)
    expect(c.os).toEqual({ osImageId: "ubuntu-24.04", disk: "", partition: "lvm", timezone: "Asia/Jakarta", locale: "en_US.UTF-8" })
    expect(c.username).toBeNull()
    expect(c.passwordHash).toBeNull()
    expect(c.sshKeyIds).toEqual([])
    expect(c.extraKeys).toEqual([])
    expect(c.network).toMatchObject({ mode: "static", ip: "10.10.10.11", prefix: 24, gateway: "10.10.10.1", dns: ["10.10.10.1"], iface: { by: "mac" } })
  })
  it("id OS lama dipetakan ke id kanonik", () => {
    const c = defaultConfig({ ...getHost(NODE01)!, osInstalled: "rocky-9.4" })
    expect(c.os!.osImageId).toBe("rocky-9")
  })
  it("host discovered: tanpa OS/credentials, network DHCP", () => {
    const c = defaultConfig(getHost(DISC1)!)
    expect(c.os).toBeNull()
    expect(c.username).toBeNull()
    expect(c.passwordHash).toBeNull()
    expect(c.sshKeyIds).toEqual([])
    expect(c.network).toEqual({ mode: "dhcp" })
  })
  it("mengikuti env PXE_MGMT_* (DEC-006)", () => {
    process.env.PXE_MGMT_CIDR = "10.99.0.0/24"
    process.env.PXE_MGMT_GATEWAY = "10.99.0.1"
    process.env.PXE_SERVER_IP = "10.99.0.2"
    process.env.PXE_DYNAMIC_RANGE = "10.99.0.100-10.99.0.200"
    const c = defaultConfig(getHost(NODE01)!)
    expect(c.network).toMatchObject({ gateway: "10.99.0.1", dns: ["10.99.0.1"] })
  })
  it("peekConfig/configOrDefault tidak menulis baris (CR-3-4); saveConfig menulis + join key", () => {
    expect(peekConfig(NODE01)).toBeNull()
    const d = configOrDefault(getHost(NODE01)!)
    expect(peekConfig(NODE01)).toBeNull()
    expect(getDb().prepare("SELECT count(*) AS n FROM host_configs").get()).toEqual({ n: 0 })
    tx(() => saveConfig(NODE01, { ...d, username: "ops", updatedAt: T }))
    expect(peekConfig(NODE01)).toMatchObject({ username: "ops", network: d.network, updatedAt: T })
    expect(configOrDefault(getHost(NODE01)!).username).toBe("ops")
  })
})

describe("G-SEC-2 / SR-2-1: tanpa hash password & key seed", () => {
  const LAB_HASH_SALT = "$6$pxelab$"

  it("DB demo tidak berisi hash password, key library, maupun key wals@wal", () => {
    const db = getDb()
    expect(db.prepare("SELECT count(*) AS n FROM host_configs").get()).toEqual({ n: 0 })
    expect(db.prepare("SELECT count(*) AS n FROM ssh_keys").get()).toEqual({ n: 0 })
    const dump = JSON.stringify(TABLES.map((t) => db.prepare(`SELECT * FROM ${t}`).all()))
    expect(dump).not.toContain("$6$")
    expect(dump).not.toContain("wals@wal")
  })

  it("source seed tidak memuat hash (lab maupun demo) atau key wals@wal", () => {
    const src = readFileSync(path.join(__dirname, "seed.ts"), "utf8")
    expect(src).not.toContain("$6$")
    // Komentar boleh menyebut `wals@wal` (alasan penghapusan); materi key tidak boleh ada.
    expect(src).not.toMatch(/ssh-(ed25519|rsa) AAAA|AAAAC3NzaC1lZDI1NTE5|AAAAB3NzaC1yc2E/)
    expect(src).not.toMatch(/crypt\s+"[^"]+"/i)
  })

  it("tidak ada hash lab $6$pxelab$ di kode produk src/ maupun configs/autoinstall (I-3-14)", () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = path.join(dir, f)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && readFileSync(p, "utf8").includes(LAB_HASH_SALT)) offenders.push(p)
      }
    }
    walk(SRC_ROOT)
    expect(offenders).toEqual([])
    const userData = readFileSync(path.join(REPO_ROOT, "configs/autoinstall/user-data"), "utf8")
    expect(userData).not.toContain(LAB_HASH_SALT)
    expect(userData).not.toMatch(/\$6\$[./0-9A-Za-z]{1,16}\$[./0-9A-Za-z]{86}/)
  })
})

describe("AC-4.4 (statis): tanpa mock-hosts dan tanpa route __test__", () => {
  it("tidak ada file/impor mock-hosts dan tidak ada direktori __test__ di src/", () => {
    const imports: string[] = []
    const testDirs: string[] = []
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = path.join(dir, f)
        if (statSync(p).isDirectory()) {
          if (/__test__/.test(f)) testDirs.push(p)
          walk(p)
        } else {
          expect(f, p).not.toMatch(/^mock-hosts\./)
          if (/\.(ts|tsx)$/.test(f) && /from\s+["'][^"']*mock-hosts["']/.test(readFileSync(p, "utf8"))) imports.push(p)
        }
      }
    }
    walk(SRC_ROOT)
    expect(imports).toEqual([])
    expect(testDirs).toEqual([])
    expect(existsSync(path.join(SRC_ROOT, "app/api/__test__"))).toBe(false)
  })
})
