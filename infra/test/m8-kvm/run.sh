#!/usr/bin/env bash
# infra/test/m8-kvm/run.sh <tahap> — uji KVM installer M8 (DEC-029 §4), ditulis test-engineer.
# Bukti di .agent/runs/m8/kvm/ (RUNS_DIR infra/lib.sh dengan PXE_RUN=m8). Tahap (berurutan):
#   protect <label>  snapshot resource libvirt terlindungi (dumpxml sha256) -> protected-<label>.txt
#   up               net-up + install-vm.sh up (VM bersih) + snapshot /etc pra-install + push repo
#   install <n> [--release FILE]
#                    install.sh --yes non-interaktif (password dari file 0600 sekali pakai
#                    .agent/keys/m8-admin.pass yang disalin ke VM lewat stdin), log -> install-<n>.log
#   node             node pxe-test-m8-node51 (UEFI) + Playwright e2e-kvm/m8-installer.spec.ts
#   data <label>     login admin dari host -> status host/job node51 (data dashboard) -> data-<label>.txt
#   uninstall        uninstall.sh --yes (+ cek manifest, port, /etc diff)
#   purge            uninstall.sh --purge --yes (+ cek, /etc diff terhadap pra-install)
#   cleanup          destroy node + VM install + disk, hapus key sekali pakai, net-down
#   results          gabungkan steps.tsv + hasil Playwright -> results.json; redaksi + scan secret
# Batas keras: tanpa sudo; ssh hanya root@10.99.0.2 / node 10.99.0.61 dengan key .agent/keys.
set -euo pipefail
export PXE_RUN=m8
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/../../lib.sh"
mkdir -p "$RUNS_DIR"
K="$RUNS_DIR"
STEPS="$K/steps.tsv"
PASSF="$KEYS_DIR/m8-admin.pass"
NODE=pxe-test-m8-node51
NODE_MAC=52:54:00:99:00:51
NODE_IP=10.99.0.61
if [[ "${M8_TOPOLOGY:-flat}" == vlan ]]; then NODE=pxe-test-m8-node52; NODE_MAC=52:54:00:99:00:52; NODE_IP=10.99.20.62; fi
NODE_KEY="$KEYS_DIR/m8-node_ed25519"
# M8_NIC: nama NIC provisioning di VM. Default pxe0 (nama lab dari infra/server/netplan.yaml). Run 1
# memakai pxe0 dan GAGAL (deploy/render.sh:65 menolak NIC bernama pxe0, lihat results.json); run
# berikutnya memakai M8_NIC=prov0: `up` mengganti set-name di netplan VM lalu reboot (konfigurasi
# VM uji, setara server sungguhan dengan NIC bernama lain), tanpa mengubah kode produk.
M8_NIC="${M8_NIC:-pxe0}"
[[ "$M8_NIC" =~ ^[a-z][a-z0-9]{1,10}$ ]] || die "M8_NIC tidak valid"
# Lab flat: admin 10.99.0.1 berada DI subnet PXE 10.99.0.0/24 -> wajib --admin-overlap-ok (DEC-030,
# SR-8-2; penolakan tanpa flag diuji di tahap neg-overlap). M8_FIREWALL=1 -> + --firewall.
# M8_TOPOLOGY=vlan (iterasi 2, DEC-030 §4): NIC trunk0 (trunk lewat switch lab M7), PXE di VLAN 10
# (pxe10 10.99.10.2), VLAN management 20; UI admin tetap di 10.99.0.2 (--admin-listen).
M8_TOPOLOGY="${M8_TOPOLOGY:-flat}"
if [[ "$M8_TOPOLOGY" == vlan ]]; then
  INSTALL_ARGS=(--yes --interface trunk0 --address 10.99.10.2/24 --dhcp-range 10.99.10.100-10.99.10.200
    --gateway 10.99.10.1 --dns 10.99.10.2 --vlan-id 10 --vlan-iface pxe10
    --vlan-networks "20:10.99.20.0/24:10.99.20.1" --admin-allow 10.99.0.1 --admin-listen 10.99.0.2
    --admin-password-file /root/m8-admin.pass --iso-ubuntu /dev/sr0 --debian-netboot none)
else
  INSTALL_ARGS=(--yes --interface "$M8_NIC" --address 10.99.0.2/24 --dhcp-range 10.99.0.100-10.99.0.200
    --gateway 10.99.0.1 --dns 10.99.0.2 --admin-allow 10.99.0.1 --admin-overlap-ok --admin-password-file /root/m8-admin.pass
    --iso-ubuntu /dev/sr0 --iso-debian /dev/sr1 --iso-rocky /dev/sr2)
fi
[[ "${M8_FIREWALL:-0}" == 1 ]] && INSTALL_ARGS+=(--firewall)
# M8_EXTRA: opsi produk tambahan (mis. "--debian-netboot /root/debian-netboot"), hanya [A-Za-z0-9 ./_-].
if [[ -n "${M8_EXTRA:-}" ]]; then
  [[ "$M8_EXTRA" =~ ^[A-Za-z0-9\ ./_-]+$ ]] || die "M8_EXTRA tidak valid"
  read -ra _ex <<<"$M8_EXTRA"; INSTALL_ARGS+=("${_ex[@]}")
fi
PXE_IF="$M8_NIC"; [[ "$M8_TOPOLOGY" == vlan ]] && PXE_IF=pxe10
SRV_PXE_IP=10.99.0.2; [[ "$M8_TOPOLOGY" == vlan ]] && SRV_PXE_IP=10.99.10.2

step() { # step <id> <PASS|FAIL> <catatan> [bukti...]
  local id="$1" st="$2" n="$3"; shift 3
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$id" "$st" "$n" "$*" >> "$STEPS"
  log "STEP $id $st — $n"
}
vm() { ssh "${SSH_OPTS[@]}" -o IdentitiesOnly=yes "root@$SERVER_IP" "$@"; }
vm_script() { local s="$1"; shift; vm "$@ bash -s" < "$HERE/$s"; }
host_code() { curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "http://$SERVER_IP$1" 2>/dev/null || true; }

state() { vm_script vm-state.sh "LABEL=$1 SRV_IP=$SRV_PXE_IP" > "$K/state-$1.txt" 2>&1 || true; }
snap() { vm_script vm-snapshot.sh > "$K/etc-$1.tsv"; vm "dpkg-query -W -f='\${Package}\n' | LC_ALL=C sort" > "$K/pkgs-$1.txt"; vm "cut -d: -f1 /etc/passwd | LC_ALL=C sort" > "$K/users-$1.txt"; }

