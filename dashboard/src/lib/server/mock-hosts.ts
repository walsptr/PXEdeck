// Store host in-memory untuk tahap 2 (data mock). Tahap 4 diganti dengan
// database + parser lease dnsmasq. Simulasi kecil supaya polling terlihat hidup:
//  - host yang sedang provisioning maju ke tahap berikutnya seiring waktu
//  - host baru "melakukan PXE boot" berkala (sampai batas tertentu)
import type { HostConfig, SshKey } from "@/lib/host-config"
import { MGMT_NETWORK, parseCidr } from "@/lib/net"
import { lookupVendor } from "@/lib/oui"
import type { Firmware, Host, ProvisionStatus } from "@/lib/types"

const SEC = 1000
const MIN = 60 * SEC

/** Durasi simulasi tiap tahap sebelum maju ke tahap berikutnya. */
const STAGE_DURATION: Partial<Record<ProvisionStatus, number>> = {
  booting: 20 * SEC,
  installing: 60 * SEC,
  configuring: 20 * SEC,
}
const NEXT_STAGE: Partial<Record<ProvisionStatus, ProvisionStatus>> = {
  booting: "installing",
  installing: "configuring",
  configuring: "done",
}

const LEASE_RENEW = 3 * MIN
const DISCOVER_EVERY = 40 * SEC
const DISCOVER_MAX = 4

type Seed = {
  mac: string
  hostname?: string
  currentIp?: string
  mgmtIp?: string
  firmware?: Firmware
  osInstalled?: string
  osAssigned?: string
  status: ProvisionStatus
  /** Menit sejak terakhir terlihat. */
  seenAgo: number
  /** Menit sejak status berubah. */
  sinceAgo?: number
}

const SEED: Seed[] = [
  // Node uji yang benar-benar sudah di-install (README §9).
  {
    mac: "52:54:00:10:10:11",
    hostname: "node01",
    currentIp: "10.10.10.11",
    mgmtIp: "10.10.10.11",
    firmware: "uefi",
    osInstalled: "ubuntu-24.04.5",
    status: "done",
    seenAgo: 0.5,
    sinceAgo: 60 * 26,
  },
  {
    mac: "14:18:77:4a:2c:01",
    hostname: "ctrl-01",
    currentIp: "10.10.10.21",
    mgmtIp: "10.10.10.21",
    firmware: "uefi",
    osInstalled: "ubuntu-24.04.5",
    status: "done",
    seenAgo: 1,
    sinceAgo: 60 * 50,
  },
  {
    mac: "14:18:77:4a:2c:02",
    hostname: "ctrl-02",
    currentIp: "10.10.10.22",
    mgmtIp: "10.10.10.22",
    firmware: "uefi",
    osInstalled: "ubuntu-24.04.5",
    status: "done",
    seenAgo: 1.5,
    sinceAgo: 60 * 49,
  },
  {
    mac: "14:18:77:4a:2c:03",
    hostname: "ctrl-03",
    currentIp: "10.10.10.23",
    mgmtIp: "10.10.10.23",
    firmware: "uefi",
    osAssigned: "ubuntu-24.04.5",
    status: "installing",
    seenAgo: 0.2,
    sinceAgo: 0.3,
  },
  {
    mac: "0c:c4:7a:91:5e:10",
    hostname: "compute-01",
    currentIp: "10.10.10.31",
    mgmtIp: "10.10.10.31",
    firmware: "uefi",
    osAssigned: "ubuntu-24.04.5",
    status: "booting",
    seenAgo: 0.1,
    sinceAgo: 0.1,
  },
  {
    mac: "0c:c4:7a:91:5e:11",
    hostname: "compute-02",
    currentIp: "10.10.10.32",
    mgmtIp: "10.10.10.32",
    firmware: "uefi",
    osAssigned: "ubuntu-24.04.5",
    status: "configuring",
    seenAgo: 0.1,
    sinceAgo: 0.1,
  },
  {
    mac: "ac:1f:6b:22:7d:40",
    hostname: "compute-03",
    currentIp: "10.10.10.33",
    mgmtIp: "10.10.10.33",
    firmware: "uefi",
    osAssigned: "ubuntu-24.04.5",
    status: "failed",
    seenAgo: 7,
    sinceAgo: 8,
  },
  {
    mac: "94:40:c9:6e:01:aa",
    hostname: "storage-01",
    currentIp: "10.10.10.41",
    mgmtIp: "10.10.10.41",
    firmware: "uefi",
    osInstalled: "rocky-9.4",
    status: "done",
    seenAgo: 2,
    sinceAgo: 60 * 30,
  },
  {
    mac: "94:40:c9:6e:01:ab",
    hostname: "storage-02",
    mgmtIp: "10.10.10.42",
    firmware: "uefi",
    osInstalled: "rocky-9.4",
    status: "offline",
    seenAgo: 60 * 5,
  },
  {
    mac: "3c:a8:2a:10:44:7c",
    hostname: "legacy-01",
    currentIp: "10.10.10.51",
    mgmtIp: "10.10.10.51",
    firmware: "bios",
    osInstalled: "debian-12",
    status: "done",
    seenAgo: 3,
    sinceAgo: 60 * 72,
  },
  {
    mac: "b0:83:fe:5c:19:e2",
    currentIp: "10.10.10.143",
    firmware: "uefi",
    status: "discovered",
    seenAgo: 0.8,
  },
  {
    mac: "b0:83:fe:5c:19:e3",
    currentIp: "10.10.10.144",
    firmware: "uefi",
    status: "discovered",
    seenAgo: 1.2,
  },
  {
    mac: "a0:36:9f:0b:72:5d",
    currentIp: "10.10.10.157",
    firmware: "bios",
    status: "discovered",
    seenAgo: 4,
  },
  {
    mac: "00:50:56:b2:3e:91",
    hostname: "win-jump",
    currentIp: "10.10.10.61",
    mgmtIp: "10.10.10.61",
    firmware: "uefi",
    osInstalled: "windows-2022",
    status: "done",
    seenAgo: 12,
    sinceAgo: 60 * 24 * 3,
  },
]

