Verdict: PASS

# Review keamanan M6 (security hardening), iterasi 1

- Reviewer: security-reviewer (read-only). Disimpan oleh Orchestrator dari jawaban akhir reviewer tanpa diubah isinya.
- Worktree: `.agent/wt-m6`, branch `milestone/6-hardening`, HEAD `4fabdb4`, base `main`
- Cakupan: `git diff main...HEAD -- dashboard infra` (184 file), SPEC §6, DEC-017..021, `docs/design/M6-plan.md`, carry-over `.agent/runs/m5/gate-iter3.md`, bukti `.agent/runs/m6/final/` dan `kvm/{core,bulk,distro}/`
- Metode: baca kode + bukti, `git grep` secret, dan probe redaksi baru (`redact.ts` disalin ke scratchpad, node 22 `--experimental-strip-types`; 29 probe baru di luar fixture).
- Catatan: laporan ini **bukan approval**. Verdict PASS hanya berarti tidak ada temuan critical/major terbuka.

## Ringkasan

| Severity | Jumlah | ID |
|---|---|---|
| critical | 0 | — |
| major | 0 | — |
| minor | 4 | SR-6-1, SR-6-2, SR-6-3, SR-6-4 |
| info | 8 | SR-6-5 … SR-6-12 |

Tidak ditemukan secret, password plaintext, hash nyata, atau private key di repo maupun bukti. Syarat gate SR-4-1, SR-5-3, SR-5-4 terpenuhi dan teruji di level unit, proses, dan KVM.

## Temuan

