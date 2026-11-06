Verdict: PASS

# Security review M6, iteration 2

- Reviewer: security-reviewer (read-only). Disimpan oleh Orchestrator dari jawaban akhir reviewer tanpa diubah isinya. Tanpa Playwright/KVM, tanpa bind port.
- Cakupan: `git diff 2b90cf5..18913b5 -- dashboard infra` (45 file), bukti KVM iterasi 2 `.agent/runs/m6/kvm/{core,bulk,distro}/` (tiap `results.json` `"commit": "18913b5"`, semua PASS), `.agent/runs/m6/final-iter2/`, DEC-021/DEC-022.
- Metode: baca kode dan bukti; probe normalisasi URL dengan WHATWG URL node 22; 79 probe redaksi terhadap salinan `redact.ts` di scratchpad + timing 16 KB/256 KB/1 MB; scan Python (`-I`) 146 file bukti (plaintext, base64, base64 baris digabung); `git grep` secret.

## Ringkasan

| Severity | Jumlah | ID |
|---|---|---|
| critical | 0 | — |
| major | 0 | — |
| minor | 0 | — |
| info | 2 baru | SR-6-13, SR-6-14 |

SR-6-1..4 dan SR-6-6 **Closed**. Tidak ada secret, password admin, hash nyata, path `/boot/<mac>/<token>`, atau private key di repo/bukti. `/etc/apt` target Debian terbukti bersih oleh cek fail-closed.

## Temuan baru

| ID | Severity | Lokasi | Skenario / PoC | Rekomendasi |
|---|---|---|---|---|
| SR-6-13 | info | `dashboard/src/lib/server/redact.ts` `wrappedB64Ranges` (kondisi baris penutup `(total + core.length) % 4 === 0`) | Komentar header meremehkan sisa risiko: bukan hanya baris terakhir base64 ter-wrap tanpa padding yang terlewat — bila baris penutup ditolak dan run tinggal 1 baris (`cores.length < 2`), **seluruh blok** tidak di-decode bersama. PoC: `wrap76(b64(path).replace(/=+$/,""))` untuk `curl …/boot/52:54:00:99:00:11/<tok>/status` → output polos; baris 2 decode ke 36 dari 43 karakter token. Juga terlewat (sudah terdokumentasi): lebar 72/80, blok ter-wrap dengan baris kosong. Kemungkinan rendah: GNU `base64`, openssl, PEM selalu padding; generator menulis base64 satu baris. | Opsional: saat baris penutup ditolak, tetap evaluasi run + baris itu (`b64HasSecret` sudah memotong ke kelipatan 4), atau koreksi komentar header. Tambah fixture blok 2 baris tanpa padding. |
| SR-6-14 | info | `installers/debian.ts` `DEBIAN_UNTRUST_CMD`; `context.ts` `isLocalMedia` | (a) Cleanup hanya `sources.list` dan `sources.list.d/*.list`, bukan deb822 `*.sources`. d-i bookworm menulis `sources.list`, dan cek KVM `grep -r trusted=yes /etc/apt` mencakup semua format (`trusted_rc=1`) → aman saat ini. (b) `isLocalMedia` menerima port lain di IP sama (`http://10.99.0.2:8080` → `true`); host sama, dalam batas DEC-022 §2. | Opsional: perluas loop ke `*.sources`; catat asumsi "port apa pun di PXE_SERVER_IP" di README. |

## Status SR-6-1..12

