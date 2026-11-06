// Lingkungan E2E M4 (DEC-005/DEC-007): setiap server `next start` memakai file DB SQLite sendiri di
// direktori sementara, di-seed SEBELUM server start (bukan lewat route HTTP). `next start` berjalan
// dengan NODE_ENV=production sehingga `PXE_SEED=demo` ditolak settings (benar untuk produksi); DB
// demo karenanya dibuat di sini dengan `openDbAt(file, "demo")` lalu server memakai `PXE_SEED=empty`
// (flag `meta.seeded` sudah ada → seed tidak diterapkan ulang).
//
// Dipanggil dari playwright.config.ts. Config juga dimuat ulang di proses worker; root yang sudah
// dibuat proses utama diwariskan lewat env `PXE_E2E_ROOT`; seed/tulis file hanya di proses yang
// membuat root (sekali per run).
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import path from "node:path"

import { openDbAt } from "../../src/lib/server/db"
import { BUILTIN_SOURCES } from "../../src/lib/server/db/seed"
import type { SeedName } from "../../src/lib/server/settings"

export type E2eDb = {
  name: string
  seed: SeedName
  /** M6: data tambahan ditulis langsung ke file DB sebelum server start (sekali per run). */
  extra?: (file: string) => void
}

/**
 * Induk direktori data E2E: di dalam project (`dashboard/.e2e-data`, gitignored) — batas keras
 * CLAUDE.md melarang menghapus file di luar direktori project.
 */
export const E2E_DATA_DIR = path.resolve(__dirname, "../../.e2e-data")

/** true hanya di proses yang membuat root (proses utama Playwright), bukan di worker. */
let createdHere = false

/** Root direktori sementara E2E (dibuat sekali di proses utama Playwright). */
export function e2eRoot(): string {
  if (!process.env.PXE_E2E_ROOT) {
    mkdirSync(E2E_DATA_DIR, { recursive: true })
    process.env.PXE_E2E_ROOT = mkdtempSync(path.join(E2E_DATA_DIR, "run-"))
    createdHere = true
  }
  return process.env.PXE_E2E_ROOT
}

/** Path DB untuk server `name`; dibuat + di-seed bila proses ini yang membuat root. */
export function e2eDb({ name, seed, extra }: E2eDb): string {
  const file = path.join(e2eRoot(), "db", `${name}.db`)
  if (e2eRoot() && createdHere) {
    mkdirSync(path.dirname(file), { recursive: true })
    openDbAt(file, seed).close()
    extra?.(file)
  }
  return file
}

/**
 * Root media palsu: kernel + initrd untuk `ids` (default Ubuntu 24.04, Debian 12, Rocky 9 —
 * Ubuntu 22.04 sengaja tidak ada → "tidak tersedia").
 */
export function e2eMedia(ids: string[] = ["ubuntu-24.04", "debian-12", "rocky-9"]): string {
  const dir = path.join(e2eRoot(), "media")
  if (createdHere) {
    for (const id of ids) {
      const s = BUILTIN_SOURCES[id].source
      for (const f of [s.kernel, s.initrd]) {
        mkdirSync(path.dirname(path.join(dir, f)), { recursive: true })
        writeFileSync(path.join(dir, f), "dummy\n")
      }
    }
  }
  return dir
}

/** Path file lease dnsmasq fixture (ditulis oleh test). */
export function e2eLeaseFile(name: string): string {
  const dir = path.join(e2eRoot(), "leases")
  if (createdHere) mkdirSync(dir, { recursive: true })
  return path.join(dir, `${name}.leases`)
}
