// Seed DB (DEC-005/DEC-007).
//  - OS image bawaan: selalu (seed apa pun).
//  - "demo": host contoh untuk dev/E2E (sama dengan data mock M2), TANPA
//    credentials maupun SSH key (SR-2-1/CR-3-12: tidak ada hash atau public
//    key `wals@wal` yang diwarisi; install host demo ditolak sampai
//    credentials diisi eksplisit).
//  - "empty": tanpa host/key/job.
import type { DatabaseSync } from "node:sqlite"

import { OS_IMAGES } from "@/lib/os-images"
import { lookupVendor } from "@/lib/oui"
import type { SeedName } from "@/lib/server/settings"
import type { Firmware, ProvisionStatus } from "@/lib/types"

export type OsImageSource = {
  /** Path kernel relatif terhadap PXE_MEDIA_ROOT / PXE_MEDIA_URL. */
  kernel: string
  initrd: string
  /** Direktori repo/root media (nfsroot Ubuntu, inst.repo Rocky, mirror Debian). */
  repo: string
}

export const BUILTIN_SOURCES: Record<string, { source: OsImageSource; bootable: boolean }> = {
  "ubuntu-24.04": {
    source: {
      kernel: "ubuntu-24.04/casper/vmlinuz",
      initrd: "ubuntu-24.04/casper/initrd",
      repo: "ubuntu-24.04",
    },
    bootable: true,
  },
  "ubuntu-22.04": {
    source: {
      kernel: "ubuntu-22.04/casper/vmlinuz",
      initrd: "ubuntu-22.04/casper/initrd",
      repo: "ubuntu-22.04",
    },
    bootable: true,
  },
  "debian-12": {
    source: {
      kernel: "debian-netboot/linux",
      initrd: "debian-netboot/initrd.gz",
      repo: "debian-12",
    },
    bootable: true,
  },
  "rocky-9": {
    source: {
      kernel: "rocky-9/images/pxeboot/vmlinuz",
      initrd: "rocky-9/images/pxeboot/initrd.img",
      repo: "rocky-9",
    },
    bootable: true,
  },
  "windows-2022": {
    source: { kernel: "", initrd: "", repo: "windows-2022" },
    bootable: false,
  },
}

export function seedOsImages(db: DatabaseSync, now = new Date().toISOString()) {
  const ins = db.prepare(`INSERT OR IGNORE INTO os_images
    (id, name, version, arch, method, source, bootable, offline, builtin, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`)
  for (const img of OS_IMAGES) {
    const b = BUILTIN_SOURCES[img.id]
    ins.run(
      img.id,
      img.name,
      img.version,
      img.arch,
      img.method,
      JSON.stringify(b.source),
      b.bootable ? 1 : 0,
      now,
    )
  }
}

type DemoHost = {
  mac: string
  hostname?: string
  currentIp?: string
  mgmtIp?: string
  firmware?: Firmware
  osInstalled?: string
  osAssigned?: string
  status: ProvisionStatus
  seenAgo: number
  sinceAgo?: number
}

