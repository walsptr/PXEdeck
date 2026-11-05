# M5 — Callback status & jobs (plan)

- Milestone: 5 · Branch: `milestone/5-callback-jobs`
- Sumber: SPEC §3.1 (update otomatis, aksi "Lihat log"), §4 (Provisioning Jobs: riwayat per host,
  timeline pill pastel, log streaming mono; OS Images; SSH Keys CRUD), §5 (callback status,
  model `jobs`, API `GET /api/jobs` dan `GET /api/jobs/:id/logs` (SSE), host kembali ke boot lokal),
  §6, §1 (design system); CLAUDE.md §Pengujian KVM (uji negatif `virsh destroy`); DEC-004
  (coverage), DEC-005 (tanpa seam HTTP), DEC-007 (SQLite), DEC-008 (token), DEC-009 (topologi),
  DEC-010 (cakupan KVM M5 = `virsh destroy` → Failed → install ulang), DEC-012.
- Masukan wajib: `.agent/runs/m4/gate-iter1.md` §Kewajiban carry-over M5 (lihat §7 trace),
  `review-{code,security,design}-iter1.md` M4, amandemen `docs/design/M4-plan.md` §7.
- Opsi & rekomendasi: `docs/design/M5-options.md` (O1–O14). Plan ini mengasumsikan rekomendasi
  diterima; AC yang bergantung pada opsi ditandai `[O<n>]`.
- Kode dasar (`main` @ `m4-approved`): `lib/server/{discovery,provisioning,install-service,
  boot-script,boot-http,http,settings,leases}.ts`, `lib/server/db/{migrations.ts,repos/jobs.ts}`,
  `lib/server/installers/{shell,firstboot,ubuntu,debian,rocky}.ts`, `app/boot/**`, `app/api/**`,
  `hooks/use-hosts.ts`, `components/hosts/*`, `components/host-config/*`, placeholder
  `app/(dashboard)/{jobs,os-images,ssh-keys}/page.tsx`, `infra/**`, `dashboard/e2e-kvm/**`.

## 1. Ruang lingkup

Masuk M5:
1. **Siklus hidup job lengkap**: batas penyajian installer per job (CR-4-1), watchdog timeout per
   tahap → `failed` dengan alasan, install ulang setelah `failed`, host kembali ke boot lokal
   tanpa reinstall berulang.
2. **Event & log job**: tabel `job_events` (event sisi server + log yang didorong installer),
   redaksi secret sisi server, retensi.
3. **Endpoint installer** `POST /boot/{mac}/{token}/log` + hook log di generator Ubuntu/Debian/Rocky
   dan first-boot (URL diturunkan dari `/proc/cmdline`, kontrak B-5).
4. **API** `GET /api/jobs`, `GET /api/jobs/:id`, `GET /api/jobs/:id/logs` (SSE + mode JSON);
   `PATCH /api/ssh-keys/:id` (rename, melengkapi CRUD); jumlah pemakaian di GET os-images/ssh-keys;
   ringkasan job terakhir di `GET /api/hosts`.
5. **UI**: halaman Provisioning Jobs (daftar + riwayat per host + timeline pill pastel + log
   streaming mono), integrasi tabel host (alasan Failed, "Lihat log"), halaman **OS Images** dan
   **SSH Keys** (dijadwalkan M5 oleh M4-plan §1 tabel UI; menutup DR-4-7), Settings menampilkan
   pengaturan job.
6. **Hardening carry-over**: SR-4-2, CR-4-4, CR-4-5, CR-4-8/SR-4-4, CR-4-9, CR-4-10,
   CR-4-15/SR-4-9, mitigasi SR-4-1 di nginx + allowlist Host untuk GET API [O9].
7. **Perbaikan UI carry-over** DR-4-1..DR-4-7.
8. **Infra & KVM**: `node.sh poweroff|start`, asersi otomatis log server (CR-4-12), CR-4-13,
   CR-4-14, run KVM M5 (UEFI `virsh destroy` → Failed → install ulang → Done + SSH; BIOS positif
   + log/SSE), asersi jumlah job (CR-4-11).

Tidak masuk M5: login/sesi/rate limit `/api/**` (SR-4-1, M6, blocker gate M6); KVM Debian 12 /
Rocky 9 / bulk 3× UEFI (DEC-010, CR-4-6/SR-4-6, M6); penyajian `unattend.xml` Windows
(CR-4-7/SR-4-3); status `offline` otomatis [O11]; registrasi image dari URL jarak jauh [O12];
aksi "Batalkan job" (tidak ada di SPEC; operator menunggu timeout atau install ulang setelah
Failed); edit Settings dari UI; HTTPS (SR-4-8); kendali daya IPMI/Redfish (DEC-012).

### Pembagian M5 / M6 (eksplisit)

| Hal | M5 | M6 |
|---|---|---|
| Jobs | Siklus hidup, watchdog, event/log, API, halaman Jobs, riwayat per host | — |
| Generator | Hook log (penanda + tail saat gagal) Ubuntu/Debian/Rocky, first-boot | Verifikasi KVM Debian/Rocky (CR-4-6, SR-4-6), unattend (CR-4-7) |
| Keamanan | SR-4-2, CR-4-8/9/10/15, redaksi log installer, nginx allowlist admin + allowlist Host GET | Login admin, auth semua `/api/**`, rate limit (SR-4-1), SR-4-8 |
| KVM | UEFI destroy → Failed → install ulang → Done + SSH; BIOS positif + log/SSE + allowlist; jumlah job | Debian 12, Rocky 9, bulk 3× UEFI, E2E penuh |

## 2. Rancangan teknis

### 2.1 Settings (env) baru — `lib/server/settings.ts`, `.env.example`, `infra/server/dashboard.env`

| Variabel | Default | Batas | KVM |
|---|---|---|---|
| `PXE_JOB_BOOTING_TIMEOUT_MIN` | 60 | 1–1440 | 60 |
| `PXE_JOB_INSTALLING_TIMEOUT_MIN` | 120 | 1–1440 | **15** |
| `PXE_JOB_CONFIGURING_TIMEOUT_MIN` | 60 | 1–1440 | 60 |
| `PXE_JOB_MAX_INSTALLER_BOOTS` | 3 | 1–10 | 3 |
| `PXE_WATCHDOG_INTERVAL_SEC` | 30 | 5–600 | 15 |
| `PXE_JOB_LOG_MAX_EVENTS` | 5000 | 100–100000 | 5000 |
| `PXE_JOB_HISTORY_PER_HOST` | 20 | 1–1000 | 20 |
| `PXE_INSECURE_NO_LEASE_CHECK` | 0 | 0/1 | 0 |

Validasi silang (fail fast, pesan menyebut nama variabel):
- `PXE_TOKEN_TTL_MIN` ≥ booting + installing + configuring [O7].
- **SR-4-2** [O10]: `PXE_TRUST_PROXY=1` tanpa `PXE_DNSMASQ_LEASES` → error yang menyebut kedua
  variabel, kecuali `PXE_INSECURE_NO_LEASE_CHECK=1` (peringatan satu baris saat start).
- **CR-4-10**: `PXE_BASE_URL`/`PXE_MEDIA_URL` dengan literal IPv6 (`[`/`]`) ditolak; setiap URL yang
  lolos settings dijamin lolos `ipxeSafe` (satu sumber regex atau test properti).

`GET /api/settings` menambah `jobTimeouts {bootingMin, installingMin, configuringMin}`,
`maxInstallerBoots`, `insecureNoLeaseCheck` (non-rahasia). Halaman Settings menampilkannya
read-only (mono untuk angka/satuan, konsisten I-4-2).

### 2.2 Data — migrasi 2 (`db/migrations.ts`, hanya menambah)

