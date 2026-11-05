// Seam test (DEC-005): kosongkan DB aktif lalu terapkan seed. Hanya lewat
// fungsi — TIDAK pernah diekspos sebagai route HTTP.
import { getSettings, type SeedName } from "@/lib/server/settings"

import { getDb, tx } from "./index"
import { applySeed } from "./seed"

const TABLES = [
  "sessions",
  "job_events",
  "jobs",
  "host_ssh_keys",
  "host_configs",
  "ssh_keys",
  "hosts",
  "os_images",
  "settings",
  "meta",
] as const

/** Hapus semua data (skema tetap) dan seed ulang (`seed` default = PXE_SEED). */
export function resetDb(seed: SeedName = getSettings().seed): void {
  getDb()
  tx((db) => {
    for (const t of TABLES) db.exec(`DELETE FROM ${t}`)
    applySeed(db, seed)
    db.prepare("INSERT INTO meta(key, value) VALUES ('seeded', ?)").run(seed)
  })
}
