# M5 — Opsi teknis (callback status & jobs)

Dokumen ini memuat pilihan teknis yang berarti untuk M5. Setiap bagian berisi 2–3 opsi (kadang
lebih bila memang ada), trade-off, dan rekomendasi. Keputusan final ditulis Orchestrator sebagai
`DEC-013` dan seterusnya. Rujukan: SPEC §3.1 (update otomatis), §4 (Provisioning Jobs, OS Images,
SSH Keys), §5 (callback, model `jobs`, API `GET /api/jobs`, `GET /api/jobs/:id/logs` (SSE), host
kembali ke boot lokal), §6; DEC-004/005/007/008/009/010/012; `docs/design/M4-plan.md` §7
(amandemen pasca-implementasi); `.agent/runs/m4/gate-iter1.md` §Kewajiban carry-over.

Fakta kode M4 yang membentuk pilihan di bawah (`main` @ `m4-approved`):
- `decideBoot` (`lib/server/discovery.ts`) menerbitkan token **baru** setiap kali
  `/boot/{mac}.ipxe` diminta selama job `booting|installing` (CR-4-1).
- `jobs.stages` berupa JSON `[{stage, at, source}]`; `jobs.logs` TEXT kosong; belum ada API jobs.
- Tabel host sudah polling 5 dtk (`use-hosts.ts`, TanStack Query); "Lihat log" sudah
  mengarah ke `/jobs?host=<id>` (halaman placeholder).
- Satu proses Next (standalone) di belakang nginx (`proxy_buffering off`), SQLite WAL (DEC-007).
- Callback `configuring` dari late-commands, `done` dari unit first-boot; URL callback diturunkan
  dari `/proc/cmdline` saat runtime (B-5).

Ringkasan rekomendasi ada di akhir dokumen.

---

## O1. Update otomatis: tabel host, daftar job, dan log

SPEC §3.1: "update otomatis (polling 5 dtk atau SSE/WebSocket)". SPEC §5 API: `GET
/api/jobs/:id/logs` **(SSE)**.

| | A. Polling 5 dtk untuk host & daftar job; SSE hanya untuk log job (rekomendasi) | B. Satu kanal SSE global `/api/events` (host, job, log) | C. WebSocket |
|---|---|---|---|
| Kesesuaian SPEC | Ya (polling 5 dtk disebut eksplisit; SSE untuk log sesuai API) | Ya, tetapi menambah endpoint di luar daftar API | Ya untuk §3.1; `logs` tetap harus SSE |
| Perubahan kode | Kecil: polling host sudah ada (AC-4.12 lulus) | Besar: invalidasi cache klien per jenis event, resume, fan-out | Butuh custom server (Next route handler tidak meng-upgrade WebSocket); bertentangan dengan deploy standalone DEC-009 |
| Beban server | N klien × 1 query/5 dtk (kecil, SQLite lokal) | 1 koneksi panjang per klien | 1 koneksi per klien |
| Latensi status | ≤ 5 dtk (cukup untuk tahap yang berlangsung menit) | < 1 dtk | < 1 dtk |
| Risiko | Hampir nol | Koneksi panjang lewat nginx/Next 16, kebocoran stream | Tinggi |

**Rekomendasi: A.** Tambahan murah: saat stream log sebuah job menerima event `stage`, klien
meng-invalidasi query `hosts` dan `jobs` sehingga pill di halaman lain ikut bergerak tanpa
menunggu interval.

---

## O2. Implementasi SSE `GET /api/jobs/:id/logs`

| | A. Event bus in-memory (`EventEmitter`) mendorong event ke stream | B. Stream "tail" DB: loop 1 dtk membaca `job_events WHERE seq > last` (rekomendasi) | C. Hibrida: bus untuk sinyal, DB untuk data |
|---|---|---|---|
| Kebenaran setelah restart / multi-instance modul | Rapuh: Next dapat memuat modul server lebih dari sekali (bundle route berbeda, HMR dev), sehingga emitter di route log ≠ emitter di route callback | Selalu benar: DB satu-satunya sumber | Benar, tetapi dua jalur kode |
| Resume (`Last-Event-ID`) | Harus tetap membaca DB | Alami (cursor `seq`) | Alami |
| Latensi | ~0 | ≤ 1 dtk (cukup untuk log installer) | ~0 |
| Beban | Minimal | 1 query terindeks per koneksi per detik | Minimal |
| Testability | Perlu mock bus | Langsung: sisipkan baris, baca stream (fake timers) | Sedang |

