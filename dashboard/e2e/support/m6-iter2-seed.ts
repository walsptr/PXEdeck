// Data server E2E `m6-ui-iter2` (gate M6 iter1 R1/R2/R3/R7, DEC-022): seed m6-ui (60 job, hostname 63
// karakter) + host Failed (`compute-03` seed demo) yang job terakhirnya failed, agar alasan gagal tampil
// di tabel Hosts dan Sheet. Ditulis langsung ke file DB sebelum server start (DEC-005/007).
import { DatabaseSync } from "node:sqlite"

import { seedM6Ui } from "./m6-seed"

export const ITER2_FAILED_HOST_MAC = "ac:1f:6b:22:7d:40"
export const ITER2_FAILED_JOB = "job-iter2-failed-001"

export function seedM6Iter2(file: string) {
  seedM6Ui(file)
  const db = new DatabaseSync(file)
  try {
    const hostId = ITER2_FAILED_HOST_MAC.replaceAll(":", "")
    const host = db.prepare("SELECT status FROM hosts WHERE id = ?").get(hostId) as { status: string } | undefined
    if (host?.status !== "failed") throw new Error(`seed demo berubah: host ${hostId} bukan failed`)
    // Terbaru untuk host ini (job seed m6-ui = 3 hari lalu).
    const at = new Date(Date.now() - 10 * 60_000).toISOString()
    const end = new Date(Date.now() - 5 * 60_000).toISOString()
    const stages = JSON.stringify([
      { stage: "booting", at, source: "install" },
      { stage: "failed", at: end, source: "watchdog" },
    ])
    db.prepare(
      `INSERT INTO jobs (id, host_id, os_image_id, status, stages, created_at, updated_at, finished_at, failure_reason, installer_boots)
       VALUES (?, ?, 'ubuntu-24.04', 'failed', ?, ?, ?, ?, 'timeout-installing', 1)`,
    ).run(ITER2_FAILED_JOB, hostId, stages, at, end, end)
  } finally {
    db.close()
  }
}
