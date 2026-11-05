# DEC-012: "Reboot ke PXE" ditampilkan nonaktif sampai ada kendali daya out-of-band
- Tanggal: 2026-11-05T10:05:00Z
- Milestone: 4
- Status: Accepted
## Konteks
SPEC §3.1 mencantumkan aksi baris "Reboot ke PXE". Di M2–M3 aksi ini hanya mengubah status di
store mock. Dengan backend nyata (M4), dashboard tidak punya cara me-reboot mesin fisik: tidak ada
agen di host dan tidak ada integrasi IPMI/Redfish/BMC. Mengembalikan "sukses" palsu akan
menyesatkan operator.
## Opsi yang dipertimbangkan
1. Tetap tampilkan dan pura-pura sukses — menyesatkan, melanggar prinsip status jujur.
2. Hapus aksi dari menu — menyimpang dari SPEC tanpa jejak.
3. Tampilkan aksi **nonaktif** dengan alasan ("butuh IPMI/Redfish — belum dikonfigurasi");
   `POST /api/hosts/:id/reboot` → 501. Install tetap bekerja: host di-boot ulang oleh operator
   (atau harness KVM memakai `virsh reset`, DEC-010).
## Keputusan
Opsi 3. Integrasi kendali daya (IPMI/Redfish) dicatat sebagai pekerjaan lanjutan di luar
milestone 1–6.
## Konsekuensi
- AC-2.12 bagian "reboot dengan konfirmasi" diganti: menu menampilkan item nonaktif dengan alasan
  dan API mengembalikan 501. Test reboot lama diganti test perilaku baru ini; ini perubahan
  perilaku yang disengaja lewat decision, bukan pelemahan test.
- Bagian hapus host pada AC-2.12 tidak berubah.