**Rekomendasi: B.** Detail: `Content-Type: text/event-stream`, `Cache-Control: no-cache,
no-transform`, `X-Accel-Buffering: no`; tiap event `id: <seq>`; komentar heartbeat `: ping` tiap
15 dtk (di bawah `proxy_read_timeout` 60 dtk nginx); event `end` lalu stream ditutup bila job final
dan semua event terkirim; koneksi ditutup server setelah 30 menit dengan `retry: 3000` (klien
EventSource tersambung ulang dengan `Last-Event-ID`); batas koneksi SSE serentak per proses
(mis. 50 → 503) karena `/api/**` belum berautentikasi sampai M6. Mode JSON
(`Accept: application/json` atau `?format=json&after=<seq>`) untuk klien non-SSE, test, dan
fallback UI.

---

## O3. Model data log & tahapan job

SPEC model minimal: `jobs(id, host_id, type, status, stages[], logs, created_at)`.

| | A. Append ke `jobs.logs` (TEXT) | B. Tabel `job_events(job_id, seq, at, kind, level, source, message)` (rekomendasi) | C. File log per job di disk (`/var/lib/pxe-dashboard/jobs/<id>.log`) |
|---|---|---|---|
| Sesuai kolom SPEC | Literal | Perluasan; `logs` di API disajikan dari event | Perluasan |
| Append atomik + cursor SSE | Tulis ulang seluruh TEXT per baris (O(n²)), cursor = offset byte | `INSERT` + `seq` per job dalam transaksi yang sama dengan perubahan status | Append file, cursor = offset; tidak transaksional terhadap DB |
| Retensi/pemotongan | Potong string | `DELETE … WHERE seq <` / batas jumlah baris | Rotasi file |
| Ikut `ON DELETE CASCADE` host | Ya | Ya (FK ke `jobs`) | Tidak (harus manual) |
| Backup/test | Satu DB | Satu DB | DB + direktori |

**Rekomendasi: B.** `jobs.stages[]` tetap sumber timeline (sudah ada, dipakai M4). Kolom
`jobs.logs` dibiarkan (tidak dihapus; migrasi hanya menambah) dan tidak lagi ditulis; respons API
memakai nama SPEC (`type`, `stages`, `logs` lewat endpoint log). Tambahan kolom `jobs`:
`failure_reason`, `installer_boots`, `event_seq`. Kandidat decision karena memperluas model
SPEC §5.

---

## O4. Retensi job & log

| | A. Tanpa retensi | B. Batas jumlah: event per job + job final per host (rekomendasi) | C. Berbasis umur (hapus > N hari) |
|---|---|---|---|
| Pertumbuhan DB | Tak terbatas (installer bisa mengirim log besar) | Terbatas dan dapat dihitung | Terbatas, tetapi host yang sering di-install tetap bisa membengkak dalam N hari |
| Kapan dijalankan | — | Sinkron saat menambah event (cap per job) dan saat membuat job baru (riwayat per host), di transaksi yang sama | Butuh timer |
| Determinisme test | — | Tinggi | Butuh jam injeksi |

**Rekomendasi: B** dengan env: `PXE_JOB_LOG_MAX_EVENTS` (default 5000 per job; setelah batas,
satu event `warn` "log dipotong" lalu event installer berikutnya dibuang, event sistem/tahap tetap
dicatat), panjang pesan maks 2048 karakter (konstanta), `PXE_JOB_HISTORY_PER_HOST` (default 20
job final per host; job aktif tidak pernah dihapus). Estimasi kasus terburuk: 5000 × 2 KB ≈ 10 MB
per job.

---

## O5. Sumber log installer

