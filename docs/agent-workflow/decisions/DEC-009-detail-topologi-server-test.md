# DEC-009: Detail topologi PXE server test (amandemen DEC-003)
- Tanggal: 2026-11-05T07:07:00Z
- Milestone: 4
- Status: Accepted
## Konteks
Plan M4 (`docs/design/M4-options.md` §O3–O6, O11) menyempurnakan detail DEC-003: IP sumber
request diperlukan untuk binding token (DEC-008), deploy dashboard ke VM, cara membawa ISO, cara
boot installer Ubuntu dengan node 2 GB RAM, dan DHCP di network NAT.
## Opsi yang dipertimbangkan
1. Next.js langsung di :3000 tanpa proxy — IP sumber dari socket tidak selalu tersedia di route
   handler Next 16; media besar lewat Node tidak efisien.
2. nginx di :80 di depan Next (127.0.0.1:3000): `X-Real-IP` dari socket, media statis dilayani
   nginx, header klien `X-Forwarded-*` dibuang.
3. Boot Ubuntu dengan `url=` ISO — butuh RAM > 10 GB (README §10); vs kernel/initrd via HTTP +
   root live via NFS (terbukti di lab).
## Keputusan
- Opsi 2: dashboard diakses di `http://10.99.0.2/`; Next hanya listen di 127.0.0.1:3000.
- Deploy: `next build` mode standalone di host, kirim via scp, jalankan dengan systemd di VM.
- Media: ISO dipasang read-only sebagai CD-ROM VM server (bukan disalin), di-mount loop dan
  disajikan nginx (HTTP) serta NFS read-only ke `10.99.0.0/24` untuk root live Ubuntu.
- Boot Ubuntu: kernel/initrd via HTTP + `netboot=nfs` (bukan `url=`).
- Network: `pxe-test-nat` dengan IP statis tanpa DHCP libvirt; `pxe-test` tanpa `<dhcp>` dan
  `dns enable='no'` agar dnsmasq libvirt tidak berjalan di bridge itu.
- DEC-003 tetap berlaku; detail port `:3000` di dalamnya digantikan oleh `:80` di sini.
## Konsekuensi
- Verifikasi wajib: dnsmasq di VM server dan NFS/nginx hanya terpapar di NIC `pxe-test` (selain
  SSH di NIC NAT untuk provisioning); bukti `ss -lntup`.
- Base disk server di-provision sekali (overlay qcow2 per run) untuk menghemat waktu iterasi.