| ID | Severity | Lokasi | Skenario / PoC | Rekomendasi |
|---|---|---|---|---|
| SR-6-1 | minor | `dashboard/src/lib/server/installers/debian.ts:160,191,212,221`; `installers/context.ts:58` | **DEC-021 tidak benar-benar dibatasi ke media lokal.** `mediaSigned` tidak pernah diisi kode produk; hanya test. Akibatnya `apt-setup/local0/repository = [trusted=yes by-hash=no] <PXE_MEDIA_URL>/<repo>` **selalu** keluar, ke URL apa pun di `PXE_MEDIA_URL` (hanya divalidasi `URL_SAFE_RE`, tidak dicek harus server PXE). Bila operator mengarahkan media Debian ke mirror lain (HTTP), apt menerima paket tanpa verifikasi tanda tangan selama instalasi. Selain itu `debian-installer/allow_unauthenticated true` (`:212`, sejak M4) tetap aktif saat `mediaSigned: true`, dan `rm 00AllowUnauthenticated` hanya di cabang `!mediaSigned`. | Fail-closed: `trusted=yes` hanya bila host `mediaUrl` = `PXE_SERVER_IP` (atau image ditandai media lokal); selain itu tolak/422 atau isi `mediaSigned` dari metadata image. `allow_unauthenticated` dan pembersihan `00AllowUnauthenticated` mengikuti flag yang sama. Test: `mediaUrl` eksternal → tanpa `trusted=yes` atau ditolak. |
| SR-6-2 | minor | `infra/README.md:67-95` ("Asumsi keamanan") | DEC-021 §3 mewajibkan sisa risiko "apt tanpa verifikasi tanda tangan selama instalasi dari server PXE" dicatat di README "Asumsi keamanan"; DEC-019 §1 mewajibkan catatan "polling memperpanjang idle; batas atas = absolut 12 jam". Keduanya tidak ada. | Tambahkan dua butir: DEC-021 (trusted=yes hanya selama install, dibersihkan di `late_command`, ISO diverifikasi checksum, rujuk `kvm/media-checksums.txt`) dan DEC-019 (idle tidak habis selama tab terbuka; absolut `PXE_SESSION_MAX_HOURS`). |
| SR-6-3 | minor | `dashboard/src/lib/server/auth/login-service.ts:28`; `dashboard/src/lib/server/request-ip.ts:9-12` | **Kunci rate limit kolaps ke `"unknown"` tanpa proxy tepercaya.** Tanpa `PXE_TRUST_PROXY` (dev, atau production tanpa nginx) atau klien IPv6 → semua klien berbagi `login-ip:unknown`. PoC: 20 login salah per 15 menit → admin 429 terus-menerus (DoS login). Brute force tetap terbatas. | Production tanpa `PXE_TRUST_PROXY=1`: peringatan atau tolak start. Alternatif: dokumentasikan di README. |
| SR-6-4 | minor | `dashboard/src/lib/server/redact.ts:88-116` (`B64_RUN_RE` / `b64HasSecret` per baris) | **Base64 ter-wrap (GNU `base64` 76 kolom) membocorkan baris lanjutan.** Hanya baris pertama yang memuat `$6$` atau `/boot/<mac>/` dikenali. PoC: `wrap76(b64("curl http://10.99.0.2/boot/<mac>/<tok>/status"))` → `[REDACTED-B64]\nTG0ybk9wNXFS…`, baris 2 = base64 dari 31 karakter terakhir token. Sama untuk `wrap76(b64('password: "$6$…"'))`: baris 2–3 memuat ±60 karakter body hash. Tidak ada di daftar sisa risiko header `redact.ts`. Kemungkinan rendah (generator memakai base64 satu baris). | Gabungkan baris base64 berurutan (lebar sama 60/64/76, baris terakhir lebih pendek) sebelum decode, atau tandai blok lanjutan; pertahankan linearitas (SR-5-11). Alternatif: catat "base64 multi-baris" sebagai sisa risiko + fixture. |
| SR-6-5 | info | `.agent/runs/m6/kvm/core/perimeter-node.txt:6`; `infra/server/nginx-pxe.conf:43-48` | `/boot/..\api/hosts` → 308: nginx tidak menganggap `\` separator → `location /boot/` → `@app`; Next 308 ke `/api/hosts`. Bila diikuti → `location /` (allowlist 403) dan API butuh sesi (401). **Aman**, tetapi bukti tidak mencatat `Location` dan tidak mengikuti redirect. | Catat `Location` dan jalankan `curl -L` (harus 403/401). Opsional: nginx tolak `\` di `$uri` untuk `/boot/`. |
| SR-6-6 | info | `dashboard/src/lib/server/installers/debian.ts:159-160` | `DEBIAN_UNTRUST_CMD` dijalankan **setelah** `firstbootInstallCmds` di bawah `set -e`; bila pembersihan gagal setelah firstboot terpasang, node bisa Done dengan `trusted=yes` tersisa. Kemungkinan sangat kecil; bukti distro `trusted_files=0`. | Pindahkan `DEBIAN_UNTRUST_CMD` sebelum `firstbootInstallCmds`. |
| SR-6-7 | info | `dashboard/src/lib/server/redact.ts` | Probe lain yang lolos (buatan sengaja / kategori sisa risiko): (a) TAB atau `\r` di tengah token; (b) `\x24` dan `&#36;` untuk `$`; (c) NBSP di tengah nilai `token=`; (d) `/boot//<mac>//<tok>` dan `/boot/<mac>/ <tok>`. Tertangkap: JSON `/`/`$`, persen tiga lapis, base64url, UTF-16LE, ANSI di tengah token, `"TOKEN" :`, `X-Pxe-Token:`. | Opsional: `\xNN` ke `BACKSLASH_RE`, `/+` di `TOKEN_PATH_RE`, catat (a)/(c) di tabel sisa risiko. |
| SR-6-8 | info | `dashboard/src/app/api/m6-auth-matrix.test.ts:52` | Enumerasi statis lengkap, tetapi `export { handler as GET }` tidak terdeteksi regex; test juga tidak memastikan handler mutasi memakai `guardMutation` (saat ini benar). | Tambah pola `export\s*\{…\}` dan asersi "method ≠ GET → guardMutation". |
| SR-6-9 | info | `dashboard/src/lib/server/auth/rate-limit.ts:116-120` | Saat `MAX_KEYS` (20 000) penuh, kunci tertua dibuang termasuk lockout. Tidak tercapai di deploy rujukan. | Opsional: buang kunci `api:` lebih dulu. |
| SR-6-10 | info | `dashboard/src/lib/server/installers/debian.ts:45` | `.ko` virtio diunduh lewat HTTP polos lalu `insmod`; kepercayaan sama dengan kernel/initrd/media via HTTP di LAN terisolasi. | Dokumentasikan. |
| SR-6-11 | info | `infra/server/exports:4` | Ekspor Ubuntu `ro,no_root_squash` (sejak M4). Rocky baru benar: `ro,root_squash`, `10.99.0.0/24`, diasersi `m6-nfs.sh`. | Opsional: Ubuntu ke `root_squash` bila casper tidak butuh. |
| SR-6-12 | info | `dashboard/.env.example` | Contoh `printf '%s' "<password>" \| npm run …` memasukkan password ke shell history. Mode TTY tanpa echo tersedia. | Utamakan contoh prompt TTY, sebut risiko history. |