/** Host demo (MAC & status sama dengan seed mock M2; id OS kanonik M4). */
export const DEMO_HOSTS: DemoHost[] = [
  { mac: "52:54:00:10:10:11", hostname: "node01", currentIp: "10.10.10.11", mgmtIp: "10.10.10.11", firmware: "uefi", osInstalled: "ubuntu-24.04", status: "done", seenAgo: 0.5, sinceAgo: 60 * 26 },
  { mac: "14:18:77:4a:2c:01", hostname: "ctrl-01", currentIp: "10.10.10.21", mgmtIp: "10.10.10.21", firmware: "uefi", osInstalled: "ubuntu-24.04", status: "done", seenAgo: 1, sinceAgo: 60 * 50 },
  { mac: "14:18:77:4a:2c:02", hostname: "ctrl-02", currentIp: "10.10.10.22", mgmtIp: "10.10.10.22", firmware: "uefi", osInstalled: "ubuntu-24.04", status: "done", seenAgo: 1.5, sinceAgo: 60 * 49 },
  { mac: "14:18:77:4a:2c:03", hostname: "ctrl-03", currentIp: "10.10.10.23", mgmtIp: "10.10.10.23", firmware: "uefi", osAssigned: "ubuntu-24.04", status: "installing", seenAgo: 0.2, sinceAgo: 0.3 },
  { mac: "0c:c4:7a:91:5e:10", hostname: "compute-01", currentIp: "10.10.10.31", mgmtIp: "10.10.10.31", firmware: "uefi", osAssigned: "ubuntu-24.04", status: "booting", seenAgo: 0.1, sinceAgo: 0.1 },
  { mac: "0c:c4:7a:91:5e:11", hostname: "compute-02", currentIp: "10.10.10.32", mgmtIp: "10.10.10.32", firmware: "uefi", osAssigned: "ubuntu-24.04", status: "configuring", seenAgo: 0.1, sinceAgo: 0.1 },
  { mac: "ac:1f:6b:22:7d:40", hostname: "compute-03", currentIp: "10.10.10.33", mgmtIp: "10.10.10.33", firmware: "uefi", osAssigned: "ubuntu-24.04", status: "failed", seenAgo: 7, sinceAgo: 8 },
  { mac: "94:40:c9:6e:01:aa", hostname: "storage-01", currentIp: "10.10.10.41", mgmtIp: "10.10.10.41", firmware: "uefi", osInstalled: "rocky-9", status: "done", seenAgo: 2, sinceAgo: 60 * 30 },
  { mac: "94:40:c9:6e:01:ab", hostname: "storage-02", mgmtIp: "10.10.10.42", firmware: "uefi", osInstalled: "rocky-9", status: "offline", seenAgo: 60 * 5 },
  { mac: "3c:a8:2a:10:44:7c", hostname: "legacy-01", currentIp: "10.10.10.51", mgmtIp: "10.10.10.51", firmware: "bios", osInstalled: "debian-12", status: "done", seenAgo: 3, sinceAgo: 60 * 72 },
  { mac: "b0:83:fe:5c:19:e2", currentIp: "10.10.10.143", firmware: "uefi", status: "discovered", seenAgo: 0.8 },
  { mac: "b0:83:fe:5c:19:e3", currentIp: "10.10.10.144", firmware: "uefi", status: "discovered", seenAgo: 1.2 },
  { mac: "a0:36:9f:0b:72:5d", currentIp: "10.10.10.157", firmware: "bios", status: "discovered", seenAgo: 4 },
  { mac: "00:50:56:b2:3e:91", hostname: "win-jump", currentIp: "10.10.10.61", mgmtIp: "10.10.10.61", firmware: "uefi", osInstalled: "windows-2022", status: "done", seenAgo: 12, sinceAgo: 60 * 24 * 3 },
]

const MIN = 60_000

export function seedDemoHosts(db: DatabaseSync, nowMs = Date.now()) {
  const ins = db.prepare(`INSERT INTO hosts
    (id, mac, hostname, current_ip, mgmt_ip, vendor, firmware, os_installed,
     os_assigned, status, status_since, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  for (const h of DEMO_HOSTS) {
    const seen = new Date(nowMs - h.seenAgo * MIN).toISOString()
    ins.run(
      h.mac.replaceAll(":", ""),
      h.mac,
      h.hostname ?? null,
      h.currentIp ?? null,
      h.mgmtIp ?? null,
      lookupVendor(h.mac),
      h.firmware ?? null,
      h.osInstalled ?? null,
      h.osAssigned ?? null,
      h.status,
      new Date(nowMs - (h.sinceAgo ?? h.seenAgo) * MIN).toISOString(),
      seen,
      seen,
    )
  }
}

/** Terapkan seed ke DB yang baru dimigrasi/dikosongkan. */
export function applySeed(db: DatabaseSync, seed: SeedName) {
  seedOsImages(db)
  if (seed === "demo") seedDemoHosts(db)
}
