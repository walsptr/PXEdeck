# Review design M3 — iterasi 2

- Reviewer: design-reviewer · Branch `milestone/1-3-baseline` @ `ed30b1e`
- Acuan: SPEC §1, §3.2, `docs/design/M3-plan.md`, `review-design-iter1.md`, `gate-iter1.md`
- Metode: sama dengan M1 iter2 (`.agent/runs/m1/design/audit.mjs`). Dialog install ditutup
  "Batal". State baru memakai stub `page.route` di browser (server tidak dimutasi):
  error state Sheet (`GET /api/hosts/*/config` → 500), dialog password acak (`POST
  /api/hosts/bulk` → `generatedPasswords` dummy `DUMMY-audit-*`). Data
  `m3/design/iter2/audit-results.json`. Screenshot `m3/design/iter2/`.
- State M3: Sheet single (storage-01) 5 tab, AlertDialog install, Sheet bulk Network/Hostname,
  375px Sheet OS/Network, **baru:** `sheet-error`, `passwords-dialog`,
  `passwords-dialog-confirmed`.

## Status temuan iter1

| ID | Status | Bukti |
|---|---|---|
| DR-3-1 (major) | **closed** | `tab-ssh.tsx:144,228` Badge `className="type-data"`. Terukur: badge `ssh-rsa` → `"JetBrains Mono Variable"` (`sheet-single-ssh-keys.tech`, kind `key`, slot `badge`, mono true). `iter2/sheet-single-ssh-keys.png` |
| DR-3-2 (minor) | **closed** | `ui/sheet.tsx:66` `data-[side=right]:rounded-l-xl`. Terukur `sheet-content` radius `12px 0 0 12px` (semua state Sheet). |
| DR-3-3 (minor) | **terbuka sebagian** | "Hapus DNS …" & "Batalkan perubahan …" tetap `icon-xs` visual 24px (area klik diperluas `after:-inset-1` → 32px). "Tambah" DNS `tab-network.tsx:272` `h-8` → 32px. Token hostname (`tab-hostname.tsx`) dan tombol password (`tab-credentials.tsx`) naik ke `sm`/`icon-sm`. Masih < 36px untuk tiga kontrol tsb. Lihat DR-3-4. |

## Hasil pengukuran objektif

| Cek | Hasil | Status |
|---|---|---|
| `body` background | `rgb(247, 247, 244)` | OK |
| Box-shadow | Sheet, AlertDialog, Dialog password: hanya hairline spread-only. **Toast** "Konfigurasi 2 host disimpan" drop shadow `0 4px 12px rgba(0,0,0,.1)` | 1 pelanggaran (DR-1-2) |
| Oranye | Primary footer Sheet ("Install"/"Simpan & Install"), dialog password "Unduh CSV" (satu CTA), "Install OS" bulk bar di bawah overlay. Error state: tidak ada oranye ("Coba lagi" outline). Checkbox konfirmasi tercentang = ink `rgb(38,37,30)`, bukan oranye | OK |
| Mono | Dialog password: MAC, hostname, username, password → mono. Badge tipe key mono. Error state: MAC subjudul Sheet mono. 0 leaf teknis non-mono di 13 state M3 | OK |
| Dialog password | Radius 12px; "Selesai" outline 40px (disabled sampai unduh/konfirmasi); checkbox 16px radius 6px, border hairline-strong; tanpa tombol close X | OK |
| Error state Sheet | `Alert variant=destructive`: bg putih, border hairline `rgb(230,229,224)`, radius 8px, teks `rgb(207,45,86)` (token destructive). Form tidak dirender | OK |
| Radius | Tombol/input 8px, AlertDialog/Dialog 12px, Sheet 12px sisi kiri, badge 9999px | OK |
| Tinggi | Tombol footer 40px, input/select Sheet 44px. Kecuali DR-3-4 | lihat DR-3-4 |
| Pastel di luar pill | Tidak ada | OK |
| Overflow 375px | `scrollWidth == 375` | OK |

## Temuan

| ID | Severity (critical/major/minor) | File:baris | Temuan | Saran |
|---|---|---|---|---|
| DR-3-4 | minor | `dashboard/src/components/host-config/tab-network.tsx:272` (Tambah DNS), `:242` (Hapus DNS), `config-sheet.tsx:422` (Batalkan perubahan) | Lanjutan DR-3-3. "Tambah" DNS `InputGroupButton size="xs" className="h-8"` → 32px, di bawah 36–40px konteks padat. "Hapus DNS"/"Batalkan perubahan" visual 24px; target klik 32px via pseudo-element — tetap < 36px. Bukti: `sheet-single-network`, `sheet-bulk-network`, `mobile-sheet-network` → `shapes.buttons` (24, 32). | "Tambah": `h-9` (input-group 44px masih muat). Icon-button di dalam badge boleh tetap 24px visual bila dicatat sebagai pengecualian di SPEC/decision; jika tidak, perluas hit area ke ≥ 36px. |

Lintas milestone: **DR-1-2 (major, terbuka)** — toast Sonner ber-drop shadow, muncul di alur
simpan konfigurasi M3. Bukti `iter2/passwords-dialog.png`; detail di `m1/review-design-iter2.md`.

## Info (non-blocking)

- I-3-1 s/d I-3-4 iter1 tetap berlaku.
- I-3-5 Di 375px Sheet full-width tetap memakai sudut kiri 12px — kosmetik, diterima.
- I-3-6 Alert error: judul dan deskripsi sama-sama merah destructive; pertimbangkan deskripsi ink
  agar pesan panjang lebih terbaca (bukan pelanggaran SPEC).
- I-3-7 Dialog password: "Selesai" ber-`disabled` sebelum unduh/konfirmasi — tidak ada oranye
  tambahan; "Unduh CSV" satu-satunya CTA primary di konteks.

Ringkasan: critical 0 · major 0 milik M3 (+ DR-1-2 lintas milestone, terbuka) · minor 1 (DR-3-4) ·
iter1: DR-3-1 closed, DR-3-2 closed, DR-3-3 terbuka sebagian (→ DR-3-4).