## Hasil pemeriksaan per poin

1. **Hash password: OK.** scrypt `N=2^15, r=8, p=1`, batas logN 14–20 / r 8–16 / p 1–4, salt 16–64 B, hash 64 B, `maxmem = 128·N·r + 1 MiB`, `timingSafeEqual`, NFC. Username tak dikenal → `verifyDummy` dengan parameter hash admin; username via `safeEqualString`. Tanpa kredensial default; production tanpa admin valid ditolak start (`start-guard.test.ts` 13/13). `admin:hash` stdin (TTY tanpa echo atau pipe), 12–256 karakter, tolak multi-baris, hanya cetak hash.
2. **Sesi: OK.** Token 32 B base64url, DB sha256; cookie `HttpOnly; SameSite=Strict; Path=/; Max-Age` + `Secure` bila https. ID baru tiap login, sesi lama dihapus; `cred_fp`; logout hapus baris + `Max-Age=0`; idle geser + absolut; SSE revalidasi 30 dtk, 5/sesi → 429, global 50 → 503.
3. **Penegakan: OK.** Semua route memanggil `guardRead`/`guardMutation` pertama; pengecualian tunggal `POST /api/auth/login`; `GET /api/auth/session` 401 tanpa sesi. Proxy + `SessionGate`. `next` disanitasi (≤ 2048, tanpa `/login`); open redirect tertutup. CSRF: SameSite=Strict, Origin/`Sec-Fetch-Site`, CT JSON wajib, allowlist Host.
4. **Rate limit: OK** (catatan SR-6-3, SR-6-9). 5 per (IP,user), 20 per IP; dicatat sebelum `await`; 429 + `Retry-After` seragam; tanpa enumerasi. `X-Real-IP` hanya dengan `PXE_TRUST_PROXY=1`; nginx menimpa dengan `$remote_addr` dan membuang `X-Forwarded-*`. Map dibatasi. KVM `rate-limit-login.txt`: 401×5, 429, admin 204 setelah 15 dtk.
5. **SR-5-3 dan SR-5-4: OK.** Throttle 20 baris/jalur/60 dtk + ringkasan jumlah; `flood-boot.txt`: 300 POST → 20 baris + `[boot] 271 penolakan log ditekan`, node21 Done. Frasa `I_UNDERSTAND_CONFIG_LEAKS` tanpa trim, diuji level proses.
6. **Redaksi:** carry-over M5 terbukti. Probe baru → SR-6-4 (minor), SR-6-7 (info).
7. **Generator:** Windows tanpa callback/token; Panther/Sysprep dihapus, AutoLogon mati, password diacak, logoff; install 422. Debian: `trusted=yes` dibersihkan, terbukti SSH; pembatasan ke media lokal belum ditegakkan (SR-6-1). Rocky: NFS `ro,root_squash`, 10.99.0.0/24; `%pre` membatasi `clearpart`. Golden tanpa `/boot/<mac>/<token>`; `verify-node.sh` membuktikan target bebas token.
8. **nginx: OK.** `limit_req` login 10 r/m burst 5, `/boot/` 20 r/s burst 100; allowlist. Varian `%2e%2e`, `..%2F`, `//`, `/api/../`, `%61pi` → 403; `..\` → 308 aman (SR-6-5).
9. **Secret: bersih.** `.env.example` hash kosong; `dashboard.env` placeholder; `deploy-dashboard.sh` menolak `scrypt$` nyata; `git grep` hanya fixture sintetis. `.agent/keys/`, `.agent/vms/`, `.e2e-data/`, `.env*` tidak di-track. Scan password admin E2E/KVM 0 file.
10. **Infra: OK.** `virsh_m` menolak nama terlindungi; `libvirt-diff.txt` ketiga run `protectedIdentical=true runDomainsRemaining=0`. Password admin `umask 077`/0600, dikirim via stdin; cookie jar dihapus; key node dihapus di cleanup; `install-dashboard.sh` allowlist overlay, `admin.env` dihapus via trap, env root:pxe 0640.

## Validasi ulang carry-over

| Item | Status | Bukti |
|---|---|---|
| SR-4-1 (login + rate limit) | **Closed** | `auth/*`, requireSession, `m6-auth-matrix.test.ts`, KVM `rate-limit-login.txt`, `perimeter-host.txt` |
| SR-5-3 (banjir log `/boot`) | **Closed** | throttle `boot-http.ts` + `m6-te-boot.test.ts`, KVM `flood-boot.txt` |
| SR-5-4 / DEC-016 §2 | **Closed** | `settings.ts:280-289`, `start-guard.test.ts` |
| SR-5-6 (varian path nginx) | **Closed** | `perimeter-node.txt` (403; `..\` 308 aman) |
| SR-5-7 (SSE per klien) | **Closed** | `SSE_MAX_PER_SESSION=5` → 429 |
| SR-5-8 (kontrol/bidi di nama) | **Closed** | `UNSAFE_DISPLAY_RE` |
| SR-5-10 (uji start level proses) | **Closed** | `start-guard.test.ts` |
| SR-5-11 (performa linear) | **Closed (tetap)** | `final/perf-redact-16kb.log` |
| SR-5-13 / SR-5-18 / SR-5-20 / CR-5-21 | **Closed** | `matchView` + probe baru tertangkap |
| SR-5-19 / CR-5-30 | **Closed** | salinan `sgr` + `greedy`, mutasi tercatat |
| SR-5-5(c) / CR-5-20 | **Closed** dengan sisa risiko | fixture log installer nyata (5 format); sisa: SR-6-4 |
| SR-5-14 | **Closed** (a); (b) sisa risiko terdokumentasi | `LOG_PREFIX_RE` |
| SR-5-15 | **Closed** (terdokumentasi) | header `redact.ts` |
| SR-4-3 / CR-4-7 (unattend Windows) | **Closed** | `windows.ts` `cleanupCommands`; tetap 422 |
| SR-4-6 (` ---` preseed) | **Closed** | verify-ssh distro |
| SR-4-6 / CR-4-6 (KVM Debian + Rocky + bulk) | **Closed** | `kvm/{core,bulk,distro}/results.json` PASS |
| SR-4-7(b) (`/var/log/installer`) | Diterima, terdokumentasi | `infra/README.md:89-93` |

## Penutup
Tidak ada temuan critical/major. Empat temuan minor (SR-6-1..4) sebaiknya diperbaiki atau dicatat resmi oleh Orchestrator; SR-6-1 dan SR-6-2 menyangkut kepatuhan DEC-021/DEC-019.
