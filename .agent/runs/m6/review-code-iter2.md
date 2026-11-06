Verdict: PASS

# Code review M6, iteration 2

- Reviewer: code-reviewer (read-only). Disimpan oleh Orchestrator dari jawaban akhir reviewer tanpa diubah isinya.
- Worktree `.agent/wt-m6`, branch `milestone/6-hardening`. Kode produk `18913b5`; HEAD `fdc0abf` hanya bukti (`git diff 18913b5..HEAD -- dashboard infra` kosong). Diff iterasi 2: `2b90cf5..HEAD -- dashboard infra` (66a74d9, e273c67, c67d438, 18913b5); `git diff 4fabdb4..2b90cf5 -- dashboard infra` kosong.

## Pemeriksaan independen
- `npx tsc --noEmit`: exit 0. `npm run lint`: exit 0.
- `vitest run` (installers, m6-iter2-be, m6-kvm-apt-trust, m6-backend, components/m6-iter2-ui, redact): 10 file, 428/428 lulus. Playwright/KVM/proses tidak dijalankan.
- Skip: tidak ada `.skip/.only/.todo/fixme/xit/skipIf` di `dashboard/src`, `e2e`, `e2e-kvm`, `test`, `infra`.
- Jumlah asersi vs `main`: semua file test lama yang diubah sama atau naik. Di dalam iterasi, `m6-smoke-fixes.test.ts` (baru di M6) 113 → 110 — penggantian yang dibenarkan (CR-6-10). `m5-te-hooks` 66 → 67; `m5-library`, `m5-ui-fixes` tetap.
- Bukti KVM `kvm/results.json` commit `18913b5`: node23 Debian `apt_dir=ADA trusted_rc=1 allow_file=TIDAK allow_grep_rc=1`; node24 Rocky `apt_dir=TIDAK` (tidak relevan).

## Status temuan iterasi 1

| ID | Status | Verifikasi |
|---|---|---|
| CR-6-1 | **Fixed** | `host-config.ts:43` `AUTHORIZED_KEYS_MAX_BYTES = 32768`; `config-service.ts:516-528` menghitung key library terpilih + key library baru + key tambahan (ternormalisasi), 422 section `ssh`, all-or-nothing termasuk bulk. `debian.ts:86,212-218` generator throw `InstallerInputError` di atas 100 000 byte. Test `m6-iter2-be.test.ts` (tepat 32 KiB → 200; +1 → 422 tanpa perubahan DB; library + key baru; bulk) dan `m6-iter2-debian.test.ts` (config maksimum ≤ 100 000 dan > 50 000; 64 KiB → throw; bisection). UI hanya menampilkan error server; tanpa test UI (CR-6-9). |
| CR-6-2 | Carry-over (DEC-022 §3) | Windows tidak dilayani. |
| CR-6-3 / R4 | **Fixed** | `mediaSigned` dihapus. `isLocalMedia` (`context.ts:75`) lulus hanya bila host URL persis sama dengan IPv4 `PXE_SERVER_IP`; nama DNS, IP lain, `10.99.0.2.evil…`, URL invalid ditolak. `requireLocalMedia` di `debianPreseed` dan `debianLateScript`. `installBlocker` 422 per host (bulk Ubuntu tetap jalan). `DEBIAN_UNTRUST_CMD` sebelum `firstbootInstallCmds` di bawah `set -e`. Ter-test termasuk urutan. |
| CR-6-4 / R6 | **Fixed** | `m5-te-hooks.test.ts`: `modprobe/insmod/udevadm/uname` selalu di-stub; sandbox remap `/sys/module/`, `/tmp/`, `/usr/lib/`; `toEqual` persis 4 panggilan HTTP dan 13 langkah stub, `code===0`, mode hook 0755. Deterministik. |
| CR-6-5 | Terbuka, info (carry-over) | — |
| CR-6-6 | **Fixed** | `trustProxyWarnings` hanya saat production tanpa `trustProxy`; terpasang di `onServerStart`; unit test + process test (`server.js` standalone, peringatan tepat sekali, tanpa hash); butir README diasersi. |
| CR-6-7, CR-6-8 | Terbuka, info (carry-over) | — |
| SR-6-4 | **Fixed** | `wrappedB64Ranges` (`redact.ts:274`) linear (scan tiap baris sekali, decode tiap run sekali); lebar W ∈ {60,64,76}, baris penutup ≤ W hanya bila total kelipatan 4, min 2 baris; base64 ter-wrap bersarang digabung; UTF-16LE hanya bila ada 0x00. Test: PoC reviewer, lebar 60/64/76, secret terbelah batas baris, 2 lapis, tanpa over-redaksi. Budget ≤ 20 ms, 50 ms untuk 2 lapis. Sisa risiko (lebar lain, tanpa padding) didokumentasikan. |

