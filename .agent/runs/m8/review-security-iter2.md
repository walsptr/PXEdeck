Verdict: PASS

# Security review M8, iterasi 2 (installer)

- Reviewer: security-reviewer (read-only). Disimpan oleh Orchestrator dari jawaban akhir reviewer; temuan tidak diubah.
- Cakupan: diff `1a64ffd..06517b9` (commit produk `3d60aa9`, `06517b9`), DEC-030. Baca file, `bash -n` (lulus untuk `install.sh`, `uninstall.sh`, `deploy/lib.sh`, `deploy/render.sh`), `manifest_valid_line` di script scratch, uji gpgv dengan kunci sekali pakai di GNUPGHOME scratch (dihapus), scan secret. Tanpa `kvm/iter3/`, VM, libvirt. Perubahan uncommitted `infra/test/m8-kvm/*` (iter3 berjalan) di luar cakupan.

## Status temuan iterasi 1
| ID | Severity iter1 | Status | Bukti |
|---|---|---|---|
| SR-8-1 | major | **Closed** | `manifest_canonical` untuk semua tipe sebelum regex; `SEG` tidak boleh diawali titik (`deploy/lib.sh:76-77,136-141,149-150`). Ditolak: `data /srv/pxe/../../etc`, `/srv/pxe/..`, `/srv/pxe/./media`, `//`, trailing `/`, `mount /srv/pxe/media/..`, `file /etc/pxe-dashboard/../shadow`, `.hidden`, sumber fstab dengan `..`/`/./`. Diterima tetapi aman: `/srv/pxe/a..`, `/srv/pxe/-rf` (rm menerima path absolut), `/srv/pxe/é` (tetap di bawah `/srv/pxe`). Whitespace ditolak. Lapis ketiga sebelum setiap `rm`: `parent_resolved_ok` + `safe_rm_tree` (`lib.sh:200-217`) — parent ter-resolve kanonik dan path di bawah `RM_ROOTS`; path symlink → `rm -rf` hanya menghapus link; `--one-file-system` dan `mounted_under` tetap. Test `infra/test/m8.sh:853,871`. |
| SR-8-2 | minor | Closed | Default interaktif = alamat `$SSH_CLIENT`; `/0` atau overlap `NFS_CIDRS` (subnet PXE + VLAN, termasuk `/32` di dalamnya) ditolak tanpa `--admin-overlap-ok` atau ketik `ya` (`install.sh:138-139,240-261`); terbukti KVM `neg-overlap.log`. |
| SR-8-3 | minor | Diterima (DEC-030) | Syarat single-tenant di README; unix socket pekerjaan lanjutan. |
| SR-8-4 | minor | Closed | `pkg requested` hanya untuk `INSTALLER_PKGS` (`openssh-server requested` ditolak); `dep` di balik cek autoremovable + simulasi `apt-get -s purge` yang menolak bila ada di luar manifest (`uninstall.sh:46-56`). |
| SR-8-5 | minor | Closed (sisa SR-8-13) | `valid_iso_path` menolak ISO di bawah `/srv/pxe`, `/opt/pxe-dashboard`, `/var/lib/pxe-dashboard`, wajib kanonik; purge melewati path data yang memuat sumber fstab (`uninstall.sh:208-213`). |
| SR-8-6 | minor | Closed | Rantai Release.gpg → Release → SHA256SUMS → `linux`/`initrd.gz` (lihat di bawah). |
| SR-8-7 | info | Closed | File password milik `$EUID`, bukan symlink, dicek sebelum mode; `read -r -s` di TTY (`install.sh:430-443`). |
| SR-8-8 | info | Closed | policy-rc.d sisa dihapus hanya bila memuat baris marker persis (`install.sh:501-505`). |
| SR-8-9 | info | Diterima (DEC-030) | Firewall tetap menerima tcp/22 dan 111 dari NIC PXE; aturan ICMPv6 ND hanya di `$IFACE`. |
| SR-8-10 | info | Diterima (DEC-030, masih ada) | `kvm/iter2/etc-*.tsv` tetap menyimpan SHA256 `/etc/shadow`, `/etc/gshadow`, `/etc/pxe-dashboard.env`, host key SSH; praktis tidak bisa dibalik. |

