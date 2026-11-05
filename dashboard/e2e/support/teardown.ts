// Hapus direktori data E2E run ini (DB, media palsu, lease fixture) setelah semua test selesai.
// Hanya direktori `dashboard/.e2e-data/run-*` (di dalam project).
import { rmSync } from "node:fs"
import path from "node:path"

import { E2E_DATA_DIR } from "./e2e-env"

export default async function globalTeardown() {
  const root = process.env.PXE_E2E_ROOT
  if (root && path.dirname(root) === E2E_DATA_DIR && path.basename(root).startsWith("run-")) {
    rmSync(root, { recursive: true, force: true })
  }
}
