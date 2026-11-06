# Code review M7 "PXE lewat VLAN" — iterasi 2

Verdict: PASS

- Reviewer: code-reviewer
- Branch `milestone/7-vlan`, HEAD `d48ce8a`, kode final `5220865`
- Diff yang direview: `339f234..5220865 -- dashboard infra` (14 file)
- Cakupan: DEC-028

## Pemeriksaan yang dijalankan sendiri (read-only)
| Perintah | Hasil |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 |
| `npx vitest run src/lib/server/m7-kvm-urlcred.test.ts src/components/host-config src/components/auth` | 6 file, 106 test lulus |
| `bash infra/test/run.sh` (sekali, berurutan) | EXIT 0, 116 lulus / 0 gagal (1m20s), termasuk kedua test GK-7-1 dan test scanner DEC-028 §2 |
| probe `URL_CRED` dengan tsx (string dibaca latin1 seperti `scanEvidence`) | lihat CR-7-7 |
| `git diff --name-only 339f234..5220865` (seluruh repo, di luar `.agent/runs`) | sesuai daftar di reuse-diff-final, ditambah DEC-028 dan `e2e/m6-ui-iter2.spec.ts` |

## Verifikasi per butir
- **GK-7-1 (`infra/deploy-dashboard.sh:121-132`)**
  - Saat dry-run, script hanya menjalankan `ssh_server … </dev/null`. `run` hanya mencetak, sehingga tidak ada pipe dan tidak ada SIGPIPE.
  - `diff -w` menunjukkan cabang `else` byte-identik dengan pipeline lama, hanya berbeda indentasi.
  - `lib.sh` (`run`/`ssh_server`) dan `kvm-run.sh` tidak berubah (diff 0 baris).
  - `infra/test/m7-gk71.sh` sehat:
    - Penulis lambat disuntik lewat `export -f printf`. Fungsi ini hanya aktif untuk argumen `PXE_ADMIN_USERNAME=*` dan di-`unset -f` setelah `run_infra`.
    - `run_infra` tidak meng-`exit`, jadi `unset` selalu jalan.
    - Hook hanya ada di harness test. Tidak ada jalur produksi yang membacanya, jadi tidak bisa bocor ke produksi.
    - Test (a) deterministik: sleep 0.4 s jauh lebih lama dari `run` dry-run, sehingga revert selalu exit 141. `mutation-iter2.txt` M1/M2 memang merah.
    - Test (b) memeriksa stdin persis 3 baris, satu pemanggilan `umask 077`, dan tidak ada hash/password di argv maupun output. Mutasi M3–M5 merah.
  - Tidak flaky: 10/10 di `final-iter2` + 1 run saya.
- **CR-7-3**: setelah komentar dibuang, diff `login-form.tsx` kosong. JSDoc kembali menempel ke `loginErrorText`. **Selesai.**
- **CR-7-4**: label region sekarang "Area gulir preview …" dan "Area gulir password yang dibuat". Label tabel tidak berubah, jadi selector `e2e-kvm/m6-bulk` dan `m6-core` (`getByRole("table", { name: "Preview …" })`) tetap valid. Asersi lama di `plan-table-a11y.test.tsx` tidak dilemahkan: query region diganti ke nama baru, lalu ditambah asersi negatif (nama lama tidak ada) dan asersi label region ≠ label tabel. Ada juga test baru untuk `PasswordsDialog`. **Selesai.**
- **CR-7-2 (scanner)**
  - `redact-evidence.sh`: prefilter grep `-i` untuk `?`/`&`/`%3F`/`%26`/`&`/`?` + `=`/`%3D`/`=`. Setelah itu awk melakukan decode → tolower → memeriksa setiap nilai. Hanya placeholder utuh yang dikecualikan.
  - `m7-shared.ts` memakai lookahead negatif `(?!PLACEHOLDER?END)`.
  - Tidak ada kuantifier bersarang di kedua sisi, jadi tidak ada risiko ReDoS. Cost-nya linear terhadap jumlah kandidat. awk hanya memproses baris hasil prefilter, sehingga murah untuk bukti besar.
  - Kedua implementasi konsisten untuk semua kasus test, dan kasus "bad"/"good" di vitest sama persis dengan test shell.
  - Pemindaian ulang atas bukti KVM (`final-iter2/kvm-evidence-rescan.txt`) menghasilkan 0 temuan.
  - **Selesai.** Ada catatan minor di CR-7-7.
