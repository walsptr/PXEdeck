// Repo `os_images`. `available` dihitung saat runtime: image bootable dan file
// kernel + initrd ada di PXE_MEDIA_ROOT.
import { existsSync } from "node:fs"
import path from "node:path"

import { getDb } from "../index"
import type { OsImageSource } from "../seed"

import type { InstallMethod, OsImage } from "@/lib/os-images"

export type OsImageRecord = OsImage & {
  source: OsImageSource
  bootable: boolean
  offline: boolean
  builtin: boolean
  createdAt: string
}

/** Bentuk `GET /api/os-images`. */
export type OsImageInfo = OsImage & {
  bootable: boolean
  available: boolean
  /** Alasan tidak tersedia (null bila tersedia). */
  reason: string | null
  builtin: boolean
  /** M5: path media relatif PXE_MEDIA_ROOT (UI OS Images). */
  source: OsImageSource
  /** M5: `${PXE_MEDIA_URL}/${source.repo}`. */
  repoUrl: string
  /** M5: jumlah host yang mereferensikan image (assigned, config, job aktif). */
  usedBy: number
  createdAt: string
}

type Row = {
  id: string
  name: string
  version: string
  arch: "amd64" | "arm64"
  method: InstallMethod
  source: string
  bootable: number
  offline: number
  builtin: number
  created_at: string
}

function toRecord(r: Row): OsImageRecord {
  return {
    id: r.id,
    name: r.name,
    version: r.version,
    arch: r.arch,
    method: r.method,
    source: JSON.parse(r.source) as OsImageSource,
    bootable: r.bootable === 1,
    offline: r.offline === 1,
    builtin: r.builtin === 1,
    createdAt: r.created_at,
  }
}

export function listImages(): OsImageRecord[] {
  return (getDb().prepare("SELECT * FROM os_images ORDER BY id").all() as Row[]).map(toRecord)
}

export function getImage(id: string): OsImageRecord | null {
  const r = getDb().prepare("SELECT * FROM os_images WHERE id = ?").get(id) as Row | undefined
  return r ? toRecord(r) : null
}

export function insertImage(img: OsImageRecord): void {
  getDb()
    .prepare(
      `INSERT INTO os_images (id, name, version, arch, method, source, bootable, offline, builtin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      img.id,
      img.name,
      img.version,
      img.arch,
      img.method,
      JSON.stringify(img.source),
      img.bootable ? 1 : 0,
      img.offline ? 1 : 0,
      img.builtin ? 1 : 0,
      img.createdAt,
    )
}

export function deleteImage(id: string): boolean {
  return Number(getDb().prepare("DELETE FROM os_images WHERE id = ?").run(id).changes) > 0
}

/**
 * Jumlah host unik yang masih mereferensikan image (assigned, config, job aktif) — dipakai untuk
 * menolak hapus (409). Sama dengan `usedBy` (`imageHostCount`): satu host yang punya
 * `os_assigned`, config, dan job aktif untuk image yang sama dihitung SATU kali (BUG-M5-1).
 */
export function imageUsage(id: string): number {
  return imageHostCount(id)
}

/** Ketersediaan image terhadap media di `mediaRoot` (fungsi murni + fs). */
export function imageAvailability(
  img: OsImageRecord,
  mediaRoot: string,
  exists: (p: string) => boolean = existsSync,
): { available: boolean; reason: string | null } {
  if (!img.bootable) {
    return {
      available: false,
      reason:
        img.method === "unattend"
          ? "Windows: hanya generator unattend.xml (install via PXE belum didukung)"
          : "Image tidak bootable via PXE",
    }
  }
  for (const f of [img.source.kernel, img.source.initrd]) {
    if (!f || !exists(path.join(mediaRoot, f))) {
      return { available: false, reason: `Media ${img.id} tidak tersedia (${f || "kernel"} tidak ada)` }
    }
  }
  return { available: true, reason: null }
}

/** Jumlah host berbeda yang mereferensikan image (assigned, config, atau job aktif). */
export function imageHostCount(id: string): number {
  const r = getDb()
    .prepare(
      `SELECT count(*) AS n FROM (
        SELECT id AS h FROM hosts WHERE os_assigned = ?1
        UNION SELECT host_id FROM host_configs WHERE json_extract(os_profile, '$.osImageId') = ?1
        UNION SELECT host_id FROM jobs WHERE os_image_id = ?1
          AND status IN ('booting','installing','configuring')
      )`,
    )
    .get(id) as { n: number }
  return Number(r.n)
}

export function toImageInfo(
  img: OsImageRecord,
  mediaRoot: string,
  mediaUrl: string,
  usedBy: number = imageHostCount(img.id),
): OsImageInfo {
  const { available, reason } = imageAvailability(img, mediaRoot)
  return {
    id: img.id,
    name: img.name,
    version: img.version,
    arch: img.arch,
    method: img.method,
    bootable: img.bootable,
    builtin: img.builtin,
    available,
    reason,
    source: { ...img.source },
    repoUrl: `${mediaUrl}/${img.source.repo}`,
    usedBy,
    createdAt: img.createdAt,
  }
}
