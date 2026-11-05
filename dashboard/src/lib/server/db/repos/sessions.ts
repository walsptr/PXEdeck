// Repo `sessions` (M6, DEC-017 §1, migrasi 3). Hanya sha256(id sesi) yang disimpan; id mentah
// hanya ada di cookie klien. Semua fungsi sinkron.
import { getDb } from "../index"

export type SessionRow = {
  idHash: string
  username: string
  credFp: string
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  ip: string | null
}

type Row = {
  id_hash: string
  username: string
  cred_fp: string
  created_at: string
  last_seen_at: string
  expires_at: string
  ip: string | null
}

function toSession(r: Row): SessionRow {
  return {
    idHash: r.id_hash,
    username: r.username,
    credFp: r.cred_fp,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    expiresAt: r.expires_at,
    ip: r.ip,
  }
}

export function insertSession(s: SessionRow): void {
  getDb()
    .prepare(
      `INSERT INTO sessions (id_hash, username, cred_fp, created_at, last_seen_at, expires_at, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(s.idHash, s.username, s.credFp, s.createdAt, s.lastSeenAt, s.expiresAt, s.ip)
}

export function getSessionRow(idHash: string): SessionRow | null {
  const r = getDb().prepare("SELECT * FROM sessions WHERE id_hash = ?").get(idHash) as Row | undefined
  return r ? toSession(r) : null
}

export function touchSession(idHash: string, at: string): void {
  getDb().prepare("UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?").run(at, idHash)
}

export function deleteSession(idHash: string): boolean {
  return Number(getDb().prepare("DELETE FROM sessions WHERE id_hash = ?").run(idHash).changes) > 0
}

/**
 * Hapus sesi yang `expires_at` ≤ `now`, `last_seen_at` < `idleBefore`, atau sidik kredensialnya ≠
 * `credFp` (null = admin tidak dikonfigurasi → semua sesi). Mengembalikan jumlah yang dihapus.
 */
export function deleteExpiredSessions(now: string, idleBefore: string, credFp: string | null): number {
  return Number(
    getDb()
      .prepare(
        "DELETE FROM sessions WHERE expires_at <= ? OR last_seen_at < ? OR ? IS NULL OR cred_fp != ?",
      )
      .run(now, idleBefore, credFp, credFp).changes,
  )
}

export function countSessions(): number {
  return Number((getDb().prepare("SELECT count(*) AS n FROM sessions").get() as { n: number }).n)
}
