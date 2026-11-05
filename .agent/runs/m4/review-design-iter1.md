# Review design M4 — iterasi 1

- Reviewer: design-reviewer · Worktree `.agent/wt-m4`, branch `milestone/4-backend-ipxe` @ `2b9d88e`
- Metode: build produksi yang ada (`.next` lebih baru dari commit `src/` terakhir `b3a7ed4`) +
  `next start -p 3250` (background, **sudah dimatikan**; port 3250 bebas lagi) dengan env subnet KVM
  (`PXE_MGMT_CIDR=10.99.0.0/24`, DNS/server `10.99.0.2`, `PXE_DHCP_INTERFACE=pxe0`), DB SQLite
  sementara hasil seed `demo` + media palsu (Ubuntu 22.04 sengaja tidak ada) di
  `dashboard/.e2e-data/design-iter1/` (gitignored; penghapusan direktori ditolak permission, jadi
  masih ada; aman dihapus). Audit Playwright read-only `.agent/runs/m4/design/audit.mjs` (`measure()`
  sama dengan `m1/design/audit.mjs` iter3, plus pengukuran top bar/tooltip/Settings/menu/OS
  card/toast). Install (single & bulk) dan hapus host di-stub dengan `page.route` di browser; satu
  PATCH simpan OS storage-01 sempat masuk ke DB sementara (tidak berdampak ke repo).
  21 state, 1440×900 + 375×812 → `.agent/runs/m4/screenshots/design-iter1/` (+ `audit-results.json`).
- Ditinjau juga: `.agent/runs/m4/screenshots/*.png` (E2E) dan `.agent/runs/m4/kvm/screenshots/*.png`
  (run KVM node11/node12).
- Acuan: SPEC §1–4, `docs/design/M4-plan.md` M4-T8, DEC-012, carry-over DR-1-3 / DR-2-3.

## Status carry-over

| ID | Status | Bukti |
|---|---|---|
| DR-1-3 (minor, M1) toast bukan Inter | **closed** | `font-family` `[data-sonner-toast]` = `"Inter Variable", -apple-system, …` di `toast-delete`, `install-error-single`, dan toast bulk (`sonner.tsx` `font-sans!`). boxShadow tetap datar (lapisan transparan 0). |
| DR-2-3 (minor, M2) hostname di judul toast sans | **closed** | Toast hapus: `storage-01` dalam `.type-data` = `"JetBrains Mono Variable"`; toast install gagal single/bulk: `storage-01`, `ctrl-01`, `ctrl-02` mono (`toast-delete.png`, `install-error-single.png`, `install-error-bulk.png`). |
| DEC-012 Reboot ke PXE nonaktif | **sesuai** | Menu baris: item `data-disabled`, opacity 0.5, alasan "Belum didukung (butuh IPMI/Redfish) — reboot host manual"; tidak ada AlertDialog reboot (`row-menu-reboot-disabled.png`). Lihat DR-4-6 untuk kontras. |

## Hasil pengukuran objektif

| Cek | Hasil | Status |
|---|---|---|
| `body` bg | `rgb(247, 247, 244)` di 21/21 state | OK |
| Judul halaman | Hosts/Settings/OS Images/SSH Keys/Jobs: 26px, 400, letter-spacing −0.325px; header 64px | OK |
| Box-shadow | 0 drop shadow di 21 state. Satu-satunya lapisan non-transparan: `ring-1` hairline spread-only pada section Settings (pengganti border, bukan drop) dan ring fokus | OK |
| Oranye | Hanya tombol primary: footer Sheet "Install"/"Simpan & Install", bulk bar "Install OS". Konfirmasi install memakai varian destructive. Tombol close Sheet oranye hanya saat focus ring (`ac-4.27-os-tab-windows.png`) | OK |
| Mono | 0 leaf teknis (MAC/IP/CIDR/key/hostname) non-mono menurut regex audit; Settings: semua nilai (`pxe0`, CIDR, IP, range, path TFTP, URL) mono; tooltip status: detail mono; label DHCP/TFTP/HTTP mono 11px. Pengecualian di judul campuran → DR-4-1 | OK* |
| Pill pastel | 0 elemen pastel di luar `[data-status]`; pill Booting/Installing/Configuring/Done/Discovered sesuai hex di KVM screenshot node11/node12 | OK |
| Status server top bar | Pill putih + hairline, radius 9999px, tinggi 24px; dot `#1f8a65` online / `#cf2d56` offline / `#a09c92` unknown; tooltip bg ink, teks krem, radius 12px, `box-shadow: none` (`topbar-mixed*.png`, `topbar-tooltip-real.png`) | OK |
| Settings | Read-only alert + 3 section; radius 12px; judul section 16px/600; label `dt` caption 13px muted; konten `max-w-3xl` (`settings.png`, `mobile-settings.png`) | OK |
| Overflow 375px | 375/375 (Hosts, Settings) | OK |

