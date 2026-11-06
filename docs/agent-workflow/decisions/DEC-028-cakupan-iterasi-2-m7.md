# DEC-028: Cakupan iterasi 2 M7
- Tanggal: 2026-11-07
- Milestone: 7
- Status: Accepted
## Konteks
Gate M7 iterasi 1 (`.agent/runs/m7/gate-iter1.md`) memberi CHANGES_REQUESTED hanya karena GK-7-1 (major):
`infra/test/run.sh` hijau 8/10. Penyebabnya race SIGPIPE di jalur dry-run `infra/deploy-dashboard.sh:121-125`,
bug infra sejak M6.

Semua bukti KVM sudah PASS, termasuk Ubuntu UEFI/BIOS, Debian, Rocky lewat VLAN, uji negatif, dan regresi
flat. Gatekeeper menetapkan bahwa perubahan apa pun pada nginx, profil server, generator, atau komponen
yang dipakai spec KVM (`e2e-kvm/m7-*`) mewajibkan run KVM ulang (beberapa jam). Komponen itu antara lain
tab Credentials dan tab Network di Sheet.
## Keputusan
1. **Wajib:** GK-7-1. Jalur dry-run tidak boleh mem-pipe ke konsumen yang tidak membaca stdin. Jalur
   non-dry identik byte demi byte. Ada test regresi (penulis lambat) yang merah bila di-revert, dan test
   shell bahwa jalur non-dry tetap mengirim env admin lewat stdin.
2. **Ikut dikerjakan karena murah dan di luar jalur KVM:**
   - CR-7-2 / SR-7-5: pengecualian placeholder di scanner kredensial URL (`redact-evidence.sh`, `m7-shared.ts`
     `URL_CRED`) hanya untuk token placeholder utuh, ditambah bentuk ter-encode (`%3D`, `%26`). Scanner
     dijalankan ulang atas `.agent/runs/m7/**`.
   - SR-7-2 (dokumentasi saja): koreksi komentar `apply-profile.sh` dan `infra/README.md` §Topologi VLAN agar
     perimeter yang tertulis sesuai kenyataan. rpcbind/mountd/statd/sshd wildcard terjangkau dari VLAN, dan
     filter nftables direkomendasikan untuk production. Perilaku `verify-listen-vlan.sh` tidak diubah.
   - CR-7-3: pindahkan blok hydration di `login-form.tsx` agar JSDoc kembali ke `loginErrorText`. Hanya
     posisi kode, tanpa perubahan perilaku.
   - CR-7-4: label region di `plan-table.tsx` dibedakan dari label tabel. Preview bulk tidak dipakai spec
     KVM M7.
3. **Ditunda (carry-over di REPORT-m7, alasannya menyentuh jalur atau komponen KVM):**
   - CR-7-1 / SR-7-1: masking `error_log` nginx.
   - SR-7-2: filter nftables.
   - DR-7-1: ringkasan error tab Network.
   - DR-7-2: aksesibilitas tab Credentials (sejak M3).
   - DR-7-3: fokus checkbox.
   - Semua temuan info.

   DR-7-2 adalah temuan axe critical yang sudah ada sejak M3. Temuan ini dicatat sebagai prioritas pertama
   pekerjaan lanjutan.
4. **Tanpa run KVM ulang**, selama diff `339f234..<final>` memenuhi syarat "tanpa run ulang" di gate-iter1
   §Bukti ulang 5. Bukti diff wajib ditulis ke `kvm/reuse-diff-final.txt`. Bila syarat itu tidak terpenuhi,
   run KVM yang ditetapkan gatekeeper dijalankan.
5. **Bukti ulang lokal:**
   - `infra/test/run.sh` 10× berurutan, 10/10 hijau.
   - typecheck, lint, vitest + coverage, `test:process`.
   - E2E penuh 2×, karena `dashboard/src` berubah (CR-7-3, CR-7-4).
   - axe, skip-weakening, secret scan.
   - `ac-trace.md` ke commit final.

   Review iterasi 2: code dan security. Design juga dijalankan, karena `plan-table` berubah.
## Konsekuensi
- backend-dev: §1 dan bagian infra/dokumentasi §2. frontend-dev: CR-7-3 dan CR-7-4. test-engineer:
  scanner §2 dan bukti ulang §5.
