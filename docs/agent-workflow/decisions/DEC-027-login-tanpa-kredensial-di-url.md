# DEC-027: Login tidak boleh membawa kredensial di URL
- Tanggal: 2026-11-06
- Milestone: 7 (temuan run KVM `vlandistro`; bug sejak M6)
- Status: Accepted
## Konteks
Pada run `vlandistro` (bukti di `.agent/runs/m7/kvm/history/vlandistro-login-get-leak/`, sudah diredaksi),
Playwright menekan tombol Masuk sebelum hydration. Form login
(`dashboard/src/components/auth/login-form.tsx:94`) tidak punya `method`, sementara input memakai `name`.
Akibatnya browser mengirim `GET /login?username=…&password=…`, dan password admin ikut tercatat di:
- access log nginx (`$request_uri` tidak dimasker);
- log Playwright.

Password itu sekali pakai, file-nya sudah dihapus, dan bukti sudah dibersihkan (0 kemunculan). Bukti
M4–M6 sudah diperiksa dan tidak ada kebocoran serupa.

Ini temuan keamanan **major**: secret plaintext masuk log. Bug ini ada di `main` sejak M6, tetapi muncul
hanya bila submit terjadi sebelum JavaScript siap, sehingga lolos di M6.
## Keputusan
1. **Produk, frontend (opsi a), wajib.**
   - Form login tidak pernah boleh menghasilkan request yang membawa kredensial di URL.
   - Minimal: `method="post"` dan tombol submit nonaktif sampai hydration selesai. Submit native
     sebelum hydration tidak boleh menempatkan username/password di query.
   - Ada E2E yang membuktikannya dengan JavaScript dinonaktifkan atau submit sebelum hydration: URL
     dan request tidak berisi `password=`. Test ini harus merah bila perbaikan di-revert.
2. **Infra, defense in depth (opsi b), wajib.**
   - Format log nginx (flat dan VLAN) tidak mencatat query string untuk `/login`.
   - Lebih aman lagi bila query string semua path non-`/boot` dimasker, selama tidak mengurangi bukti
     yang dibutuhkan asersi log yang ada. Bila suatu asersi butuh query, dev menjelaskannya.
   - Diuji dengan test shell infra.
3. **Opsi c ditolak.** Spec KVM tidak boleh menunggu hydration hanya untuk menyembunyikan bug ini.
   Setelah perbaikan, spec boleh tetap dengan perilaku apa adanya.
4. **Bukti ulang.**
   - `vlandistro` dan regresi flat Debian (DEC-026 §4) dijalankan ulang di commit yang memuat perbaikan.
   - `vlanneg` dan `vlancore` (`d9d5308`) boleh dipakai ulang bila
     `git diff d9d5308 <commit final> -- dashboard/src infra` hanya menyentuh form login, log nginx, dan
     tabel UI. Diff wajib dilampirkan untuk gatekeeper.
   - Secret scan bukti diperluas dengan pola `password=` di URL.
## Konsekuensi
- frontend-dev mengerjakan §1 dan backend-dev §2, paralel dengan file yang tidak tumpang tindih.
- Temuan ini dicatat di REPORT-m7 sebagai perbaikan keamanan yang juga berlaku untuk `main` setelah
  merge.
