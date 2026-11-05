// Helper DB untuk test node (DEC-005 seam: `resetDb(seed)`, tanpa route HTTP).
// Vitest memakai PXE_DB_PATH kosong → `:memory:` per worker; `resetDb` mengosongkan semua tabel
// lalu menerapkan seed, sehingga setiap test mulai dari keadaan yang sama.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterAll, beforeEach } from "vitest"

import { getDb } from "@/lib/server/db"
import { resetDb } from "@/lib/server/db/reset"
import { BUILTIN_SOURCES } from "@/lib/server/db/seed"
import type { SeedName } from "@/lib/server/settings"

import { isolateEnv } from "./env"

/** isolateEnv + resetDb(seed) sebelum tiap test. */
export function useDb(seed: SeedName = "demo", env: Record<string, string> = {}) {
  isolateEnv(env)
  beforeEach(() => {
    resetDb(seed)
  })
}

/** Direktori sementara (dihapus di afterAll file test). */
export function tmpDir(prefix: string): string {
  const d = mkdtempSync(path.join(os.tmpdir(), `pxe-test-${prefix}-`))
  afterAll(() => rmSync(d, { recursive: true, force: true }))
  return d
}

/**
 * Buat root media palsu berisi kernel + initrd image bootable `ids` (default: semua kecuali
 * ubuntu-22.04 — media tidak ada, sesuai plan §2.2).
 */
export function makeMediaRoot(
  dir: string,
  ids: string[] = ["ubuntu-24.04", "debian-12", "rocky-9"],
): string {
  for (const id of ids) {
    const s = BUILTIN_SOURCES[id].source
    for (const f of [s.kernel, s.initrd]) {
      if (!f) continue
      mkdirSync(path.dirname(path.join(dir, f)), { recursive: true })
      writeFileSync(path.join(dir, f), "dummy\n")
    }
  }
  return dir
}

/** Semua baris tabel (snapshot untuk membuktikan request ditolak tanpa efek). */
export function dbSnapshot(): string {
  const db = getDb()
  const all = (t: string) => db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()
  return JSON.stringify({
    hosts: all("hosts"),
    host_configs: all("host_configs"),
    ssh_keys: all("ssh_keys"),
    host_ssh_keys: all("host_ssh_keys"),
    jobs: all("jobs"),
    os_images: all("os_images"),
  })
}