```sql
ALTER TABLE jobs ADD COLUMN failure_reason TEXT;          -- lihat daftar di bawah
ALTER TABLE jobs ADD COLUMN installer_boots INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN event_seq INTEGER NOT NULL DEFAULT 0;  -- seq terakhir job_events
CREATE TABLE job_events (
  job_id  TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  seq     INTEGER NOT NULL,                       -- 1.. per job, naik ketat
  at      TEXT NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('stage','system','installer')),
  level   TEXT NOT NULL CHECK (level IN ('info','warn','error')),
  source  TEXT NOT NULL,   -- install|boot-script|config-fetch|callback|watchdog|installer|operator
  message TEXT NOT NULL,   -- sudah diredaksi, ≤ 2048 char, tanpa karakter kontrol selain \t
  repeat  INTEGER NOT NULL DEFAULT 1,             -- penggabungan event identik (O8)
  PRIMARY KEY (job_id, seq)
);
```
Backfill: `installer_boots` = jumlah entri `stages` ber-`source='boot-script'`; job lama tanpa
event tetap tampil (timeline dari `stages`). `jobs.logs` tidak dihapus dan tidak ditulis [O3].
`failure_reason` ∈ `timeout-booting | timeout-installing | timeout-configuring |
installer-boot-limit | installer-error | superseded`.

Repo `db/repos/jobs.ts` + `db/repos/job-events.ts`: `appendEvent(jobId, e)` (dalam `tx`,
`seq = event_seq + 1`, cap `PXE_JOB_LOG_MAX_EVENTS`: event installer setelah cap dibuang dan satu
event `warn` "log dipotong" dicatat sekali; event `stage`/`system` tetap dicatat), `eventsAfter(jobId,
seq, limit)`, `listJobs({hostId, status, limit, before})`, `pruneHostHistory(hostId, keep)` (hapus job
final tertua di luar `PXE_JOB_HISTORY_PER_HOST`, dipanggil di `installHosts` dalam transaksi yang
sama). Penggabungan: event `system` dengan `message`+`source` sama dengan event terakhir job dalam
60 dtk → `repeat += 1` (tidak menambah `seq`, tetapi `updated_at` job berubah dan SSE mengirim
ulang event itu dengan `id` sama + `repeat` baru — klien mengganti baris, bukan menambah).

### 2.3 Siklus hidup job

Mesin status (job & host): `booting → installing → configuring → done`; apa pun aktif → `failed`.

| Pemicu | Kondisi | Efek |
|---|---|---|
| `POST /api/hosts/:id/install` / bulk | syarat M4 + host tidak `booting|installing|configuring` | job `booting`, event `stage` "Job install dibuat (OS …)", `pruneHostHistory`; job aktif lama (seharusnya tidak ada) → `failed` `superseded` + event |
| `GET /boot/{mac}.ipxe` | job `booting`, `installer_boots < N`, image tersedia, lease terverifikasi atau flag insecure | script installer, token baru, `installer_boots += 1`, event "Script installer dilayani (ke-k/N, platform, IP)" |
| `GET /boot/{mac}.ipxe` | job `booting`, `installer_boots ≥ N` | **boot lokal**, job+host `failed` `installer-boot-limit`, token dicabut, event `error` |
| `GET /boot/{mac}.ipxe` | job `installing` | **boot lokal**, token & `installer_boots` tidak berubah, event `warn` (digabung) "PXE boot ulang saat Installing: boot lokal, instalasi tidak diulang" (CR-4-1) |
| `GET /boot/{mac}.ipxe` | job `configuring`/tanpa job aktif | boot lokal (M4) |
| `GET /boot/{mac}.ipxe` | lease tidak dikonfigurasi dan flag insecure = 0 | boot lokal, tanpa token (SR-4-2, O10-B) |
| `GET /boot/{mac}/{token}/{file}` sukses | — | event "File `<file>` diambil dari IP"; file utama → `installing` (M4) |
| `POST …/status` | M4 | event `stage`; `failed` dari installer → `failure_reason=installer-error` |
| `POST …/log` | §2.4 | event `installer` |
| `sweepJobs(now)` | job aktif dan `now − masuk tahap > timeout tahap` | job+host `failed` `timeout-<tahap>`, stage `{failed, at, source:'watchdog'}`, token dicabut, event `error` "Timeout di tahap X (> N mnt)" |

"Masuk tahap" = `at` entri `stages` terakhir yang statusnya = status job. `sweepJobs` idempoten,
dalam `BEGIN IMMEDIATE`, dipanggil [O6]: di awal `GET /api/hosts`, `GET /api/jobs*`,
`decideBoot`, `serveConfigFile`, `handleStatusCallback`, `handleLogPost` (khusus host terkait
untuk jalur `/boot`), dan oleh timer `startWatchdog()` (`src/instrumentation.ts` →
`lib/server/watchdog.ts`; satu per proses lewat simbol global, `unref`, hanya runtime `nodejs`).

Install ulang setelah `failed` memakai jalur install biasa (host `failed` bukan in-progress).
Callback/log dengan token job yang sudah `failed` → 404 seragam (token dicabut); host tetap
Failed (konsekuensi O7 yang dicatat).

### 2.4 Endpoint log installer — `POST /boot/{mac}/{token}/log`

Route `app/boot/[name]/[token]/log/route.ts`. Otorisasi identik dengan callback status
(`authorize` + job aktif + `ipAllowed` dengan IP statis/mgmt) → selain itu 404 seragam.
Pemeriksaan body `text/plain`:
- Ukuran > 16 KB → 413, diperiksa **sebelum** otorisasi lewat `readBodyLimited` (hasilnya tidak
  bergantung pada token, jadi tidak membocorkan validitasnya).
- Setelah otorisasi: > 200 baris → 413; > 60 request/menit per job → 429.
- Baris dipisah `\n`; `\r` dan karakter kontrol (kecuali `\t`) dibuang; baris > 2048 karakter
  dipotong + `…[dipotong]`; baris kosong diabaikan.
- Setiap baris → `redactSecrets` → event `installer` level `info` (penanda gagal dari generator
  yang berawalan `ERROR` → `error`).

`lib/server/redact.ts` `redactSecrets(text)`: token pada `/boot/<mac>/<43 base64url>` →
`/boot/<mac>/[REDACTED]`, `token[=:]<43>` → `[REDACTED]`, hash `$6$…` → `$6$[REDACTED]`, blok
`-----BEGIN … PRIVATE KEY-----…END…` → `[REDACTED PRIVATE KEY]`, blob base64 ≥ 40 karakter yang
(didekode UTF-8/UTF-16LE, offset 0–3, hingga 2 lapis) memuat salah satu pola → `[REDACTED-B64]`
(selaras `infra/redact-evidence.sh`). Dipakai juga untuk pesan event sistem yang memuat input
eksternal.

### 2.5 Generator — hook log (kontrak B-5 dipertahankan)

`installers/shell.ts`: `callbackUrlCmd` digeneralisasi menjadi `callbackBaseCmd(method, mac)` →
variabel `b` = `http(s)://…/boot/<mac>/<token>/` (pola sed yang sama: hanya MAC host ini + 43
karakter), lalu `callbackCmd(…, stage)` memakai `${b}status` dan `logCmd(method, mac, message)`
memakai `${b}log` (`printf '%s\n' '<pesan konstan>' | curl -fsS -m 15 --data-binary @-
-H 'Content-Type: text/plain' "${b}log" || wget … || true`). `logTailCmd(method, mac, files[], n)`
mengirim `tail -n <n>` file log yang ada. Pesan selalu konstanta generator (diuji tidak memuat nilai
pengguna); `b` kosong → no-op, installer tidak gagal.

| OS | Titik | Isi |
|---|---|---|
| Ubuntu | `early-commands` | `log "installer: autoinstall mulai"` |
| | `late-commands` | `log "installer: late-commands mulai"` sebelum callback `configuring` (urutan M4 dipertahankan), `log "installer: konfigurasi target selesai"` di akhir |
| | `error-commands` | `logTail` (`/var/log/installer/subiquity-server-debug.log`, `/var/log/curtin/install.log`, 100 baris masing-masing bila ada) lalu callback `failed` |
| Debian | `preseed/early_command` | log mulai |
| | `preseed/late_command` | log sebelum callback `configuring` dan di akhir |
| Rocky | `%pre` | log mulai |
| | `%post` | log sebelum callback `configuring` dan di akhir |
| | `%onerror` | `logTail` (`/tmp/anaconda.log`, `/tmp/program.log`) lalu `failed` |
| First-boot | `pxe-callback-done` | `log "first-boot: OS terpasang boot dari disk: $(hostname) $(ip -4 -o addr show scope global | …)"` lalu `done` (URL dari `/etc/pxe-callback/url`, basis tanpa `status`) |

