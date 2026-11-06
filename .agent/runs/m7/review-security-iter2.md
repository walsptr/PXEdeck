Verdict: PASS

# Security review M7, iterasi 2

- Reviewer: security-reviewer (read-only). Disimpan oleh Orchestrator dari jawaban akhir reviewer; temuan tidak diubah.
- Cakupan `339f234..5220865 -- dashboard infra` (14 file), DEC-028, `.agent/runs/m7/**`, riwayat git sampai `d48ce8a`. Probe scanner hanya pada file sintetis di scratchpad. Tanpa Playwright/KVM/port.

## Diverifikasi aman
- **GK-7-1** (`infra/deploy-dashboard.sh:121-133`): jalur non-dry sama byte demi byte; env admin hanya lewat stdin ssh ke `umask 077 && cat > '<stage>/admin.env'`, argv hanya path; `unset admin_hash_val` tetap. Dry-run mencetak perintah sama dengan `</dev/null` → race SIGPIPE hilang, hash tidak ditulis. `m7-gk71.sh` mengasersi hash/password tidak ada di argv (`FAKE_LOG`) maupun output, stdin tepat 3 baris. Hook `printf` ter-export hanya di `m7-gk71.sh`, di-source hanya oleh `infra/test/run.sh`, di sandbox harness (`PXE_AGENT_DIR=$SB/agent`), dibersihkan `unset -f`; script production tidak men-source-nya.
- **Scanner** (`redact-evidence.sh` `_url_cred_hits`, `m7-shared.ts` `URL_CRED`): hanya token placeholder utuh dikecualikan (kosong, `***`, `…`, `<REDACTED…>`); `***x`, `<REDACTED>x`, nilai berbacktick, bentuk `%3F/%26/%3D`, `&/?/=` (case apa pun) ditandai; awk dan JS sepakat di semua probe. Tetap fail-closed (hit → exit 1; nama file ber-`:` tetap hit; UTF-8 invalid tetap terdeteksi). Tanpa ReDoS: `[^&\s"<>%\\]*` berhenti di `<` → linear; 304 KB `?password=<REDACTED` berulang 0 ms, 320 KB 1 ms.
- **Dokumentasi SR-7-2** sesuai bukti `kvm/vlandistro/server-listen-vlan.txt` (rpcbind `0.0.0.0:111` tcp+udp; mountd/statd/sshd `0.0.0.0`; nfsd `10.99.10.2:2049`; nginx `10.99.0.2:80`, `10.99.10.2:80`; nftables hanya drop dari `nat0`). Rekomendasi nftables sehat (default drop per interface VLAN, `ip daddr 10.99.0.2 drop`, blok 22 dan statd, pin port mountd); celah kecil di SR-7-9.
- **CR-7-4/CR-7-3:** tanpa dampak keamanan; test baru memakai dummy `dummy-pw-1`.
- **Scan ulang secret:** `git diff 339f234..HEAD` tanpa hash `$6$` (selain `fixturesalt`), tanpa scrypt nyata, PEM body, path `/boot/<mac>/<token43>`. Tidak ada `.env`/`.pass` ter-track; `.agent/keys/` hanya `infra_ed25519` (0600) + `.pub`. Sisa nilai kredensial URL di `.agent/runs/m7/**` (di luar laporan scan) = teks dokumentasi (`review-*-iter1.md:23/24/47`, `kvm/reuse-diff-*.txt`); bukti KVM termasuk history leak kini `username=<REDACTED>&password=<REDACTED-admin-password>`. Hit "PRIVATE KEY" di `final*/secret-scan.txt` hanya header. Setuju triase `final-iter2/secret-scan.txt`; `kvm-evidence-rescan.txt` exit 0, `URL_CRED` 0 hit di 6 skenario.

## Temuan
| ID | Severity | Lokasi | Skenario | Rekomendasi |
|---|---|---|---|---|
| SR-7-1 | minor (carry-over DEC-028 §3) | nginx `error_log` | Tidak berubah: `error.log` server tidak dimasker; salinan bukti tetap ditangkap scanner. | Sisa risiko di REPORT-m7. |
| SR-7-2 | minor (perilaku carry-over; dokumentasi **selesai**) | `apply-profile.sh`, `verify-listen-vlan.sh`, README | Dokumentasi akurat; socket wildcard tetap terjangkau dari VLAN 10/20 dan tidak dideteksi `verify-listen-vlan.sh`. | Filter nftables di pekerjaan lanjutan. |
| SR-7-3 | info (terbuka) | `exports-vlan` | `no_root_squash` (ro) export ubuntu. | Seperti iterasi 1. |
| SR-7-4 | info (terbuka) | map nginx aturan 1 | Query `/boot/<mac>.ipxe?…` dicatat apa adanya. | Seperti iterasi 1. |
| SR-7-5 | info (**selesai**) | scanner | Pengecualian prefix diperbaiki, bentuk ter-encode dicakup. | — |
| SR-7-6 | info (terbuka) | `infra/vlan/relay.sh` | `StrictHostKeyChecking=no` node lab. | Seperti iterasi 1. |
| SR-7-7 | info | `redact-evidence.sh` `_url_cred_hits`; `m7-shared.ts` `URL_CRED` | Negatif palsu yang diprobe (kedua scanner): entitas HTML `&amp;password=X`; encoding ganda `%253Fpassword%253DX`; `\x26password=X`; `%5Cu0026password=X`; `;password=X`; nilai terbelah baris; `<REDACTED-apa saja>`; nilai diawali JSON `\"`. Tidak ada sumber bukti kita yang menghasilkan bentuk ini; pencocokan persis password run tetap pertahanan utama. | Opsional: decode `&amp;`, `\x26`, percent-decode berulang (maks 2); batasi `<REDACTED(-[a-z-]+)?>`. |
| SR-7-8 | info | `redact-evidence.sh:131-132` (`… \| _url_cred_hits \| head -50 \|\| true`) | `\|\| true` menyembunyikan exit 1 grep, tetapi juga error runtime/hilangnya awk → scan URL fail open tanpa pesan. Pola lama; risiko rendah di host Fedora (gawk). | Pisahkan langkah; grep ≥ 2 atau awk ≠ 0 → exit 1. |
| SR-7-9 | info | `infra/README.md` §Perimeter | (1) Socket wildcard lockd/NLM kernel tanpa nama proses (udp `0.0.0.0:39743`, tcp `0.0.0.0:34905`) tidak disebut. (2) "data TFTP lewat helper conntrack `tftp` atau related" kurang lengkap: sejak kernel 4.7 helper tidak otomatis; perlu `ct helper set "tftp"` eksplisit (atau rentang port tetap), tanpa itu `related` tidak cocok. | Tambahkan lockd (pin `nlm_udpport`/`nlm_tcpport` atau drop) dan aturan `ct helper` eksplisit saat filter diimplementasikan. |
| SR-7-10 | info | riwayat git `67d6e78` (`kvm/history/vlandistro-login-get-leak/*`) | Blob lama memuat `?username=<username admin>` (default non-rahasia yang sudah ada di `infra/server/dashboard*.env`); password di blob itu `<REDACTED-admin-password>`. HEAD teredaksi penuh. | Tanpa tindakan; catat di triase. |

## Jumlah severity
Terbuka: critical 0, major 0, minor 2 (SR-7-1, SR-7-2 — carry-over DEC-028; dokumentasi SR-7-2 selesai), info 7 (SR-7-3, -4, -6, -7..10). Selesai: SR-7-5. Baru iterasi ini: 0/0/0, 4 info. Tidak ada secret/password plaintext di repo, log bukti, maupun riwayat git sampai HEAD.
