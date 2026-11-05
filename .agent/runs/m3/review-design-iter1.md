# Review design M3 — iterasi 1

- Reviewer: design-reviewer · Branch `milestone/1-3-baseline` @ `8f4b2d7`
- Acuan: SPEC §1, §3.2, `docs/design/M3-plan.md` (AC-3.12, 3.14, 3.15)
- Metode: sama dengan M1 (`.agent/runs/m1/design/audit.mjs`). Dialog install dibuka lalu ditutup
  dengan "Batal" (tanpa request simpan/install). Data `m3/design/audit-results.json`.
  Screenshot `m3/design/`.
- State M3: Sheet single (storage-01) tab OS, Credentials, Network (Static), Hostname, SSH Keys;
  AlertDialog "Install OS ke ctrl-02?"; Sheet bulk 2 host tab Network (preview IP) dan Hostname
  (preview template); 375px Sheet OS + Network.

## Hasil pengukuran objektif

| Cek | Hasil | Status |
|---|---|---|
| `body` background | `rgb(247, 247, 244)` | OK |
| Box-shadow | Tanpa drop shadow; AlertDialog hanya hairline 1px spread-only. Ring oranye 3px pada tab/close hanya saat fokus (hilang setelah blur) | OK |
| Oranye | Hanya tombol primary footer Sheet ("Install"/"Simpan & Install", `data-variant=default`) + "Install OS" bulk bar di bawah overlay. Aksi AlertDialog "Hapus disk & install" = varian destructive (bukan oranye) | OK |
| Mono | MAC/IP/hostname di preview, input IP/gateway/DNS/hostname/template, fingerprint SHA256 → JetBrains Mono. **Kecuali** badge tipe key (DR-3-1) | 1 pelanggaran |
| Label kolom tabel preview | 11px/600/uppercase/0.88px/muted | OK |
| Radius | Tombol 8px, input/select/input-group 8px, AlertDialog 12px, badge 9999px; Sheet 0px (DR-3-2) | 1 deviasi |
| Tinggi | Tombol footer 40px; input & select di Sheet 44px | OK (lihat DR-3-3) |
| Pastel di luar pill | Tidak ada | OK |
| Overflow 375px | Sheet full-width, `scrollWidth == 375` | OK |

## Temuan

| ID | Severity (critical/major/minor) | File:baris | Temuan | Saran |
|---|---|---|---|---|
| DR-3-1 | major | `dashboard/src/components/host-config/tab-ssh.tsx:136`, `:217` | Badge tipe SSH key (`ssh-rsa`, `ssh-ed25519`, `ecdsa-…`) dirender `<Badge variant="secondary">` dengan font `"Inter Variable"`. Tipe key adalah data teknis SSH key → SPEC §1 mewajibkan JetBrains Mono. Fingerprint di sebelahnya sudah `type-data` (mono). Bukti: `m3/design/sheet-single-ssh-keys.png`, `audit-results.json` → `sheet-single-ssh-keys.tech` (`kind:key, mono:false`). | Tambahkan `className="type-data"` (atau `font-mono`) pada kedua Badge tipe key. |
| DR-3-2 | minor | `dashboard/src/components/ui/sheet.tsx` (SheetContent) | Sheet konfigurasi radius 0px di semua sudut. SPEC: card/dialog/panel 12px. Sheet menempel tepi kanan sehingga sudut luar 0 wajar, tetapi sudut kiri (atas/bawah) yang menghadap konten juga 0. | Pertimbangkan `rounded-l-xl` (12px) untuk sisi kanan, atau catat pengecualian di SPEC/decision. |
| DR-3-3 | minor | `dashboard/src/components/host-config/tab-network.tsx`, `config-sheet.tsx` | Tombol kecil di Sheet: "Tambah" DNS (`size="xs"`) dan "Hapus DNS …"/"Batalkan perubahan …" (`icon-xs`) tinggi 24px, di bawah 36–40px konteks padat. | Pakai `size="sm"`/`icon-sm` minimal, atau ≥ 36px untuk target sentuh. |

## Info (non-blocking)

- I-3-1 Saat Sheet terbuka, fokus otomatis jatuh ke tab aktif (1440) atau tombol Close (375) dengan
  border/ring oranye — focus ring, diizinkan.
- I-3-2 Badge "kickstart"/"autoinstall" (metode installer) sans — bukan data teknis per daftar SPEC
  (MAC, IP, hostname, SSH key, log); diterima.
- I-3-3 Footer single host berlabel "Install" saat tidak ada perubahan dan "Simpan & Install" saat
  ada — tetap satu CTA primary per konteks.
- I-3-4 "Lihat log" belum punya tampilan (M5) — font log belum dapat diaudit.

Ringkasan: critical 0 · major 1 · minor 3.
