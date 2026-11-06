// Snapshot/restore process.env antar test (dipakai test node).
// Sejak M4 mencakup semua env `PXE_*` yang dibaca `getSettings()` (settings.ts) sehingga nilai
// dari shell pengembang tidak bocor ke test. PXE_DB_PATH kosong → `:memory:` di Vitest.
import { afterEach, beforeEach } from "vitest"

import { resetRateLimits } from "@/lib/server/auth/rate-limit"
import { resetBootLogThrottle } from "@/lib/server/boot-http"
import { SETTINGS_ENV_KEYS } from "@/lib/server/settings"
import { resetSseCounters } from "@/lib/server/sse"

import { testAdminEnv } from "./auth"

const KEYS = [
  ...SETTINGS_ENV_KEYS.filter((k) => k !== "NODE_ENV" && k !== "VITEST"),
  "PXE_LOG_BOOT",
]

/**
 * Simpan env PXE_* sebelum tiap test, hapus untuk test, kembalikan sesudahnya.
 * M6: admin test (`testAdminEnv`, password acak per worker) dipasang sebagai default sehingga
 * helper `src/test/route.ts` dapat membuat sesi sungguhan; `defaults` test menimpanya (mis.
 * `PXE_ADMIN_USERNAME: ""` untuk menguji tanpa admin). Hitungan rate limit, throttle log
 * penolakan /boot, dan penghitung SSE di-reset per test (state in-memory per proses).
 */
export function isolateEnv(defaults: Record<string, string> = {}) {
  let snapshot: Record<string, string | undefined> = {}
  beforeEach(() => {
    snapshot = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
    for (const k of KEYS) delete process.env[k]
    Object.assign(process.env, testAdminEnv(), defaults)
    resetRateLimits()
    resetBootLogThrottle()
    resetSseCounters()
  })
  afterEach(() => {
    for (const k of KEYS) {
      if (snapshot[k] === undefined) delete process.env[k]
      else process.env[k] = snapshot[k]
    }
  })
}