Path log installer di atas adalah kandidat; backend-dev memverifikasinya di run KVM (Ubuntu) dan
memilih file yang ada saat runtime (`[ -f ]`). `boot-script.ts` (CR-4-5): `waitScript` memakai
`chain --replace --autofree … || exit 1`.

### 2.6 API

| Endpoint | Perilaku |
|---|---|
| `GET /api/jobs?hostId=&status=&limit=&before=` | Sweep dulu. `{jobs: JobSummary[], nextBefore, serverTime}` urut `created_at DESC, id`; `limit` 1–200 (default 50); param invalid → 400. `JobSummary` = `id, hostId, host{mac, hostname}, type, osImageId, status, stages[], failureReason, installerBoots, createdAt, updatedAt, finishedAt, eventCount`. Tidak pernah `token`, `tokenHash`, `tokenExpiresAt`. `no-store`. |
| `GET /api/jobs/:id` | `JobSummary`; id tak valid → 400; tidak ada → 404. |
| `GET /api/jobs/:id/logs` | `Accept: text/event-stream` → SSE [O2]: backlog `event: log` (`id: <seq>`, `data` JSON `{seq, at, kind, level, source, message, repeat}`), lalu tail 1 dtk; `event: stage` saat status job berubah (`data` = `JobSummary` ringkas); heartbeat `: ping` 15 dtk; `event: end` + tutup saat job final & tersalurkan; resume via `Last-Event-ID` atau `?after=`; tutup otomatis 30 mnt + `retry: 3000`; batas 50 koneksi serentak → 503; `req.signal` abort menghentikan loop. Selain itu (JSON) → `{events, lastSeq, final}` setelah `after`. |
| `GET /api/hosts` | + `lastJob {id, status, failureReason, createdAt} | null` per host (sweep dulu). |
| `PATCH /api/ssh-keys/:id` | `{name}` (1–64), `guardMutation("json")`; 404/400/422; public key/fingerprint tidak bisa diubah. |
| `GET /api/ssh-keys`, `GET /api/os-images` | + `usedBy` (jumlah host). |
| Semua GET `/api/**` | Allowlist Host (SR-3-5) juga diterapkan → 403 bila Host tidak diizinkan [O9]. |

`http.ts` (CR-4-15/SR-4-9): `requestHost` membaca `X-Forwarded-Host` hanya bila
`settings.trustProxy`. Kolom DB `jobs.kind` disajikan sebagai `type` (nama SPEC §5).

### 2.7 Endpoint boot — perbaikan kecil

- CR-4-9/SR-4-5: `app/boot/[name]/route.ts` tidak lagi `decodeURIComponent` ganda; nama yang
  gagal didekode/di-parse → 400 `MAC tidak valid` (tidak pernah 500).
- CR-4-8/SR-4-4: `logBootDenied` menerima `parseBootMac(name) ?? "-"` dan `reason` di-escape
  (`JSON.stringify` atau penggantian karakter non-cetak) sehingga satu penolakan = satu baris.

### 2.8 UI

Semua mengikuti SPEC §1: tanpa shadow, hairline, pastel HANYA di pill/timeline, mono untuk
MAC/IP/hostname/id/path/log/fingerprint, judul halaman 26/400, label kolom 11/600 uppercase.

**Provisioning Jobs** (`app/(dashboard)/jobs/page.tsx` + `components/jobs/*`, hook
`hooks/use-jobs.ts`, `hooks/use-job-log.ts`):
- Tata letak master-detail dengan state di URL: `/jobs?host=<id>&job=<id>&status=<s>` (deep link
  dari "Lihat log"); di 375 px detail ditumpuk di bawah daftar.
- Daftar (TanStack Table): host (hostname mono atau MAC mono), OS, status (pill), dibuat (relatif),
  durasi, alasan gagal (caption). Filter status & host (combobox mono), polling 5 dtk [O1]. Empty
  state: "Belum ada job — job dibuat saat Install OS dijalankan dari halaman Hosts".
- Bila `?host=` aktif: judul section "Riwayat <host>" + jumlah job; job terbaru dipilih otomatis.
- Detail: **timeline** horizontal Booting → Installing → Configuring → Done (atau Failed),
  pill pastel per tahap yang tercapai (warna SPEC, Done teks putih), tahap belum tercapai =
  pill netral hairline, Failed merah `semantic-error` dengan alasan (teks Indonesia, mis.
  "Timeout di tahap Installing (> 15 mnt)"); di bawah tiap pill waktu (mono 13 px) dan durasi;
  info "Installer dilayani k/N".
