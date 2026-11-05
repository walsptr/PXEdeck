# Code review M5 (callback status & jobs), iterasi 1

- Reviewer: code-reviewer
- Worktree `.agent/wt-m5`, branch `milestone/5-callback-jobs` @ `96eb489`, diff `23e508e..96eb489`
- Acuan: `docs/SPEC.md`, `docs/design/M5-plan.md` (AC-5.1..5.43), DEC-013/014/015, `.agent/runs/m4/gate-iter1.md` (carry-over)
- Laporan ini tidak memuat keputusan approve; keputusan ada di gatekeeper.

## Verifikasi yang dijalankan reviewer (read-only)

| Perintah | Hasil |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | bersih, tanpa error |
| `npx vitest run` @ HEAD | 45 file, **1080/1080 lulus**. Bukti `unit.log` tercatat 1078 karena dibuat di `ae3b7c1`; selisih 2 test berasal dari regresi BUG-M5-1 (lihat CR-5-12). |
| grep `.skip/.only/.todo/.fixme/xit/xdescribe/skipIf/runIf/test.fail` di `dashboard/src`, `dashboard/e2e`, `dashboard/e2e-kvm`, `infra/test` | 0 hit |
| Baris `-` di file test (`git diff`) | Semua baris yang dihapus sudah ditelusuri: perubahan signature `GET(req)`, pergeseran indeks karena hook log (asersi lama tetap ada di indeks baru dan baris baru juga diasersikan), placeholder yang diganti test konten nyata, harapan `--replace`, dan versi migrasi rusak 2 → 99. Saya tidak menemukan pelemahan. Kesimpulan ini sama dengan `test-migration.md` #1–#17. |
| Semua handler GET di `app/api/**` | Semuanya memanggil `guardRead` (diperiksa dengan skrip grep) |
| Bukti KVM | `kvm/results.json`: AC-5.38..5.43 dan CR-4-12 (dnsmasq/nginx) semuanya PASS. `kvm-run.txt` `result PASS exit=0`. Playwright KVM 4/4. |

## Temuan