- Dua kasus vitest lama (komentar ber-backtick) pindah dari "tidak menandai" ke "menandai". Ini konsekuensi aturan yang lebih ketat dan sengaja, bukan pelemahan. `ok.txt` di `m7-te.sh` juga disesuaikan; baris yang dibuang dari sana muncul lagi di daftar `bad`.
- `m7-te.sh`: hanya komentar/judul test dan satu test baru. Asersi `OPTIONS="-w -h 10.99.10.2"` tetap ada.
- `apply-profile.sh`: 0 baris non-komentar berubah, saya verifikasi sendiri. `README.md` hanya dokumentasi.
- `e2e/m6-ui-iter2.spec.ts` (di luar daftar DEC-028): perbaikan flaky. Nilai poll disimpan lalu dipakai ulang, dan asersi `text`/`color` tetap sama. Bukan pelemahan.
- **Verdict "tanpa run KVM ulang" (`kvm/reuse-diff-final.txt`)**: saya verifikasi sendiri dan hasilnya **benar**.
  - File non-test yang berubah hanyalah cabang `is_dry`, komentar `apply-profile.sh`, README, posisi JSDoc `login-form.tsx` (label/selector login sama), `scrollRegionLabel` (tidak dirujuk `e2e-kvm/m7-*`), dan scanner (scan saja, tidak memengaruhi boot/install/deploy).
  - Tidak ada perubahan pada `lib.sh`, `kvm-run.sh`, nginx, `server/**` non-komentar, switch, relay, generator, validasi, atau boot.
  - Syarat gate-iter1 §Bukti ulang 5 terpenuhi.

## Temuan
| ID | Severity | File:baris | Temuan | Saran |
|---|---|---|---|---|
| CR-7-7 | minor | dashboard/e2e-kvm/m7-shared.ts:127-129 + kvm-harness.ts:331 | `scanEvidence` membaca file dengan `latin1`, sehingga `…` (UTF-8 E2 80 A6) menjadi `"â\u0080¦"`, dan alternatif `…` di `URL_PLACEHOLDER` tidak pernah cocok pada file bukti. Probe: `URL_CRED.test(Buffer.from("GET /login?username=…&password=… HTTP/1.1").toString("latin1")) === true`, sedangkan dengan utf8 hasilnya `false`. Akibatnya placeholder `…` tetap dianggap temuan (false positive, fail-closed, bukan kebocoran), tidak konsisten dengan `redact-evidence.sh` yang membandingkan byte, dan test vitest yang hanya memakai string JS tidak menangkap perbedaan ini. Masalah ini sudah ada sejak pola lama. Rescan bukti saat ini 0 temuan, jadi tidak ada dampak ke gate. | Tambahkan alternatif `â\u0080¦` di `URL_PLACEHOLDER`, atau baca file sebagai utf8 khusus untuk cek ini, lalu tambahkan test yang memakai `Buffer…toString("latin1")`. |
| CR-7-8 | info | infra/redact-evidence.sh:44; m7-shared.ts:124-126 | Masih ada false negative di luar cakupan DEC-028: double-encoding (`%253Fpassword%253D…`) dan `password=` di awal baris tanpa pemisah `?`/`&` (misalnya body form `password=x` yang di-log). Probe double-encoding menghasilkan `false`. | Opsional: decode berulang (maks 2×) dan tambahkan `^` sebagai pemisah. |

## Status temuan iterasi 1
| ID | Status |
|---|---|
| CR-7-1 (minor) | Ditunda sesuai DEC-028 §3 (carry-over, jalur nginx/KVM) |
| CR-7-2 (minor) | Selesai (`5220865`) |
| CR-7-3 (minor) | Selesai |
| CR-7-4 (minor) | Selesai (plan-table + passwords-dialog, dengan test) |
| CR-7-5 (info) | Ditunda (DEC-028 §3) |
| CR-7-6 (info) | Ditunda (DEC-028 §3) |

## Ringkasan severity
| Severity | Jumlah (baru) |
|---|---|
| critical | 0 |
| major | 0 |
| minor | 1 (CR-7-7) |
| info | 1 (CR-7-8) |

Tidak ada test yang di-skip atau dilemahkan. Laporan ini bukan approval; keputusan ada di gatekeeper.