- **Log viewer**: card putih hairline radius 12, `font-mono` 13 px, baris `HH:MM:SS sumber
  pesan` (waktu dan sumber muted), level error teks `semantic-error`, penggabungan ditampilkan
  `×n`; indikator koneksi (titik `semantic-success` "Live" / muted "Selesai" / "Terputus —
  mencoba ulang"); toggle "Ikuti log" (autoscroll); EventSource dengan fallback polling JSON 5 dtk
  setelah 3 kegagalan; event `stage` → invalidasi query `hosts`/`jobs`.

**Hosts**: pill Failed di tabel memiliki caption/tooltip alasan dari `lastJob.failureReason`;
"Lihat log" tetap ke `/jobs?host=<id>`; Install OS tersedia untuk host Failed (perilaku M4).

**OS Images** (`app/(dashboard)/os-images/page.tsx`): tabel id (mono), nama, versi, arsitektur,
metode, sumber kernel/initrd/repo (mono) + URL hasil `PXE_MEDIA_URL/<repo>` (mono), tersedia
(✓ / alasan muted + ikon info, DR-4-5), bootable, dipakai N host; dialog "Daftarkan image"
(field sesuai `newOsImagePayload`, error server 400/409/422 per field), hapus dengan AlertDialog
(409 "dipakai N host" tampil). Tombol primary oranye hanya "Daftarkan image".

**SSH Keys** (`app/(dashboard)/ssh-keys/page.tsx`): tabel nama, tipe, fingerprint SHA256 (mono),
komentar (mono), dibuat (tanggal), dipakai N host; dialog tambah (paste atau unggah `.pub`,
preview fingerprint, validasi ssh-ed25519/ssh-rsa/ecdsa-*, error 409 duplikat), rename inline
(PATCH), hapus dengan AlertDialog (409 bila dipakai).

**Perbaikan design carry-over**:
- DR-4-1: judul Sheet `Konfigurasi <span class="type-data">{name}</span>` dan judul AlertDialog
  install dengan hostname/MAC dalam `type-data` (mono).
- DR-4-2: `SheetTitle` 16–18 px / 600 (`font-semibold` eksplisit atau `extendTailwindMerge` untuk
  utility `type-*`).
- DR-4-3: saat Sheet terbuka, error install tidak memakai toast (Alert di Sheet cukup).
- DR-4-4: bulk dengan sebagian gagal → Sheet tetap terbuka, Alert per host gagal + ringkasan
  "N host mulai diinstal".
- DR-4-5: "tidak tersedia" pada kartu OS = `muted-foreground` + ikon info; merah hanya bila image
  itu yang terpilih (footer/alert).
- DR-4-6: alasan "Reboot ke PXE" di luar wrapper yang di-dim (kontras ≥ 4,5:1).
- DR-4-7: placeholder "dibangun di tahap 4/5" hilang karena ketiga halaman dibangun.

### 2.9 Infra & KVM

- `infra/node.sh poweroff <name>` (= `virsh destroy`, definisi & disk tetap) dan `start <name>`
  (`virsh start`, listener serial disambung `append`); guard `assert_name`, tolak VM server.
- `infra/kvm-run.sh`: spec node `NN:uefi|bios[:destroy]`; env baru untuk suite
  `PXE_KVM_POWER_CMD` (node.sh); pemilihan spec per milestone (`e2e-kvm/m5-*.spec.ts`; `m4`
  tetap dapat dijalankan); fungsi `assert_server_logs` setelah `collect_evidence` (CR-4-12):
  `grep` log dnsmasq memuat TFTP `snponly.efi` untuk node UEFI dan log nginx memuat
  `GET /boot/<mac>/***/user-data` 200 untuk tiap node → entri `results.json`, gagal → exit ≠ 0;
  ekspor log job (`GET /api/jobs/:id/logs?format=json`) per node ke `kvm/jobs-<name>.json`
  sebelum redaksi.
- `infra/cleanup.sh` (CR-4-13): tolak run id `server` dan id lain yang prefix-nya bertabrakan
  dengan VM infra (`pxe-test-server*`); glob disk dibatasi `pxe-test-<run>-node[0-9][0-9].qcow2`.
- `infra/redact-evidence.sh` (CR-4-14): redaksi in-place hanya untuk file teks (`grep -Iq .`);
  scan tetap mencakup semua file (biner ber-secret → exit 1).
- `infra/server/nginx-pxe.conf` [O9]: `location /boot/` dan `/media/` tanpa pembatasan;
  `location /` (UI + `/api/`) `allow ${PXE_ADMIN_ALLOW}; deny all;` (default `10.99.0.1`),
  `location /api/jobs/` dengan `proxy_buffering off`, `proxy_read_timeout 3600s`,
  `gzip off`; `nginx -t` di `install-dashboard.sh`.
- `infra/server/dashboard.env`: nilai kolom KVM §2.1.
- Node M5: `pxe-test-m5-node11` (UEFI, MAC `52:54:00:99:00:11`, IP `10.99.0.21`, peran `destroy`),
  `pxe-test-m5-node12` (BIOS, `…:12`, `10.99.0.22`), berurutan, 2 GB, satu server run.

## 3. Task

| ID | Owner | Deskripsi | Dependensi | File |
|---|---|---|---|---|
| M5-T1 | backend-dev | Settings baru + validasi silang (TTL, SR-4-2, CR-4-10 IPv6), `/api/settings` diperluas, `.env.example` (komentar risiko flag insecure), `dashboard.env` KVM; CR-4-15 `requestHost`; allowlist Host untuk semua GET `/api/**` [O9]. | — | `lib/server/settings.ts`, `lib/server/http.ts`, `app/api/**/route.ts` (GET), `.env.example`, `infra/server/dashboard.env` |
| M5-T2 | backend-dev | Migrasi 2 + repo `jobs`/`job-events` (append+seq+cap+gabung, list/filter/cursor, prune riwayat, backfill). | — | `lib/server/db/migrations.ts`, `lib/server/db/repos/{jobs,job-events}.ts` |
| M5-T3 | backend-dev | Siklus hidup job §2.3: CR-4-1 (`installer_boots`, batas N, `installing` → lokal tanpa rotasi), SR-4-2 tanpa lease → lokal, `failure_reason`, event di setiap titik, `sweepJobs` + pemanggil + `startWatchdog`/`instrumentation.ts`. | T1, T2 | `lib/server/{discovery,provisioning,install-service,watchdog}.ts`, `src/instrumentation.ts` |
| M5-T4 | backend-dev | `redact.ts`; route `POST /boot/{mac}/{token}/log` (batas ukuran/baris/laju); CR-4-8/SR-4-4 `logBootDenied`; CR-4-9 decode. | T2, T3 | `lib/server/{redact,boot-http}.ts`, `lib/server/provisioning.ts`, `app/boot/[name]/route.ts`, `app/boot/[name]/[token]/{log,status,[file]}/route.ts` |
| M5-T5 | backend-dev | Generator: `callbackBaseCmd`/`logCmd`/`logTailCmd`, hook §2.5 di Ubuntu/Debian/Rocky/first-boot; CR-4-5 `waitScript --replace`. | T4 (kontrak endpoint) | `lib/server/installers/{shell,firstboot,ubuntu,debian,rocky}.ts`, `lib/server/boot-script.ts`, golden file |
| M5-T6 | backend-dev | API jobs (`GET /api/jobs`, `/:id`, `/:id/logs` SSE+JSON), `lastJob` di hosts, `PATCH /api/ssh-keys/:id`, `usedBy`. | T2, T3 | `app/api/jobs/**`, `app/api/hosts/route.ts`, `app/api/ssh-keys/**`, `app/api/os-images/route.ts`, `lib/server/{jobs-service,sse}.ts`, `lib/server/library-service.ts` |
| M5-T7 | backend-dev | Infra §2.9: `node.sh poweroff|start`, `kvm-run.sh` (spec peran, asersi log server CR-4-12, ekspor log job, pemilihan spec), `cleanup.sh` CR-4-13, `redact-evidence.sh` CR-4-14, nginx allowlist + SSE, `install-dashboard.sh nginx -t`. Paralel sejak awal. | — (ekspor log butuh T6) | `infra/**` |
| M5-T8 | frontend-dev | Halaman Provisioning Jobs §2.8 (daftar, filter, riwayat per host, timeline, log viewer SSE + fallback, deep link), hook `use-jobs`/`use-job-log`, invalidasi host/job dari event `stage`; Settings menampilkan pengaturan job. | T6 | `app/(dashboard)/jobs/page.tsx`, `components/jobs/**`, `hooks/use-jobs.ts`, `hooks/use-job-log.ts`, `components/settings/settings-view.tsx` |
| M5-T9 | frontend-dev | Halaman OS Images & SSH Keys (CRUD) §2.8; hapus placeholder (DR-4-7). | T6 | `app/(dashboard)/{os-images,ssh-keys}/page.tsx`, `components/{os-images,ssh-keys}/**`, `hooks/use-os-images.ts`, `hooks/use-ssh-keys.ts` |
| M5-T10 | frontend-dev | Tabel host: alasan Failed dari `lastJob`; DR-4-1..DR-4-6. | T6 | `components/hosts/*`, `components/host-config/{config-sheet,tab-os}.tsx`, `components/hosts/host-actions.tsx`, `lib/utils.ts` (bila `extendTailwindMerge`) |
| M5-T11 | test-engineer | Unit: settings baru (SR-4-2, CR-4-10, TTL), `redactSecrets`, `transition`/`sweepJobs` (jam injeksi), penggabungan event, generator hook (sh terhadap cmdline palsu), CR-4-4 `KCMD` dari output `installerScript`, CR-4-5, `logBootDenied`, `requestHost`. | T1–T5 | `src/**/*.test.ts` |
| M5-T12 | test-engineer | Integration route handler (DB tmp, fixture lease, jam injeksi): CR-4-1, watchdog + pemicu, install ulang, endpoint log, SSE (stream dibaca + fake timers), API jobs/ssh-keys/os-images/hosts, CR-4-9, allowlist GET, migrasi v1→v2, retensi, regresi M2–M4. `test-migration.md` untuk test M4 yang kini perlu `PXE_INSECURE_NO_LEASE_CHECK=1` atau fixture lease (pengetatan, bukan pelemahan). | T3–T6 | `src/app/**/*.test.ts`, `src/lib/server/**/*.test.ts` |
| M5-T13 | test-engineer | E2E Playwright lokal: halaman Jobs (live), timeline, log SSE, Failed via callback, timeout via webserver kedua [O13], OS Images, SSH Keys, DR-4-1..7, regresi M1–M4. | T8–T10 | `dashboard/e2e/m5-*.spec.ts`, `dashboard/playwright.config.ts` (webServer + project kedua saja) |
| M5-T14 | test-engineer | Test shell infra (virsh/ssh palsu + `INFRA_DRY_RUN`): `node.sh poweroff|start`, CR-4-13, CR-4-14, asersi log CR-4-12, konfigurasi nginx statis. | T7 | `infra/test/*.sh` |
| M5-T15 | test-engineer | Suite KVM `dashboard/e2e-kvm/m5-*.spec.ts` + perluasan `kvm-harness.ts`/`verify-node.sh` (cek allowlist dari node); jalankan `infra/kvm-run.sh m5 --nodes "11:uefi:destroy 12:bios"`; `results.json`; scan bukti. | T7, T8, T13 | `dashboard/e2e-kvm/**`, `.agent/runs/m5/kvm/**` |

Urutan: (T1 ∥ T2 ∥ T7) → T3 → (T4 → T5) ∥ T6 → (T8 ∥ T9 ∥ T10) → T11/T12/T13; T14 setelah T7;
T15 terakhir. Smoke KVM dini disarankan setelah T3+T6 (satu node UEFI, `virsh destroy` saat
Installing → `start` → verifikasi boot lokal) sebelum UI selesai, untuk memvalidasi CR-4-1 di
firmware nyata (R6/R8).

## 4. Acceptance criteria

### Settings & hardening
- **AC-5.1** (unit + integration + e2e) Env baru ter-parse dengan default §2.1; nilai di luar batas
  atau non-angka → error yang menyebut nama variabel; `PXE_TOKEN_TTL_MIN` < jumlah tiga timeout →
  error menyebut `PXE_TOKEN_TTL_MIN`. `GET /api/settings` memuat `jobTimeouts`,
  `maxInstallerBoots`, `insecureNoLeaseCheck` dan tidak memuat path DB/flag rahasia lain; halaman
  Settings menampilkan nilai itu read-only (mono).
- **AC-5.2** (unit + integration + static) SR-4-2 [O10]: `PXE_TRUST_PROXY=1` tanpa
  `PXE_DNSMASQ_LEASES` → error yang menyebut kedua variabel; dengan
  `PXE_INSECURE_NO_LEASE_CHECK=1` → diterima dan peringatan tercatat. Tanpa lease dan tanpa flag,
  `GET /boot/{mac}.ipxe` untuk host ber-job `booting` → script lokal tanpa `kernel`/token, token_hash
  dan `installer_boots` tidak berubah. `.env.example` memuat ketiga variabel dengan komentar risiko
  (test statis).
- **AC-5.3** (unit) CR-4-10: `PXE_BASE_URL=http://[fd00::2]` dan `PXE_MEDIA_URL` IPv6 → error
  settings; untuk daftar contoh URL yang diterima settings, `entryScript`/`installerScript` tidak
  melempar (konsistensi `ipxeSafe`).
- **AC-5.4** (unit + integration) CR-4-15/SR-4-9 + [O9]: dengan `PXE_TRUST_PROXY=0`, mutasi ber-Host
  tak diizinkan + `X-Forwarded-Host` diizinkan → 403; dengan `=1` header itu dipakai. Setiap GET
  `/api/**` (hosts, hosts/:id, config, jobs, jobs/:id, jobs/:id/logs, settings, server-status,
  network, os-images, ssh-keys) dengan Host di luar allowlist → 403; dengan Host diizinkan → 200.
- **AC-5.5** (integration) CR-4-9: `GET /boot/%25zz.ipxe`, `/boot/%E0%A4%A.ipxe`,
  `/boot/zz:zz.ipxe`, `/boot/.ipxe` → 400 `MAC tidak valid` (tidak ada 500), tanpa host baru.
- **AC-5.6** (unit + integration) CR-4-8/SR-4-4: penolakan `POST /boot/<seg>/<tok>/status` dan
  `GET …/{file}` dengan segmen MAC berisi `%0a[boot] tolak …` menghasilkan tepat satu baris log
  yang memuat `mac=-` (atau MAC ternormalisasi untuk MAC valid) dan tidak memuat CR/LF dari input;
  `reason` berisi karakter kontrol ter-escape; log tidak memuat token.

### Siklus hidup job (CR-4-1, watchdog, install ulang)
- **AC-5.7** (integration) CR-4-1 [O8]: job `booting` dengan `PXE_JOB_MAX_INSTALLER_BOOTS=3` →
  permintaan `/boot/{mac}.ipxe` ke-1..3 masing-masing script installer dengan token baru (hash
  berganti, `installer_boots` 1..3, event per penyajian); permintaan ke-4 → script lokal (tanpa
  `kernel`/token), job & host `failed` `installer-boot-limit`, token dicabut. Job `installing` →
  `/boot/{mac}.ipxe` → script lokal, `token_hash`, `token_expires_at`, dan `installer_boots` tidak
  berubah, satu event `warn` (permintaan identik berulang dalam 60 dtk → `repeat` bertambah, bukan
  event baru); setelah itu `POST …/status stage=done` dengan token sah → 200, host `done` (callback
  terlambat yang sah tetap diterima).
- **AC-5.8** (integration) Watchdog [O6/O7] dengan jam injeksi dan timeout (booting 60, installing
  120, configuring 60): untuk tiap tahap, `now` = masuk tahap + timeout − 1 dtk → tidak berubah; +
  timeout + 1 dtk → job & host `failed`, `failure_reason=timeout-<tahap>`, `stages` diakhiri
  `{failed, source:'watchdog'}`, `finished_at` terisi, token dicabut (URL file/status → 404), satu
  event `error`; sapuan kedua tidak mengubah apa pun; job `done`/`failed` tidak tersentuh.
- **AC-5.9** (integration + unit) Pemicu sapuan: setelah lewat timeout, masing-masing `GET
  /api/hosts`, `GET /api/jobs`, `GET /api/jobs/:id`, `GET /boot/{mac}.ipxe` (host itu) menampilkan
  hasil yang sudah `failed` dan `/boot/{mac}.ipxe` → script lokal; `startWatchdog()` (fake timers)
  memanggil sapuan tiap `PXE_WATCHDOG_INTERVAL_SEC`, hanya satu timer walau dipanggil dua kali,
  dan `stopWatchdog()` membersihkannya.
- **AC-5.10** (integration) Install ulang setelah `failed` (alasan timeout, installer-boot-limit,
  installer-error): `POST /api/hosts/:id/install` → 200, job baru `booting` dengan
  `installer_boots=0`; job lama tetap `failed` dengan alasan semula; `GET /api/jobs?hostId=` = 2
  job; token job lama → 404; `/boot/{mac}.ipxe` melayani installer untuk job baru.
- **AC-5.11** (integration) Callback/log dengan token job yang sudah `failed` oleh watchdog → 404
  seragam; host tetap `failed`; tidak ada event baru pada job itu.

### Event, log installer, retensi
- **AC-5.12** (integration) Siklus simulasi lengkap (install → boot dilayani → `user-data`,
  `meta-data` diambil → `configuring` → `done`) menghasilkan event berurutan dengan `seq` naik
  ketat mulai 1, `kind`/`source` sesuai §2.3, IP sumber tercatat; seluruh pesan event di DB tidak
  memuat token plaintext, `token_hash`, maupun `$6$`.
- **AC-5.13** (integration) `POST /boot/{mac}/{token}/log`: otorisasi = callback status (token
  salah, MAC lain, IP asing, job final, expired → 404 body identik `not found`); body 3 baris →
  3 event `installer` (urut, CR dan karakter kontrol dibuang, baris kosong diabaikan); baris
  > 2048 → dipotong + penanda; > 16 KB → 413 (juga dengan token salah) tanpa event; > 200 baris
  → 413 tanpa event; > 60 request/menit per job → 429; setelah `PXE_JOB_LOG_MAX_EVENTS` → satu
  event `warn` "log dipotong", event installer berikutnya dibuang, event `stage` tetap tercatat.
- **AC-5.14** (unit) `redactSecrets` (tabel): token di path `/boot/<mac>/<43>/x` (MAC `:`/`-`/hex),
  `token=<43>`, `"token":"<43>"`, hash `$6$rounds=5000$salt$…`, blok OpenSSH/PEM private key,
  blob base64 (UTF-8 & UTF-16LE, offset 0–3, dua lapis) berisi token/hash → tersamarkan; teks tanpa
  secret identik; idempoten. Integration: baris log berisi pola itu tersimpan tersamarkan.
- **AC-5.15** (integration) Migrasi & retensi: DB v1 berisi job M4 → migrasi 2 sukses, job lama
  utuh, `installer_boots` = jumlah stage `boot-script`; migrasi dua kali tidak error. Dengan
  `PXE_JOB_HISTORY_PER_HOST=2`, install ke-4 untuk satu host menyisakan 2 job final terbaru + job
  aktif, event job yang dihapus ikut terhapus; hapus host → semua job & event host itu terhapus.

### API
- **AC-5.16** (integration) `GET /api/jobs`: filter `hostId`/`status`, urut terbaru dulu, `limit` +
  `nextBefore` (halaman tanpa duplikat/lompatan), bentuk `JobSummary` persis §2.6; respons tidak
  memuat kunci `token`, `tokenHash`, `token_hash`, `tokenExpiresAt` (rekursif); `limit=0`,
  `limit=500`, `status=xyz`, `hostId` bukan 12 hex → 400. `GET /api/jobs/:id` → 200/400/404.
  `GET /api/hosts` memuat `lastJob` yang cocok dengan job terbaru host.
- **AC-5.17** (integration) SSE `GET /api/jobs/:id/logs` (`Accept: text/event-stream`): header
  `text/event-stream`, `Cache-Control` memuat `no-cache`, `X-Accel-Buffering: no`; backlog terkirim
  dengan `id` = `seq`; event yang disisipkan setelah tersambung tiba ≤ 2 dtk; `Last-Event-ID: k` →
  hanya event `seq > k`; event gabungan dikirim ulang dengan `id` sama dan `repeat` baru;
  heartbeat `: ping` tiap 15 dtk (fake timers); perubahan status → `event: stage`; job final →
  `event: end` lalu stream selesai; abort klien menghentikan loop (tidak ada timer tersisa);
  koneksi ke-51 → 503; job tak ada → 404. Mode JSON (`?format=json&after=k`) → `{events, lastSeq,
  final}` konsisten dengan SSE.
- **AC-5.18** (integration) `PATCH /api/ssh-keys/:id` `{name}` → 200 dan tersimpan; nama kosong /
  > 64 → 400; id tak ada → 404; tanpa `application/json`/Origin lintas → 415/403; field
  `publicKey`/`fingerprint` di body diabaikan atau ditolak 400 (tidak berubah). GET
  ssh-keys/os-images memuat `usedBy` yang benar; hapus yang dipakai → 409 (regresi).

### Generator & script boot
- **AC-5.19** (unit) Hook log §2.5: Ubuntu `early-commands`, `late-commands` (log sebelum callback
  `configuring`), `error-commands` (log tail lalu callback `failed`, urutan itu); Debian
  early/late; Rocky `%pre`/`%post`/`%onerror`; first-boot mengirim log lalu `done`. Perintah yang
  dihasilkan, bila dijalankan `sh` terhadap cmdline palsu (MAC host + token 43), mem-POST ke
  `<base>/boot/<mac>/<token>/log` dan `/status` (`curl` stub mencatat URL); dengan MAC lain atau
  token 42 karakter → tidak ada request dan exit 0. Output generator (teks + payload base64 yang
  didekode) tidak memuat token, `/log` ber-token, maupun nilai pengguna di pesan log
  (hostname/username uji tidak muncul di argumen `logCmd`). Golden file diperbarui.
- **AC-5.20** (unit) CR-4-4: cmdline untuk evaluasi callback diturunkan dari baris `kernel` output
  `installerScript()` nyata untuk `autoinstall`, `preseed`, `kickstart` (bukan konstanta
  tulis-tangan); URL hasil = `<base>/boot/<mac>/<token>/status` untuk ketiganya; test negatif:
  script hasil mutasi (mis. `inst.ks=` → `ks=`) membuat evaluasi gagal (test mendeteksi kopling).
- **AC-5.21** (unit) CR-4-5: `waitScript` memuat `chain --replace --autofree` dan setiap `exit` di
  `entryScript`, `localBootScript`, `waitScript` adalah `exit 1`.

### UI
- **AC-5.22** (e2e) Halaman Jobs: setelah install + callback disimulasikan via `request`, daftar
  menampilkan job (host mono, OS, pill, dibuat relatif, durasi) dan status berubah tanpa reload
  ≤ 10 dtk; filter status & host mempersempit daftar; empty state saat tanpa job; tidak ada
  placeholder.
- **AC-5.23** (e2e) Timeline: job done menampilkan 4 pill berurutan dengan background persis
  `#dfa88f`, `#c0a8dd`, `#9fc9a2`, `#c08532` (Done teks putih) dan waktu mono; job failed
  menampilkan pill Failed `#cf2d56` + alasan teks; audit: tidak ada warna pastel di luar elemen
  `[data-status]`/timeline, box-shadow 0, oranye hanya CTA primary.
- **AC-5.24** (e2e) Log streaming: detail job terbuka, test mengirim `POST …/log` → baris muncul
  ≤ 3 dtk tanpa reload, `font-family` JetBrains Mono, autoscroll saat "Ikuti log" aktif; baris
  berisi hash/token fixture tampil tersamarkan; koneksi SSE diputus (`page.route` abort sekali) →
  indikator "Terputus", lalu tersambung ulang tanpa baris ganda; job selesai → indikator "Selesai".
- **AC-5.25** (e2e) Integrasi Hosts: "Lihat log" membuka `/jobs?host=<id>` dengan job terbaru
  terpilih dan judul riwayat host; host dengan job `failed` (callback `failed`) menampilkan pill
  Failed + alasan; Install OS dari host itu → riwayat host berisi 2 job.
- **AC-5.26** (e2e, webserver kedua [O13]) Timeout: `PXE_JOB_BOOTING_TIMEOUT_MIN=1`,
  `PXE_WATCHDOG_INTERVAL_SEC=5`: install tanpa callback → ≤ 90 dtk pill Failed di tabel Hosts dan
  halaman Jobs tanpa reload, alasan "Timeout di tahap Booting"; Install OS ulang → Booting.
- **AC-5.27** (e2e) OS Images: tabel memuat image seed (id/sumber/URL mono), image tanpa media
  "tidak tersedia" dengan warna muted (bukan `#cf2d56`); dialog daftar: payload invalid → error
  server per field, valid → baris baru; hapus image terpakai → pesan 409, tidak terpakai → hilang
  setelah konfirmasi.
- **AC-5.28** (e2e) SSH Keys: tambah via paste dan via unggah `.pub` (fingerprint SHA256 mono
  tampil sama dengan `ssh-keygen -lf` fixture), key invalid → error, duplikat → pesan 409, rename
  tersimpan setelah reload, hapus terpakai → 409, tidak terpakai → hilang; key baru muncul di
  library tab SSH Keys Sheet.
- **AC-5.29** (e2e) DR-4-1 + DR-4-2: di judul Sheet dan judul AlertDialog install, elemen
  MAC/hostname ber-`font-family` JetBrains Mono; judul Sheet `font-weight` 600 dan ukuran 16–18 px.
- **AC-5.30** (e2e) DR-4-3 + DR-4-4: install single ditolak saat Sheet terbuka → tidak ada toast
  yang bounding box-nya beririsan dengan footer Sheet, Alert di Sheet memuat pesan; bulk dengan 1
  sukses + 2 gagal → Sheet tetap terbuka, Alert menyebut kedua host gagal (mono) + ringkasan
  "1 host mulai diinstal", host sukses ber-pill Booting di tabel.
- **AC-5.31** (e2e) DR-4-5 + DR-4-6: alasan "tidak tersedia" di kartu OS ber-warna `#807d72` saat
  image tidak dipilih; teks alasan "Reboot ke PXE" memiliki kontras efektif ≥ 4,5:1 terhadap latar
  (warna dan opacity terhitung).
- **AC-5.32** (static + e2e) DR-4-7: tidak ada string "dibangun di tahap" di `src/`; halaman
  `/os-images`, `/ssh-keys`, `/jobs` menampilkan judul 26 px dan konten nyata.

### Infra (unit-shell)
- **AC-5.33** `node.sh poweroff <name>` → hanya `virsh destroy` (tanpa `undefine`, tanpa `rm` disk);
  `start` → `virsh start` + listener serial `append`; keduanya menolak (exit ≠ 0, tanpa perintah
  virsh) `pxe-test-node01`, `ubuntu24.04`, `default`, `int`, `pxe-test-server`, nama tanpa prefix.
- **AC-5.34** CR-4-13: `cleanup.sh server` dan run id lain yang menghasilkan prefix `pxe-test-server`
  → exit ≠ 0 tanpa virsh/rm; `cleanup.sh m5` dengan fixture `.agent/vms/pxe-test-server-base.qcow2`
  dan `pxe-test-m5-node11.qcow2` hanya menghapus yang kedua.
- **AC-5.35** CR-4-14: `redact-evidence.sh` atas direktori berisi PNG fixture tanpa secret
  (sha256 tidak berubah) dan teks bertoken (tersamarkan) → exit 0; PNG/biner yang memuat token →
  tidak diubah tetapi exit 1 (scan tetap mencakup biner).
- **AC-5.36** CR-4-12: `assert_server_logs` dengan fixture log dnsmasq/nginx yang memuat TFTP
  `snponly.efi` (node UEFI) dan `GET /boot/<mac>/***/user-data` 200 → entri PASS di `results.json`;
  fixture tanpa salah satunya → FAIL dan exit ≠ 0; dry-run `kvm-run.sh m5 --nodes "11:uefi:destroy
  12:bios"` mencetak `node.sh poweroff/start` hanya untuk node berperan `destroy`.
- **AC-5.37** (static-shell) `nginx-pxe.conf`: `location /boot/` dan `/media/` tanpa `allow/deny`;
  `location /` memuat `allow` alamat admin dan `deny all`; lokasi SSE memuat `proxy_buffering off`
  dan `proxy_read_timeout` ≥ 3600s; `bash -n` semua script.

### KVM
- **AC-5.38** (kvm) Server: regresi AC-4.29 (`ss -lunp` hanya dnsmasq di `pxe0`/`10.99.0.2`,
  layanan aktif, Next hanya `127.0.0.1:3000`, `nginx -t` OK) + allowlist [O9]: dari host
  `GET http://10.99.0.2/api/settings` 200; dari node12 yang sudah terpasang (via SSH)
  `GET /api/hosts` → 403 dan `GET /boot/<mac12>.ipxe` → 200 berisi script lokal.
- **AC-5.39** (kvm, wajib gate) `virsh destroy` di tengah install (UEFI `pxe-test-m5-node11`):
  konfigurasi via dashboard seperti AC-4.30 (IP `10.99.0.21`) → Simpan & Install → `node.sh reset`
  → status Installing teramati di UI dan ≥ 1 event `installer` ("autoinstall mulai") tampil di log
  job → `node.sh poweroff` (virsh destroy) → `node.sh start` → node PXE boot ulang:
  `/boot/<mac>.ipxe` melayani script lokal (log nginx memuat request baru setelah start; serial
  console: jumlah kernel installer tetap 1; `installerBoots` job tetap 1; job memuat event `warn`
  boot lokal) → status tetap Installing hingga ≥ 15 mnt sejak masuk Installing, lalu job & host
  **Failed** alasan `timeout-installing` teramati di UI tanpa reload ≤ 17 mnt sejak masuk Installing;
  timeline job menampilkan pill Failed + alasan.
- **AC-5.40** (kvm, wajib gate) Install ulang setelah AC-5.39: Install OS dari UI untuk host yang
  sama → `node.sh reset` → Booting → Installing → Configuring → Done ≤ 30 mnt; verifikasi SSH
  dengan key yang di-inject (paritas AC-4.31: hostname `m5-node11`, `10.99.0.21/24` di NIC MAC
  `…:11`, gateway, DNS, `sudo -n true`, `authorized_keys` tepat key itu, `sshd -T`
  `passwordauthentication no`, login password ditolak); `GET /api/jobs?hostId=` = 2 job (`failed`
  `timeout-installing`, `done`); `reboot` → kembali dari disk (tanpa kernel installer baru di
  serial), status tetap Done, jumlah job tetap 2 (CR-4-11).
- **AC-5.41** (kvm) BIOS `pxe-test-m5-node12` jalur positif (IP `10.99.0.22`) → Done ≤ 30 mnt, SSH
  key login + hostname benar; selama instalasi halaman Jobs (detail job node12) menerima event
  baru lewat SSE tanpa reload (penanda `early`, `late-commands`, `first-boot` dari installer
  muncul berurutan; indikator Live); timeline akhir 4 pill dengan waktu; setelah reboot jumlah job
  = 1 (CR-4-11). Asersi otomatis CR-4-12 di `results.json`: dnsmasq TFTP `snponly.efi` untuk
  node11, nginx `user-data` 200 untuk kedua node (dua kali untuk node11: job 1 dan 2).
- **AC-5.42** (kvm) Negatif selama job aktif node12: dari host 10.99.0.1 `POST
  /boot/<mac12>/<token-acak-43>/log` dan `/status` → 404; jumlah event job tidak berubah;
  `GET /boot/<mac12>.ipxe` dari host → script lokal tanpa token (regresi AC-4.32).
- **AC-5.43** (kvm) Cleanup & bukti: tidak ada VM `pxe-test-m5-*`/`pxe-test-server` dan disknya;
  base disk server tetap (CR-4-13); key sekali pakai dihapus; `pxe-test-node01`, `ubuntu24.04`,
  `default`, `int`, `pxe-test` identik sebelum/sesudah; `results.json` memuat status + durasi per
  AC kvm; `kvm/jobs-*.json` (ekspor log job) dan seluruh `.agent/runs/m5/**` lolos scan: tanpa
  password run, token, hash `$6$`, private key (teks & base64).

Total: **43 AC**. Per jenis test (AC gabungan dihitung di setiap jenisnya): unit 10 · integration
17 · e2e 12 · static 2 · unit-shell 5 · kvm 6 (AC-5.39 dan AC-5.40 wajib gate).

## 5. Cakupan KVM M5

| Skenario | Node | AC | Catatan |
|---|---|---|---|
| Server + allowlist nginx | `pxe-test-server` | AC-5.38 | regresi AC-4.29 |
| `virsh destroy` saat Installing → boot lokal (tanpa reinstall) → Failed oleh watchdog | UEFI node11 | AC-5.39 (gate) | timeout installing 15 mnt (dashboard.env KVM) |
| Install ulang → Done → SSH key → reboot dari disk, jumlah job 2 | UEFI node11 | AC-5.40 (gate) | membuktikan syarat gate "PXE → konfigurasi → Done → SSH" |
| Jalur positif + log installer via SSE + jumlah job 1 | BIOS node12 | AC-5.41 | regresi BIOS untuk perubahan boot-script/generator |
| Negatif token acak log/status | node12 | AC-5.42 | |
| Cleanup & scan bukti | semua | AC-5.43 | |

Resource: satu server run (3 GB) + satu node (2 GB) sekaligus, berurutan (CLAUDE.md clamp; preflight
`kvm-run.sh`). Estimasi ±60–70 mnt per run. Debian 12, Rocky 9, bulk 3× UEFI: M6 (DEC-010).

## 6. Risiko

| ID | Risiko | Dampak | Mitigasi |
|---|---|---|---|
| R1 | Timeout terlalu pendek → install sah ditandai Failed (Rocky/Debian di hardware lambat, atau KVM 15 mnt) | Gagal palsu, host Failed padahal OS terpasang | Default produksi longgar (60/120/60); KVM 15 mnt ≥ 1,5× durasi M4 terukur; nilai dicatat di `results.json`; env bisa diubah tanpa kode |
| R2 | Callback `done` setelah watchdog ditolak | Host Failed walau OS jalan | Dokumentasi + alasan jelas di UI; install ulang; alternatif masa tenggang sebagai kandidat decision (O7) |
| R3 | Log installer membawa secret (subiquity debug log memuat konfigurasi autoinstall/hash; URL ber-token di argv) | Secret di DB/UI/bukti | Jalur sukses hanya penanda konstan; tail hanya saat gagal; `redactSecrets` sebelum simpan; scan bukti + ekspor log job; AC-5.12/5.14/5.43 |
| R4 | SSE lewat nginx + Next 16 (`cacheComponents`, kompresi, buffering, umur koneksi) | Log tidak live / koneksi bocor | Header + heartbeat + batas umur/koneksi; `location /api/jobs/` khusus; mode JSON + fallback polling; diuji integration, E2E, dan KVM (AC-5.41); dev wajib membaca docs Next di `node_modules` (AGENTS.md) |
| R5 | Timer di `instrumentation.ts` ganda (HMR dev) atau tidak berjalan di standalone | Failed terlambat | Lazy sweep adalah sumber kebenaran; timer idempoten dengan guard global; AC-5.9 |
| R6 | OVMF dengan disk setengah terpasang setelah `virsh destroy`: loop PXE → `exit 1` → disk gagal → PXE (banjir request `/boot`) atau macet di menu | Banjir event / bukti sulit dibaca | Penggabungan event (`repeat`); AC-5.39 menilai "tidak ada kernel installer kedua" dari serial + `installerBoots`, bukan perilaku firmware sesudahnya; install ulang memakai `node.sh reset` |
| R7 | Waktu siklus KVM ±70 mnt × hingga 3 iterasi gate | Siklus lambat | Smoke dini (destroy → boot lokal) sebelum UI; `--skip-build`; base disk server dipakai ulang |
| R8 | `virsh destroy` terlalu dini (sebelum `user-data` diambil) → job masih `booting` → installer dilayani lagi (benar menurut O8, tetapi bukan skenario uji) | Uji tidak membuktikan CR-4-1 | Harness menunggu status Installing + event installer pertama sebelum destroy (AC-5.39) |
| R9 | Migrasi 2 di DB lab/KVM yang sudah berisi data M4 | Start gagal | `ALTER TABLE ADD COLUMN` + tabel baru saja; AC-5.15 v1→v2 |
| R10 | Kontensi SQLite: tail SSE (baca/1 dtk/koneksi) + log installer + sweep | `SQLITE_BUSY` | WAL + `busy_timeout` (M4); query terindeks `(job_id, seq)`; batas koneksi SSE; transaksi singkat tanpa `await` |
| R11 | Allowlist nginx memutus jalur PXE bila lokasi salah urut | Node tidak bisa boot | `/boot/` & `/media/` eksplisit tanpa pembatasan; AC-5.37 statis + AC-5.38 dari node nyata |
| R12 | SR-4-1 tetap terbuka untuk deploy di luar konfigurasi nginx lab | Pengambilalihan host di LAN | Dokumentasi di `.env.example`/README infra; blocker gate M6 |
| R13 | Hook log baru mengulang B-5 (URL ber-token tercetak installer) | Token di console/bukti | URL selalu dari `/proc/cmdline`; AC-5.19 memeriksa output + base64; `redact-evidence.sh` + scan KVM |
| R14 | Webserver Playwright kedua memperlambat E2E / bentrok port | E2E rapuh | Port & DB terpisah, project terpisah; tidak mengubah `retries`, `forbidOnly`, guard spec |
| R15 | SR-4-2 fail-fast/O10-B mengubah perilaku yang diandalkan test M4 (installer tanpa lease) | Test M4 merah | Test diubah untuk menyetel fixture lease atau flag insecure secara eksplisit; dicatat di `test-migration.md` sebagai pengetatan berdasar decision (bukan pelemahan) |

## 7. Trace carry-over gate M4 → task/AC

| Kewajiban (gate-iter1 §Kewajiban carry-over M5) | Task | AC |
|---|---|---|
| (1) CR-4-1 installer dilayani berulang + test integration & KVM `virsh destroy` → Failed → install ulang | M5-T3, T12, T15 | AC-5.7, AC-5.8, AC-5.10, AC-5.39, AC-5.40 |
| (2) SR-4-2 binding IP gagal-terbuka (fail-fast + test + `.env.example`) | M5-T1, T3, T11, T12 | AC-5.2 |
| (3) Amandemen plan/DEC CR-4-2/4-3/4-21 sebelum plan M5 final | architect (selesai: `M4-plan.md` §7) + Orchestrator (usulan DEC binding IP) | — (dokumen; usulan teks DEC di `M4-plan.md` §7 A6) |
| (4) CR-4-4 `KCMD` dari `installerScript` | M5-T11 | AC-5.20 |
| (5) CR-4-11 asersi jumlah job | M5-T6, T15 | AC-5.10, AC-5.40, AC-5.41 |
| (5) CR-4-12 asersi otomatis log dnsmasq/nginx di `kvm-run.sh` | M5-T7, T14, T15 | AC-5.36, AC-5.41 |
| (6) CR-4-5 `waitScript --replace` | M5-T5, T11 | AC-5.21 |
| (6) CR-4-8 / SR-4-4 log injection `logBootDenied` | M5-T4, T11, T12 | AC-5.6 |
| (6) CR-4-9 (/SR-4-5) decode ganda → 500 | M5-T4, T12 | AC-5.5 |
| (6) CR-4-10 base URL IPv6 | M5-T1, T11 | AC-5.3 |
| (6) CR-4-13 `cleanup.sh server` menghapus base disk | M5-T7, T14 | AC-5.34, AC-5.43 |
| (6) CR-4-14 redaksi memproses biner | M5-T7, T14 | AC-5.35 |
| (6) CR-4-15 / SR-4-9 `X-Forwarded-Host` tanpa trust proxy | M5-T1, T11, T12 | AC-5.4 |
| (7) DR-4-1 hostname/MAC di judul Sheet/AlertDialog sans | M5-T10, T13 | AC-5.29 |
| (7) DR-4-2 bobot judul Sheet | M5-T10, T13 | AC-5.29 |
| (7) DR-4-3 toast menutup footer Sheet | M5-T10, T13 | AC-5.30 |
| (7) DR-4-4 bulk gagal sebagian menutup Sheet (prioritas) | M5-T10, T13 | AC-5.30 |
| (7) DR-4-5 "tidak tersedia" merah | M5-T9, T10, T13 | AC-5.27, AC-5.31 |
| (7) DR-4-6 kontras alasan reboot | M5-T10, T13 | AC-5.31 |
| (7) DR-4-7 placeholder "tahap 4" (prioritas) | M5-T8, T9, T13 | AC-5.22, AC-5.32 |
| Disarankan: SR-4-1 mitigasi nginx `allow 10.99.0.1; deny all` (+ allowlist Host GET) | M5-T1, T7, T14, T15 | AC-5.4, AC-5.37, AC-5.38 |

Item M6 (tidak dikerjakan M5, dicatat agar tidak hilang): SR-4-1 login + rate limit (blocker M6);
CR-4-6 + SR-4-6 KVM Debian 12/Rocky 9 (target bebas token, `---` di cmdline preseed) + bulk 3×
UEFI; CR-4-7/SR-4-3 sebelum unattend dilayani; SR-4-8 dokumentasi LAN/HTTPS.

## 8. Kandidat decision (untuk Orchestrator)

1. **Binding IP config/callback per-MAC** (amandemen DEC-008; CR-4-21 + SR-4-2) — teks usulan di
   `M4-plan.md` §7 A6. Rekomendasi: terima.
2. **O8 CR-4-1**: installer hanya saat `booting`, maks 3 kali; `installing` → boot lokal tanpa
   rotasi token; lewat batas → Failed `installer-boot-limit`.
3. **O6/O7 watchdog**: lazy sweep + timer in-process; timeout absolut per tahap 60/120/60 mnt
   (KVM installing 15); TTL token ≥ jumlah; `done` terlambat ditolak.
4. **O3/O4 model log**: tabel `job_events` + kolom `jobs` baru (perluasan model SPEC §5; `jobs.logs`
   tidak dipakai); retensi 5000 event/job, 20 job final/host.
5. **O5 sumber log**: event server + endpoint `POST /boot/{mac}/{token}/log` dengan redaksi; tanpa
   webhook subiquity/syslog.
6. **O1/O2 update otomatis**: polling 5 dtk untuk host/daftar job; SSE (tail DB) hanya untuk log.
7. **O9 mitigasi SR-4-1**: nginx allowlist IP admin + allowlist Host untuk GET API (disarankan
   menjadi syarat gate M5).
8. **O10 SR-4-2**: fail-fast trust proxy tanpa lease + tanpa lease tidak menerbitkan installer.
9. **O11 Offline**: tidak ada transisi otomatis di M5 (mengamandemen jadwal M4-plan §1).
10. **O12 OS Images**: registrasi path media lokal; URL jarak jauh ditunda.
11. **O13/O14 pengujian**: webserver Playwright kedua untuk timeout; KVM M5 = UEFI destroy →
    Failed → install ulang + BIOS positif.
