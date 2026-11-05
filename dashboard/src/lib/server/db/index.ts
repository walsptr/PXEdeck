// Koneksi SQLite (`node:sqlite`, DEC-007). Lapisan tipis: hanya modul di
// src/lib/server/db/ yang menyentuh API `node:sqlite`; service memakai repo.
//
// - Path dari `PXE_DB_PATH` (settings). Di Vitest default `:memory:`.
// - Pragma: foreign_keys=ON, journal_mode=WAL (file), busy_timeout.
// - Migrasi berversi dijalankan saat dibuka (idempoten).
// - Seed (`PXE_SEED`) hanya diterapkan sekali pada DB baru (flag di `meta`).
// - `tx(fn)`: transaksi SINKRON `BEGIN IMMEDIATE … COMMIT` (validasi + apply
//   atomik; tanpa await di dalamnya). Panggilan bertingkat memakai transaksi
//   luar.
import { mkdirSync } from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

import { getSettings, type SeedName } from "@/lib/server/settings"

import { runMigrations } from "./migrations"
import { applySeed } from "./seed"

export type Db = DatabaseSync

type State = { path: string; db: DatabaseSync; depth: number }

const g = globalThis as typeof globalThis & { __pxeDb?: State }

/** Buka DB di `file` (membuat direktori induk), jalankan migrasi + seed awal. */
export function openDbAt(file: string, seed: SeedName): DatabaseSync {
  if (file !== ":memory:") mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec("PRAGMA foreign_keys = ON")
  db.exec("PRAGMA busy_timeout = 5000")
  if (file !== ":memory:") db.exec("PRAGMA journal_mode = WAL")
  runMigrations(db)
  const seeded = db
    .prepare("SELECT value FROM meta WHERE key = 'seeded'")
    .get() as { value: string } | undefined
  if (!seeded) {
    db.exec("BEGIN IMMEDIATE")
    try {
      applySeed(db, seed)
      db.prepare("INSERT INTO meta(key, value) VALUES ('seeded', ?)").run(seed)
      db.exec("COMMIT")
    } catch (e) {
      db.exec("ROLLBACK")
      throw e
    }
  }
  return db
}

/** Koneksi aktif untuk `PXE_DB_PATH`; dibuka ulang bila path berubah. */
export function getDb(): DatabaseSync {
  const s = getSettings()
  const cur = g.__pxeDb
  if (cur && cur.path === s.dbPath && cur.db.isOpen) return cur.db
  if (cur?.db.isOpen) cur.db.close()
  g.__pxeDb = { path: s.dbPath, db: openDbAt(s.dbPath, s.seed), depth: 0 }
  return g.__pxeDb.db
}

/** Tutup koneksi (test: membuka ulang dari file yang sama, AC-4.2). */
export function closeDb(): void {
  const cur = g.__pxeDb
  if (cur?.db.isOpen) cur.db.close()
  g.__pxeDb = undefined
}

/**
 * Jalankan `fn` di dalam transaksi `BEGIN IMMEDIATE`. `fn` wajib sinkron.
 * Error → ROLLBACK dan dilempar ulang. Bertingkat → ikut transaksi luar.
 */
export function tx<T>(fn: (db: DatabaseSync) => T): T {
  const db = getDb()
  const st = g.__pxeDb!
  if (st.depth > 0) {
    st.depth++
    try {
      return fn(db)
    } finally {
      st.depth--
    }
  }
  db.exec("BEGIN IMMEDIATE")
  st.depth = 1
  try {
    const out = fn(db)
    if (out instanceof Promise) throw new Error("tx(fn): fn harus sinkron")
    db.exec("COMMIT")
    return out
  } catch (e) {
    if (db.isTransaction) db.exec("ROLLBACK")
    throw e
  } finally {
    st.depth = 0
  }
}

/** true bila error berasal dari pelanggaran constraint UNIQUE SQLite. */
export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Error && /UNIQUE constraint failed/.test(e.message)
}

/** Nama kolom/indeks unik yang dilanggar (untuk pesan 422), atau null. */
export function uniqueViolationTarget(e: unknown): string | null {
  if (!(e instanceof Error)) return null
  const m = /UNIQUE constraint failed: (.+)$/.exec(e.message)
  return m ? m[1] : null
}