cmd="${1:-}"; shift || true
case "$cmd" in
  protect)
    lbl="${1:?label}"
    {
      echo "# resource libvirt terlindungi ($lbl) $(date -u +%FT%TZ)"
      for d in ubuntu24.04 pxe-test-node01; do
        if virsh_q dominfo "$d" >/dev/null 2>&1; then
          echo "vm $d state=$(virsh_q domstate "$d") xml-sha256=$(virsh_q dumpxml "$d" | sha256sum | cut -c1-64)"
        else echo "vm $d tidak-ada"; fi
      done
      for n in default int; do
        echo "net $n $(virsh_q net-info "$n" | awk '/Active|Autostart|Bridge/{printf "%s ", $0}') xml-sha256=$(virsh_q net-dumpxml "$n" | sha256sum | cut -c1-64)"
      done
      echo "# semua domain/network"; virsh_q list --all --name | sed '/^$/d;s/^/dom /'; virsh_q net-list --all --name | sed '/^$/d;s/^/net /'
    } > "$K/protected-$lbl.txt"
    cat "$K/protected-$lbl.txt"
    ;;
  up)
    "$INFRA_DIR/install-vm.sh" up
    if [[ "$M8_NIC" != pxe0 ]]; then
      vm "NEW=$M8_NIC bash -s" < "$HERE/vm-rename-nic.sh" || true
      sleep 10; wait_ssh_host "root@$SERVER_IP" 300 || die "VM tidak kembali setelah rename NIC"
      vm "ip -br addr; grep -rn 'set-name' /etc/netplan" > "$K/nic-rename.txt" 2>&1
      vm "ip -4 -o addr show dev $M8_NIC | grep -q ' 10.99.0.2/24 '" || die "$M8_NIC tanpa 10.99.0.2/24"
    fi
    vm "test ! -e /etc/pxe-dashboard.env && ! command -v dnsmasq && ! getent passwd pxe" >/dev/null \
      && step up PASS "VM bersih (tanpa dnsmasq/env/user pxe)" install-vm-clean.txt \
      || step up FAIL "VM tidak bersih" install-vm-clean.txt
    snap pre
    "$INFRA_DIR/install-vm.sh" push
    vm "ls /root/pxe-src | tr '\n' ' '; echo; ls -l /dev/sr0 /dev/sr1 /dev/sr2; blkid /dev/sr0 /dev/sr1 /dev/sr2" > "$K/push.txt" 2>&1
    ;;
  install)
    n="${1:?nomor run}"; shift
    extra=()
    if [[ "${1:-}" == --release ]]; then
      f="${2:?file}"; "$INFRA_DIR/install-vm.sh" push "$f"; extra=(--release /root/pxe-release.tar.xz)
    fi
    [[ -f "$PASSF" ]] || admin_pass_new "$PASSF"
    admin_pass_check "$PASSF"
    # Password -> VM lewat stdin ssh (bukan argv/scp), file 0600 sekali pakai.
    vm 'umask 077 && cat > /root/m8-admin.pass && chmod 600 /root/m8-admin.pass && stat -c "%a %U" /root/m8-admin.pass' < "$PASSF" > "$K/install-$n-passfile.txt"
    vm "test -d /opt/pxe-dashboard/releases && ls -1 /opt/pxe-dashboard/releases | sort || true" > "$K/install-$n-releases-before.txt"
    vm "cat /var/lib/pxe-dashboard-installer/install-manifest 2>/dev/null || true" > "$K/install-$n-manifest-before.txt"
    printf '# ssh root@10.99.0.2 cd /root/pxe-src && ./install.sh %s\n' "${INSTALL_ARGS[*]} ${extra[*]}" > "$K/install-$n.log"
    pathpre=""
    if [[ "${M8_SS_SHIM:-0}" == 1 ]]; then
      vm 'bash -s' < "$HERE/vm-ss-shim.sh" > "$K/install-$n-ss-shim.txt" 2>&1
      pathpre="PATH=/root/m8-shim:\$PATH "
      echo "# M8_SS_SHIM=1: install.sh dijalankan dengan PATH=/root/m8-shim:\$PATH (shim ss diagnostik, lihat vm-ss-shim.sh)" >> "$K/install-$n.log"
    fi
    [[ "${M8_IDEMPOTENT:-0}" == 1 ]] && state "install-$n-before"
    t0=$(date +%s); rc=0
    vm "cd /root/pxe-src && ${pathpre}./install.sh $(printf '%q ' "${INSTALL_ARGS[@]}" "${extra[@]}")" >> "$K/install-$n.log" 2>&1 || rc=$?
    echo "# exit=$rc durasi=$(( $(date +%s) - t0 )) dtk" >> "$K/install-$n.log"
    vm "ls -1 /opt/pxe-dashboard/releases | sort" > "$K/install-$n-releases-after.txt" 2>&1 || true
    vm "cat /var/lib/pxe-dashboard-installer/install-manifest" > "$K/install-$n-manifest-after.txt" 2>&1 || true
    vm "ss -lunp" > "$K/install-$n-ss-lunp.txt" 2>&1 || true
    vm "ss -ltnp" > "$K/install-$n-ss-ltnp.txt" 2>&1 || true
    state "install-$n"
    snap "post-install-$n"
    { echo "# dari host 10.99.0.1 (admin allowlist)"; echo "GET http://10.99.0.2/login -> $(host_code /login)"; echo "GET http://10.99.0.2/api/settings (tanpa sesi) -> $(host_code /api/settings)"; } > "$K/install-$n-host-http.txt"
    login="$(sed -n 's#^GET http://10.99.0.2/login -> ##p' "$K/install-$n-host-http.txt")"
    sett="$(sed -n 's#^GET http://10.99.0.2/api/settings (tanpa sesi) -> ##p' "$K/install-$n-host-http.txt")"
    # dnsmasq hanya di $M8_NIC / 10.99.0.2 (kolom alamat lokal = field pertama berbentuk host:port
    # setelah kolom antrean; `ss -lunp` tanpa kolom Netid bila hanya satu protokol).
    lss() { awk '/"dnsmasq"/ { for (i = 1; i <= NF; i++) if ($i ~ /:[0-9]+$/) { print $i; break } }' "$K/install-$n-ss-lunp.txt"; }
    bad_dns="$( { lss | grep -Ev "^${SRV_PXE_IP//./\\.}:[0-9]+$|%$PXE_IF:[0-9]+$|^\[fe80::[0-9a-f:]+\]%$PXE_IF:[0-9]+$" || true; } | wc -l)"
    dhcp67="$(lss | wc -l)"
    nic_67="$( { lss | grep -c "%$PXE_IF:67$" || true; } )"
    ev="install-$n.log install-$n-ss-lunp.txt install-$n-host-http.txt state-install-$n.txt"
    if ((rc == 0)) && [[ "$login" == 200 && "$sett" == 401 ]] && ((dhcp67 > 0 && bad_dns == 0 && nic_67 >= 1)); then
      step "install-$n" PASS "exit 0; /login 200; /api/settings 401 (dari host); dnsmasq ${dhcp67} socket udp, semua di $PXE_IF/$SRV_PXE_IP (DHCP %$PXE_IF:67)" "$ev"
    else
      step "install-$n" FAIL "exit=$rc login=$login settings=$sett dnsmasq-socket=$dhcp67 di-luar-$PXE_IF=$bad_dns %$PXE_IF:67=$nic_67" "$ev"
    fi
    # M8_CHECK_DEBIAN=1: --iso-debian perangkat /dev/sr1 -> modul disk virtio Debian diekstrak.
    if [[ "${M8_CHECK_DEBIAN:-0}" == 1 ]]; then
      kos="$(grep -cE '^ko [^ ]+/virtio_(blk|scsi)\.ko [1-9]' "$K/state-install-$n.txt" || true)"
      if grep -qE '^\[pxe-install\] modul disk Debian [^ ]+ di /srv/pxe/media/debian-netboot/modules' "$K/install-$n.log" && ! grep -q 'modul disk Debian tidak diekstrak' "$K/install-$n.log" && ((kos == 2)); then
        step "install-$n-debian-modules" PASS "--iso-debian /dev/sr1: modul virtio_blk + virtio_scsi diekstrak ke debian-netboot/modules" "install-$n.log state-install-$n.txt"
        if [[ " ${INSTALL_ARGS[*]} " == *" --debian-netboot "* ]]; then :
        elif grep -q 'Debian netboot terpasang di /srv/pxe/media/debian-netboot (Release.gpg terverifikasi)' "$K/install-$n.log"; then
          step "install-$n-debian-netboot-gpg" PASS "DEBIAN_NETBOOT=auto: unduh deb.debian.org, Release.gpg diverifikasi gpgv (debian-archive-keyring) -> SHA256SUMS -> linux/initrd.gz" "install-$n.log"
        else
          step "install-$n-debian-netboot-gpg" FAIL "tanpa log 'Release.gpg terverifikasi'" "install-$n.log"
        fi
      else
        step "install-$n-debian-modules" FAIL "modul Debian tidak lengkap (ko=$kos)" "install-$n.log state-install-$n.txt"
      fi
    fi
    # M8_IDEMPOTENT=1: run ulang args sama, ISO ter-mount + diekspor NFS -> tanpa rilis baru, env tidak
    # ditulis ulang, dashboard tidak di-restart (MainPID/ActiveEnterTimestamp sama), manifest sama.
    if [[ "${M8_IDEMPOTENT:-0}" == 1 ]]; then
      b="$K/state-install-$n-before.txt"; a="$K/state-install-$n.txt"; probs=()
      mounts_b="$(grep -c '^/srv/pxe/media/[a-z0-9.-]* /dev/sr[0-2] iso9660' "$b" || true)"
      exp_b="$(awk '/^# exportfs -v/ { f = 1; next } /^# / { f = 0 } f' "$b" | grep -cE '^/srv/pxe/media/(ubuntu-24\.04|rocky-9)' || true)"
      ((mounts_b == 3)) || probs+=("ISO ter-mount sebelum=$mounts_b (harus 3)")
      ((exp_b >= 2)) || probs+=("ekspor NFS media sebelum=$exp_b")
      ((rc == 0)) || probs+=("exit=$rc")
      cmp -s "$K/install-$n-releases-before.txt" "$K/install-$n-releases-after.txt" || probs+=("daftar rilis berubah")
      cmp -s "$K/install-$n-manifest-before.txt" "$K/install-$n-manifest-after.txt" || probs+=("manifest berubah")
      grep -q 'rilis dashboard tidak berubah' "$K/install-$n.log" || probs+=("tanpa log 'rilis tidak berubah'")
      grep -q 'password admin tidak berubah' "$K/install-$n.log" || probs+=("tanpa log 'password admin tidak berubah'")
      grep -q 'pxe-dashboard tidak berubah — tidak di-restart' "$K/install-$n.log" || probs+=("tanpa log 'tidak di-restart'")
      ! grep -q 'terpasang /etc/pxe-dashboard.env' "$K/install-$n.log" || probs+=("env ditulis ulang")
      for key in '^MainPID=' '^ActiveEnterTimestamp=' '^env-file-sha256=' '^current -> ' '^release-id: '; do
        [[ "$(grep -m1 "$key" "$b")" == "$(grep -m1 "$key" "$a")" ]] || probs+=("berubah: $(grep -m1 "$key" "$b" | cut -c1-60) -> $(grep -m1 "$key" "$a" | cut -c1-60)")
      done
      if ((${#probs[@]} == 0)); then
        step "install-$n-idempotent" PASS "ISO ter-mount (3) + diekspor; rilis/manifest/env sama; password sama -> hash dipertahankan; pxe-dashboard tidak di-restart (MainPID & ActiveEnterTimestamp sama)" "install-$n.log state-install-$n-before.txt state-install-$n.txt install-$n-releases-before.txt install-$n-releases-after.txt"
      else
        step "install-$n-idempotent" FAIL "$(IFS='; '; echo "${probs[*]}")" "install-$n.log state-install-$n-before.txt state-install-$n.txt"
      fi
    fi
    ;;
  neg-address)
    # Install gagal di preflight (alamat tidak terpasang di NIC) -> exit != 0, TANPA perubahan apa pun
    # (manifest tidak dibuat, paket tidak dipasang).
    [[ -f "$PASSF" ]] || admin_pass_new "$PASSF"
    vm 'umask 077 && cat > /root/m8-admin.pass && chmod 600 /root/m8-admin.pass' < "$PASSF"
    args=("${INSTALL_ARGS[@]}"); args[4]=10.99.0.250/24; args[6]=10.99.0.100-10.99.0.200
    printf '# ./install.sh %s\n' "${args[*]}" > "$K/neg-address.log"
    rc=0; vm "cd /root/pxe-src && ./install.sh ${args[*]}" >> "$K/neg-address.log" 2>&1 || rc=$?
    echo "# exit=$rc" >> "$K/neg-address.log"
    vm 'echo "manifest: $(test -e /var/lib/pxe-dashboard-installer && echo ADA || echo tidak-ada)"; for p in dnsmasq nginx nfs-kernel-server; do echo "$p: $(dpkg-query -W -f="\${Status}" $p 2>/dev/null || echo absent)"; done; echo "env: $(test -e /etc/pxe-dashboard.env && echo ADA || echo tidak-ada)"; echo "user pxe: $(getent passwd pxe >/dev/null && echo ADA || echo tidak-ada)"' > "$K/neg-address-state.txt" 2>&1
    if ((rc != 0)) && grep -q 'belum memiliki alamat 10.99.0.250/24' "$K/neg-address.log" && grep -q '^manifest: tidak-ada' "$K/neg-address-state.txt" && ! grep -q 'install ok installed' "$K/neg-address-state.txt" && grep -q '^env: tidak-ada' "$K/neg-address-state.txt"; then
      step neg-address PASS "--address 10.99.0.250/24 (tidak ada di NIC) ditolak preflight exit=$rc; tanpa manifest/paket/env/user" "neg-address.log neg-address-state.txt"
    else
      step neg-address FAIL "exit=$rc atau ada perubahan" "neg-address.log neg-address-state.txt"
    fi
    ;;
  failinstall)
    # Install gagal SETELAH paket dipasang + unit di-enable (rilis rusak: server.js langsung exit 1 ->
    # /login bukan 200 -> verify gagal) -> rollback: dnsmasq dihentikan, unit yang di-enable run itu
    # dinonaktifkan lagi. Dijalankan pada state segar (paket installer sudah di-purge).
    bad="$(mktemp -d "${TMPDIR:-/tmp}/m8-badrel.XXXXXX")"
    mkdir -p "$bad/app/.next/static"
    printf '// rilis rusak sengaja (uji M8 rollback)\nprocess.exit(1)\n' > "$bad/app/server.js"
    tar -C "$bad/app" -cJf "$bad/bad-release.tar.xz" .
    state failinstall-before
    "$INFRA_DIR/install-vm.sh" push "$bad/bad-release.tar.xz"
    rm -rf "$bad"
    [[ -f "$PASSF" ]] || admin_pass_new "$PASSF"
    vm 'umask 077 && cat > /root/m8-admin.pass && chmod 600 /root/m8-admin.pass' < "$PASSF"
    printf '# ./install.sh %s --release /root/pxe-release.tar.xz (rilis rusak)\n' "${INSTALL_ARGS[*]}" > "$K/failinstall.log"
    rc=0; vm "cd /root/pxe-src && ./install.sh ${INSTALL_ARGS[*]} --release /root/pxe-release.tar.xz" >> "$K/failinstall.log" 2>&1 || rc=$?
    echo "# exit=$rc" >> "$K/failinstall.log"
    state failinstall
    vm "cat /var/lib/pxe-dashboard-installer/install-manifest 2>/dev/null || echo '(tidak ada)'" > "$K/failinstall-manifest.txt" 2>&1 || true
    pr=()
    ((rc != 0)) || pr+=("exit 0 (harus gagal)")
    grep -q 'FAIL GET http://10.99.0.2/login' "$K/failinstall.log" || pr+=("verify /login tidak gagal seperti diharapkan")
    grep -q 'rollback: menonaktifkan' "$K/failinstall.log" || pr+=("tanpa log rollback")
    for u in dnsmasq nginx nfs-server pxe-dashboard; do
      line="$(grep -E "^$u +" "$K/state-failinstall.txt" | head -1)"
      [[ "$line" == *" enabled"* ]] && pr+=("$u masih enabled")
      [[ "$u" == dnsmasq && "$line" == *" active "* ]] && pr+=("dnsmasq masih aktif")
    done
    grep -qE '^OPEN udp .*:(67|69) ' "$K/state-failinstall.txt" && pr+=("DHCP/TFTP masih listen")
    if ((${#pr[@]} == 0)); then
      step failinstall PASS "rilis rusak -> verify gagal exit=$rc; rollback: dnsmasq/nginx/nfs-server/pxe-dashboard tidak enabled, dnsmasq mati, udp 67/69 tertutup" "failinstall.log state-failinstall-before.txt state-failinstall.txt failinstall-manifest.txt"
    else
      step failinstall FAIL "$(IFS='; '; echo "${pr[*]}")" "failinstall.log state-failinstall-before.txt state-failinstall.txt failinstall-manifest.txt"
    fi
    ;;
  neg-overlap)
    # SR-8-2: allowlist admin yang tumpang tindih dengan subnet PXE TANPA --admin-overlap-ok -> exit 2,
    # tanpa perubahan.
    [[ -f "$PASSF" ]] || admin_pass_new "$PASSF"
    vm 'umask 077 && cat > /root/m8-admin.pass && chmod 600 /root/m8-admin.pass' < "$PASSF"
    args=(); for a in "${INSTALL_ARGS[@]}"; do [[ "$a" == --admin-overlap-ok ]] || args+=("$a"); done
    printf '# ./install.sh %s\n' "${args[*]}" > "$K/neg-overlap.log"
    rc=0; vm "cd /root/pxe-src && ./install.sh $(printf '%q ' "${args[@]}")" >> "$K/neg-overlap.log" 2>&1 || rc=$?
    echo "# exit=$rc" >> "$K/neg-overlap.log"
    vm 'echo "manifest: $(test -e /var/lib/pxe-dashboard-installer && echo ADA || echo tidak-ada)"; echo "dnsmasq: $(dpkg-query -W -f="\${Status}" dnsmasq 2>/dev/null || echo absent)"' > "$K/neg-overlap-state.txt" 2>&1
    if ((rc == 2)) && grep -q 'tumpang tindih' "$K/neg-overlap.log" && grep -q '^manifest: tidak-ada' "$K/neg-overlap-state.txt"; then
      step neg-overlap PASS "--admin-allow 10.99.0.1 (di subnet PXE) tanpa --admin-overlap-ok ditolak exit 2, tanpa manifest/paket" "neg-overlap.log neg-overlap-state.txt"
    else step neg-overlap FAIL "exit=$rc" "neg-overlap.log neg-overlap-state.txt"; fi
    ;;
  fwcheck)
    # --firewall: tabel nft ada + unit enabled, SSH admin (host 10.99.0.1 -> 22) & UI tetap jalan,
    # ICMPv6 ND: host ping6 link-local VM lewat virbr-pxe + VM punya neighbor host.
    lbl="${1:?label}"; pr=()
    state "fw-$lbl"
    vm true && ssh_ok=1 || { ssh_ok=0; pr+=("ssh admin gagal"); }
    code="$(host_code /login)"; [[ "$code" == 200 ]] || pr+=("/login dari host $code")
    grep -q '^nft-table pxe_dashboard: ADA' "$K/state-fw-$lbl.txt" || pr+=("tabel nft tidak ada")
    grep -qE '^pxe-dashboard-firewall active enabled' "$K/state-fw-$lbl.txt" || pr+=("unit firewall tidak active/enabled")
    grep -qE 'nd-(neighbor|router)-(solicit|advert)' "$K/state-fw-$lbl.txt" || pr+=("aturan ICMPv6 ND tidak terlihat")
    vmll="$(vm "ip -6 -o addr show dev $PXE_IF scope link | awk '{print \$4}' | cut -d/ -f1" | head -1)"
    # Host bridge virbr-pxe tanpa IPv6 (network pxe-test tanpa <ip family=ipv6>, tanpa link-local) ->
    # ND dari host tidak bisa diuji; ND dibuktikan dari node (tahap nodedns: ping6 link-local server).
    if [[ -n "$(ip -6 addr show dev virbr-pxe 2>/dev/null)" ]]; then
      p6="$(ping -6 -c 3 -W 2 "$vmll%virbr-pxe" 2>&1 || true)"
      grep -qE '[1-3] received' <<<"$p6" || pr+=("ping6 link-local VM gagal")
    else p6="n/a: virbr-pxe di host tanpa alamat IPv6 (ND diuji dari node, tahap nodedns)"; fi
    neigh="$(vm "ip -6 neigh show dev $PXE_IF" 2>&1 || true)"
    { echo "# fwcheck $lbl $(date -u +%FT%TZ)"; echo "ssh root@10.99.0.2 (admin, tcp/22 di $PXE_IF): $([[ $ssh_ok == 1 ]] && echo OK || echo GAGAL)"
      echo "GET http://10.99.0.2/login dari host: $code"; echo "# ping -6 $vmll%virbr-pxe (ND)"; echo "$p6"; echo "# ip -6 neigh di VM ($PXE_IF)"; echo "$neigh"; } > "$K/fwcheck-$lbl.txt"
    if ((${#pr[@]} == 0)); then step "fwcheck-$lbl" PASS "--firewall: tabel nft inet pxe_dashboard ada (aturan ICMPv6 ND), unit active+enabled, SSH admin + /login 200 dari host, ND: lihat nodedns" "fwcheck-$lbl.txt state-fw-$lbl.txt"
    else step "fwcheck-$lbl" FAIL "$(IFS='; '; echo "${pr[*]}")" "fwcheck-$lbl.txt state-fw-$lbl.txt"; fi
    ;;
  nodedns)
    # CR-8-7: node terpasang me-resolve nama eksternal lewat dnsmasq lokal (forward ke resolver host VM
    # server). Diharapkan: nama ter-resolve; konektivitas internet node TIDAK ada (gateway 10.99.0.1 =
    # host, network pxe-test terisolasi; NAT hanya untuk VM server, DEC-009) -> ping 1.1.1.1 gagal.
    SRV_LL="$(vm "ip -6 -o addr show dev $PXE_IF scope link | awk '{print \$4}' | cut -d/ -f1" | head -1)"
    o="$(ssh -i "$NODE_KEY" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o BatchMode=yes -o IdentitiesOnly=yes "m8admin@$NODE_IP" \
      'echo "# resolv"; resolvectl dns 2>/dev/null | grep -v "^Global: *$"; echo "# getent hosts deb.debian.org"; getent hosts deb.debian.org; echo "rc=$?"; echo "# getent hosts archive.ubuntu.com"; getent hosts archive.ubuntu.com; echo "rc=$?"; echo "# ping -c1 -W3 1.1.1.1 (diharapkan gagal: tanpa NAT untuk node)"; ping -c1 -W3 1.1.1.1 >/dev/null 2>&1 && echo reachable || echo unreachable; echo "# ICMPv6 ND ke link-local server (firewall: nd-* + echo-request)"; sudo -n ip -6 neigh flush dev enp1s0 >/dev/null 2>&1; ping -6 -c3 -W2 '"$SRV_LL"'%enp1s0 2>&1 | tail -2; ip -6 neigh show '"$SRV_LL"' dev enp1s0' 2>&1)" || true
    printf '%s\n' "$o" > "$K/nodedns.txt"
    vm "nft list table inet pxe_dashboard 2>/dev/null | grep -E 'counter|icmpv6' || echo '(tanpa firewall)'" >> "$K/nodedns.txt" 2>&1 || true
    nd_ok=1; grep -qE ' [1-3] received' "$K/nodedns.txt" || nd_ok=0
    grep -qE 'lladdr 52:54:00:99:01:02 (REACHABLE|STALE|DELAY|PROBE)' "$K/nodedns.txt" || nd_ok=0
    if ((nd_ok)); then step nodedns-nd PASS "node -> ping6 link-local server $SRV_LL (lewat firewall bila aktif): ND berhasil (neighbor 52:54:00:99:01:02)" nodedns.txt
    else step nodedns-nd FAIL "ICMPv6 ND/ping6 node -> server gagal" nodedns.txt; fi
    if [[ "$(grep -c '^rc=0$' "$K/nodedns.txt")" == 2 ]] && grep -q 'deb.debian.org' <(sed -n '/getent hosts deb/,/rc=/p' "$K/nodedns.txt" | sed 1d); then
      step nodedns PASS "node $NODE_IP me-resolve deb.debian.org & archive.ubuntu.com lewat dnsmasq (DNS 10.99.0.2 -> resolver host server); ping 1.1.1.1 $(grep -m1 -E "^(reachable|unreachable)$" "$K/nodedns.txt") (sesuai harapan: NAT hanya untuk VM server)" nodedns.txt
    else step nodedns FAIL "resolusi nama eksternal dari node gagal" nodedns.txt; fi
    ;;
  refuse)
    # CR-8-3/CR-8-4: dnsmasq / nfs-kernel-server milik admin (pra-ada) dengan konfigurasi aktif lain ->
    # install.sh menolak, TANPA perubahan (/etc sama, manifest sama, konfigurasi & status layanan admin sama).
    c="${1:?dnsmasq|nfs}"
    vm "CASE=$c bash -s" < "$HERE/vm-refuse-setup.sh" > "$K/refuse-$c-setup.txt" 2>&1
    [[ -f "$PASSF" ]] || admin_pass_new "$PASSF"
    vm 'umask 077 && cat > /root/m8-admin.pass && chmod 600 /root/m8-admin.pass' < "$PASSF"
    snap "refuse-$c-before"; state "refuse-$c-before"
    vm "cat /var/lib/pxe-dashboard-installer/install-manifest 2>/dev/null || echo '(tidak ada)'" > "$K/refuse-$c-manifest-before.txt"
    printf '# ./install.sh %s\n' "${INSTALL_ARGS[*]}" > "$K/refuse-$c.log"
    rc=0; vm "cd /root/pxe-src && ./install.sh $(printf '%q ' "${INSTALL_ARGS[@]}")" >> "$K/refuse-$c.log" 2>&1 || rc=$?
    echo "# exit=$rc" >> "$K/refuse-$c.log"
    snap "refuse-$c-after"; state "refuse-$c-after"
    vm "cat /var/lib/pxe-dashboard-installer/install-manifest 2>/dev/null || echo '(tidak ada)'" > "$K/refuse-$c-manifest-after.txt"
    drc=0; diff "$K/etc-refuse-$c-before.tsv" "$K/etc-refuse-$c-after.tsv" > "$K/refuse-$c-etc-diff.txt" || drc=$?
    pr=()
    ((rc != 0)) || pr+=("exit 0")
    case "$c" in
      dnsmasq) grep -q 'dnsmasq sudah terpasang sebelum installer dengan konfigurasi aktif lain' "$K/refuse-$c.log" || pr+=("pesan penolakan dnsmasq tidak ada") ;;
      nfs) grep -q 'nfs-kernel-server sudah terpasang sebelum installer dengan ekspor/konfigurasi lain' "$K/refuse-$c.log" || pr+=("pesan penolakan nfs tidak ada") ;;
    esac
    ((drc == 0)) || pr+=("/etc berubah")
    cmp -s "$K/refuse-$c-manifest-before.txt" "$K/refuse-$c-manifest-after.txt" || pr+=("manifest berubah")
    cmp -s "$K/pkgs-refuse-$c-before.txt" "$K/pkgs-refuse-$c-after.txt" || pr+=("daftar paket berubah")
    for u in dnsmasq nginx nfs-server; do
      [[ "$(grep -E "^$u +" "$K/state-refuse-$c-before.txt")" == "$(grep -E "^$u +" "$K/state-refuse-$c-after.txt")" ]] || pr+=("status $u berubah")
    done
    if ((${#pr[@]} == 0)); then step "refuse-$c" PASS "$c milik admin dengan konfigurasi aktif lain -> install.sh menolak exit=$rc; /etc, manifest, paket, status layanan tidak berubah" "refuse-$c.log refuse-$c-setup.txt refuse-$c-etc-diff.txt state-refuse-$c-after.txt"
    else step "refuse-$c" FAIL "$(IFS='; '; echo "${pr[*]}")" "refuse-$c.log refuse-$c-etc-diff.txt"; fi
    vm "CASE=clean bash -s" < "$HERE/vm-refuse-setup.sh" > "$K/refuse-$c-clean.txt" 2>&1 || true
    ;;
  vlan-up)
    # Mode VLAN (DEC-030 §4): network topologi M7 + switch lab + VM install bersih dengan NIC trunk
    # tambahan (attach-interface, test-owned; infra/install-vm.sh tidak diubah) + jaringan server
    # trunk0/mgmt20 (vm-trunk-setup.sh), lalu snapshot /etc pra-install + push repo.
    "$INFRA_DIR/net-up.sh" --topology vlan > "$K/net-up-vlan.txt" 2>&1
    "$INFRA_DIR/switch-up.sh"
    "$INFRA_DIR/install-vm.sh" up
    assert_name "$NET_TRUNK"
    virsh_m attach-interface --domain pxe-test-install --type network --source "$NET_TRUNK" --mac "$SERVER_MAC_TRUNK" --model virtio --live --config
    sleep 5
    vm 'bash -s' < "$HERE/vm-trunk-setup.sh" > "$K/trunk-setup.txt" 2>&1 || die "trunk setup gagal (trunk-setup.txt)"
    vm "test ! -e /etc/pxe-dashboard.env && ! command -v dnsmasq && ! getent passwd pxe" >/dev/null \
      && step up PASS "VM bersih + NIC trunk0 (pxe-test-trunk -> switch) + mgmt20 10.99.20.1/24; switch-check $(grep -c '^OK' "$K/switch-check.txt" 2>/dev/null) OK" "install-vm-clean.txt trunk-setup.txt switch-check.txt" \
      || step up FAIL "VM tidak bersih" install-vm-clean.txt
    snap pre
    "$INFRA_DIR/install-vm.sh" push
    vm "ls /root/pxe-src | tr '\n' ' '; echo; blkid /dev/sr0" > "$K/push.txt" 2>&1
    ;;
  vlan-relay)
    # Relay M7 (infra/vlan/relay.sh) di VM install (10.99.0.2): key node + verify-node.sh via stdin.
    [[ -f "$NODE_KEY" ]] || ssh-keygen -q -t ed25519 -N '' -C "pxe-test-m8-node" -f "$NODE_KEY"
    vm "MODE=setup bash -s" < "$INFRA_DIR/vlan/relay.sh" > "$K/relay-setup.txt" 2>&1
    vm 'umask 077 && cat > /root/pxe-relay/node_ed25519 && chmod 600 /root/pxe-relay/node_ed25519' < "$NODE_KEY"
    vm 'umask 077 && cat > /root/pxe-relay/verify-node.sh' < "$DASH_DIR/e2e-kvm/verify-node.sh"
    vm "MODE=status bash -s" < "$INFRA_DIR/vlan/relay.sh" >> "$K/relay-setup.txt" 2>&1
    grep -q 'relay-key: 600' "$K/relay-setup.txt" && step vlan-relay PASS "relay siap (key node 0600 di /root/pxe-relay, isi tidak dicetak)" relay-setup.txt || step vlan-relay FAIL "relay" relay-setup.txt
    ;;
  vlan-node)
    [[ -f "$NODE_KEY" ]] || die "jalankan vlan-relay dulu"
    "$INFRA_DIR/node.sh" create "$NODE" "$NODE_MAC" uefi --net "$NET_PORT1"
    mkdir -p "$K/screenshots"
    rc=0
    (cd "$DASH_DIR" && env PXE_KVM_BASE_URL="http://$SERVER_IP" PXE_KVM_RUN=m8 PXE_KVM_RUNS_DIR="$K" PXE_KVM_SCENARIO="" \
      PXE_KVM_TOPOLOGY=vlan PXE_KVM_VLAN=20 PXE_KVM_INFRA_KEY="$SSH_KEY" PXE_KVM_RELAY_CMD="$INFRA_DIR/vlan/relay.sh" \
      PXE_KVM_NODES="$NODE=$NODE_MAC=uefi=$NODE_IP=ubuntu=install=m8-node52" PXE_KVM_NODE_USER=m8admin \
      PXE_KVM_SSH_KEY="$NODE_KEY" PXE_KVM_SSH_PUBKEY="$NODE_KEY.pub" PXE_KVM_RESET_CMD="$INFRA_DIR/node.sh" \
      PXE_KVM_POWER_CMD="$INFRA_DIR/node.sh" PXE_KVM_GATEWAY=10.99.20.1 PXE_KVM_DNS=10.99.10.2 PXE_KVM_PREFIX=24 \
      PXE_KVM_SPEC=m8 PXE_KVM_ADMIN_USER=pxeadmin PXE_KVM_ADMIN_PASS_FILE="$PASSF" \
      npx playwright test -c e2e-kvm/playwright.config.ts) > "$K/playwright-kvm.log" 2>&1 || rc=$?
    [[ -f "$K/results.json" ]] && cp "$K/results.json" "$K/playwright-results.json"
    step vlan-node "$([[ $rc == 0 ]] && echo PASS || echo FAIL)" "playwright m8-vlan.spec.ts exit=$rc" "playwright-kvm.log playwright-results.json $NODE-timeline.txt $NODE-relay-verify.txt"
    ;;
  vlan-relay-teardown)
    vm "MODE=teardown bash -s" < "$INFRA_DIR/vlan/relay.sh" > "$K/relay-teardown.txt" 2>&1 || true
    grep -qx 'relay-clean: absent' "$K/relay-teardown.txt" && step relay-teardown PASS "relay-clean: absent" relay-teardown.txt || step relay-teardown FAIL "relay tidak bersih" relay-teardown.txt
    ;;
  netplan-neg)
    # CR-8-5: netplan VLAN tidak valid -> install.sh gagal SEBELUM memasang file; tanpa
    # /etc/netplan/99-pxe-dashboard.yaml, jaringan (alamat semua NIC, SSH) utuh. Argumen: opsi pengganti
    # (mis. "--vlan-iface mgmt20" = nama bentrok dengan VLAN server id 20 di file lain).
    lbl="${1:?label}"; shift
    [[ -f "$PASSF" ]] || admin_pass_new "$PASSF"
    vm 'umask 077 && cat > /root/m8-admin.pass && chmod 600 /root/m8-admin.pass' < "$PASSF"
    vm 'ip -br addr | sort; ls -1 /etc/netplan; ip route' > "$K/netplan-neg-$lbl-net-before.txt" 2>&1
    args=("$@")
    printf '# ./install.sh %s\n' "${args[*]}" > "$K/netplan-neg-$lbl.log"
    rc=0; vm "cd /root/pxe-src && ./install.sh $(printf '%q ' "${args[@]}")" >> "$K/netplan-neg-$lbl.log" 2>&1 || rc=$?
    echo "# exit=$rc" >> "$K/netplan-neg-$lbl.log"
    vm 'ip -br addr | sort; ls -1 /etc/netplan; ip route' > "$K/netplan-neg-$lbl-net-after.txt" 2>&1
    vm 'test -e /etc/netplan/99-pxe-dashboard.yaml && echo "99-pxe-dashboard.yaml: ADA" || echo "99-pxe-dashboard.yaml: tidak ada"; for u in dnsmasq nginx nfs-server pxe-dashboard; do echo "$u $(systemctl is-active $u 2>/dev/null) $(systemctl is-enabled $u 2>/dev/null)"; done' > "$K/netplan-neg-$lbl-state.txt" 2>&1
    pr=()
    ((rc != 0)) || pr+=("exit 0")
    grep -q 'netplan VLAN tidak valid (tidak dipasang)' "$K/netplan-neg-$lbl.log" || pr+=("bukan kegagalan validasi netplan")
    grep -q '99-pxe-dashboard.yaml: tidak ada' "$K/netplan-neg-$lbl-state.txt" || pr+=("file netplan installer tertinggal")
    cmp -s "$K/netplan-neg-$lbl-net-before.txt" "$K/netplan-neg-$lbl-net-after.txt" || pr+=("jaringan berubah")
    vm true || pr+=("ssh terputus")
    if ((${#pr[@]} == 0)); then step "netplan-neg-$lbl" PASS "netplan VLAN tidak valid ditolak exit=$rc sebelum dipasang; tanpa 99-pxe-dashboard.yaml; ip addr/route/daftar netplan sama; SSH utuh" "netplan-neg-$lbl.log netplan-neg-$lbl-net-before.txt netplan-neg-$lbl-net-after.txt netplan-neg-$lbl-state.txt"
    else step "netplan-neg-$lbl" FAIL "$(IFS='; '; echo "${pr[*]}")" "netplan-neg-$lbl.log netplan-neg-$lbl-net-before.txt netplan-neg-$lbl-net-after.txt netplan-neg-$lbl-state.txt"; fi
    ;;
  rmpkg-refuse)
    # CR-8-6: admin memasang paket yang bergantung pada nginx milik installer (libnginx-mod-stream) ->
    # `uninstall.sh --purge --remove-packages --yes` wajib menolak (simulasi apt-get -s purge) TANPA
    # perubahan apa pun; lalu paket admin dicopot lagi.
    vm 'DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=600 install -y -qq --no-install-recommends libnginx-mod-stream >/dev/null && dpkg-query -W -f="\${Package} \${Status}\n" libnginx-mod-stream; apt-mark showmanual libnginx-mod-stream' > "$K/rmpkg-refuse-setup.txt" 2>&1
    snap rmpkg-refuse-before; state rmpkg-refuse-before
    vm "cat /var/lib/pxe-dashboard-installer/install-manifest" > "$K/rmpkg-refuse-manifest-before.txt" 2>&1 || true
    printf '# ./uninstall.sh --purge --remove-packages --yes\n' > "$K/rmpkg-refuse.log"
    rc=0; vm "cd /root/pxe-src && ./uninstall.sh --purge --remove-packages --yes" >> "$K/rmpkg-refuse.log" 2>&1 || rc=$?
    echo "# exit=$rc" >> "$K/rmpkg-refuse.log"
    snap rmpkg-refuse-after; state rmpkg-refuse-after
    vm "cat /var/lib/pxe-dashboard-installer/install-manifest" > "$K/rmpkg-refuse-manifest-after.txt" 2>&1 || true
    pr=()
    ((rc != 0)) || pr+=("exit 0")
    grep -q -- '--remove-packages akan ikut menghapus paket yang tidak dipasang installer: .*libnginx-mod-stream' "$K/rmpkg-refuse.log" || pr+=("pesan penolakan tidak memuat libnginx-mod-stream")
    diff -q "$K/etc-rmpkg-refuse-before.tsv" "$K/etc-rmpkg-refuse-after.tsv" >/dev/null || pr+=("/etc berubah")
    cmp -s "$K/pkgs-rmpkg-refuse-before.txt" "$K/pkgs-rmpkg-refuse-after.txt" || pr+=("paket berubah")
    cmp -s "$K/rmpkg-refuse-manifest-before.txt" "$K/rmpkg-refuse-manifest-after.txt" || pr+=("manifest berubah")
    diff <(grep -E '^(dnsmasq|nginx|nfs-server|pxe-dashboard|ADA|HILANG) ' "$K/state-rmpkg-refuse-before.txt") <(grep -E '^(dnsmasq|nginx|nfs-server|pxe-dashboard|ADA|HILANG) ' "$K/state-rmpkg-refuse-after.txt") >/dev/null || pr+=("layanan/data berubah")
    if ((${#pr[@]} == 0)); then step rmpkg-refuse PASS "uninstall --remove-packages ditolak exit=$rc (apt-get -s purge: libnginx-mod-stream milik admin ikut terhapus); /etc, paket, manifest, layanan, data tidak berubah" "rmpkg-refuse.log rmpkg-refuse-setup.txt state-rmpkg-refuse-after.txt"
    else step rmpkg-refuse FAIL "$(IFS='; '; echo "${pr[*]}")" "rmpkg-refuse.log rmpkg-refuse-setup.txt"; fi
    vm 'DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=600 purge -y -qq libnginx-mod-stream >/dev/null; dpkg-query -W -f="\${Status}\n" libnginx-mod-stream 2>&1' > "$K/rmpkg-refuse-clean.txt" 2>&1 || true
    ;;
  umount-media)
    # Diagnostik (temuan deploy/lib.sh:201): lepas mount ISO /srv/pxe/media/* sebelum install.sh diulang
    # agar sisa skenario bisa diuji; install.sh memasang ulang dari fstab. Dicatat sebagai langkah.
    lbl="${1:?label}"
    # exportfs -ua dulu: nfsd menahan mount ISO yang diekspor (umount "target is busy" setelah node
    # memakai NFS); install.sh menjalankan exportfs -ra lagi.
    vm 'exportfs -ua; for m in /srv/pxe/media/ubuntu-24.04 /srv/pxe/media/debian-12 /srv/pxe/media/rocky-9; do if mountpoint -q $m; then umount $m && echo "umount $m"; fi; done; echo "# sisa mount:"; findmnt -rno TARGET | grep /srv/pxe || echo "(tidak ada mount /srv/pxe)"' > "$K/umount-media-$lbl.txt" 2>&1 || true
    if grep -q '^(tidak ada mount /srv/pxe)$' "$K/umount-media-$lbl.txt"; then
      step "umount-media-$lbl" PASS "diagnostik: exportfs -ua + mount ISO dilepas sebelum install.sh diulang (bukan bagian produk)" "umount-media-$lbl.txt"
    else
      step "umount-media-$lbl" FAIL "diagnostik: mount ISO tidak bisa dilepas" "umount-media-$lbl.txt"
    fi
    ;;
  node)
    [[ -f "$NODE_KEY" ]] || ssh-keygen -q -t ed25519 -N '' -C "pxe-test-m8-node" -f "$NODE_KEY"
    "$INFRA_DIR/node.sh" create "$NODE" "$NODE_MAC" uefi
    mkdir -p "$K/screenshots"
    rc=0
    (cd "$DASH_DIR" && env PXE_KVM_BASE_URL="http://$SERVER_IP" PXE_KVM_RUN=m8 PXE_KVM_RUNS_DIR="$K" PXE_KVM_SCENARIO="" \
      PXE_KVM_NODES="$NODE=$NODE_MAC=uefi=$NODE_IP=ubuntu=install=m8-node51" PXE_KVM_NODE_USER=m8admin \
      PXE_KVM_SSH_KEY="$NODE_KEY" PXE_KVM_SSH_PUBKEY="$NODE_KEY.pub" PXE_KVM_RESET_CMD="$INFRA_DIR/node.sh" \
      PXE_KVM_POWER_CMD="$INFRA_DIR/node.sh" PXE_KVM_GATEWAY=10.99.0.1 PXE_KVM_DNS=10.99.0.2 PXE_KVM_PREFIX=24 \
      PXE_KVM_SPEC=m8 PXE_KVM_ADMIN_USER=pxeadmin PXE_KVM_ADMIN_PASS_FILE="$PASSF" \
      npx playwright test -c e2e-kvm/playwright.config.ts) > "$K/playwright-kvm.log" 2>&1 || rc=$?
    [[ -f "$K/results.json" ]] && cp "$K/results.json" "$K/playwright-results.json"
    step node "$([[ $rc == 0 ]] && echo PASS || echo FAIL)" "playwright m8-installer.spec.ts exit=$rc" "playwright-kvm.log playwright-results.json $NODE-timeline.txt $NODE-verify-ssh.txt"
    ;;
  data)
    lbl="${1:?label}"
    jar="$KEYS_DIR/m8-cookies.txt"
    ADMIN_USERNAME=pxeadmin
    code="$(admin_login "$PASSF" "$jar" || true)"
    hid="${NODE_MAC//:/}"
    {
      echo "# data dashboard ($lbl) $(date -u +%FT%TZ): login admin -> $code"
      curl -sS --max-time 10 -b "$jar" "http://$SERVER_IP/api/hosts/$hid" | python3 -I -c 'import json,sys; h=json.load(sys.stdin); print("host", {k: h.get(k) for k in ("mac","status","osInstalled","osAssigned","hostname","mgmtIp","firmware","vendor")})'
      curl -sS --max-time 10 -b "$jar" "http://$SERVER_IP/api/jobs?hostId=$hid&limit=200" | python3 -I -c 'import json,sys; j=json.load(sys.stdin)["jobs"]; print("jobs", len(j)); [print("job", x["id"], x["status"], x.get("failureReason")) for x in j]'
      curl -sS --max-time 10 -b "$jar" "http://$SERVER_IP/api/hosts" | python3 -I -c 'import json,sys; d=json.load(sys.stdin); h=d.get("hosts", d) if isinstance(d, dict) else d; print("hosts", len(h))'
    } > "$K/data-$lbl.txt" 2>&1 || true
    rm -f "$jar"
    cat "$K/data-$lbl.txt"
    ;;
  uninstall|purge)
    lbl="${M8_LABEL:-$cmd}"; args=(--yes); mode=keep
    [[ "$cmd" == purge ]] && { args=(--purge --yes); mode=purge; [[ "${M8_REMOVE_PKGS:-0}" == 1 ]] && args=(--purge --remove-packages --yes); }
    # M8_ANALYZE_ONLY=1: hanya analisis ulang bukti yang sudah ada (tanpa menjalankan uninstall lagi).
    if [[ "${M8_ANALYZE_ONLY:-0}" != 1 ]]; then
      vm "cp /var/lib/pxe-dashboard-installer/install-manifest /root/m8-manifest-before-$lbl && chmod 600 /root/m8-manifest-before-$lbl"
      vm "cat /root/m8-manifest-before-$lbl" > "$K/$lbl-manifest-before.txt"
      snap "before-$lbl"
      state "before-$lbl"
      printf '# ssh root@10.99.0.2 cd /root/pxe-src && ./uninstall.sh %s\n' "${args[*]}" > "$K/$lbl.log"
      rc=0; vm "cd /root/pxe-src && ./uninstall.sh ${args[*]}" >> "$K/$lbl.log" 2>&1 || rc=$?
      echo "# exit=$rc" >> "$K/$lbl.log"
      state "$lbl"
      snap "after-$lbl"
      mrc=0; vm "MODE=$mode MF=/root/m8-manifest-before-$lbl bash -s" < "$HERE/vm-manifest-check.sh" > "$K/$lbl-manifest-check.txt" 2>&1 || mrc=$?
      { echo "# dari host"; echo "GET http://10.99.0.2/login -> $(host_code /login)"; } > "$K/$lbl-host-http.txt"
      vm "cat /var/lib/pxe-dashboard-installer/install-manifest 2>/dev/null || echo '(manifest tidak ada)'" > "$K/$lbl-manifest-after.txt" 2>&1 || true
      if [[ "${M8_REMOVE_PKGS:-0}" == 1 ]]; then
        vm "tail -n 60 /var/log/apt/history.log" > "$K/$lbl-apt-history.txt" 2>&1 || true
        vm "apt-get -s autoremove 2>/dev/null | grep -E '^Remv ' || echo '(tidak ada paket autoremovable)'" > "$K/$lbl-apt-autoremove-after.txt" 2>&1 || true
      fi
    else
      rc="$(sed -n 's/^# exit=//p' "$K/$lbl.log")"
      mrc="$(sed -n 's/^# manifest-check MODE=[a-z]* fails=//p' "$K/$lbl-manifest-check.txt")"
    fi
    open_ports="$(awk '/^OPEN /' "$K/state-$lbl.txt" | wc -l)"
    LC_ALL=C comm -13 <(LC_ALL=C sort "$K/pkgs-pre.txt") <(LC_ALL=C sort "$K/pkgs-after-$lbl.txt") > "$K/pkgs-new-vs-pre.txt"
    LC_ALL=C comm -23 <(LC_ALL=C sort "$K/pkgs-before-$lbl.txt") <(LC_ALL=C sort "$K/pkgs-after-$lbl.txt") > "$K/$lbl-pkgs-removed.txt"
    rmopt=(); [[ -s "$K/$lbl-pkgs-removed.txt" ]] && rmopt=(--removed-pkgs "$K/$lbl-pkgs-removed.txt")
    drc=0; python3 -I "$HERE/etc-diff.py" "$K/etc-before-$lbl.tsv" "$K/etc-after-$lbl.tsv" --manifest "$K/$lbl-manifest-before.txt" "${rmopt[@]}" --label "$lbl: sebelum vs sesudah" > "$K/$lbl-etc-diff.txt" || drc=$?
    prc=0; python3 -I "$HERE/etc-diff.py" "$K/etc-pre.tsv" "$K/etc-after-$lbl.tsv" --manifest "$K/$lbl-manifest-before.txt" --new-pkgs "$K/pkgs-new-vs-pre.txt" --label "$lbl: pra-install vs sesudah" > "$K/$lbl-etc-diff-vs-pre.txt" || prc=$?
    { echo "# user baru vs pra-install (dari paket / installer)"; LC_ALL=C comm -13 <(LC_ALL=C sort "$K/users-pre.txt") <(LC_ALL=C sort "$K/users-after-$lbl.txt"); echo "# user hilang vs pra-install"; LC_ALL=C comm -23 <(LC_ALL=C sort "$K/users-pre.txt") <(LC_ALL=C sort "$K/users-after-$lbl.txt"); } > "$K/$lbl-users-vs-pre.txt"
    data_ok=1
    if [[ "$mode" == keep ]]; then
      # CR-8-14: pxe.db wajib tetap ada bila ADA sebelum uninstall (state-before-<lbl>); install segar
      # yang belum pernah membuat DB (dibuat lazy) hanya dinilai dari direktori data.
      grep -q '^ADA   /var/lib/pxe-dashboard ' "$K/state-$lbl.txt" && grep -q '^ADA   /srv/pxe/media ' "$K/state-$lbl.txt" || data_ok=0
      if grep -q '^pxe.db ' "$K/state-before-$lbl.txt" 2>/dev/null; then
        db_before="ada"; grep -q '^pxe.db ' "$K/state-$lbl.txt" || data_ok=0
      else db_before="tidak-ada"; fi
    else
      grep -q '^HILANG /var/lib/pxe-dashboard$' "$K/state-$lbl.txt" && grep -q '^HILANG /srv/pxe$' "$K/state-$lbl.txt" && grep -q '^# user pxe' "$K/state-$lbl.txt" && ! grep -q '^pxe:' "$K/state-$lbl.txt" || data_ok=0
    fi
    # Unit installer/paket tidak boleh tertinggal "failed" (pxe-dashboard SIGTERM -> 143 = sukses).
    failed_units="$(grep -cE '^(dnsmasq|nginx|nfs-server|pxe-dashboard|pxe-dashboard-firewall) +failed' "$K/state-$lbl.txt" || true)"
    # Firewall installer (bila ada di manifest) wajib hilang: tabel nft dan unit.
    if grep -qP '^unit\tpxe-dashboard-firewall\.service' "$K/$lbl-manifest-before.txt"; then
      if grep -q '^nft-table pxe_dashboard: tidak ada' "$K/state-$lbl.txt"; then step "$lbl-firewall-removed" PASS "tabel nft inet pxe_dashboard + unit firewall dicopot" "state-$lbl.txt"
      else step "$lbl-firewall-removed" FAIL "tabel nft pxe_dashboard masih ada" "state-$lbl.txt"; fi
    fi
    if ((rc == 0 && mrc == 0 && drc == 0 && open_ports == 0 && data_ok == 1 && failed_units == 0)); then
      step "$lbl" PASS "exit 0; manifest-check 0 FAIL; port 67/69/80/3000/2049 tertutup; tanpa unit failed; data $mode OK (pxe.db sebelum: ${db_before:-n/a}); /etc sebelum→sesudah tanpa UNEXPLAINED (vs pra-install rc=$prc, informatif)" "$lbl.log $lbl-manifest-check.txt state-$lbl.txt $lbl-etc-diff.txt $lbl-etc-diff-vs-pre.txt"
    else
      step "$lbl" FAIL "exit=$rc manifest-check=$mrc open_ports=$open_ports failed_units=$failed_units data_ok=$data_ok etc-diff=$drc vs-pre=$prc" "$lbl.log $lbl-manifest-check.txt state-$lbl.txt $lbl-etc-diff.txt $lbl-etc-diff-vs-pre.txt"
    fi
    # M8_REMOVE_PKGS=1: tinjauan apt — paket 'requested' ter-purge; 'dep' ter-purge atau masih dibutuhkan
    # (tetap di manifest); paket pra-install tidak ada yang hilang; tidak ada dep kita yang tersisa
    # autoremovable; sisa paket vs pra-install dijelaskan.
    if [[ "${M8_REMOVE_PKGS:-0}" == 1 && "$cmd" == purge ]]; then
      pr=(); mb="$K/$lbl-manifest-before.txt"; ma="$K/$lbl-manifest-after.txt"; after="$K/pkgs-after-$lbl.txt"
      lost="$(LC_ALL=C comm -23 <(LC_ALL=C sort "$K/pkgs-pre.txt") <(LC_ALL=C sort "$after") | tr '\n' ' ')"
      [[ -z "${lost// }" ]] || pr+=("paket pra-install hilang: $lost")
      {
        echo "# tinjauan paket $lbl (uninstall.sh --purge --remove-packages)"
        echo "# paket dihapus (sebelum - sesudah):"; sed 's/^/  /' "$K/$lbl-pkgs-removed.txt"
        echo "# paket pra-install yang hilang: ${lost:-(tidak ada)}"
        echo "# entri pkg manifest sebelum:"
        awk -F'\t' '$1 == "pkg"' "$mb" | while IFS=$'\t' read -r t pk ex; do
          if grep -qxF "$pk" "$K/$lbl-pkgs-removed.txt"; then st=dipurge; elif grep -qxF "$pk" "$after"; then st=masih-terpasang; else st=tidak-terpasang-sebelumnya; fi
          kept="$(awk -F'\t' -v q="$pk" '$1 == "pkg" && $2 == q { print "tetap-di-manifest" }' "$ma")"
          echo "  ${ex:-requested} $pk -> $st ${kept}"
        done
        echo "# sisa paket vs pra-install:"; LC_ALL=C comm -13 <(LC_ALL=C sort "$K/pkgs-pre.txt") <(LC_ALL=C sort "$after") | sed 's/^/  /'
        echo "# apt-get -s autoremove sesudah:"; sed 's/^/  /' "$K/$lbl-apt-autoremove-after.txt"
      } > "$K/$lbl-packages-review.txt"
      while IFS=$'\t' read -r t pk ex; do
        [[ "$t" == pkg ]] || continue
        if [[ "$ex" == dep ]]; then
          if grep -qxF "$pk" "$after" && ! grep -qP "^pkg\t$pk\tdep" "$ma" 2>/dev/null; then pr+=("dep $pk masih terpasang tapi hilang dari manifest"); fi
          grep -qE "^Remv $pk[ :]" "$K/$lbl-apt-autoremove-after.txt" && pr+=("dep $pk masih autoremovable")
        else
          grep -qxF "$pk" "$after" && pr+=("requested $pk masih terpasang")
        fi
      done < "$mb"
      leftover="$(LC_ALL=C comm -13 <(LC_ALL=C sort "$K/pkgs-pre.txt") <(LC_ALL=C sort "$after"))"
      for pk in $leftover; do awk -F'\t' -v q="$pk" '$1 == "pkg" && $2 == q { f = 1 } END { exit !f }' "$mb" || pr+=("sisa $pk tidak tercatat di manifest"); done
      if ((${#pr[@]} == 0)); then step "$lbl-packages" PASS "requested ter-purge; dep ter-purge atau masih dibutuhkan (tetap di manifest); paket pra-install utuh; tanpa autoremove global" "$lbl-packages-review.txt $lbl-apt-history.txt $lbl-apt-autoremove-after.txt"
      else step "$lbl-packages" FAIL "$(IFS='; '; echo "${pr[*]}")" "$lbl-packages-review.txt $lbl-apt-history.txt $lbl-apt-autoremove-after.txt"; fi
    fi
    ;;
  cleanup)
    "$INFRA_DIR/node.sh" destroy "$NODE" "$NODE_MAC" || true
    "$INFRA_DIR/install-vm.sh" down || true
    if [[ "$M8_TOPOLOGY" == vlan ]]; then
      "$INFRA_DIR/switch-down.sh" --purge || true
      for f in "$SWITCH_BASE" "$SWITCH_READY"; do assert_path_in_vms "$f"; rm -f "$f"; done
      "$INFRA_DIR/net-down.sh" --topology vlan || true
    else
      "$INFRA_DIR/net-down.sh" || true
    fi
    rm -f "$PASSF" "$NODE_KEY" "$NODE_KEY.pub" "$SSH_KEY" "$SSH_KEY.pub" "$KEYS_DIR/m8-cookies.txt"
    {
      echo "# cleanup $(date -u +%FT%TZ)"
      echo "# domain:"; virsh_q list --all --name | sed '/^$/d'
      echo "# network:"; virsh_q net-list --all --name | sed '/^$/d'
      echo "# .agent/vms:"; ls -la "$VMS_DIR"
      echo "# .agent/keys:"; ls -la "$KEYS_DIR"
      echo "# socat capture:"; ls "$K"/.capture-*.pid 2>/dev/null || echo "(tidak ada)"
    } > "$K/cleanup.txt" 2>&1
    left="$(virsh_q list --all --name | grep -c '^pxe-test-' || true)"; nets="$(virsh_q net-list --all --name | grep -c '^pxe-test' || true)"
    nk="$(find "$KEYS_DIR" -type f | wc -l)"; nv="$(find "$VMS_DIR" -name 'pxe-test-*' | wc -l)"
    step cleanup "$([[ $left == 0 && $nets == 0 && $nk == 0 && $nv == 0 ]] && echo PASS || echo FAIL)" "VM pxe-test-*=$left network pxe-test*=$nets key=$nk disk=$nv" cleanup.txt
    cat "$K/cleanup.txt"
    ;;
  results)
    rrc=0; "$INFRA_DIR/redact-evidence.sh" "$K" > "$K/redact.txt" 2>&1 || rrc=$?
    python3 -I - "$K" <<'PY'
import json, os, sys
k = sys.argv[1]
steps = []
for line in open(os.path.join(k, "steps.tsv"), encoding="utf-8"):
    at, sid, st, note, ev = (line.rstrip("\n").split("\t") + [""] * 5)[:5]
    steps.append({"at": at, "step": sid, "status": st, "note": note, "evidence": ev.split()})
pw = []
p = os.path.join(k, "playwright-results.json")
if os.path.exists(p):
    pw = json.load(open(p, encoding="utf-8")).get("results", [])
# Status akhir per langkah = entri non-INFO TERAKHIR untuk id itu (analisis ulang setelah tinjauan
# INFO menggantikan entri sebelumnya; seluruh riwayat tetap di "steps").
final = {}
for st in steps:
    if st["status"] != "INFO":
        final[st["step"]] = st["status"]
commit = ""
cp = os.path.join(k, "commit.txt")
if os.path.exists(cp):
    commit = open(cp, encoding="utf-8").read().strip()
out = {"run": "m8", "scenario": "DEC-029 §4 installer KVM", "commit": commit, "final": final, "steps": steps, "playwright": pw,
       "overall": "PASS" if final and all(v == "PASS" for v in final.values()) and pw and all(r["status"] == "PASS" for r in pw) else "FAIL"}
json.dump(out, open(os.path.join(k, "results.json"), "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print(out["overall"])
PY
    echo "redact-evidence exit=$rrc"
    ;;
  *) die "pakai: run.sh protect|up|install|node|data|uninstall|purge|cleanup|results" ;;
esac