| ID | Severity | File:baris | Temuan | Saran |
|---|---|---|---|---|
| CR-5-1 | minor | `dashboard/src/lib/server/installers/shell.ts:106` (`logTailCmd`) | `cut -c1-240` memotong baris di node, yaitu **sebelum** `redactSecrets` berjalan di server. Kalau URL ber-token `/boot/<mac>/<43>/…` (dari debug log subiquity atau cloud-init) terpotong di tengah token, `TOKEN_PATH_RE` (wajib tepat 43 karakter) tidak cocok, sehingga prefiks token tersimpan di `job_events`. Hash `$6$` yang tersisa < 20 karakter juga lolos. Dampaknya kecil karena jalur ini hanya dipakai saat gagal, token langsung dicabut oleh callback `failed`, dan hanya sebagian token yang bocor. Tetap saja ini bertentangan dengan janji R3/AC-5.12 bahwa DB tidak memuat token plaintext. | Ada dua pilihan. (a) Redaksi di server juga menangkap token parsial: `/boot/<mac>/[A-Za-z0-9_-]{8,43}` di akhir baris dan `$6$…` berapa pun panjangnya. (b) Di node, lewatkan dulu `sed` yang menyamarkan `/boot/<mac>/<43>` sebelum `cut`. Tambahkan test redaksi untuk token terpotong. |
| CR-5-2 | minor | `dashboard/src/lib/server/job-lifecycle.ts:64-69` dan `discovery.ts:182` | Timeout Booting **tidak absolut**. Setiap kali installer dilayani, entri `{stage:"booting", source:"boot-script"}` baru ditambahkan, dan `stageEnteredAt` mengambil entri terakhir, sehingga jam Booting kembali ke nol. Dengan N=3, job bisa bertahan di Booting sampai sekitar (N+1)×`PXE_JOB_BOOTING_TIMEOUT_MIN`. Hasilnya konsisten dengan definisi literal di plan §2.3, tetapi DEC-014 §2 menyebut "timeout absolut per tahap". AC-5.8 hanya menguji satu penyajian, jadi perilaku ini tidak terlihat. | Putuskan secara eksplisit. Untuk timeout absolut: pakai entri **pertama** dari run tahap aktif, atau `createdAt` untuk booting. Kalau reset memang disengaja: catat di DEC/plan. Lalu tambahkan test sweep setelah ≥ 2 penyajian. |
| CR-5-3 | minor | `dashboard/src/lib/server/job-lifecycle.ts:94-108`, `sse.ts:105` | `sweepJobs` selalu membuka `BEGIN IMMEDIATE` (write lock), termasuk saat tidak ada job yang perlu diubah. Fungsi ini dipanggil tiap 1 detik per koneksi SSE (maksimal 50), tiap 5 detik per tab untuk `/api/hosts`, `/api/jobs`, dan `/api/jobs/:id`, serta oleh timer. Akibatnya request baca menjadi penulis, dan kontensi dengan callback/log installer meningkat (R10). Ketika SQLITE_BUSY terjadi di tick SSE, `catch { close() }` menutup stream tanpa `end`. | Sebelum membuka tx, lakukan pra-cek tanpa transaksi: `listActiveJobs` dan filter yang lewat timeout. Buka `tx` hanya bila ada kandidat, lalu baca ulang di dalam tx. Sebagai alternatif, sweep di SSE dibatasi, misalnya hanya saat timeout tahap terdekat sudah lewat. |
| CR-5-4 | minor | `dashboard/src/lib/server/db/repos/jobs.ts:319-326`, `hooks/use-jobs.ts:302-321` | Cursor `before` = id job, lalu dicari di DB. Polling `useInfiniteQuery` me-refetch semua halaman dengan cursor lama. (a) Bila job cursor sudah terhapus oleh `pruneHostHistory`, halaman ke-2 mendapat 400 "before: job tidak ditemukan" dan seluruh query masuk error (Alert terus tampil). (b) Bila ada job baru masuk, item terakhir halaman 1 terdorong ke luar halaman 1, sementara halaman 2 tetap dimulai dari cursor lama, sehingga item itu hilang dari tampilan. | Pakai cursor nilai `(created_at,id)` yang dienkode, tanpa lookup id, sehingga cursor tidak bisa menjadi tidak valid. Pertimbangkan juga `maxPages` atau hanya me-refetch halaman pertama. |
| CR-5-5 | minor | `dashboard/src/hooks/use-job-log.ts:128-168` | Untuk job yang tidak ada (dipangkas oleh retensi atau host dihapus sebelum stream dibuka), SSE dibalas 404, `onerror` terpanggil 3×, lalu klien beralih ke polling. Polling juga dibalas 404, error dilempar, status menjadi "reconnecting", dan polling diulang tiap 5 detik **tanpa batas**. UI terus menampilkan "Terputus — mencoba ulang" untuk job yang memang sudah tidak ada. | Saat polling mendapat 404 (atau 4xx selain 429), hentikan klien dan tampilkan status final, misalnya "Job tidak ditemukan". |
| CR-5-6 | minor | `dashboard/src/lib/server/sse.ts:92-93` | Resume dengan `after=k` mengambil `lastRepeat` dari kondisi DB saat ini. Bila event `k` digabung (repeat naik) selama klien terputus, nilai `repeat` baru tidak pernah dikirim ulang, sehingga klien menampilkan `×n` yang basi sampai job selesai. JSON fallback sudah menangani kasus ini (`after = lastSeq − 1`), tetapi SSE belum. | Saat resume, kirim ulang event `after` sekali (inisialisasi `lastRepeat = 0` bila `after > 0`), atau klien membuka dengan `after = lastSeq − 1` seperti polling. |
| CR-5-7 | minor | `dashboard/src/lib/server/db/repos/job-events.ts:130-147` | Jendela penggabungan 60 detik dihitung dari `at` kemunculan **pertama** (`last.at` tidak pernah diperbarui saat merge). Pada banjir PXE loop (R6), tetap tercipta satu baris baru per menit, bukan satu baris per rentetan, dan baris gabungan tidak menunjukkan waktu kemunculan terakhir. | Simpan `last_at` (atau perbarui `at`) saat merge, dan bandingkan jendela terhadap kemunculan terakhir. Atau dokumentasikan bahwa jendela dihitung dari kemunculan pertama. |
| CR-5-8 | minor | `dashboard/src/lib/server/install-service.ts:43` | `installHosts` tidak menjalankan sweep. Job yang sudah lewat timeout tetapi belum disapu (≤ `PXE_WATCHDOG_INTERVAL_SEC`, atau tanpa GET di antaranya) membuat `POST /api/hosts/:id/install` ditolak 422 "sedang berjalan", padahal tahapnya sudah habis. Klien API langsung tidak konsisten dengan GET berikutnya. | Panggil `sweepJobs(now, id)` di awal `installHosts`, di dalam tx yang sama, dan tambahkan test integration untuk install tepat setelah timeout tanpa GET di antaranya. |
| CR-5-9 | minor | `dashboard/src/lib/types.ts:42-121`, `hooks/use-os-images.ts:10-25`, `hooks/use-ssh-keys.ts:9` vs `lib/server/jobs-service.ts:176-203`, `db/repos/os-images.ts` | Tipe kontrak API (`JobSummary`, `JobLogEvent`, `HostLastJob`, `OsImageInfo`, `SshKeyInfo`) ditulis ulang manual di sisi klien ("salinan"). Tidak ada pemeriksaan compile-time bahwa salinan itu sama dengan tipe server (tidak ada `expectTypeOf` atau asersi tipe). Selain itu, `HostLastJob.failureReason` bertipe `string`, padahal di server `FailureReason \| null`, dan di klien field M5 OS image bersifat opsional. Perubahan kontrak di masa depan akan lolos typecheck. | Tambahkan test tipe, misalnya `expectTypeOf<ServerJobSummary>().toEqualTypeOf<JobSummary>()` di file test node. Atau satukan sumber tipe di modul bebas-server (`lib/types.ts`) yang diimpor oleh kedua sisi. |
| CR-5-10 | minor | `infra/assert-server-logs.sh:70-76` | Entri hasil disisipkan ke `results.json` dengan `sed` yang mencari `"results": [`. Cara ini rapuh: bergantung pada format pretty-print harness, dan nilai `note` hanya di-escape untuk `\` dan `"`, tidak untuk `&` atau newline. Saat ini nilainya aman (IP/angka), tetapi kalau pesan bebas ditambahkan nanti, JSON atau penggantian `sed` bisa rusak tanpa terdeteksi. | Gabungkan dengan `python3 -c`/`jq` bila tersedia di host, atau tulis ke berkas terpisah `server-log-asserts.json`. Tambahkan test infra untuk `note` yang memuat `&`. |
| CR-5-11 | minor | `dashboard/src/lib/server/sse.ts:131-134` | Exception apa pun di `tick` (termasuk SQLITE_BUSY sementara) menutup stream secara diam-diam, tanpa log server. Klien menghitungnya sebagai kegagalan, dan setelah 3 kali beralih permanen ke polling. Akibatnya masalah DB tidak terlihat di journal. | Catat satu baris `[sse] tick gagal: <message>` tanpa data sensitif. Pertimbangkan retry tick sekali untuk SQLITE_BUSY. |
| CR-5-12 | minor | `.agent/runs/m5/{unit.log,coverage-*.txt,e2e.log}` | Bukti test dibuat di `ae3b7c1`, sedangkan HEAD `96eb489` mengubah `os-images.ts` serta `db.test.ts`, `m4-api-routes.test.ts`, dan `e2e/m5-library.spec.ts`. Log unit/coverage/E2E belum mencerminkan HEAD: unit tercatat 1078, sementara di HEAD 1080 (verifikasi reviewer). Screenshot AC-5.27 sudah diperbarui, tetapi `e2e.log` belum. | Test-engineer menjalankan ulang `npm run test` (coverage) dan E2E `m5-library` di HEAD, lalu memperbarui log sebelum gate. |
| CR-5-13 | info | `.agent/runs/m5/kvm/deploy-dashboard.txt` | Run KVM resmi dideploy dari `543cf5a`. Dari `543cf5a` ke HEAD, perubahan kode produk hanya `db/repos/os-images.ts` (BUG-M5-1, perhitungan `imageUsage`), yang tidak menyentuh jalur boot, job, atau callback. Dengan begitu bukti KVM tetap representatif. | Gatekeeper cukup mencatatnya; run ulang KVM tidak diperlukan. |
| CR-5-14 | info | `dashboard/src/lib/server/provisioning.ts:50-63` | Callback `done` yang sah tetapi tiba setelah watchdog menandai `failed` akan ditolak 404, sehingga host tetap Failed walaupun OS terpasang. Ini sesuai DEC-014 §2 dan R2 (diterima). | Saya tidak minta perubahan. Masa tenggang tetap tercatat sebagai kandidat decision. |
| CR-5-15 | info | `dashboard/src/lib/server/installers/installers.test.ts:51` | Konstanta `KCMD` tulis-tangan lama masih dipakai di `installers.test.ts`. CR-4-4 sudah tertutup oleh `m5-te-hooks.test.ts` (KCMD diturunkan dari `installerScript()` + test mutasi negatif), tetapi belum ada asersi bahwa konstanta lama sama dengan hasil turunan. | Opsional: asersikan `KCMD.<m> === kcmdFromScript(realScript(m))`, atau ganti konstanta dengan hasil turunan. |
| CR-5-16 | info | `dashboard/src/lib/server/installers/m5-te-hooks.test.ts:158` | `.replace(TOKEN.slice(0, 42), TOKEN.slice(0, 42))` tidak melakukan apa pun (no-op). Asersinya tetap valid. | Hapus no-op agar intent test jelas. |
| CR-5-17 | info | DEC-014 §3 vs `provisioning.ts`/`discovery.ts` | DEC-014 menyebut "`jobs.stages[]` diturunkan dari event", tetapi implementasi menulis `stages` dan `job_events` secara terpisah di transaksi yang sama. Hasilnya konsisten, tetapi tidak "diturunkan". | Orchestrator dapat mengoreksi teks di DEC berikutnya. |

