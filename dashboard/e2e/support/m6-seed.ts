// Data stres server E2E `m6-ui` (M6-T12): ditulis langsung ke file DB sebelum server start (sama seperti
// seed demo, DEC-005/007 — bukan seam di kode produk). 60 job (> 1 halaman 50, AC-6.19), hostname 63
// karakter, sebagian job failed, event gabungan dengan lastAt ≠ at (CR-5-7), pesan panjang.
import { DatabaseSync } from "node:sqlite"

/** Id job failed yang dipakai uji detail job (axe /jobs, AC-6.38). */
export const M6_FAILED_JOB = "job-m6ui-007"
export const M6_JOB_COUNT = 60
export const M6_LONG_HOSTNAME = "node-rack07-lab-cluster-a-very-long-hostname-without-dots-0001x"

export function seedM6Ui(file: string) {
  const db = new DatabaseSync(file)
  try {
    const hosts = db.prepare("SELECT id FROM hosts ORDER BY id").all() as { id: string }[]
    db.prepare("UPDATE hosts SET hostname = ? WHERE id = ?").run(M6_LONG_HOSTNAME, hosts[0].id)
    const ins = db.prepare(
      `INSERT INTO jobs (id, host_id, os_image_id, status, stages, created_at, updated_at, finished_at, failure_reason, installer_boots)
       VALUES (?, ?, 'ubuntu-24.04', ?, ?, ?, ?, ?, ?, 1)`,
    )
    const ev = db.prepare(
      `INSERT INTO job_events (job_id, seq, at, kind, level, source, message, repeat, last_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    // Selalu di masa lalu relatif jam sistem (3 hari lalu, dibulatkan ke menit) agar job baru dari test
    // menjadi yang terbaru di halaman pertama.
    const base = Math.floor((Date.now() - 3 * 86_400_000) / 60_000) * 60_000
    for (let i = 0; i < M6_JOB_COUNT; i++) {
      const at = new Date(base + i * 60_000).toISOString()
      const end = new Date(base + i * 60_000 + 30_000).toISOString()
      const failed = i % 7 === 0
      const id = `job-m6ui-${String(i).padStart(3, "0")}`
      const stages = JSON.stringify([
        { stage: "booting", at, source: "install" },
        { stage: failed ? "failed" : "done", at: end, source: failed ? "watchdog" : "callback" },
      ])
      ins.run(id, hosts[i % hosts.length].id, failed ? "failed" : "done", stages, at, end, end, failed ? "installer-error" : null)
      ev.run(id, 1, at, "stage", "info", "install", "Job install dibuat", 1, at)
      ev.run(id, 2, at, "system", "warn", "boot-script", `PXE boot ulang ${"/very/long/path/segment".repeat(6)}`, 11, end)
      ev.run(id, 3, end, "installer", "error", "installer", `ERROR ${"A".repeat(300)}`, 1, end)
    }
  } finally {
    db.close()
  }
}
