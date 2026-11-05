// Snapshot/restore process.env antar test (dipakai test node).
// Sejak M4 mencakup semua env `PXE_*` yang dibaca `getSettings()` (settings.ts) sehingga nilai
// dari shell pengembang tidak bocor ke test. PXE_DB_PATH kosong → `:memory:` di Vitest.
import { afterEach, beforeEach } from "vitest"

import { SETTINGS_ENV_KEYS } from "@/lib/server/settings"

const KEYS = [
  ...SETTINGS_ENV_KEYS.filter((k) => k !== "NODE_ENV" && k !== "VITEST"),
  "PXE_LOG_BOOT",
]

/** Simpan env PXE_* sebelum tiap test, hapus untuk test, kembalikan sesudahnya. */
export function isolateEnv(defaults: Record<string, string> = {}) {
  let snapshot: Record<string, string | undefined> = {}
  beforeEach(() => {
    snapshot = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
    for (const k of KEYS) delete process.env[k]
    Object.assign(process.env, defaults)
  })
  afterEach(() => {
    for (const k of KEYS) {
      if (snapshot[k] === undefined) delete process.env[k]
      else process.env[k] = snapshot[k]
    }
  })
}
