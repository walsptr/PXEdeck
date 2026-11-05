// Snapshot/restore process.env antar test (dipakai test node).
import { afterEach, beforeEach } from "vitest"

const KEYS = [
  "PXE_MOCK_SIMULATION",
  "PXE_MOCK_DISCOVER_EVERY_MS",
  "PXE_MOCK_SEED",
  "PXE_MGMT_CIDR",
  "PXE_MGMT_GATEWAY",
  "PXE_MGMT_DNS",
  "PXE_DYNAMIC_RANGE",
  "PXE_SERVER_IP",
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