/** MAC yang "muncul" berkala untuk mendemokan discovery otomatis. */
const DISCOVER_POOL = [
  "f8:bc:12:3a:00:61",
  "f8:bc:12:3a:00:62",
  "0c:c4:7a:91:5e:12",
  "98:03:9b:44:1c:07",
]

export type Store = {
  hosts: Map<string, Host>
  startedAt: number
  discovered: number
  configs: Map<string, HostConfig>
  sshKeys: Map<string, SshKey>
}

// Key admin workstation yang dipakai configs/autoinstall/user-data.
const ADMIN_KEY: SshKey = {
  id: "key-admin-wals",
  name: "Admin workstation",
  type: "ssh-rsa",
  publicKey:
    "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDN3rlfsi1FiKjSGlnBCcDks6VDPwSHn7a+TRpDNSySTNTHglgxx+skVxFnnZLqGcLZXVs/bk7nHyTOJnk7hPLfekonynnWNiF1M10ei8pvrVROIxL/rMJ+5rS3Kt6upjG5NDZ5ImTccudR1csMnB2VoScsX3xfFOBYT/s+nW2J4Kxs9yAsoKyCP0VakhNsMQSNYx1y+BJwW1ByojIPKtLgxoaAJwhGBZLdfMbez2ZkSuAwFzm58pSoBPHF/9o6RObsjFnhTYhjJi/92zawv99/sPnQfR+F7rA1MQhIaAaMiy1AoCKIR8k9AWL50kkmNJwZrj+ylvpkWCLxfEwJN9jGxUW2pgFO8YW2xm8dkCSD6mkTV9Pu6J76E0AIIWAsl3lfpq1SxpV19uj2uQBDjsVtfIz7pZTg9yC3S9WC/TIKC7//t/8oBGSsPhn880KpEkKCMVYuGImmLS105XIUiWe4Aman4IfnBMjMbhKO02LuPJgxiVxWHzqyEzSgoUUNa40= wals@wal",
  fingerprint: "SHA256:AqJ29VcE4jU7CEjFJVHo3nvu1EGE5EXwVAPnqIAwTmc",
  comment: "wals@wal",
  createdAt: "2026-11-04T03:00:00.000Z",
}

// Hash SHA-512 crypt "ubuntu" dari user-data lab (README §7).
const LAB_PASSWORD_HASH =
  "$6$pxelab$EzRdg/3FWt3YwSUFK8NZ5TXl/GP93OzXhv47DpBlRfQUclTe83eSkgjhetCGkJq9rvLGisqfUKTvGlTxXWMbp/"

export function defaultConfig(h: Host): HostConfig {
  const installed = Boolean(h.osInstalled)
  return {
    os:
      h.osInstalled || h.osAssigned
        ? {
            osImageId: (h.osAssigned ?? h.osInstalled)!,
            disk: "",
            partition: "lvm",
            timezone: "Asia/Jakarta",
            locale: "en_US.UTF-8",
          }
        : null,
    username: installed || h.osAssigned ? "ubuntu" : null,
    passwordHash: installed || h.osAssigned ? LAB_PASSWORD_HASH : null,
    sudo: true,
    disableSshPassword: false,
    network: h.mgmtIp
      ? {
          mode: "static",
          ip: h.mgmtIp,
          prefix: parseCidr(MGMT_NETWORK.cidr).prefix,
          gateway: MGMT_NETWORK.gateway,
          dns: [...MGMT_NETWORK.dns],
          vlan: null,
          iface: { by: "mac" },
        }
      : { mode: "dhcp" },
    sshKeyIds: installed || h.osAssigned ? [ADMIN_KEY.id] : [],
    extraKeys: [],
    sshUser: null,
    updatedAt: null,
  }
}

