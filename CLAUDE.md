# PXE Boot Dashboard — aturan kerja multi-agent

Project ini dikerjakan otonom oleh tim subagent (`.claude/agents/`) yang dikoordinasikan
**Orchestrator** (sesi utama). Spesifikasi produk: `docs/SPEC.md` (sumber kebenaran).
Next.js di `dashboard/` versi 16; baca juga `dashboard/AGENTS.md`.

## Struktur
- `dashboard/` — Next.js + shadcn/ui (UI + API + endpoint boot)
- `configs/`, `scripts/` — PXE server lab asli (dnsmasq + GRUB/pxelinux + autoinstall)
- `infra/` — script test KVM (network/VM `pxe-test-*`, PXE server VM)
- `docs/SPEC.md`, `docs/design/` (plan & opsi dari architect)
- `docs/agent-workflow/{decisions,approvals,reports}/` — hanya ditulis Orchestrator
- `.agent/runs/<milestone>/` — bukti mentah (log, coverage, review, gate, kvm)
- `.agent/media/`, `.agent/vms/`, `.agent/keys/` — media ISO, disk VM, key sekali pakai (gitignored)

## Peran
| Agent | Menulis | Tidak boleh |
|---|---|---|
| architect | `docs/design/` | kode |
| frontend-dev / backend-dev | kode produk, `infra/` | mereview/approve kode sendiri, melemahkan test |
| test-engineer | test, `.agent/runs/` | skip/hapus/melemahkan test |
| code/security/design-reviewer | laporan di `.agent/runs/` | mengedit kode |
| gatekeeper | (keputusan dikembalikan ke Orchestrator) | menurunkan gate |
| Orchestrator | decision, approval, report, git merge/tag | menulis kode produk |

## Alur per milestone
Milestone: (1) setup + tokens + layout, (2) tabel host mock, (3) sheet & bulk,
(4) backend + iPXE, (5) callback status & jobs, (6) hardening keamanan & E2E penuh.

1. **Plan** — architect → `docs/design/M<n>-plan.md` (task + AC teruji).
2. **Decide** — Orchestrator → `decisions/DEC-<NNN>-<slug>.md`.
3. **Build** — dev agent di branch `milestone/<n>-<slug>`.
4. **Test** — test-engineer; output mentah di `.agent/runs/m<n>/`.
5. **Review** — code, security, design reviewer paralel → `review-*-iter<k>.md`.
6. **Gate** — gatekeeper → `gate-iter<k>.md`. CHANGES_REQUESTED → ulang 3–6, **maks 3 iterasi**;
   lalu BLOCKED, tulis report, lanjut milestone yang tidak bergantung.
7. **Approve** — Orchestrator → `approvals/APR-<NNN>-m<n>.md`, merge ke `main` lokal, tag
   `m<n>-approved`.
8. **Report** — `reports/REPORT-m<n>.md`; akhir: `reports/REPORT-final.md`.
Penomoran DEC/APR berurutan; jangan menimpa file lama.

## Gate approval (objektif)
APPROVED hanya jika: typecheck & lint bersih; semua unit/integration/E2E lulus dengan coverage
kode baru ≥ 80%; setiap AC punya ≥ 1 test; tidak ada temuan critical/major terbuka; milestone ≥ 4
punya bukti KVM (PXE boot → konfigurasi diterima → status Done → login SSH dengan key yang
di-inject); tidak ada secret/password plaintext di repo atau log. Menonaktifkan/men-skip/
melemahkan test = critical.

## Batas keras (mutlak, tidak bisa di-approve agent mana pun)
- PXE/DHCP/TFTP hanya di jaringan virtual terisolasi `pxe-test`. **Jangan pernah** menjalankan
  DHCP/TFTP di host atau interface fisik. dnsmasq hanya di dalam VM `pxe-test-server`.
- Hanya disk image VM di `.agent/vms/` yang boleh di-wipe/di-install. Jangan sentuh
  `/dev/sd*`, `/dev/nvme*`.