| | A. Hanya event sisi server | B. A + installer mendorong baris log lewat `POST /boot/{mac}/{token}/log` (rekomendasi) | C. A + webhook `reporting` subiquity | D. A + syslog jarak jauh (`log_host=` d-i, `inst.syslog=` anaconda, rsyslog di live Ubuntu) | E. Tarik console serial/journal |
|---|---|---|---|---|---|
| Isi | Job dibuat, script installer dilayani (ke-n, platform, IP), file konfigurasi diambil, callback, boot lokal selama installing, timeout, digantikan | + penanda tahap dari early/late-commands, `%pre/%post`, first-boot; **tail log installer saat gagal** | Event curtin/subiquity rinci (Ubuntu saja) | Seluruh syslog installer | Semuanya |
| OS | Semua | Ubuntu, Debian, Rocky (generator yang sama) | Ubuntu saja | Semua, konfigurasi berbeda per OS | Hanya lab KVM (`virsh`), bukan fitur produk |
| Token / B-5 | Tidak menyentuh | URL diturunkan dari `/proc/cmdline` seperti callback (tanpa token di config) | Endpoint harus ditulis di user-data → token di config installer (mengulang B-5) kecuali token log terpisah | Tanpa token: penerimaan berbasis IP saja, mudah dipalsukan; perlu rsyslog root di VM server + pemetaan IP→job | — |
| Infra tambahan | Tidak ada | Tidak ada (route Next) | Tidak ada | Port UDP 514 di VM server, layanan root, aturan nftables | Tidak berlaku di produksi |
| Risiko secret | Nol (teks dibuat server) | Log installer bisa memuat hash `$6$`/URL bertoken → **redaksi sisi server wajib** + batas ukuran | Sama | Sama + tanpa autentikasi | — |

**Rekomendasi: A + B.** Baris yang dikirim installer pada jalur sukses hanya penanda konstan dari
generator (bukan nilai pengguna); isi log mentah hanya dikirim pada jalur gagal (`error-commands`
Ubuntu, `%onerror` Rocky) sebagai `tail` terbatas. Debian tidak punya hook gagal (ditangani
watchdog, O6). Server menerapkan `redactSecrets` (token di path `/boot/<mac>/<43>`,
`token=`, hash `$6$`, blok `PRIVATE KEY`, blob base64 yang ter-decode memuat salah satunya —
selaras `infra/redact-evidence.sh`), membuang karakter kontrol, membatasi ukuran body (16 KB),
jumlah baris per request (200), panjang baris (2048), dan laju per job (60 request/menit → 429
setelah otorisasi). Autentikasi endpoint = callback status (token + MAC + IP + job aktif, 404
seragam).

---

## O6. Mekanisme watchdog timeout → `failed`

| | A. Sapuan malas (lazy sweep) saat request baca/boot | B. Timer in-process (`setInterval` dari `instrumentation.ts` `register()`) | C. systemd timer memanggil endpoint internal / CLI |
|---|---|---|---|
| Berjalan tanpa UI terbuka | Tidak (status benar bagi setiap pembaca karena disapu sebelum dibaca, tetapi `failed` baru tercatat saat ada request) | Ya | Ya |
| Kebenaran | Tinggi: setiap jalur yang membaca/bergantung pada status job (API hosts/jobs, `/boot/{mac}.ipxe`, file/callback) menyapu dulu di transaksi yang sama | Bergantung pada keunikan timer (HMR/duplikasi modul) | Tinggi |
| Permukaan serangan | Tidak ada | Tidak ada | Endpoint baru tanpa auth sampai M6, atau script CLI yang membuka DB dari luar proses |
| Testability | Fungsi murni `sweepJobs(now)` + jam injeksi | Fake timers | Sulit |

**Rekomendasi: A + B memakai fungsi yang sama.** `sweepJobs(now)` idempoten, berjalan dalam
`BEGIN IMMEDIATE`. Timer B (interval `PXE_WATCHDOG_INTERVAL_SEC`, default 30) hanya pelengkap:
dijaga simbol global agar satu per proses, `unref()`, hanya di runtime `nodejs`. Tanpa endpoint
HTTP (DEC-005). Logika diletakkan di `src/lib/server/watchdog.ts` (masuk include coverage
DEC-004); `src/instrumentation.ts` hanya memanggil `startWatchdog()`.

---

## O7. Semantik timeout

| | A. Batas absolut per tahap, dihitung dari masuk tahap (rekomendasi) | B. Batas idle (tanpa aktivitas/log selama N menit) | C. Satu batas total per job |
|---|---|---|---|
| Ketergantungan pada log installer | Tidak ada | Tinggi: Debian/Rocky/Ubuntu tanpa heartbeat periodik → gagal palsu, atau perlu heartbeat baru di installer | Tidak ada |
| Kejelasan alasan gagal | "Timeout di tahap Installing (> 120 mnt)" | "Tidak ada aktivitas" | "Timeout total" (tidak jelas tahap mana) |
| Waktu deteksi `virsh destroy` | ≤ batas tahap installing | Bisa lebih cepat | Paling lambat |
| Konfigurasi | 3 env | 1 env + heartbeat | 1 env |

