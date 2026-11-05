// Library SSH key & OS image (API M4-T2; halaman UI CRUD = M5).
import { z } from "zod"

import type { SshKey } from "@/lib/host-config"
import { parseSshKey, sshFingerprint } from "@/lib/ssh-key"
import { getDb, isUniqueViolation, tx } from "@/lib/server/db"
import {
  deleteImage,
  getImage,
  imageUsage,
  insertImage,
  toImageInfo,
  type OsImageInfo,
} from "@/lib/server/db/repos/os-images"
import {
  deleteKey,
  getKey,
  getKeyByFingerprint,
  insertKey,
  keyUsage,
  listKeys,
  renameKey,
} from "@/lib/server/db/repos/ssh-keys"
import { getSettings } from "@/lib/server/settings"

/** Item `GET /api/ssh-keys` (M5): key + jumlah host pemakai. */
export type SshKeyInfo = SshKey & { usedBy: number }

/** Library key + `usedBy`. */
export function listSshKeyInfos(): SshKeyInfo[] {
  return listKeys().map((k) => ({ ...k, usedBy: keyUsage(k.id) }))
}

export type LibraryResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 404 | 409 | 422; error: string }

// ---- SSH keys ----

export const newSshKeyPayload = z.object({
  name: z.string().trim().min(1, "Nama wajib").max(64),
  publicKey: z.string().max(16_384),
})

export async function createSshKey(
  p: z.infer<typeof newSshKeyPayload>,
): Promise<LibraryResult<SshKeyInfo>> {
  const parsed = parseSshKey(p.publicKey)
  if ("error" in parsed) return { ok: false, status: 422, error: parsed.error }
  const fingerprint = await sshFingerprint(parsed.blob)
  // Tanpa await setelah titik ini.
  getDb()
  try {
    return tx(() => {
      const existing = getKeyByFingerprint(fingerprint)
      if (existing)
        return {
          ok: false as const,
          status: 409 as const,
          error: `Key sudah ada di library sebagai "${existing.name}"`,
        }
      const key: SshKeyInfo = {
        id: `key-${crypto.randomUUID().slice(0, 8)}`,
        name: p.name,
        type: parsed.type,
        publicKey: parsed.normalized,
        fingerprint,
        comment: parsed.comment,
        createdAt: new Date().toISOString(),
        usedBy: 0,
      }
      insertKey(key)
      return { ok: true as const, value: key }
    })
  } catch (e) {
    if (isUniqueViolation(e))
      return { ok: false, status: 409, error: "Key sudah ada di library" }
    throw e
  }
}

/** Body `PATCH /api/ssh-keys/:id`: hanya `name` (field lain → 400). */
export const renameSshKeyPayload = z
  .object({ name: z.string().trim().min(1, "Nama wajib").max(64) })
  .strict()

export function renameSshKey(id: string, name: string): LibraryResult<SshKeyInfo> {
  getDb()
  return tx(() => {
    if (!renameKey(id, name)) return { ok: false, status: 404, error: "Key tidak ditemukan" }
    return { ok: true, value: { ...getKey(id)!, usedBy: keyUsage(id) } }
  })
}

export function removeSshKey(id: string): LibraryResult<null> {
  getDb()
  return tx(() => {
    if (!getKey(id)) return { ok: false, status: 404, error: "Key tidak ditemukan" }
    const used = keyUsage(id)
    if (used > 0)
      return {
        ok: false,
        status: 409,
        error: `Key dipakai ${used} host — lepaskan dari konfigurasi host dulu`,
      }
    deleteKey(id)
    return { ok: true, value: null }
  })
}

// ---- OS images ----

const relPath = z
  .string()
  .max(256)
  .regex(
    /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/,
    "Path relatif terhadap media (tanpa / di awal)",
  )
  .refine((s) => !s.split("/").includes(".."), "Path tidak boleh memuat ..")

export const newOsImagePayload = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,47}$/, "Id: huruf kecil, angka, titik, minus"),
    name: z.string().trim().min(1).max(64),
    version: z.string().trim().min(1).max(32),
    arch: z.enum(["amd64", "arm64"]),
    method: z.enum(["autoinstall", "kickstart", "preseed", "unattend"]),
    bootable: z.boolean(),
    source: z.object({
      kernel: relPath.or(z.literal("")),
      initrd: relPath.or(z.literal("")),
      repo: relPath,
    }),
  })
  .refine(
    (v) => !v.bootable || (v.source.kernel !== "" && v.source.initrd !== ""),
    { message: "Image bootable wajib punya kernel dan initrd", path: ["source"] },
  )
  .refine((v) => !(v.bootable && v.method === "unattend"), {
    message: "Windows (unattend) belum bisa bootable via PXE",
    path: ["bootable"],
  })

export function createOsImage(
  p: z.infer<typeof newOsImagePayload>,
): LibraryResult<OsImageInfo> {
  getDb()
  return tx(() => {
    if (getImage(p.id))
      return { ok: false, status: 409, error: `OS image ${p.id} sudah ada` }
    const rec = {
      ...p,
      offline: true,
      builtin: false,
      createdAt: new Date().toISOString(),
    }
    insertImage(rec)
    const st = getSettings()
    return { ok: true, value: toImageInfo(rec, st.mediaRoot, st.mediaUrl, 0) }
  })
}

export function removeOsImage(id: string): LibraryResult<null> {
  getDb()
  return tx(() => {
    if (!getImage(id))
      return { ok: false, status: 404, error: "OS image tidak ditemukan" }
    const used = imageUsage(id)
    if (used > 0)
      return {
        ok: false,
        status: 409,
        error: `OS image dipakai ${used} host/job`,
      }
    deleteImage(id)
    return { ok: true, value: null }
  })
}
