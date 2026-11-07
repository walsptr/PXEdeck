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
NODE_KEY="$KEYS_DIR/m8-node_ed25519"
# M8_NIC: nama NIC provisioning di VM. Default pxe0 (nama lab dari infra/server/netplan.yaml). Run 1
# memakai pxe0 dan GAGAL (deploy/render.sh:65 menolak NIC bernama pxe0, lihat results.json); run
# berikutnya memakai M8_NIC=prov0: `up` mengganti set-name di netplan VM lalu reboot (konfigurasi
# VM uji, setara server sungguhan dengan NIC bernama lain), tanpa mengubah kode produk.
M8_NIC="${M8_NIC:-pxe0}"
[[ "$M8_NIC" =~ ^[a-z][a-z0-9]{1,10}$ ]] || die "M8_NIC tidak valid"
INSTALL_ARGS=(--yes --interface "$M8_NIC" --address 10.99.0.2/24 --dhcp-range 10.99.0.100-10.99.0.200
  --gateway 10.99.0.1 --dns 10.99.0.2 --admin-allow 10.99.0.1 --admin-password-file /root/m8-admin.pass
  --iso-ubuntu /dev/sr0 --iso-debian /dev/sr1 --iso-rocky /dev/sr2)

step() { # step <id> <PASS|FAIL> <catatan> [bukti...]
  local id="$1" st="$2" n="$3"; shift 3
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$id" "$st" "$n" "$*" >> "$STEPS"
  log "STEP $id $st — $n"
}
vm() { ssh "${SSH_OPTS[@]}" -o IdentitiesOnly=yes "root@$SERVER_IP" "$@"; }
vm_script() { local s="$1"; shift; vm "$@ bash -s" < "$HERE/$s"; }
host_code() { curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "http://$SERVER_IP$1" 2>/dev/null || true; }