**Rekomendasi: A.** Env (menit, 1–1440): `PXE_JOB_BOOTING_TIMEOUT_MIN` default 60 (menunggu
operator menyalakan ulang host + unduh kernel + ambil konfigurasi), `PXE_JOB_INSTALLING_TIMEOUT_MIN`
default 120 (anaconda/d-i di hardware lambat), `PXE_JOB_CONFIGURING_TIMEOUT_MIN` default 60
(reboot + first-boot). Validasi silang: `PXE_TOKEN_TTL_MIN` ≥ jumlah ketiganya (kalau tidak,
token kedaluwarsa sebelum watchdog sehingga callback sah ditolak sementara job masih "aktif").
Lingkungan KVM (`infra/server/dashboard.env`): installing 15 menit (instalasi Ubuntu M4 teramati
393–603 dtk total, margin ≥ 1,5×), interval watchdog 15 dtk.

Konsekuensi yang harus diterima: callback `done` yang datang **setelah** watchdog menandai
`failed` ditolak (token sudah dicabut) sehingga host tetap Failed walau OS mungkin terpasang.
Alternatif (menerima `done` terlambat dalam masa tenggang) menambah status semi-final; tidak
direkomendasikan di M5. Kandidat decision.

---

## O8. Batas penyajian installer per job (CR-4-1)

Masalah: installer dilayani ulang (dan disk di-wipe lagi) tanpa batas bila callback `configuring`
hilang, karena setiap `/boot/{mac}.ipxe` selama `booting|installing` menerbitkan token baru.

| | A. Installer hanya sekali per job | B. Installer hanya saat job `booting`, maksimal N kali (default 3); selama `installing` → boot lokal tanpa rotasi token (rekomendasi) | C. Maksimal N kali per job di status apa pun |
|---|---|---|---|
| Disk di-wipe ulang setelah konfigurasi diambil | Tidak | **Tidak** (wipe hanya mungkin setelah file konfigurasi utama diambil, yaitu setelah `installing`) | Ya, hingga N−1 kali |
| Toleransi gangguan sebelum installer jalan (power-cycle, unduh kernel gagal) | Tidak ada: satu kegagalan iPXE = job macet sampai timeout | Ada (N−1 percobaan ulang) | Ada |
| Callback `done` terlambat (late-commands sempat menulis URL first-boot, callback `configuring` hilang) | Diterima (token tidak dirotasi) | Diterima: token tidak dirotasi selama `installing`, `installing → done` transisi maju yang sah | Ditolak bila token dirotasi |
| Uji `virsh destroy` di tengah install | Node menyala → boot lokal → Failed oleh watchdog | Sama | Node menginstal ulang (bertabrakan dengan uji) |

**Rekomendasi: B.** Rincian: kolom `jobs.installer_boots`; permintaan ke-(N+1) saat `booting` →
boot lokal + job/host `failed` dengan alasan `installer-boot-limit` (umpan balik jelas, operator
bisa install ulang); saat `installing` → boot lokal, token dan `installer_boots` tidak berubah,
event `warn` "host PXE boot ulang saat Installing: boot lokal, instalasi tidak diulang" (event
berulang identik dalam 60 dtk digabung dengan penghitung agar loop PXE↔disk gagal tidak
membanjiri log). Env `PXE_JOB_MAX_INSTALLER_BOOTS` (1–10).

---

## O9. Mitigasi SR-4-1 sebelum login M6 (disarankan gate)

`/api/**` dan UI belum berautentikasi; nginx melayani UI/API di interface yang sama dengan klien
PXE. Node mana pun di LAN provisioning dapat mengubah konfigurasi dan memicu install host lain.

| | A. nginx allowlist IP admin untuk `location /` (UI + `/api/`), `/boot/` dan `/media/` tetap terbuka (rekomendasi) | B. Pemeriksaan IP admin di aplikasi (`src/proxy.ts` Next 16, `X-Real-IP` ∈ `PXE_ADMIN_CIDRS`) | C. Tanpa mitigasi sampai M6 |
|---|---|---|---|
| Kode produk | Tidak ada (infra) | Ada; akan digantikan/ditumpuk auth M6 | — |
| Melindungi deploy non-lab | Hanya bila operator memakai konfigurasi nginx serupa (didokumentasikan) | Ya, di mana pun | Tidak |
| Risiko memecah jalur PXE | Rendah bila lokasi `/boot/` dan `/media/` dipisah eksplisit; diuji di KVM | Sedang (proxy memotong semua route, termasuk `/boot/`, kecuali dikecualikan) | — |
| Bukti | KVM: dari node `GET /api/hosts` → 403, `/boot/<mac>.ipxe` → 200; dari host 10.99.0.1 → 200 | Integration + KVM | — |