- **Tanpa sudo.** Tanpa force-push/deploy. `git push` hanya ke remote `origin`
  (`https://github.com/walsptr/PXEdeck.git`), tanpa force/delete/mirror (izin user 2026-11-07).
- Tanpa secret sungguhan di repo (pakai `.env.example` + nilai dummy). Tanpa membaca `~/.ssh`.
- Jangan menghapus file di luar direktori project.
- Resource libvirt hanya berprefix `pxe-test-`. **Dilindungi (milik user, jangan disentuh):** VM
  `pxe-test-node01` dan `ubuntu24.04`, network `default` dan `int`.
- curl/wget hanya ke registry paket, mirror resmi Ubuntu/Debian/Rocky, nodejs.org, CDN
  Playwright, localhost, dan `10.99.0.*`.
- ssh/scp hanya ke `10.99.0.*` dengan key di `.agent/keys/`. Perintah remote yang panjang: tulis
  ke script lalu jalankan `ssh ... 'bash -s' < script.sh`.
- Butuh salah satu hal di atas untuk lanjut → tandai BLOCKED + jelaskan di report. Jangan cari
  jalan memutar.
Lapisan kedua: hook `.claude/hooks/guard_bash.py` (PreToolUse Bash) dan deny rules di
`.claude/settings.json`.

## Pengujian KVM (milestone ≥ 4)
- Preflight sekali → `.agent/runs/preflight.log`: `/dev/kvm`, flag vmx/svm, virsh/virt-install/
  qemu-img/OVMF/ssh, `virsh -c qemu:///system list --all` tanpa sudo, `free -m`, `nproc`.
  VM paralel = clamp((RAM bebas − 4 GB) / 2 GB, 1, 3).
- Network `pxe-test`: bridge `virbr-pxe`, `10.99.0.0/24`, host `10.99.0.1`, **tanpa `<dhcp>`**,
  isolated (tanpa `<forward>`). NAT hanya dengan decision.
- PXE server berjalan sebagai VM `pxe-test-server` (10.99.0.2) karena DHCP/TFTP butuh root dan
  firewall host menolak guest→host (lihat DEC terkait). dnsmasq di VM itu wajib
  `interface=<nic pxe-test>` + `bind-interfaces`; verifikasi dengan `ss -lunp` sebelum dipakai.
- VM node: `pxe-test-<m>-nodeNN`, qcow2 20 GB di `.agent/vms/`, 2 GB RAM, 2 vCPU,
  MAC `52:54:00:99:00:NN`, `--pxe --boot network,hd` (+ `--boot uefi` untuk UEFI), serial log ke
  `.agent/runs/<m>/kvm/`.
- Matriks: BIOS Ubuntu 24.04; UEFI Ubuntu 24.04; UEFI Debian 12 (preseed); UEFI Rocky 9
  (kickstart); bulk 3× UEFI Ubuntu (sesuai batas resource). Windows: generator + unit test saja.
- Alur E2E via dashboard (Playwright): VM PXE boot → host muncul → atur hostname/IP/credentials/
  SSH key (key ed25519 sekali pakai di `.agent/keys/`) → Simpan & Install → status Booting →
  Installing → Configuring → Done (timeout 30 menit/VM).
- Verifikasi SSH: hostname, `ip -4 addr`/gateway/DNS, user + sudo, authorized_keys, password
  login ditolak bila dinonaktifkan, reboot → boot dari disk tanpa reinstall, status tetap Done.
- Uji negatif: IP bentrok ditolak (UI+API), CSV MAC invalid → error per baris tanpa efek,
  `virsh destroy` di tengah install → Failed setelah timeout + bisa install ulang, config per-MAC
  dari MAC/IP salah ditolak.
- Bukti di `.agent/runs/<m>/kvm/` + `results.json`. **Cleanup wajib** setiap run (destroy +
  undefine --nvram VM `pxe-test-*` milik run, hapus disk, matikan PXE server test). Network
  `pxe-test` dihapus di akhir semua milestone.