state() { vm_script vm-state.sh "LABEL=$1" > "$K/state-$1.txt" 2>&1 || true; }
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
    t0=$(date +%s); rc=0
    vm "cd /root/pxe-src && ${pathpre}./install.sh ${INSTALL_ARGS[*]} ${extra[*]}" >> "$K/install-$n.log" 2>&1 || rc=$?
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
    bad_dns="$( { lss | grep -Ev "^10\.99\.0\.2:[0-9]+$|%$M8_NIC:[0-9]+$" || true; } | wc -l)"
    dhcp67="$(lss | wc -l)"
    nic_67="$( { lss | grep -c "%$M8_NIC:67$" || true; } )"
    if ((rc == 0)) && [[ "$login" == 200 && "$sett" == 401 ]] && ((dhcp67 > 0 && bad_dns == 0 && nic_67 >= 1)); then
      step "install-$n" PASS "exit 0; /login 200; /api/settings 401 (dari host); dnsmasq ${dhcp67} socket udp, semua di $M8_NIC/10.99.0.2 (DHCP %$M8_NIC:67)" "install-$n.log install-$n-ss-lunp.txt install-$n-host-http.txt state-install-$n.txt"
    else
      step "install-$n" FAIL "exit=$rc login=$login settings=$sett dnsmasq-socket=$dhcp67 di-luar-$M8_NIC=$bad_dns %$M8_NIC:67=$nic_67" "install-$n.log install-$n-ss-lunp.txt install-$n-host-http.txt state-install-$n.txt"
    fi
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
      printf '# ssh root@10.99.0.2 cd /root/pxe-src && ./uninstall.sh %s\n' "${args[*]}" > "$K/$lbl.log"
      rc=0; vm "cd /root/pxe-src && ./uninstall.sh ${args[*]}" >> "$K/$lbl.log" 2>&1 || rc=$?
      echo "# exit=$rc" >> "$K/$lbl.log"
      state "$lbl"
      snap "after-$lbl"
      mrc=0; vm "MODE=$mode MF=/root/m8-manifest-before-$lbl bash -s" < "$HERE/vm-manifest-check.sh" > "$K/$lbl-manifest-check.txt" 2>&1 || mrc=$?
      { echo "# dari host"; echo "GET http://10.99.0.2/login -> $(host_code /login)"; } > "$K/$lbl-host-http.txt"
    else
      rc="$(sed -n 's/^# exit=//p' "$K/$lbl.log")"
      mrc="$(sed -n 's/^# manifest-check MODE=[a-z]* fails=//p' "$K/$lbl-manifest-check.txt")"
    fi
    open_ports="$(awk '/^OPEN /' "$K/state-$lbl.txt" | wc -l)"
    LC_ALL=C comm -13 <(LC_ALL=C sort "$K/pkgs-pre.txt") <(LC_ALL=C sort "$K/pkgs-after-$lbl.txt") > "$K/pkgs-new-vs-pre.txt"
    drc=0; python3 -I "$HERE/etc-diff.py" "$K/etc-before-$lbl.tsv" "$K/etc-after-$lbl.tsv" --manifest "$K/$lbl-manifest-before.txt" --label "$lbl: sebelum vs sesudah" > "$K/$lbl-etc-diff.txt" || drc=$?
    prc=0; python3 -I "$HERE/etc-diff.py" "$K/etc-pre.tsv" "$K/etc-after-$lbl.tsv" --manifest "$K/$lbl-manifest-before.txt" --new-pkgs "$K/pkgs-new-vs-pre.txt" --label "$lbl: pra-install vs sesudah" > "$K/$lbl-etc-diff-vs-pre.txt" || prc=$?
    { echo "# user baru vs pra-install (dari paket / installer)"; LC_ALL=C comm -13 <(LC_ALL=C sort "$K/users-pre.txt") <(LC_ALL=C sort "$K/users-after-$lbl.txt"); echo "# user hilang vs pra-install"; LC_ALL=C comm -23 <(LC_ALL=C sort "$K/users-pre.txt") <(LC_ALL=C sort "$K/users-after-$lbl.txt"); } > "$K/$lbl-users-vs-pre.txt"
    data_ok=1
    if [[ "$mode" == keep ]]; then
      grep -q '^ADA   /var/lib/pxe-dashboard ' "$K/state-$lbl.txt" && grep -q '^ADA   /srv/pxe/media ' "$K/state-$lbl.txt" && grep -q '^pxe.db ' "$K/state-$lbl.txt" || data_ok=0
    else
      grep -q '^HILANG /var/lib/pxe-dashboard$' "$K/state-$lbl.txt" && grep -q '^HILANG /srv/pxe$' "$K/state-$lbl.txt" && grep -q '^# user pxe' "$K/state-$lbl.txt" && ! grep -q '^pxe:' "$K/state-$lbl.txt" || data_ok=0
    fi
    if ((rc == 0 && mrc == 0 && drc == 0 && open_ports == 0 && data_ok == 1)); then
      step "$lbl" PASS "exit 0; manifest-check 0 FAIL; port 67/69/80/3000/2049 tertutup; data $mode OK; /etc sebelum→sesudah tanpa UNEXPLAINED (vs pra-install rc=$prc)" "$lbl.log $lbl-manifest-check.txt state-$lbl.txt $lbl-etc-diff.txt $lbl-etc-diff-vs-pre.txt"
    else
      step "$lbl" FAIL "exit=$rc manifest-check=$mrc open_ports=$open_ports data_ok=$data_ok etc-diff=$drc vs-pre=$prc" "$lbl.log $lbl-manifest-check.txt state-$lbl.txt $lbl-etc-diff.txt $lbl-etc-diff-vs-pre.txt"
    fi
    ;;
  cleanup)
    "$INFRA_DIR/node.sh" destroy "$NODE" "$NODE_MAC" || true
    "$INFRA_DIR/install-vm.sh" down || true
    "$INFRA_DIR/net-down.sh" || true
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
out = {"run": "m8", "scenario": "DEC-029 §4 installer KVM", "steps": steps, "playwright": pw,
       "overall": "PASS" if steps and all(s["status"] == "PASS" for s in steps) and all(r["status"] == "PASS" for r in pw) else "FAIL"}
json.dump(out, open(os.path.join(k, "results.json"), "w", encoding="utf-8"), indent=2, ensure_ascii=False)
print(out["overall"])
PY
    echo "redact-evidence exit=$rrc"
    ;;
  *) die "pakai: run.sh protect|up|install|node|data|uninstall|purge|cleanup|results" ;;
esac
