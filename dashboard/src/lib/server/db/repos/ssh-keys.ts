// Repo library SSH key (`ssh_keys`) + join `host_ssh_keys`.
import { getDb } from "../index"

import type { SshKey } from "@/lib/host-config"

type KeyRow = {
  id: string
  name: string
  type: string
  public_key: string
  fingerprint: string
  comment: string
  created_at: string
}

function toKey(r: KeyRow): SshKey {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    publicKey: r.public_key,
    fingerprint: r.fingerprint,
    comment: r.comment,
    createdAt: r.created_at,
  }
}

export function listKeys(): SshKey[] {
  return (
    getDb()
      .prepare("SELECT * FROM ssh_keys ORDER BY name COLLATE NOCASE, id")
      .all() as KeyRow[]
  ).map(toKey)
}

export function getKey(id: string): SshKey | null {
  const r = getDb().prepare("SELECT * FROM ssh_keys WHERE id = ?").get(id) as
    | KeyRow
    | undefined
  return r ? toKey(r) : null
}

export function getKeyByFingerprint(fp: string): SshKey | null {
  const r = getDb()
    .prepare("SELECT * FROM ssh_keys WHERE fingerprint = ?")
    .get(fp) as KeyRow | undefined
  return r ? toKey(r) : null
}

export function insertKey(k: SshKey): void {
  getDb()
    .prepare(
      `INSERT INTO ssh_keys (id, name, type, public_key, fingerprint, comment, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(k.id, k.name, k.type, k.publicKey, k.fingerprint, k.comment, k.createdAt)
}

/** Ubah nama key (public key/fingerprint tidak bisa diubah). */
export function renameKey(id: string, name: string): boolean {
  return Number(getDb().prepare("UPDATE ssh_keys SET name = ? WHERE id = ?").run(name, id).changes) > 0
}

export function deleteKey(id: string): boolean {
  return Number(getDb().prepare("DELETE FROM ssh_keys WHERE id = ?").run(id).changes) > 0
}

/** Jumlah host yang memakai key. */
export function keyUsage(id: string): number {
  const r = getDb()
    .prepare("SELECT count(*) AS n FROM host_ssh_keys WHERE key_id = ?")
    .get(id) as { n: number }
  return Number(r.n)
}

/** Id key library milik host (urut sesuai pilihan). */
export function hostKeyIds(hostId: string): string[] {
  return (
    getDb()
      .prepare("SELECT key_id FROM host_ssh_keys WHERE host_id = ? ORDER BY position")
      .all(hostId) as { key_id: string }[]
  ).map((r) => r.key_id)
}

export function setHostKeyIds(hostId: string, keyIds: string[]): void {
  const db = getDb()
  db.prepare("DELETE FROM host_ssh_keys WHERE host_id = ?").run(hostId)
  const ins = db.prepare(
    "INSERT INTO host_ssh_keys (host_id, key_id, position) VALUES (?, ?, ?)",
  )
  ;[...new Set(keyIds)].forEach((k, i) => ins.run(hostId, k, i))
}