function hostId(mac: string) {
  return mac.replaceAll(":", "")
}

function fromSeed(s: Seed, now: number): Host {
  return {
    id: hostId(s.mac),
    mac: s.mac,
    hostname: s.hostname ?? null,
    currentIp: s.currentIp ?? null,
    mgmtIp: s.mgmtIp ?? null,
    vendor: lookupVendor(s.mac),
    firmware: s.firmware ?? null,
    osInstalled: s.osInstalled ?? null,
    osAssigned: s.osAssigned ?? null,
    status: s.status,
    statusSince: new Date(now - (s.sinceAgo ?? s.seenAgo) * MIN).toISOString(),
    lastSeen: new Date(now - s.seenAgo * MIN).toISOString(),
  }
}

// Disimpan di globalThis agar tidak hilang saat hot reload di dev.
const g = globalThis as typeof globalThis & { __pxeMockStore?: Store }

function store(): Store {
  if (!g.__pxeMockStore) {
    const now = Date.now()
    g.__pxeMockStore = {
      hosts: new Map(SEED.map((s) => [hostId(s.mac), fromSeed(s, now)])),
      startedAt: now,
      discovered: 0,
      configs: new Map(),
      sshKeys: new Map(),
    }
  }
  const s = g.__pxeMockStore
  // Field yang ditambahkan belakangan (store lama bertahan lewat hot reload).
  s.configs ??= new Map()
  s.sshKeys ??= new Map()
  if (s.sshKeys.size === 0) s.sshKeys.set(ADMIN_KEY.id, { ...ADMIN_KEY })
  return s
}

/** Akses store untuk service lain (config, SSH key). Menjalankan simulasi dulu. */
export function mockDb(): Store {
  const s = store()
  tick(s, Date.now())
  return s
}

export function getConfig(s: Store, h: Host): HostConfig {
  let c = s.configs.get(h.id)
  if (!c) {
    c = defaultConfig(h)
    s.configs.set(h.id, c)
  }
  return c
}

/** Mock install: host memakai OS dari konfigurasinya dan mulai dari tahap booting. */
export function startInstall(s: Store, h: Host, osImageId: string) {
  const now = new Date().toISOString()
  h.osAssigned = osImageId
  h.status = "booting"
  h.statusSince = now
  h.lastSeen = now
}

function tick(s: Store, now: number) {
  for (const h of s.hosts.values()) {
    const dur = STAGE_DURATION[h.status]
    const next = NEXT_STAGE[h.status]
    if (dur && next && now - Date.parse(h.statusSince) >= dur) {
      h.status = next
      h.statusSince = new Date(now).toISOString()
      if (next === "done") {
        h.osInstalled = h.osAssigned
        h.osAssigned = null
        // Setelah install, host boot dari disk dengan IP management.
        h.currentIp = h.mgmtIp ?? h.currentIp
      }
    }
    if (dur) {
      h.lastSeen = new Date(now).toISOString()
    } else if (
      h.status !== "offline" &&
      h.status !== "failed" &&
      now - Date.parse(h.lastSeen) > LEASE_RENEW
    ) {
      // Host online memperbarui lease DHCP secara berkala.
      h.lastSeen = new Date(now - Math.random() * 30 * SEC).toISOString()
    }
  }

  const due = Math.floor((now - s.startedAt) / DISCOVER_EVERY)
  while (s.discovered < Math.min(due, DISCOVER_MAX)) {
    const mac = DISCOVER_POOL[s.discovered]
    s.discovered++
    if (s.hosts.has(hostId(mac))) continue
    const ip = `10.10.10.${170 + s.discovered}`
    s.hosts.set(
      hostId(mac),
      fromSeed(
        {
          mac,
          currentIp: ip,
          firmware: "uefi",
          status: "discovered",
          seenAgo: 0,
        },
        now,
      ),
    )
  }
}

export function listHosts(): Host[] {
  const s = store()
  tick(s, Date.now())
  return [...s.hosts.values()].map((h) => ({ ...h }))
}

export function getHost(id: string): Host | null {
  const s = store()
  tick(s, Date.now())
  const h = s.hosts.get(id)
  return h ? { ...h } : null
}

export function deleteHost(id: string): boolean {
  const s = store()
  s.configs.delete(id)
  return s.hosts.delete(id)
}

/** Mock "Reboot ke PXE": host yang punya OS tugasan mulai dari tahap booting. */
export function rebootToPxe(id: string): Host | null {
  const s = store()
  const h = s.hosts.get(id)
  if (!h) return null
  const now = new Date().toISOString()
  h.status = h.osAssigned ? "booting" : "discovered"
  h.statusSince = now
  h.lastSeen = now
  return { ...h }
}