## Kesesuaian AC (sampel yang dicocokkan dengan kode)

- **AC-5.7 (CR-4-1)**: `decideBoot` hanya melayani installer saat `booting` dan selama `installerBoots < N`. Penyajian berikutnya membuat job `failed installer-boot-limit` dan host diarahkan boot lokal. Saat `installing`, host boot lokal tanpa rotasi token, dan event `warn` digabung. Diuji di `m5-te-lifecycle-routes.test.ts:271-349` dan `m5-lifecycle.test.ts:54-99`.
- **AC-5.8/5.9**: `sweepJobs` idempoten di dalam `tx`, memakai jam injeksi pada batas −1 dan +1 detik untuk ketiga tahap. Timer dijamin tunggal lewat simbol global, dengan `unref` dan `stopWatchdog`. Diuji di `m5-te-lifecycle-routes.test.ts:351-468`. Lihat CR-5-2 untuk catatan "absolut".
- **AC-5.13**: batas 16 KB sebelum otorisasi, lalu 200 baris → 413, 60 request/menit → 429, dan cap event + satu penanda "dipotong". Semuanya sesuai.
- **AC-5.16/5.17**: `JobSummary` tidak memuat token atau hash. SSE mengirim header, `retry`, backlog `id=seq`, kirim ulang event gabungan, `stage`, `end`, abort, batas 50 koneksi, dan batas umur 30 menit. Semuanya diuji dengan fake timers.
- **AC-5.39/5.40 (wajib gate)**: PASS di KVM. Job pertama masuk Installing → `virsh destroy` → start → boot lokal (`installerBoots` 1, kernel di serial 4→4) → Failed `timeout-installing` +900 detik (UI +902 detik) → install ulang → Done 577 detik → SSH → 2 job.