**Rekomendasi: A**, ditambah allowlist Host (SR-3-5) juga untuk **GET** `/api/**` (menutup baca
inventaris lewat DNS rebinding, saran security-reviewer). Alamat admin di-template
(`PXE_ADMIN_ALLOW`, default lab `10.99.0.1`). B ditunda ke M6 bersama login (kandidat decision).
SR-4-1 tetap terbuka sebagai blocker gate M6.

---

## O10. SR-4-2: binding IP gagal-terbuka bila lease tidak dikonfigurasi

| | A. Fail-fast settings: `PXE_TRUST_PROXY=1` tanpa `PXE_DNSMASQ_LEASES` → server tidak mau start, kecuali `PXE_INSECURE_NO_LEASE_CHECK=1` | B. Tanpa lease (dan tanpa flag insecure) → `/boot/{mac}.ipxe` tidak pernah menerbitkan installer/token (boot lokal + event) | C. Pemicu `NODE_ENV=production` |
|---|---|---|---|
| Menutup skenario review | Ya (kombinasi yang rentan ditolak) | Ya, termasuk kasus `PXE_TRUST_PROXY=0` di mana token tetap bisa dirotasi siapa pun (DoS install) | Ya, tetapi E2E lokal (`next start` = production) tanpa lease ikut gagal start |
| Dampak dev/E2E | E2E yang memakai `PXE_TRUST_PROXY=1` sudah memakai fixture lease | Test yang mengandalkan installer tanpa lease wajib menyetel flag secara eksplisit (pengetatan, dicatat di `test-migration.md`) | Besar |

**Rekomendasi: A + B.** `.env.example` diberi komentar risiko; Settings menampilkan peringatan bila
flag insecure aktif; start mencatat satu baris peringatan.

---

## O11. Status `Offline`

M4-plan §1 menjadwalkan "status `offline` dari last_seen" ke M5. SPEC hanya mendefinisikan pill
"Offline" (abu) dan kolom "last seen (relatif)".

| | A. Turunkan dari `last_seen` (> N menit → `offline`) | B. Probe aktif (TCP 22 / ICMP ke IP management) | C. Tidak ada transisi otomatis di M5; status provisioning tidak ditimpa (rekomendasi) |
|---|---|---|---|
| Makna | Salah: host `done` yang boot dari disk (UEFI BootOrder disk-first) tidak pernah menghubungi dashboard lagi, jadi semua host Done menjadi Offline dan informasi "terpasang" hilang | Benar (liveness) | Netral: "last seen" tetap terlihat |
| Biaya | Kecil | Pemroses latar + akses jaringan ke semua host; ICMP butuh capability; ruang lingkup baru | Nol |

**Rekomendasi: C** untuk M5, kandidat decision yang mengamandemen tabel M4-plan §1. Bila
liveness diinginkan, B sebagai indikator terpisah (bukan status provisioning) setelah M6.

---

## O12. Halaman OS Images: makna "registrasi ISO/URL"

| | A. Registrasi metadata + path relatif di `PXE_MEDIA_ROOT` (ISO di-mount operator); UI menampilkan URL HTTP hasilnya (`PXE_MEDIA_URL/<repo>`) dan status tersedia (rekomendasi) | B. A + sumber URL jarak jauh (mirror http(s)) untuk preseed/kickstart | C. Unggah ISO lewat dashboard lalu mount |
|---|---|---|---|
| Sesuai API M4 | Ya (`POST /api/os-images` sudah ada) | Perlu perubahan generator (mirror Debian, `url --url` Rocky) dan `installerScript` (kernel/initrd absolut); Ubuntu tetap butuh NFS (O6 M4) → ditolak | Butuh root (mount), upload GB lewat Node |
| Teruji di KVM terisolasi | Ya | Tidak (pxe-test tanpa internet) | Tidak |
| Risiko | Rendah | Rantai pasok lewat HTTP (SR-4-8), image "tersedia" tak terverifikasi | Tinggi |

**Rekomendasi: A di M5.** B ditunda (kandidat decision) karena tidak dapat dibuktikan di lingkungan
uji dan menambah risiko SR-4-8; C ditolak (batas tanpa sudo).

---

## O13. Menguji timeout di E2E lokal tanpa seam HTTP

