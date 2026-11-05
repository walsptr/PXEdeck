# Report Milestone 3
## Ringkasan
Sheet konfigurasi host (single & bulk) dengan tab OS, Credentials (sama / acak per host sekali-tampil / import CSV dengan validasi per baris), Network (static/DHCP, range/increment dengan preview dan deteksi bentrok), Hostname (RFC 1123, template dengan preview), dan SSH Keys (library + paste/unggah, fingerprint SHA256). Penyimpanan bulk atomik (semua valid atau tidak sama sekali), password disimpan sebagai SHA-512 crypt, konfirmasi install yang menghapus disk.
## Acceptance criteria
| Kriteria | Status | Bukti |
|---|---|---|
| AC-3.1 – AC-3.15 (docs/design/M3-plan.md) | Lulus (15/15) | .agent/runs/m3/ac-matrix-iter3.md |
## Perubahan utama
- `components/host-config/*`, `hooks/use-host-config.ts`, `hooks/use-network-config.ts`.
- `lib/{net,hostname,credentials,ssh-key,host-config}.ts`, `lib/server/{config-service,http,net-config}.ts`, `app/api/{hosts/bulk,hosts/[id]/{config,install},hosts/bulk/install,credentials/import,ssh-keys,network}`.
## Iterasi & temuan
- Iterasi 1: `planIps` bisa membekukan tab (CR-3-1); subnet UI ≠ server (CR-3-2 → `GET /api/network`); password acak bisa diawali karakter formula CSV (SR-3-1); password bisa terpantul di respons CSV (SR-3-4); badge tipe key tidak mono (DR-3-1). Semua diperbaiki + diuji.
- Iterasi 2: DR-1-2 lintas milestone; minor CR-3-14, DR-3-4 ikut ditutup di iterasi 3.
- Iterasi 3: APPROVED (APR-003).
## Risiko & utang teknis
- SR-3-5 (allowlist Host / DNS rebinding) wajib sebelum endpoint install nyata (M4).
- CR-3-4, CR-3-15 dikerjakan saat pindah ke DB.
## Blocker (jika ada)
Tidak ada.
## Langkah berikutnya
M4: generator autoinstall/kickstart/preseed/unattend, endpoint `/boot/{mac}.ipxe`, token per job (DEC-008), uji KVM.