## Temuan

| ID | Severity | Halaman/komponen · screenshot | Temuan | Rekomendasi |
|---|---|---|---|---|
| DR-4-1 | minor | Sheet konfigurasi & AlertDialog install — `dashboard/src/components/host-config/config-sheet.tsx:132` (`SheetTitle {title}`), `:526-531` (`Install OS ke {hostname ?? mac}?`) · `kvm/screenshots/pxe-test-m4-node11-sheet.png`, `screenshots/ac-4.27-os-tab-windows.png`, `design-iter1/install-confirm-dialog.png` | Hostname/MAC di judul Sheet ("Konfigurasi 52:54:00:99:00:11") dan judul AlertDialog ("Install OS ke storage-01?") dirender Inter, padahal SPEC §1 "Mono untuk SEMUA data teknis". Ada sejak M3, tetapi di M4 jauh lebih sering terlihat: host hasil discovery nyata belum punya hostname, sehingga judul berisi MAC dalam sans tepat di atas subjudul MAC yang mono (kontras gaya yang jelas di screenshot KVM). Kelas masalah yang sama dengan DR-2-3 (sudah diperbaiki untuk toast). | Render judul sebagai JSX: `Konfigurasi <span className="type-data">{name}</span>` dan sama untuk judul AlertDialog install; tambahkan cek font ke E2E. |
| DR-4-2 | minor | Judul Sheet — `config-sheet.tsx:132` + `dashboard/src/components/ui/sheet.tsx:116` · `design-iter1/sheet-os-tab.png` | `SheetTitle className="type-section-title"` terukur **16px / 500** (bukan 17px/600 dari `@utility type-section-title`): `cn()`/tailwind-merge tidak mengenali utility kustom sehingga `text-base font-medium` bawaan SheetTitle tetap menang. SPEC §1: judul section/card 16–18px/**600**. Ada sejak M3 (tidak terdeteksi di review M3). | Tambahkan `font-semibold` eksplisit (atau daftarkan `type-*` ke `extendTailwindMerge` di `cn`) dan uji `font-weight` judul Sheet. |
| DR-4-3 | minor | Toast error install di atas footer Sheet · `design-iter1/install-error-single.png` | Saat install single ditolak, Sheet sengaja tetap terbuka, tetapi toast error (pojok kanan bawah, rect x 1060–1416, y 762–876) menutupi footer Sheet termasuk CTA "Install" (hanya tepi oranye yang terlihat) dan "Simpan konfigurasi" selama toast tampil. Pesan per host juga sudah ada di Alert dalam Sheet, sehingga toast menduplikasi informasi sambil menutup aksi utama. | Saat Sheet terbuka: jangan tampilkan toast error (Alert di Sheet cukup), atau pindahkan Toaster ke `top-center`/beri `offset` agar tidak menimpa footer Sheet. |
| DR-4-4 | minor | Bulk install gagal sebagian · `design-iter1/install-error-bulk.png`, `bulk-install-confirm.png` | Bila sebagian host berhasil (`started ≥ 1`) dan sebagian ditolak, Sheet langsung tertutup; alasan per host (`ctrl-01: job aktif…`, `ctrl-02: IP statis … dipakai host lain`) hanya ada di toast sementara dan Alert `install-errors` tidak pernah terlihat. M4-T8 meminta "pesan error install per host" — di skenario bulk yang paling membutuhkan, pesannya hilang setelah toast berakhir. | Biarkan Sheet tetap terbuka bila `failed.length > 0` (tampilkan Alert per host + ringkasan yang berhasil), atau beri toast `duration: Infinity` dengan tombol tutup. |
| DR-4-5 | minor | Kartu OS image di tab OS & footer — `dashboard/src/components/host-config/tab-os.tsx:308-312`, `config-sheet.tsx:491-497` · `design-iter1/sheet-os-tab.png`, `bulk-sheet-os.png` | Alasan "tidak tersedia" (media Ubuntu 22.04 tidak ada; "Windows: hanya generator unattend.xml di M4") dan "Install tidak tersedia: …" dirender `semantic-error` `#cf2d56` (terukur `rgb(207, 45, 86)`). SPEC §1 memakai warna ini untuk destructive/status gagal; Windows tidak tersedia adalah keterbatasan yang disengaja, bukan error, dan selalu tampil merah di setiap pembukaan Sheet. Dua blok merah per kartu ditambah teks merah di footer membuat tab OS tampak penuh error. | Untuk "tidak tersedia" pakai `text-muted-foreground` + ikon info, merah hanya bila host sudah memilih image tersebut (footer/alert). |
| DR-4-6 | minor | Menu baris, item "Reboot ke PXE" — `dashboard/src/components/hosts/host-actions.tsx:71-80` · `design-iter1/row-menu-reboot-disabled.png` | Teks alasan (`text-xs text-muted-foreground`) ikut opacity 0.5 dari item disabled → efektif ≈ `#bfbeb8` di atas putih, kontras ≈ 1.9:1, 12px, 3 baris. DEC-012 mensyaratkan item nonaktif **dengan alasan**; alasan itu hampir tidak terbaca. (WCAG membebaskan kontrol nonaktif, tetapi teks ini informasi.) | Taruh alasan di luar wrapper yang di-dim (mis. `opacity-100` pada span alasan dengan warna `muted`) atau tampilkan sebagai tooltip/`DropdownMenuLabel` biasa. |
| DR-4-7 | minor | Placeholder OS Images & SSH Keys — `dashboard/src/app/(dashboard)/os-images/page.tsx:12`, `ssh-keys/page.tsx:12` · `design-iter1/placeholder-os-images.png`, `placeholder-ssh-keys.png` | Judul empty state masih "OS Images — dibangun di tahap 4" / "SSH Keys — dibangun di tahap 4", padahal ini build M4 dan M4-plan §scope memindahkan UI keduanya ke M5. Copy menyesatkan operator. | Ganti menjadi "dibangun di tahap 5" (atau teks netral tanpa nomor tahap). |

## Info (non-blocking)

- I-4-1 Di 375px label DHCP/TFTP/HTTP `sr-only` sehingga top bar hanya menampilkan tiga titik; detail
  hanya lewat tooltip (tidak muncul di layar sentuh). Pola sejak M1; pertimbangkan popover saat tap.
- I-4-2 Settings: nilai "360 menit" seluruhnya mono (termasuk satuan); "Boot lokal (exit ke
  firmware)" sans — konsisten secara wajar.
- I-4-3 Screenshot full-page Settings memperlihatkan sidebar berhenti di 900px — artefak screenshot
  (sidebar sticky), bukan bug layout.
- I-4-4 Kartu OS terpilih (mis. Windows terpasang di `ac-4.27-os-tab-windows.png`) tetap menandai
  radio walau image tidak tersedia; footer menjelaskan alasannya. Sesuai perilaku, tidak ada
  pelanggaran token.
- I-4-5 Data demo (10.10.10.x) pada env subnet 10.99.0.0/24 memicu "Di luar subnet" di tab Network
  (`sheet-network-tab.png`) — artefak setup audit, bukan temuan.

Ringkasan: critical 0 · major 0 · minor 7 (DR-4-1 … DR-4-7; DR-4-1 dan DR-4-2 pre-existing sejak M3)
· info 5 · carry-over: DR-1-3 closed, DR-2-3 closed; DEC-012 diterapkan.