**Frontend (R1/R2/R3/R7, DR-6-4/6/7/8):** benar. `job-row-failure`, `host-failure-reason`, `sheet-last-job-failure`, label timeline, catatan "tidak tersedia", empty state log not-found/session → `text-body`. `server-status` glyph per state, nama layanan terlihat di semua lebar, label state `sr-only`. Ring fokus `border-ring` + `ring-ring/40` di input/select/textarea/input-group. Hostname `24ch` + `title`. `IpText` mono tanpa mengubah `textContent`. Deskripsi 404 job-detail tidak mengulang judul. Port Playwright 3117 tidak duplikat.

**`e2e-kvm/apt-trust.ts`:** fail-closed (penanda eksplisit `trusted_rc=1`, `allow_file=TIDAK`, `allow_grep_rc=1`, dan `apt_dir=ADA` untuk Debian; sudo gagal, output ssh kosong, grep rc 2 → FAIL). Unit test menjalankan script yang sama terhadap root palsu.

## Temuan baru

| ID | Severity | File:line | Temuan | Saran |
|---|---|---|---|---|
| CR-6-9 | minor | `dashboard/src/components/host-config/config-sheet.tsx:379` (tanpa test) | DEC-022 §3 meminta 422 CR-6-1 "di UI dan API". UI mengandalkan error server `section:"ssh"` (mekanisme yang ada); tidak ada E2E/komponen test yang membuktikan pesan "Total SSH key … melebihi batas" muncul di tab SSH (single/bulk). API sudah ter-test penuh. | Tambah satu E2E/komponen test: key > 32 KiB, Simpan, asersi teks error tab SSH dan tidak ada perubahan. |
| CR-6-10 | minor | `dashboard/src/lib/server/installers/m6-smoke-fixes.test.ts:470-488`; `.agent/runs/m6/test-migration.md` | Test "mirror bertanda tangan (mediaSigned)" (8 `expect`) diganti "media eksternal → generator menolak" (2 `expect` × 3 URL); cek untrust `at(-3)` menjadi cek urutan sebelum firstboot. Static count 113 → 110. Dibenarkan (fitur dihapus, aturan lebih ketat) tetapi tanpa entri `test-migration.md`. | Tambah baris migrasi (sebelum/sesudah/alasan: DEC-022 §2, CR-6-3, SR-6-6). |
| CR-6-11 | info | `dashboard/e2e-kvm/apt-trust.ts:14`, `installers/debian.ts:126` | Cek dan `DEBIAN_UNTRUST_CMD` hanya bentuk satu baris `.list`; deb822 `*.sources` `Trusted: yes` tidak terdeteksi/dibersihkan. Debian 12 d-i menulis `sources.list` → laten; bukti KVM bersih. | Opsional: `grep -ril '^Trusted:[[:space:]]*yes'` + `*.sources` di cleanup. |
| CR-6-12 | info | `dashboard/src/lib/server/install-service.ts:45-70` | `installBlocker` tidak mengecek ulang batas byte key. Config lama > 32 KiB masih bisa memulai install → generator throw, `/boot` menolak, job Failed setelah timeout watchdog. Hanya data lab lama. | Opsional: cek `authorizedKeysBytes` di `installBlocker`. |

## Jumlah per severity

| Severity | Baru terbuka | Total terbuka (termasuk carry-over) |
|---|---|---|
| critical | 0 | 0 |
| major | 0 | 0 |
| minor | 2 (CR-6-9, CR-6-10) | 3 (+ CR-6-2 carry-over) |
| info | 2 (CR-6-11, CR-6-12) | 6 (+ CR-6-5, CR-6-7, CR-6-8; CR-6-6 fixed) |

Tidak ada critical/major terbuka. R4, R6, CR-6-1, CR-6-3, CR-6-4, CR-6-6, SR-6-4 terverifikasi dengan test perilaku nyata. Tidak ada test yang di-skip atau dilemahkan.
