# DEC-020: Stage2 Rocky 9 lewat NFS (BUG-M6-4)
- Tanggal: 2026-11-06T14:00:00Z
- Milestone: 6
- Status: Accepted
## Konteks
Smoke KVM dini M6 (`.agent/runs/m6/smoke/`, `bugs.md` BUG-M6-4): dengan `inst.repo=http://…`, dracut
mengunduh `install.img` (±1,2 GB) ke RAM. Node 2 GB (CLAUDE.md §Pengujian KVM) kehabisan ruang dan
halt. Dua jalan: stage2 lewat NFS, atau RAM node Rocky ≥ 4 GB (menyimpang dari CLAUDE.md).
Server test sudah menyajikan media lewat NFS untuk Ubuntu (DEC-009).
## Keputusan
1. Rocky memakai stage2 dan repo instalasi lewat **NFS** dari `pxe-test-server` (mis.
   `inst.stage2=nfs:<server>:/<path media rocky>` dan/atau `inst.repo=nfs:…`), sehingga `install.img`
   di-mount, bukan dimuat ke RAM. Kickstart tetap diambil lewat HTTP per-MAC (`inst.ks=`), tanpa token di
   config installer.
2. RAM node tetap **2 GB** sesuai CLAUDE.md. Run diagnostik 4 GB di smoke (attempt 4) hanya bukti
   diagnosis, bukan bukti matriks.
3. Ekspor NFS tetap read-only, hanya untuk subnet `pxe-test` (10.99.0.0/24), dan diasersi oleh test infra.
4. Bila NFS terbukti tidak bisa dipakai (bukti log), Orchestrator membuat decision baru; dev tidak
   menaikkan RAM sendiri.
## Konsekuensi
- `boot-script.ts` (argumen kernel Rocky) dan konfigurasi export server berubah → wajib test generator/
  infra dan smoke ulang Rocky sebelum run KVM resmi.
- Repo `AppStream` dihapus/dijadikan kondisional sesuai isi media (BUG-M6-5), karena ISO minimal 9.8
  hanya punya repo `Minimal/`.
