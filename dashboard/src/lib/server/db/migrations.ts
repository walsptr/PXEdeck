// Migrasi skema berversi (DEC-007, docs/design/M4-options.md §O1). Disimpan
// sebagai modul TS (bukan file .sql) supaya ikut ter-bundle di build
// standalone. Tambah migrasi baru di akhir array; jangan ubah yang sudah ada.
import type { DatabaseSync } from "node:sqlite"

export type Migration = { version: number; name: string; sql: string }

const STATUSES = `'discovered','booting','installing','configuring','done','failed','offline'`
const JOB_STATUSES = `'booting','installing','configuring','done','failed'`
const FAILURE_REASONS = `'timeout-booting','timeout-installing','timeout-configuring','installer-boot-limit','installer-error','superseded'`

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "init",
    sql: `
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Disiapkan untuk Settings yang bisa diedit (M4: sumber kebenaran = env).
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE hosts (
  id TEXT PRIMARY KEY CHECK (length(id) = 12),
  mac TEXT NOT NULL UNIQUE,
  hostname TEXT,
  current_ip TEXT,
  mgmt_ip TEXT,
  vendor TEXT,
  firmware TEXT CHECK (firmware IN ('uefi','bios')),
  os_installed TEXT,
  os_assigned TEXT,
  status TEXT NOT NULL CHECK (status IN (${STATUSES})),
  status_since TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);
CREATE UNIQUE INDEX hosts_hostname_uq ON hosts (lower(hostname)) WHERE hostname IS NOT NULL;

CREATE TABLE host_configs (
  host_id TEXT PRIMARY KEY REFERENCES hosts(id) ON DELETE CASCADE,
  os_profile TEXT,
  username TEXT,
  password_hash TEXT,
  sudo INTEGER NOT NULL DEFAULT 1,
  disable_ssh_password INTEGER NOT NULL DEFAULT 0,
  network_mode TEXT NOT NULL CHECK (network_mode IN ('dhcp','static')),
  ip TEXT,
  prefix INTEGER,
  gateway TEXT,
  dns TEXT,
  vlan INTEGER,
  iface TEXT,
  extra_keys TEXT NOT NULL DEFAULT '[]',
  ssh_user TEXT,
  updated_at TEXT,
  CHECK (network_mode = 'dhcp' OR ip IS NOT NULL)
);
CREATE UNIQUE INDEX host_configs_ip_uq ON host_configs (ip) WHERE network_mode = 'static';

CREATE TABLE ssh_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  public_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE host_ssh_keys (
  host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  key_id TEXT NOT NULL REFERENCES ssh_keys(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (host_id, key_id)
);
CREATE INDEX host_ssh_keys_key ON host_ssh_keys (key_id);

CREATE TABLE os_images (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  arch TEXT NOT NULL CHECK (arch IN ('amd64','arm64')),
  method TEXT NOT NULL CHECK (method IN ('autoinstall','kickstart','preseed','unattend')),
  source TEXT NOT NULL,
  bootable INTEGER NOT NULL DEFAULT 1,
  offline INTEGER NOT NULL DEFAULT 1,
  builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'install' CHECK (kind IN ('install')),
  os_image_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (${JOB_STATUSES})),
  stages TEXT NOT NULL DEFAULT '[]',
  logs TEXT NOT NULL DEFAULT '',
  token_hash TEXT UNIQUE,
  token_expires_at TEXT,
  boot_served_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE UNIQUE INDEX jobs_active_uq ON jobs (host_id)
  WHERE status IN ('booting','installing','configuring');
CREATE INDEX jobs_host ON jobs (host_id);
`,
  },
  {
    // M5 (DEC-014): siklus hidup job + event/log. Hanya menambah kolom/tabel (R9).
    version: 2,
    name: "job-events",
    sql: `
ALTER TABLE jobs ADD COLUMN failure_reason TEXT CHECK (failure_reason IS NULL OR failure_reason IN (${FAILURE_REASONS}));
ALTER TABLE jobs ADD COLUMN installer_boots INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN event_seq INTEGER NOT NULL DEFAULT 0;

CREATE TABLE job_events (
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('stage','system','installer')),
  level TEXT NOT NULL CHECK (level IN ('info','warn','error')),
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  repeat INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (job_id, seq)
);
CREATE INDEX jobs_created ON jobs (created_at, id);

-- Backfill: jumlah penyajian installer job M4 = entri stages dari boot-script.
UPDATE jobs SET installer_boots = (
  SELECT count(*) FROM json_each(jobs.stages)
  WHERE json_extract(json_each.value, '$.source') = 'boot-script'
);
`,
  },
  {
    // M6 (DEC-017 §1): sesi admin server-side + waktu kemunculan terakhir event gabungan
    // (CR-5-7). Hanya menambah.
    version: 3,
    name: "sessions",
    sql: `
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY CHECK (length(id_hash) = 64),
  username TEXT NOT NULL,
  cred_fp TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT
);
CREATE INDEX sessions_expires ON sessions (expires_at);

ALTER TABLE job_events ADD COLUMN last_at TEXT;
UPDATE job_events SET last_at = at WHERE last_at IS NULL;
`,
  },
]

/**
 * Jalankan migrasi yang belum tercatat di `schema_migrations` (masing-masing
 * dalam transaksi). Aman dipanggil berulang. Mengembalikan versi yang baru
 * diterapkan.
 */
export function runMigrations(
  db: DatabaseSync,
  migrations: Migration[] = MIGRATIONS,
): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`)
  const done = new Set(
    (
      db.prepare("SELECT version FROM schema_migrations").all() as {
        version: number
      }[]
    ).map((r) => r.version),
  )
  const applied: number[] = []
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (done.has(m.version)) continue
    db.exec("BEGIN IMMEDIATE")
    try {
      db.exec(m.sql)
      db.prepare(
        "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
      ).run(m.version, m.name, new Date().toISOString())
      db.exec("COMMIT")
    } catch (e) {
      db.exec("ROLLBACK")
      throw e
    }
    applied.push(m.version)
  }
  return applied
}