## Penilaian penutupan carry-over (gate M4 → M5)

| Kewajiban | Status | Bukti |
|---|---|---|
| CR-4-1 installer berulang + uji integration & KVM destroy → Failed → install ulang | **Closed** | `discovery.ts` (`installerBoots`, `installing` → boot lokal); AC-5.7/5.10 (integration); AC-5.39/5.40 PASS di `kvm/results.json` |
| SR-4-2 binding IP gagal-terbuka | **Closed** | `settings.ts` fail-fast `PXE_TRUST_PROXY` tanpa leases; `decideBoot` tanpa lease → boot lokal; `startOrExit` exit 1; `.env.example` dengan komentar risiko; AC-5.2 |
| CR-4-4 KCMD dari `installerScript` | **Closed** | `m5-te-hooks.test.ts:139-160` (diturunkan + mutasi negatif untuk 3 metode); catatan info CR-5-15 |
| CR-4-5 `waitScript --replace` | **Closed** | `boot-script.ts:79`; AC-5.21 |
| CR-4-8 / SR-4-4 log injection | **Closed** | `boot-http.ts` `bootDeniedLine` (MAC dinormalisasi atau `-`, `reason` di-escape); AC-5.6 untuk status/file/log |
| CR-4-9 decode ganda → 500 | **Closed** | `app/boot/[name]/route.ts` tanpa `decodeURIComponent`; AC-5.5 (`%25zz`, `%2525zz`, `%E0%A4%A`, `zz:zz`, `.ipxe` → 400) |
| CR-4-10 base URL IPv6 | **Closed** | `settings.ts` menolak `[`/`]`; `URL_SAFE_RE` ⊂ `ipxeSafe`; AC-5.3 |
| CR-4-11 asersi jumlah job | **Closed** | `e2e-kvm/m5-jobs.spec.ts:454,492,630` (2 job untuk node11, 1 job untuk node12 setelah reboot) |
| CR-4-12 asersi log dnsmasq/nginx otomatis | **Closed** | `infra/assert-server-logs.sh` dipanggil di `finish()` `kvm-run.sh`. `results.json`: CR-4-12-dnsmasq node11 PASS, nginx node11 ×2 dan node12 ×1 PASS. Test infra AC-5.36. Catatan kualitas di CR-5-10. |
| CR-4-13 `cleanup.sh server` | **Closed** | `cleanup.sh` menolak run id `server*`/`nat*` sebelum virsh/rm; disk `pxe-test-server*` dilewati; AC-5.34 |
| CR-4-14 redaksi biner | **Closed** | `redact-evidence.sh` (`grep -Iq` → biner hanya dipindai); AC-5.35 |
| CR-4-15 / SR-4-9 X-Forwarded-Host | **Closed** | `http.ts` `requestHost(req, trustProxy)`; AC-5.4 |
| CR-4-2/4-3/4-21 amandemen plan/DEC | Closed (dokumen) | `M4-plan.md` §7 + DEC-013 (di luar cakupan kode) |
| DR-4-1..DR-4-7 | Ada test-nya (AC-5.29..5.32, AC-5.27); penilaian visual diserahkan ke design-reviewer | `e2e/m5-ui-fixes.spec.ts`, `m5-library.spec.ts`, `m1-layout.spec.ts` |
| Mitigasi SR-4-1 (nginx allowlist + allowlist Host GET) | **Closed untuk M5** | `nginx-pxe.conf` (`allow` untuk admin, `deny all`; `/boot` dan `/media` terbuka); `guardRead` di semua GET; AC-5.37/5.38 (node12 → `/api/hosts` 403, `/boot` 200). Login dan rate limit tetap blocker M6. |

## Ringkasan

| Severity | Jumlah |
|---|---|
| critical | 0 |
| major | 0 |
| minor | 12 (CR-5-1..CR-5-12) |
| info | 5 (CR-5-13..CR-5-17) |

Tidak ada test yang di-skip atau dilemahkan. `test-migration.md` sesuai dengan diff yang sebenarnya. Typecheck dan lint bersih, dan 1080/1080 unit test lulus di HEAD. Semua kewajiban carry-over kode dari M4 sudah tertutup. Temuan minor terpenting untuk ditindaklanjuti adalah CR-5-1 (prefiks token bisa lolos redaksi lewat `cut`) dan CR-5-12 (log bukti perlu disegarkan di HEAD sebelum gate).