| | A. Webserver Playwright kedua (port terpisah, DB terpisah) dengan `PXE_JOB_BOOTING_TIMEOUT_MIN=1` dan interval watchdog 5 dtk, khusus spec timeout (rekomendasi) | B. Env jam palsu (`PXE_FAKE_NOW`) | C. Hanya integration (jam injeksi), tanpa E2E |
|---|---|---|---|
| DEC-005 (tanpa seam test di produk) | Patuh | Seam di kode produk | Patuh |
| Bukti UI | Ya (pill Failed tanpa reload, ±70 dtk) | Ya | Tidak ada untuk AC UI |
| Dampak ke spec lain | Tidak ada (server terpisah) | Bisa memengaruhi semua spec | — |

**Rekomendasi: A** (+ C untuk semua batas dan kasus tepi). `playwright.config.ts` mendapat entri
`webServer` kedua dan project yang hanya mencocokkan `m5-timeout.spec.ts`; `forbidOnly`,
`retries: 0`, dan guard spec tetap.

---

## O14. Cakupan KVM M5 (batas resource: server 3 GB + 1 node 2 GB sekaligus)

| | A. Satu run server, dua node berurutan: UEFI `virsh destroy` → Failed → install ulang → Done + SSH; BIOS jalur positif + log/SSE + allowlist nginx (rekomendasi) | B. Hanya skenario UEFI destroy + install ulang | C. A + Debian/Rocky lebih awal |
|---|---|---|---|
| Kewajiban gate M5 (`virsh destroy` → Failed → install ulang; bukti Done + SSH) | Ya | Ya | Ya |
| Regresi BIOS untuk perubahan boot-script (CR-4-1, CR-4-5) dan generator (hook log) | Ya | Tidak | Ya |
| Durasi per run | ±60–70 mnt (server ±10, node11: discovery+installing ±5, timeout 15, install ulang ±10, verifikasi ±3; node12 ±12) | ±45 mnt | > 2 jam, risiko investigasi repo offline (DEC-010) |

**Rekomendasi: A.** Debian/Rocky/bulk tetap M6 (DEC-010, CR-4-6).

---

## Ringkasan rekomendasi (kandidat decision)

| # | Topik | Rekomendasi |
|---|---|---|
| O1 | Update otomatis | Polling 5 dtk untuk host & daftar job (sudah ada); SSE hanya untuk log job; event `stage` di SSE meng-invalidasi query host/job |
| O2 | SSE | Tail DB 1 dtk dengan cursor `seq`, heartbeat 15 dtk, `end` saat final, koneksi maks 30 mnt, batas koneksi serentak, mode JSON |
| O3 | Model log | Tabel `job_events` (+ `jobs.failure_reason`, `installer_boots`, `event_seq`); `jobs.stages[]` tetap; `jobs.logs` tidak dipakai (perluasan model SPEC) |
| O4 | Retensi | 5000 event/job, 2048 char/pesan, 20 job final/host; dijalankan sinkron di transaksi |
| O5 | Sumber log | Event server + `POST /boot/{mac}/{token}/log` (penanda konstan; tail log hanya saat gagal), redaksi + batas ukuran/laju |
| O6 | Watchdog | Lazy sweep di semua jalur baca/boot + timer in-process pelengkap, fungsi yang sama, tanpa endpoint |
| O7 | Timeout | Absolut per tahap: booting 60 / installing 120 / configuring 60 mnt; TTL token ≥ jumlahnya; KVM installing 15 mnt; `done` terlambat ditolak |
| O8 | CR-4-1 | Installer hanya saat `booting`, maks 3 kali; `installing` → boot lokal tanpa rotasi token; lewat batas → `failed` (`installer-boot-limit`) |
| O9 | SR-4-1 mitigasi | nginx allowlist IP admin untuk UI/API, `/boot/` & `/media/` terbuka; allowlist Host juga untuk GET API; auth tetap M6 (blocker) |
| O10 | SR-4-2 | Fail-fast trust proxy tanpa lease (kecuali flag insecure) + tanpa lease tidak menerbitkan installer |
| O11 | Offline | Tidak ada transisi otomatis di M5 (amandemen jadwal M4-plan) |
| O12 | OS Images | Registrasi path media lokal + URL hasil; URL jarak jauh ditunda |
| O13 | E2E timeout | Webserver Playwright kedua dengan timeout 1 mnt |
| O14 | KVM M5 | UEFI destroy→Failed→install ulang→Done+SSH, lalu BIOS positif + log/SSE + allowlist; berurutan |