| ID | Status | Bukti |
|---|---|---|
| SR-6-1 (DEC-021 fail-closed) | **Closed** | Lihat rincian |
| SR-6-2 (README Asumsi keamanan) | **Closed** | `infra/README.md:94-112`: sisa risiko DEC-021 (trusted=yes hanya saat install, media lokal saja, 422 media eksternal, cleanup sebelum firstboot, checksum ISO `media-checksums.txt`), DEC-019 (polling memperpanjang idle, batas absolut 12 jam), catatan SR-6-3 |
| SR-6-3 (peringatan tanpa PXE_TRUST_PROXY) | **Closed** | `settings.ts` `trustProxyWarnings` (production dan `!trustProxy`) di `onServerStart`; `test/process/trust-proxy-warning.test.ts` tingkat proses; `m6-backend.test.ts` tepat satu peringatan, nol dengan env referensi; teks tidak membocorkan apa pun |
| SR-6-4 (base64 ter-wrap) | **Closed** (sisa risiko SR-6-13) | Lihat rincian |
| SR-6-5 (`..\` → 308) | Terbuka info, ditunda (DEC-022 §3) | `perimeter-node.txt:6` tetap tanpa `Location`/`-L`; aman (403/401 setelah redirect) |
| SR-6-6 (cleanup sebelum firstboot) | **Closed** | `DEBIAN_UNTRUST_CMD` sebelum `firstbootInstallCmds`; `m6-smoke-fixes.test.ts` cek urutan (`firstboot > untrust`) |
| SR-6-7..12 | Terbuka info, carry-over REPORT-final (DEC-022 §3) | Tidak berubah dari iterasi 1 |

**Rincian SR-6-1:** kode mati `mediaSigned` dihapus; `isLocalMedia` mensyaratkan `new URL(mediaUrl).hostname === serverIp` (IPv4); `requireLocalMedia` di `debianPreseed` dan `debianLateScript`, jadi `trusted=yes`, `allow_unauthenticated`, hook `50mirror` tidak pernah dihasilkan untuk host lain; `installBlocker` blocker untuk `method === "preseed"` → 422 tanpa job (`m6-iter2-be.test.ts:59-85`); saat boot error generator jadi 404 seragam (`provisioning.ts:114`). Probe bypass tanpa hasil: userinfo, `[`/`]`, query, fragment ditolak `httpUrl`/`URL_SAFE_RE`; literal IPv6 ditolak; variasi huruf tidak relevan; `10.99.0.2.`, `0x0A.99.0.2`, `10.99.2`, `%2e`, digit fullwidth dinormalisasi WHATWG ke 10.99.0.2 dan settings menyimpan `href` ternormalisasi yang di-parse ulang dengan parser sama (host yang lolos = host yang dihubungi d-i/apt); `010.99.0.2` → 8.99.0.2 ditolak (arah fail-closed); `10.99.0.2.evil.example` ditolak (ter-test).

**Rincian SR-6-4:** `wrappedB64Ranges` menangani lebar 60/64/76 dengan prefix log, CRLF, indentasi, spasi akhir; probe menangkap path token dan hash `$6$` dalam base64 biasa, ganda, UTF-16LE, setiap baris ditandai. Waktu linear: 1 MB ±275 ms (acak), ±47 ms (padat secret); 256 KB ±75 ms. Shortcut UTF-16LE (hanya bila ada byte 0x00) aman karena semua pola ASCII. Tidak ada jalur bocor baru selain SR-6-13.

## Pemeriksaan lain
1. **Batas byte CR-6-1: OK.** `AUTHORIZED_KEYS_MAX_BYTES = 32768` atas key library + key library baru + key tambahan; section SSH mengganti penuh key host (append tidak bisa melewati batas); > batas → 422 tanpa efek (ter-test, termasuk key library); generator menolak `late_command` > 100 000 byte (< `MAX_ARG_STRLEN` 131072) → 404 saat fetch; body request dibatasi zod (`keyIds ≤ 100`, CSV ≤ 200 KB); key sintetis (`src/test/synth-keys.ts`) blob public key deterministik tanpa materi privat.
2. **Bukti KVM 18913b5: OK.** Node 23 Debian `apt_dir=ADA`, `trusted_rc=1`, `allow_file=TIDAK`, `allow_grep_rc=1` sebelum dan sesudah reboot; node 24 Rocky tanpa `/etc/apt` (diizinkan). `apt-trust.ts` fail-closed (penanda eksplisit; grep rc 2 atau `sudo` gagal = FAIL), dicakup `m6-kvm-apt-trust.test.ts`. `evidence-scan.txt` tiap run "bersih". Scan sendiri 146 file: 0 hit untuk `$6$…$`, `scrypt$`, `/boot/<mac>/<token≥20>`, `PRIVATE KEY`, `openssh-key-v1`, pola sama dalam base64 (4 offset, UTF-16 di-strip), base64 baris digabung.
3. **Secret repo: bersih.** Hit `git grep` `PRIVATE KEY`/`$6$` semuanya fixture sintetis (`FAKE_HASH`/`fixturesalt`, header BEGIN di test redaksi) atau laporan scan lama. `.agent/keys/`, `.agent/vms/`, `.agent/media/` gitignored, 0 file ter-track; `dashboard/.env*` diabaikan; satu-satunya env ter-track `dashboard/.env.example` dengan `PXE_ADMIN_PASSWORD_HASH=` kosong. Bukti non-KVM iterasi 2 juga bersih.
4. **Test tidak dilemahkan: OK.** Test `mediaSigned` diganti test fail-closed yang lebih ketat; perubahan m5 `muted`→`body` mengikuti DEC-022 §1; test urutan di `m6-smoke-fixes` lebih ketat dari `.at(-3)`. Log iterasi 2: 73 file, 1947 test lulus; baris berubah di `context.ts`, `debian.ts`, `redact.ts`, `settings.ts` coverage 100%.
5. **Diff UI:** tidak ada sink `dangerouslySetInnerHTML`/`href` baru; satu `innerHTML` hanya dibaca di test.

## Penutup
Critical 0, major 0, minor 0, info 2 baru (SR-6-13, SR-6-14) + 7 info carry-over iterasi 1 (SR-6-5, SR-6-7..12). Tidak ada yang menghalangi gate dari sisi keamanan. SR-6-13 (koreksi teks sisa risiko redaksi) dan SR-6-14 dicatat sebagai carry-over di REPORT-final.