### Rantai Debian Release.gpg (diuji dengan gpgv 2.4.9 asli)
- Path keyring tetap `/usr/share/keyrings/debian-archive-keyring.gpg`; dengan `--keyring`, gpgv tidak membaca `trustedkeys.kbx` default (terbukti: kunci hanya di `trustedkeys.kbx` → `ERRSIG/NO_PUBKEY`).
- Tanda tangan kunci asing → `ERRSIG NO_PUBKEY` tanpa `VALIDSIG` → ditolak. `GOODSIG` tanpa `VALIDSIG` diabaikan.
- Campuran: baik + kunci tak dikenal → diterima (seperti apt); baik + `BADSIG` → ditolak; kunci kedaluwarsa `EXPKEYSIG` → ditolak.
- Kebingungan format (InRelease clearsigned atau pesan opaque sebagai `Release.gpg` di samping `Release` palsu): tanpa status line → ditolak.
- Hanya stdout (`--status-fd 1`) di-parse; exit code diabaikan dengan aman.
- Binding file: hash `main/installer-amd64/current/images/SHA256SUMS` dari section SHA256 `$TMP/Release` yang sama yang diverifikasi; hash `./netboot/debian-installer/amd64/{linux,initrd.gz}` dari SHA256SUMS itu; file baru disalin ke `/srv/pxe` setelah semua cek lulus; `$TMP` = `mktemp -d` privat.
- Test `infra/test/m8.sh:1040-1070`, `:1190-1220`; KVM `install-1-gpgv-diagnosis.txt` (dua tanda tangan baik + satu `NO_PUBKEY`, exit 2) diterima.

### `ip link delete` (`uninstall.sh:162-175`)
- `vlanlink` hanya dicatat bila installer membuat interface (`!IFACE_EXISTS`) atau entri sudah ada (`install.sh:748`); interface yang sudah ada dengan IP server tidak pernah dicatat; yang sudah ada tanpa alamat ditolak kecuali tercatat milik installer (`install.sh:294-298`).
- Dihapus hanya bila `/sys/class/net/<dev>` ada, `ip -d -o link` menunjukkan `<dev>@<parent>:` dengan `vlan protocol 802.1Q id <vid>` sesuai catatan, dan tanpa alamat inet/inet6.
- `valid_iface` menolak nama diawali `.`/`-`. Alur normal tidak bisa menghapus interface bukan buatan installer; kelemahan hanya entri manifest palsu (SR-8-11).

### Lainnya
netplan `60-` → `99-` hanya menyentuh file lama bila milik manifest; firewall terbatas `$IFACE`, port 53 hanya bila server melayani DNS; mode `resolv` dnsmasq tetap `bind-interfaces` (bukan open resolver di sisi admin).

## Temuan baru
| ID | Severity | Lokasi | PoC / deskripsi | Rekomendasi |
|---|---|---|---|---|
| SR-8-11 | minor | `deploy/lib.sh:146` (validasi `vlanlink`), `uninstall.sh:162-175` | Kelas defense-in-depth seperti SR-8-4 (butuh root untuk mengubah manifest 0600 di direktori 0700). `manifest_valid_line` menerima nama interface valid apa pun sebagai `vlanlink`, mis. `vlanlink br0.5 eth0:5`; saat uninstall VLAN admin asli dengan id+parent itu dan tanpa IP (mis. port bridge VM) di-`ip link delete` → konektivitas VM/host putus. Juga diterima (aman): path = parent, vid di luar rentang. | Tolak hapus bila `ip -d link` menunjukkan `master <br>` atau link punya upper device (`/sys/class/net/<dev>/upper_*`); validasi vid 1-4094 dan path ≠ parent; opsional simpan ifindex/MAC saat dibuat dan cocokkan sebelum hapus. |
| SR-8-12 | info | `install.sh:811-826` | Field `Date` tidak dicek (Release bookworm tanpa `Valid-Until`); penyerang yang menembus TLS bisa me-replay Release lama yang bertanda tangan sah (rollback). Risiko rendah (`--proto =https --tlsv1.2`). | Opsional: tolak `Date` lebih tua dari N hari, atau catat `Date` di log/manifest. |
| SR-8-13 | info | `deploy/lib.sh:130-133`, `install.sh:313-314` | Proteksi ISO hanya membandingkan teks path; ISO lewat symlink atau parent symlink ke `/srv/pxe` lolos validasi dan bisa terhapus `--purge`. Hanya bila admin sengaja menaruh ISO di `/srv/pxe`. | Cek juga `realpath -e "$iso"` terhadap prefix terlarang. |

## Bukti KVM `kvm/iter2/**` (termasuk `vlan/`)
Password admin `.agent/keys/m8-admin.pass` (isi tidak dicetak) 0 file di `iter2`, 0 di tree `06517b9`, 0 di 40 commit terakhir semua ref. Body base64 `.agent/keys/infra_ed25519` 0 file; tidak ada `BEGIN ... PRIVATE KEY`. `PXE_ADMIN_PASSWORD_HASH` selalu `<disamarkan>`; tanpa hash scrypt/`$6$`/session secret. Log login tidak mencatat nilai cookie; `install-*-passfile.txt` hanya `600 root`; `redact.txt` dan `evidence-scan-playwright*.txt` bersih. `git grep` hanya hit lama M1–M6. Catatan: bila password admin diregenerasi antar run, password iter2 bisa berbeda dari file saat ini; `redact.txt` tetap bersih.

## Jumlah severity
critical 0 · major 0 (SR-8-1 closed) · minor 1 baru (SR-8-11) + 1 diterima (SR-8-3) · info 2 baru (SR-8-12, SR-8-13) + 2 diterima (SR-8-9, SR-8-10)
