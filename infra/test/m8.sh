# shellcheck shell=bash
# infra/test/m8.sh — test install.sh / uninstall.sh / infra/install-vm.sh (M8, DEC-029). Di-source run.sh.
#
# Keamanan: semua perintah sistem (systemctl, apt-get, ip, ss, mount, useradd, nginx, dnsmasq, ...)
# PALSU (infra/test/fake-bin-m8, dicatat ke $FAKE_LOG); filesystem target di-prefix sandbox lewat
# PXE_INSTALL_ROOT; probe DHCP palsu (fake-bin-m8/python3). Tidak ada yang menyentuh host.

_M8_PW='Dummy-Admin-Pass-0123'
_M8_HASH='scrypt$15$8$1$QUJDREVGR0hJSktMTU5PUA==$c2VjcmV0aGFzaHZhbHVlZm9ydGVzdHNvbmx5MDEyMzQ1Njc4OQ=='
_M8_ARGS=(--interface eth1 --address 10.10.10.1/24 --dhcp-range 10.10.10.100-10.10.10.200
  --gateway 10.10.10.254 --dns 10.10.10.1 --admin-allow 192.168.1.0/24)

_m8_setup() {
  export PATH="$INFRA_TEST_DIR/fake-bin-m8:$PATH"
  R="$SB/root"; export PXE_INSTALL_ROOT="$R"
  mkdir -p "$R/etc/nginx/sites-available" "$R/etc/nginx/sites-enabled" "$R/sys/class/net/eth1" \
    "$R/usr/lib/ipxe" "$R/usr/sbin" "$R/var/tmp" "$R/var/log" "$SB/curl" "$FAKE_STATE/curl-files"
  printf 'NAME="Ubuntu"\nID=ubuntu\nVERSION_ID="24.04"\n' > "$R/etc/os-release"
  echo "efi-dummy" > "$R/usr/lib/ipxe/snponly.efi"
  echo "kpxe-dummy" > "$R/usr/lib/ipxe/undionly.kpxe"
  echo "# default site" > "$R/etc/nginx/sites-available/default"
  ln -sfn /etc/nginx/sites-available/default "$R/etc/nginx/sites-enabled/default"
  printf '# fstab asli\nUUID=abcd / ext4 defaults 0 1\n' > "$R/etc/fstab"
  printf '2: eth1    inet 10.10.10.1/24 brd 10.10.10.255 scope global eth1\n3: eth0    inet 192.168.1.10/24 brd 192.168.1.255 scope global eth0\n' > "$FAKE_STATE/ip-addr"
  cat > "$FAKE_STATE/ss" <<'EOF'
udp UNCONN 0 0 10.10.10.1:53 0.0.0.0:* users:(("dnsmasq",pid=10,fd=6))
udp UNCONN 0 0 0.0.0.0%eth1:67 0.0.0.0:* users:(("dnsmasq",pid=10,fd=4))
udp UNCONN 0 0 10.10.10.1:69 0.0.0.0:* users:(("dnsmasq",pid=10,fd=8))
udp UNCONN 0 0 127.0.0.53%lo:53 0.0.0.0:* users:(("systemd-resolve",pid=5,fd=13))
tcp LISTEN 0 511 10.10.10.1:80 0.0.0.0:* users:(("nginx",pid=20,fd=6))
tcp LISTEN 0 511 127.0.0.1:3000 0.0.0.0:* users:(("next-server (v1",pid=30,fd=20))
tcp LISTEN 0 64 10.10.10.1:2049 0.0.0.0:*
EOF
  # Rilis dashboard palsu (server.js di akar) + password admin 0600.
  mkdir -p "$SB/rel"; echo 'console.log("fake")' > "$SB/rel/server.js"
  tar -C "$SB/rel" -cJf "$SB/release.tar.xz" .
  (umask 077 && printf '%s\n' "$_M8_PW" > "$SB/admin.pass")
  # Node palsu "unduhan" nodejs.org (NODE_VERSION non-default -> SHASUMS256.txt diunduh + diverifikasi).
  mkdir -p "$SB/nodesrc/node-v22.99.0-linux-x64/bin"
  cat > "$SB/nodesrc/node-v22.99.0-linux-x64/bin/node" <<EOF
#!/usr/bin/env bash
# node palsu (test M8): admin-hash membaca password dari stdin -> simpan untuk asersi, cetak hash dummy.
# admin-verify: stdin disimpan, exit \${FAKE_VERIFY_RC:-1} (default: password tidak cocok).
echo "node \$*" >> "\$FAKE_LOG"
if [[ "\$*" == *admin-verify.mjs* ]]; then cat > "\$FAKE_STATE/node-verify.stdin"; exit "\${FAKE_VERIFY_RC:-1}"; fi
cat > "\$FAKE_STATE/node.stdin"
printf '%s\n' '$_M8_HASH'
EOF
  chmod +x "$SB/nodesrc/node-v22.99.0-linux-x64/bin/node"
  tar -C "$SB/nodesrc" -cJf "$FAKE_STATE/curl-files/node-v22.99.0-linux-x64.tar.xz" node-v22.99.0-linux-x64
  (cd "$FAKE_STATE/curl-files" && sha256sum node-v22.99.0-linux-x64.tar.xz > SHASUMS256.txt)
  export NODE_VERSION=22.99.0 FAKE_CURL_HTTP=1
  unset FAKE_UID FAKE_DHCP_RC FAKE_DHCP_OUT
}
# _m8_fresh: root sandbox + state paket/user palsu baru (server "bersih" kedua dalam satu test).
_m8_fresh() {
  rm -rf -- "${SB:?}/root" "${FAKE_STATE:?}/dpkg" "${FAKE_STATE:?}/user-pxe"
  : > "$FAKE_LOG"
  _m8_setup
}
_m8_install() { set +e; OUT="$(cd "$REPO_UNDER_TEST" && bash ./install.sh "$@" </dev/null 2>&1)"; RC=$?; set -e; }
_m8_uninstall() { set +e; OUT="$(cd "$REPO_UNDER_TEST" && bash ./uninstall.sh "$@" </dev/null 2>&1)"; RC=$?; set -e; }
_m8_full() { _m8_install "${_M8_ARGS[@]}" --release "$SB/release.tar.xz" --admin-password-file "$SB/admin.pass" --yes "$@"; }
_m8_render() { # _m8_render <dir> [opsi...]
  local d="$1"; shift
  set +e; OUT="$(cd "$REPO_UNDER_TEST" && bash ./install.sh --render "$d" "$@" </dev/null 2>&1)"; RC=$?; set -e
}
_m8_tree() { (cd "$R" && find . -printf '%p %m %y\n' | sort); }
# Pemanggilan palsu yang mengubah sistem (dry-run / penolakan tidak boleh memuatnya).
_m8_mutations() {
  grep -E '^(apt-get|useradd|userdel|chown|mount |umount |runuser|exportfs|netplan (apply|generate)|nft |systemctl (enable|disable|start|stop|restart|reload|daemon-reload)|curl .* -o |node )' "$FAKE_LOG" || true
}
_m8_no_secret() { # tidak ada password plaintext di output, log palsu, atau file mana pun di root
  assert_not_contains "$OUT" "$_M8_PW" "output"
  assert_not_contains "$(cat "$FAKE_LOG")" "$_M8_PW" "argv perintah"
  ! grep -rqF -- "$_M8_PW" "$R" 2>/dev/null || _fail "password plaintext ada di file: $(grep -rlF -- "$_M8_PW" "$R")"
}
_m8_mf() { cat "$R/var/lib/pxe-dashboard-installer/install-manifest"; }

# ---------------------------------------------------------------------------------------------
test_m8_static() {
  local f
  for f in install.sh uninstall.sh deploy/lib.sh deploy/render.sh deploy/build-release.sh infra/install-vm.sh; do
    bash -n "$REPO_UNDER_TEST/$f" || _fail "bash -n $f"
  done
  for f in install.sh uninstall.sh deploy/build-release.sh infra/install-vm.sh; do
    grep -q '^set -euo pipefail' "$REPO_UNDER_TEST/$f" || _fail "$f tanpa set -euo pipefail"
    [[ -x "$REPO_UNDER_TEST/$f" ]] || _fail "$f tidak executable"
  done
  ! grep -nE '^[^#]*(set -x|set -o xtrace)' "$REPO_UNDER_TEST/install.sh" "$REPO_UNDER_TEST/uninstall.sh" "$REPO_UNDER_TEST/deploy/"*.sh || _fail "set -x dilarang (hash bisa tercetak)"
  assert_eq "$(python3 -I "$REPO_UNDER_TEST/deploy/dhcp-probe.py" --selftest)" "selftest ok" "dhcp-probe selftest"
  # Versi + SHA256 Node dipin sama dengan infra/fetch-node.sh / .agent media.
  assert_contains "$(cat "$INFRA_DIR_UNDER_TEST/fetch-node.sh")" "NODE_VERSION:-$(sed -n 's/^NODE_VERSION_DEFAULT=//p' "$REPO_UNDER_TEST/deploy/lib.sh")}" "versi Node"
  assert_match "$(sed -n 's/^NODE_SHA256_DEFAULT=//p' "$REPO_UNDER_TEST/deploy/lib.sh")" '^[0-9a-f]{64}$' "sha Node"
}

test_m8_args_rejected() {
  _m8_setup
  _m8_install --bogus; assert_eq "$RC" 2 "opsi tak dikenal"; assert_contains "$OUT" "opsi tidak dikenal"
  _m8_install --interface eth1; assert_eq "$RC" 2 "wajib kurang"
  assert_contains "$OUT" "--address"; assert_contains "$OUT" "--dhcp-range"; assert_contains "$OUT" "--admin-allow"
  _m8_install "${_M8_ARGS[@]}" --admin-password "$_M8_PW"; assert_eq "$RC" 2 "password di argv"
  assert_contains "$OUT" "password tidak boleh lewat argumen"; assert_not_contains "$OUT" "$_M8_PW"
  _m8_install "${_M8_ARGS[@]}" --admin-password="$_M8_PW"; assert_eq "$RC" 2; assert_not_contains "$OUT" "$_M8_PW"
  local bad
  for bad in "--address 10.10.10.1" "--address 10.10.10.0/24" "--address 10.10.10.1/31" \
    "--dhcp-range 10.10.10.1-10.10.10.200" "--dhcp-range 10.10.10.200-10.10.10.100" \
    "--dhcp-range 10.10.11.100-10.10.11.200" "--gateway 10.20.0.1" "--dns 10.10.10.256" \
    "--interface eth1;rm" "--admin-user Root" "--admin-allow 1.2.3.4/33" "--vlan-id 4095" \
    "--vlan-networks 20:10.20.20.5/24:10.20.20.1" "--vlan-networks 20:10.20.20.0/24:10.30.0.1" \
    "--vlan-iface pxe9" "--iso-ubuntu relative.iso" "--domain Bad_Domain" "--debian-netboot x"; do
    # shellcheck disable=SC2086
    _m8_render "$SB/r" "${_M8_ARGS[@]}" $bad
    assert_eq "$RC" 2 "harus ditolak: $bad"
  done
  assert_eq "$(_m8_mutations)" "" "penolakan argumen tanpa mutasi"
  [[ ! -e "$SB/r" ]] || _fail "render tidak boleh menulis saat argumen invalid"
}

test_m8_config_env_precedence() {
  _m8_setup
  cat > "$SB/install.conf" <<'EOF'
# contoh config
INTERFACE=eth1
ADDRESS="10.10.10.1/24"
DHCP_RANGE=10.10.10.100-10.10.10.200
GATEWAY='10.10.10.254'
DNS=10.10.10.1
ADMIN_ALLOW=192.168.1.0/24
ADMIN_USER=fromconfig
DOMAIN=conf.lan
EOF
  PXE_INSTALL_DOMAIN=env.lan _m8_render "$SB/r" --config "$SB/install.conf"
  assert_eq "$RC" 0 "$OUT"
  assert_contains "$(cat "$SB/r/pxe-dashboard.env")" "PXE_ADMIN_USERNAME=fromconfig"
  assert_contains "$(cat "$SB/r/dnsmasq.conf")" "domain=env.lan" "env > config"
  PXE_INSTALL_DOMAIN=env.lan _m8_render "$SB/r2" --config "$SB/install.conf" --domain flag.lan
  assert_contains "$(cat "$SB/r2/dnsmasq.conf")" "domain=flag.lan" "flag > env"
  printf 'ADMIN_PASSWORD=%s\n' "$_M8_PW" >> "$SB/install.conf"
  _m8_render "$SB/r3" --config "$SB/install.conf"
  assert_eq "$RC" 2 "password di config"; assert_not_contains "$OUT" "$_M8_PW"
  printf 'INTERFACE=eth1\nFOO=bar\n' > "$SB/bad.conf"
  _m8_render "$SB/r4" --config "$SB/bad.conf"; assert_eq "$RC" 2; assert_contains "$OUT" "kunci tidak dikenal FOO"
  PXE_INSTALL_ADMIN_PASSWORD="$_M8_PW" _m8_render "$SB/r5" "${_M8_ARGS[@]}"
  assert_eq "$RC" 2 "password lewat env ditolak"; assert_not_contains "$OUT" "$_M8_PW"
}

test_m8_render_dnsmasq_bound() {
  _m8_setup
  _m8_render "$SB/r" "${_M8_ARGS[@]}"
  assert_eq "$RC" 0 "$OUT"
  local c; c="$(cat "$SB/r/dnsmasq.conf")"
  assert_eq "$(grep -c '^interface=' <<<"$c")" 1 "satu interface="
  assert_match "$c" '^interface=eth1$'; assert_match "$c" '^bind-interfaces$'
  assert_match "$c" '^except-interface=lo$'
  assert_match "$c" '^dhcp-range=eth1,10\.10\.10\.100,10\.10\.10\.200,255\.255\.255\.0,1h$'
  assert_match "$c" '^dhcp-option=option:router,10\.10\.10\.254$'
  assert_match "$c" '^dhcp-option=option:dns-server,10\.10\.10\.1$'
  assert_match "$c" '^dhcp-boot=tag:ipxe,http://10\.10\.10\.1/boot/\$\{mac\}\.ipxe\?platform=\$\{platform\}$'
  assert_match "$c" '^dhcp-boot=tag:!ipxe,tag:efi64,snponly\.efi,,10\.10\.10\.1$'
  assert_match "$c" '^tftp-root=/srv/pxe/tftp$'
  assert_no_match "$c" 'pxe0|nat0|pxe\.test|10\.99\.' "sisa nilai lab"
  assert_no_match "$c" '^port=0$' "DNS lokal aktif"
  # DNS bukan server ini -> DNS dnsmasq mati total (port=0), tanpa no-resolv/local.
  _m8_render "$SB/r2" "${_M8_ARGS[@]}" --dns 1.1.1.1,9.9.9.9 --no-dhcp-router
  c="$(cat "$SB/r2/dnsmasq.conf")"
  assert_match "$c" '^port=0$'; assert_no_match "$c" '^(no-resolv|log-queries|local=)'
  assert_match "$c" '^dhcp-option=3$' "tanpa opsi router"
  assert_match "$c" '^dhcp-option=option:dns-server,1\.1\.1\.1,9\.9\.9\.9$'
  # DNS lokal + upstream lain -> server= untuk upstream.
  _m8_render "$SB/r3" "${_M8_ARGS[@]}" --dns 10.10.10.1,1.1.1.1
  assert_match "$(cat "$SB/r3/dnsmasq.conf")" '^server=1\.1\.1\.1$'
}

test_m8_render_vlan() {
  _m8_setup
  _m8_render "$SB/r" "${_M8_ARGS[@]}" --vlan-id 10 --vlan-networks '20:10.20.20.0/24:10.20.20.1;30:10.30.0.0/16:10.30.0.1'
  assert_eq "$RC" 0 "$OUT"
  local c n e x
  c="$(cat "$SB/r/dnsmasq.conf")"
  assert_match "$c" '^interface=pxe10$'; assert_match "$c" '^dhcp-range=pxe10,'
  assert_match "$c" '^dhcp-option=3$' "VLAN default tanpa opsi router"
  n="$(cat "$SB/r/netplan.yaml")"
  assert_contains "$n" "    pxe10:"; assert_contains "$n" "      id: 10"; assert_contains "$n" "      link: eth1"
  assert_contains "$n" "      addresses: [10.10.10.1/24]"
  e="$(cat "$SB/r/pxe-dashboard.env")"
  assert_match "$e" '^PXE_VLAN_NETWORKS=20:10\.20\.20\.0/24:10\.20\.20\.1;30:10\.30\.0\.0/16:10\.30\.0\.1$'
  assert_match "$e" '^PXE_DHCP_INTERFACE=pxe10$'
  x="$(grep -v '^#' "$SB/r/exports")"
  assert_eq "$(grep -c . <<<"$x")" 2 "dua ekspor"
  while IFS= read -r line; do
    assert_contains "$line" "10.10.10.0/24(ro,"; assert_contains "$line" "10.20.20.0/24(ro,"; assert_contains "$line" "10.30.0.0/16(ro,"
    assert_no_match "$line" '[(,]rw[,)]' "read-only"
  done <<<"$x"
  assert_match "$(cat "$SB/r/nfs.conf")" '^host=10\.10\.10\.1$'
  # Tanpa VLAN tidak ada netplan + nama sub-interface kustom.
  _m8_render "$SB/r2" "${_M8_ARGS[@]}"
  assert_no_file "$SB/r2/netplan.yaml"
  _m8_render "$SB/r3" "${_M8_ARGS[@]}" --vlan-id 42 --vlan-iface prov42
  assert_match "$(cat "$SB/r3/dnsmasq.conf")" '^interface=prov42$'
}

test_m8_render_nginx_logmap() {
  _m8_setup
  _m8_render "$SB/r" "${_M8_ARGS[@]}" --admin-allow 192.168.1.0/24,10.0.0.5 --admin-listen 192.168.1.10
  assert_eq "$RC" 0 "$OUT"
  local c tpl; c="$(cat "$SB/r/nginx-site.conf")"; tpl="$INFRA_DIR_UNDER_TEST/server/nginx-pxe.conf"
  assert_match "$c" '^    listen 10\.10\.10\.1:80 default_server;$'
  assert_match "$c" '^    listen 192\.168\.1\.10:80;$'
  assert_eq "$(grep -c '^ *listen ' <<<"$c")" 2 "dua listen"
  assert_eq "$(grep -c 'allow 192.168.1.0/24; # PXE_ADMIN_ALLOW' <<<"$c")" 2 "allowlist di 2 location"
  assert_eq "$(grep -c 'allow 10.0.0.5; # PXE_ADMIN_ALLOW' <<<"$c")" 2
  assert_eq "$(grep -c 'deny all;' <<<"$c")" 2
  assert_no_match "$c" 'allow 10\.99\.0\.1' "allowlist lab"
  # Log map + log_format identik template (DEC-027).
  assert_eq "$(sed -n '/^map \$request_uri \$pxe_log_uri {/,/^}/p' "$SB/r/nginx-site.conf")" \
    "$(sed -n '/^map \$request_uri \$pxe_log_uri {/,/^}/p' "$tpl")" "map log == template"
  assert_eq "$(grep '^log_format pxe ' <<<"$c")" "$(grep '^log_format pxe ' "$tpl")"
  assert_match "$c" '^    access_log /var/log/nginx/pxe-access\.log pxe;$'
  assert_eq "$(python3 -I "$INFRA_TEST_DIR/nginx-logmap.py" "$SB/r/nginx-site.conf" "/login?password=x")" "/login?***" "query tidak dicatat"
  assert_eq "$(python3 -I "$INFRA_TEST_DIR/nginx-logmap.py" "$SB/r/nginx-site.conf" "/boot/52:54:00:99:00:11/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE/user-data")" "/boot/52:54:00:99:00:11/***/user-data" "token disamarkan"
  # /boot dan /media tetap terbuka (tanpa allow/deny di location-nya).
  assert_eq "$(sed -n '/location \/media\//,/}/p;/location \/boot\//,/}/p' "$SB/r/nginx-site.conf" | grep -c 'deny')" 0 "/boot /media terbuka"
}

test_m8_render_env_no_secret() {
  _m8_setup
  _m8_render "$SB/r" "${_M8_ARGS[@]}"
  local e; e="$(cat "$SB/r/pxe-dashboard.env")"
  assert_match "$e" "^PXE_ADMIN_PASSWORD_HASH='@PXE_ADMIN_PASSWORD_HASH@'$" "render tanpa hash nyata"
  assert_no_match "$e" 'scrypt\$[0-9]' "tidak ada hash"
  assert_match "$e" '^PXE_TRUST_PROXY=1$'; assert_match "$e" '^PXE_DNSMASQ_LEASES=/var/lib/misc/dnsmasq\.leases$'
  assert_match "$e" '^PXE_INSECURE_NO_LEASE_CHECK=0$'; assert_match "$e" '^NODE_ENV=production$'
  assert_match "$e" '^PXE_MGMT_CIDR=10\.10\.10\.0/24$'; assert_match "$e" '^PXE_SERVER_IP=10\.10\.10\.1$'
  assert_match "$e" '^PXE_ALLOWED_HOSTS=10\.10\.10\.1$'
  # Nilai lab KVM tidak ikut ke produksi (default .env.example).
  assert_match "$e" '^PXE_JOB_INSTALLING_TIMEOUT_MIN=120$'; assert_match "$e" '^PXE_KERNEL_EXTRA_ARGS=$'
  assert_no_match "$e" '10\.99\.|ttyS0' "sisa nilai lab"
  assert_eq "$(grep -c '^PXE_ADMIN_PASSWORD_HASH=' <<<"$e")" 1
  assert_match "$(cat "$SB/r/pxe-dashboard.service")" '^ExecStart=/opt/pxe-dashboard/node/bin/node server\.js$'
}

test_m8_preflight_refusals() {
  _m8_setup
  local before; before="$(_m8_tree)"
  FAKE_UID=1000 _m8_full; assert_ne "$RC" 0 "non-root"; assert_contains "$OUT" "harus dijalankan sebagai root"
  printf 'ID=ubuntu\nVERSION_ID="22.04"\n' > "$R/etc/os-release"
  _m8_full; assert_ne "$RC" 0 "ubuntu 22.04"; assert_contains "$OUT" "hanya Ubuntu 24.04"
  printf 'ID=debian\nVERSION_ID="12"\n' > "$R/etc/os-release"
  _m8_full; assert_ne "$RC" 0 "debian"
  printf 'ID=ubuntu\nVERSION_ID="24.04"\n' > "$R/etc/os-release"
  before="$(_m8_tree)"
  _m8_full --interface eth9; assert_ne "$RC" 0 "NIC hilang"; assert_contains "$OUT" "NIC eth9 tidak ada"
  _m8_full --address 10.10.10.5/24 --dhcp-range 10.10.10.100-10.10.10.200; assert_ne "$RC" 0 "alamat belum di NIC"
  assert_contains "$OUT" "belum memiliki alamat 10.10.10.5/24"
  _m8_full --admin-listen 172.16.0.9; assert_ne "$RC" 0; assert_contains "$OUT" "--admin-listen 172.16.0.9"
  _m8_full --iso-ubuntu /nope/u.iso; assert_ne "$RC" 0; assert_contains "$OUT" "ISO /nope/u.iso"
  # Port bentrok (apache di 0.0.0.0:80; dnsmasq default wildcard tanpa bind-interfaces).
  cp "$FAKE_STATE/ss" "$SB/ss.ok"
  echo 'tcp LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:(("apache2",pid=7,fd=4))' >> "$FAKE_STATE/ss"
  _m8_full; assert_ne "$RC" 0; assert_contains "$OUT" "port bentrok"; assert_contains "$OUT" "apache2"
  cp "$SB/ss.ok" "$FAKE_STATE/ss"
  echo 'udp UNCONN 0 0 0.0.0.0:67 0.0.0.0:* users:(("dnsmasq",pid=8,fd=4))' >> "$FAKE_STATE/ss"
  _m8_full; assert_ne "$RC" 0 "dnsmasq wildcard asing"; assert_contains "$OUT" "port bentrok"
  cp "$SB/ss.ok" "$FAKE_STATE/ss"
  # DHCP lain di segmen -> tolak; probe gagal -> tolak.
  FAKE_DHCP_RC=1 FAKE_DHCP_OUT="OFFER server=10.10.10.77 yiaddr=10.10.10.150" _m8_full
  assert_ne "$RC" 0 "DHCP asing"; assert_contains "$OUT" "DHCP server lain terdeteksi"; assert_contains "$OUT" "10.10.10.77"
  assert_match "$(cat "$FAKE_LOG")" '^dhcp-probe .*--iface eth1 .*--ignore 10\.10\.10\.1' "probe di NIC terpilih, offer sendiri diabaikan"
  FAKE_DHCP_RC=2 FAKE_DHCP_OUT="socket error" _m8_full; assert_ne "$RC" 0 "probe gagal"
  assert_eq "$(_m8_mutations)" "" "penolakan preflight tanpa mutasi"
  assert_eq "$(_m8_tree)" "$before" "penolakan preflight tanpa perubahan file"
  # --force-dhcp melanjutkan (dry-run).
  FAKE_DHCP_RC=1 FAKE_DHCP_OUT="OFFER server=10.10.10.77 yiaddr=10.10.10.150" _m8_install "${_M8_ARGS[@]}" --dry-run --force-dhcp --admin-password-file "$SB/admin.pass" --release "$SB/release.tar.xz"
  assert_eq "$RC" 0 "--force-dhcp: $OUT"; assert_contains "$OUT" "PERINGATAN: DHCP server lain terdeteksi"
  # Non-interaktif tanpa --yes ditolak.
  _m8_install "${_M8_ARGS[@]}" --admin-password-file "$SB/admin.pass" --release "$SB/release.tar.xz"
  assert_ne "$RC" 0; assert_contains "$OUT" "butuh --yes"
  # File password yang bisa dibaca group/other ditolak.
  chmod 0644 "$SB/admin.pass"; _m8_full; assert_ne "$RC" 0; assert_contains "$OUT" "harus mode 0600/0400"
  assert_eq "$(_m8_mutations)" "" "tanpa mutasi"
}

test_m8_dry_run_no_changes() {
  _m8_setup
  local before; before="$(_m8_tree)"
  _m8_install "${_M8_ARGS[@]}" --dry-run --admin-password-file "$SB/admin.pass" --release "$SB/release.tar.xz" \
    --iso-ubuntu /dev/sr0 --firewall 2>/dev/null || true
  # /dev/sr0 tidak ada di sandbox -> ditolak; ulang dengan ISO file.
  : > "$R/srv-ubuntu.iso"
  _m8_install "${_M8_ARGS[@]}" --dry-run --admin-password-file "$SB/admin.pass" --release "$SB/release.tar.xz" \
    --iso-ubuntu /srv-ubuntu.iso --firewall
  assert_eq "$RC" 0 "$OUT"
  before="$(_m8_tree)"
  _m8_install "${_M8_ARGS[@]}" --dry-run --admin-password-file "$SB/admin.pass" --release "$SB/release.tar.xz" \
    --iso-ubuntu /srv-ubuntu.iso --firewall
  assert_eq "$RC" 0 "$OUT"
  assert_eq "$(_m8_tree)" "$before" "dry-run tidak mengubah file"
  assert_eq "$(_m8_mutations)" "" "dry-run tanpa mutasi"
  assert_match "$OUT" '^DRY-RUN: apt-get update$'
  assert_match "$OUT" '^DRY-RUN: env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends dnsmasq nginx nfs-kernel-server ipxe .*nftables$'
  assert_match "$OUT" '^DRY-RUN: useradd --system --user-group --home-dir /var/lib/pxe-dashboard --no-create-home --shell /usr/sbin/nologin pxe$'
  assert_match "$OUT" '^DRY-RUN: curl -fsSL --proto =https --tlsv1\.2 -o .* https://nodejs\.org/dist/v22\.99\.0/node-v22\.99\.0-linux-x64\.tar\.xz$'
  assert_match "$OUT" '^DRY-RUN: tulis /etc/pxe-dashboard\.env \(mode 0640 root:pxe\)$'
  assert_match "$OUT" '^DRY-RUN: tulis /etc/dnsmasq\.d/pxe-dashboard\.conf '
  assert_match "$OUT" '^DRY-RUN: tambah ke /etc/fstab: /srv-ubuntu\.iso /srv/pxe/media/ubuntu-24\.04 iso9660 loop,ro,nofail'
  assert_match "$OUT" '^DRY-RUN: systemctl restart dnsmasq\.service$'
  assert_match "$OUT" '^DRY-RUN: systemctl enable pxe-dashboard-firewall\.service$'
  assert_match "$OUT" '^MANIFEST\+ file /etc/pxe-dashboard\.env$'
  assert_match "$OUT" '^MANIFEST\+ tree /opt/pxe-dashboard$'
  assert_match "$OUT" '^MANIFEST\+ restore-link /etc/nginx/sites-enabled/default /etc/nginx/sites-available/default$'
  assert_match "$OUT" '^DRY-RUN: hash password admin \(stdin\)'
  assert_match "$OUT" 'DRY-RUN: verifikasi: GET http://10\.10\.10\.1/login == 200'
  _m8_no_secret
}

test_m8_full_install_env_manifest() {
  _m8_setup
  _m8_full
  assert_eq "$RC" 0 "$OUT"
  local env="$R/etc/pxe-dashboard.env" mf
  assert_file "$env"
  assert_eq "$(stat -c '%a' "$env")" 640 "mode env"
  assert_match "$(cat "$FAKE_LOG")" "^chown root:pxe $R/etc/\.pxe-install\." "env root:pxe"
  assert_match "$(cat "$env")" "^PXE_ADMIN_PASSWORD_HASH='scrypt\\\$15\\\$8\\\$1\\\$" "hash scrypt di env"
  assert_eq "$(grep -c '^PXE_ADMIN_PASSWORD_HASH=' "$env")" 1
  assert_not_contains "$(cat "$env")" "@PXE_ADMIN_PASSWORD_HASH@"
  # Password ke admin-hash lewat stdin, tidak di argv; hash tidak dicetak.
  assert_eq "$(cat "$FAKE_STATE/node.stdin")" "$_M8_PW" "password via stdin"
  assert_match "$(grep '^node ' "$FAKE_LOG")" '^node .*/dashboard/scripts/admin-hash\.mjs$'
  assert_not_contains "$OUT" "c2VjcmV0aGFzaHZhbHVl" "hash tidak tercetak"
  _m8_no_secret
  # Konfigurasi terpasang di path installer.
  assert_match "$(cat "$R/etc/dnsmasq.d/pxe-dashboard.conf")" '^interface=eth1$'
  assert_match "$(cat "$R/etc/dnsmasq.d/pxe-dashboard.conf")" '^bind-interfaces$'
  assert_eq "$(readlink "$R/etc/nginx/sites-enabled/pxe-dashboard")" /etc/nginx/sites-available/pxe-dashboard
  assert_no_file "$R/etc/nginx/sites-enabled/default"
  assert_file "$R/etc/systemd/system/pxe-dashboard.service"
  assert_file "$R/etc/exports.d/pxe-dashboard.exports"; assert_file "$R/etc/nfs.conf.d/pxe-dashboard.conf"
  assert_eq "$(cat "$R/srv/pxe/tftp/snponly.efi")" "efi-dummy" "iPXE dari paket ipxe"
  assert_file "$R/opt/pxe-dashboard/node/bin/node"
  assert_match "$(readlink "$R/opt/pxe-dashboard/current")" '^releases/[0-9]{8}T[0-9]{6}Z$'
  assert_file "$R/opt/pxe-dashboard/current/server.js"
  assert_no_file "$R/usr/sbin/policy-rc.d"
  assert_match "$(cat "$FAKE_LOG")" '^apt-get install -y --no-install-recommends dnsmasq nginx nfs-kernel-server ipxe'
  assert_match "$(cat "$FAKE_LOG")" '^systemctl restart dnsmasq\.service$'
  assert_match "$(cat "$FAKE_LOG")" '^systemctl restart pxe-dashboard\.service$'
  assert_no_match "$(cat "$FAKE_LOG")" '^systemctl stop dnsmasq' "sukses -> dnsmasq tidak dihentikan"
  assert_match "$(cat "$FAKE_LOG")" '^curl .*http://10\.10\.10\.1/login$'
  assert_match "$(cat "$FAKE_LOG")" '^curl .*http://10\.10\.10\.1/api/settings$'
  assert_contains "$OUT" "OK   GET /api/settings tanpa sesi -> 401"
  assert_contains "$OUT" "OK   DHCP dnsmasq listen udp %eth1:67"
  assert_contains "$OUT" "http://10.10.10.1/"
  # Manifest root-only, memuat setiap artefak.
  assert_eq "$(stat -c '%a' "$R/var/lib/pxe-dashboard-installer")" 700
  assert_eq "$(stat -c '%a' "$R/var/lib/pxe-dashboard-installer/install-manifest")" 600
  mf="$(_m8_mf)"
  local e
  for e in $'file\t/etc/pxe-dashboard.env' $'file\t/etc/dnsmasq.d/pxe-dashboard.conf' $'file\t/etc/nginx/sites-available/pxe-dashboard' \
    $'link\t/etc/nginx/sites-enabled/pxe-dashboard' $'file\t/etc/systemd/system/pxe-dashboard.service' \
    $'file\t/etc/exports.d/pxe-dashboard.exports' $'file\t/etc/nfs.conf.d/pxe-dashboard.conf' $'file\t/srv/pxe/tftp/snponly.efi' \
    $'tree\t/opt/pxe-dashboard' $'data\t/srv/pxe' $'data\t/var/lib/pxe-dashboard' $'data\t/srv/pxe/media' $'dir\t/srv/pxe/tftp' \
    $'restore-link\t/etc/nginx/sites-enabled/default\t/etc/nginx/sites-available/default' $'unit\tpxe-dashboard.service' \
    $'svc\tdnsmasq.service\tours' $'pkg\tdnsmasq' $'pkg\tipxe' $'user\tpxe' $'file\t/etc/logrotate.d/pxe-dashboard'; do
    grep -qxF -- "$e" <<<"$mf" || grep -qF -- "$e"$'\t' <<<"$mf" || _fail "manifest tanpa: $e"
  done
  assert_eq "$(grep -v '^#' <<<"$mf" | sort | uniq -d)" "" "manifest tanpa duplikat"
}

test_m8_rerun_idempotent() {
  _m8_setup
  _m8_full; assert_eq "$RC" 0 "$OUT"
  local mf1 env1; mf1="$(_m8_mf)"; env1="$(cat "$R/etc/pxe-dashboard.env")"
  # Tweak admin pada kunci non-terkelola dipertahankan; kunci jaringan ditimpa installer.
  sed -i 's/^PXE_JOB_HISTORY_PER_HOST=.*/PXE_JOB_HISTORY_PER_HOST=55/; s/^PXE_SERVER_IP=.*/PXE_SERVER_IP=1.2.3.4/' "$R/etc/pxe-dashboard.env"
  : > "$FAKE_LOG"
  export FAKE_DPKG_INSTALLED="dnsmasq nginx nfs-kernel-server ipxe curl ca-certificates xz-utils libarchive-tools python3 iproute2"
  touch "$FAKE_STATE/user-pxe"
  # Ulang TANPA sumber password: hash lama dipakai.
  _m8_install "${_M8_ARGS[@]}" --release "$SB/release.tar.xz" --yes
  assert_eq "$RC" 0 "$OUT"
  assert_contains "$OUT" "tidak berubah"
  assert_eq "$(find "$R/opt/pxe-dashboard/releases" -mindepth 1 -maxdepth 1 | wc -l)" 1 "tanpa rilis baru"
  assert_no_match "$(cat "$FAKE_LOG")" '^apt-get ' "paket sudah ada"
  assert_no_match "$(cat "$FAKE_LOG")" '^useradd ' "user sudah ada"
  assert_no_match "$(cat "$FAKE_LOG")" '^node ' "tanpa hash ulang"
  assert_eq "$(grep '^PXE_ADMIN_PASSWORD_HASH=' "$R/etc/pxe-dashboard.env")" "$(grep '^PXE_ADMIN_PASSWORD_HASH=' <<<"$env1")" "hash dipertahankan"
  assert_match "$(cat "$R/etc/pxe-dashboard.env")" '^PXE_JOB_HISTORY_PER_HOST=55$' "tweak dipertahankan"
  assert_match "$(cat "$R/etc/pxe-dashboard.env")" '^PXE_SERVER_IP=10\.10\.10\.1$' "kunci terkelola ditimpa"
  assert_eq "$(_m8_mf)" "$mf1" "manifest sama (pkg/svc dari install pertama tetap)"
  assert_no_match "$(cat "$FAKE_LOG")" '^systemctl restart dnsmasq' "dnsmasq tidak berubah -> tidak restart"
  # Ketiga kali: tidak ada yang berubah sama sekali -> dashboard tidak di-restart.
  : > "$FAKE_LOG"
  _m8_install "${_M8_ARGS[@]}" --release "$SB/release.tar.xz" --yes
  assert_eq "$RC" 0 "$OUT"
  assert_no_match "$(cat "$FAKE_LOG")" '^systemctl restart pxe-dashboard' "no-op"
  # Rilis baru (tarball berbeda) -> upgrade: rilis kedua + current pindah + restart.
  echo '// v2' >> "$SB/rel/server.js"; tar -C "$SB/rel" -cJf "$SB/release.tar.xz" .
  sleep 1
  : > "$FAKE_LOG"
  _m8_install "${_M8_ARGS[@]}" --release "$SB/release.tar.xz" --yes
  assert_eq "$RC" 0 "$OUT"
  assert_eq "$(find "$R/opt/pxe-dashboard/releases" -mindepth 1 -maxdepth 1 | wc -l)" 2 "rilis baru"
  assert_contains "$(cat "$R/opt/pxe-dashboard/current/server.js")" "// v2"
  assert_match "$(cat "$FAKE_LOG")" '^systemctl restart pxe-dashboard\.service$'
}

test_m8_verify_failure_stops_dnsmasq() {
  _m8_setup
  grep -v '%eth1:67' "$FAKE_STATE/ss" > "$SB/ss" && cp "$SB/ss" "$FAKE_STATE/ss"
  _m8_full
  assert_ne "$RC" 0 "verifikasi harus gagal"
  assert_contains "$OUT" "FAIL dnsmasq tidak listen DHCP udp %eth1:67"
  assert_match "$(cat "$FAKE_LOG")" '^systemctl stop dnsmasq\.service$' "dnsmasq dihentikan"
  # dnsmasq listen di NIC lain -> gagal juga.
  _m8_setup
  echo 'udp UNCONN 0 0 0.0.0.0%eth0:67 0.0.0.0:* users:(("dnsmasq",pid=10,fd=9))' >> "$FAKE_STATE/ss"
  : > "$FAKE_LOG"
  _m8_full
  assert_ne "$RC" 0; assert_contains "$OUT" "FAIL dnsmasq udp 0.0.0.0%eth0:67"
  assert_match "$(cat "$FAKE_LOG")" '^systemctl stop dnsmasq\.service$'
  # /api/settings tanpa sesi bukan 401 -> gagal.
  _m8_fresh
  FAKE_CURL_HTTP=0 _m8_full
  assert_ne "$RC" 0; assert_contains "$OUT" "FAIL GET http://10.10.10.1/login"
}

test_m8_foreign_file_not_overwritten() {
  _m8_setup
  mkdir -p "$R/etc/dnsmasq.d"; echo "# milik admin" > "$R/etc/dnsmasq.d/pxe-dashboard.conf"
  _m8_full
  assert_ne "$RC" 0; assert_contains "$OUT" "bukan milik installer"
  assert_eq "$(cat "$R/etc/dnsmasq.d/pxe-dashboard.conf")" "# milik admin" "file asing utuh"
  assert_eq "$(_m8_mutations)" "" "ditolak di preflight, sebelum perubahan apa pun"
  assert_no_file "$R/var/lib/pxe-dashboard-installer"
  # /opt/pxe-dashboard asing (tidak di manifest) -> ditolak di preflight.
  _m8_setup; rm -f "$R/etc/dnsmasq.d/pxe-dashboard.conf"; mkdir -p "$R/opt/pxe-dashboard"; : > "$FAKE_LOG"
  _m8_full; assert_ne "$RC" 0; assert_contains "$OUT" "/opt/pxe-dashboard sudah ada"
  assert_eq "$(_m8_mutations)" ""
}

test_m8_node_sha_mismatch() {
  _m8_setup
  echo "0000000000000000000000000000000000000000000000000000000000000000  node-v22.99.0-linux-x64.tar.xz" > "$FAKE_STATE/curl-files/SHASUMS256.txt"
  _m8_full
  assert_ne "$RC" 0; assert_contains "$OUT" "SHA256 node-v22.99.0-linux-x64.tar.xz tidak cocok"
  assert_no_file "$R/opt/pxe-dashboard/node/bin/node"
  assert_no_match "$(cat "$FAKE_LOG")" '^systemctl (restart|start) dnsmasq' "dnsmasq tidak start"
  # Versi bukan 22.x ditolak.
  NODE_VERSION=20.1.0 _m8_full; assert_ne "$RC" 0; assert_contains "$OUT" "harus 22.x.y"
}

test_m8_uninstall_keep_then_purge() {
  _m8_setup
  : > "$R/srv-ubuntu.iso"
  _m8_full --iso-ubuntu /srv-ubuntu.iso
  assert_eq "$RC" 0 "$OUT"
  local line; line="/srv-ubuntu.iso /srv/pxe/media/ubuntu-24.04 iso9660 loop,ro,nofail,x-systemd.device-timeout=15s 0 0"
  assert_eq "$(grep -cxF "$line" "$R/etc/fstab")" 1 "baris fstab"
  assert_match "$(cat "$FAKE_LOG")" '^mount /srv/pxe/media/ubuntu-24\.04$'
  # File tidak tercatat + data.
  echo "# admin" > "$R/etc/dnsmasq.d/other.conf"
  echo "# admin tftp" > "$R/srv/pxe/tftp/custom.cfg"
  mkdir -p "$R/var/lib/pxe-dashboard"; echo db > "$R/var/lib/pxe-dashboard/pxe.db"
  echo iso-file > "$R/srv/pxe/media/ubuntu-24.04/marker"
  touch "$FAKE_STATE/user-pxe"
  : > "$FAKE_LOG"
  export FAKE_MOUNTED="$R/srv/pxe/media/ubuntu-24.04"
  _m8_uninstall --dry-run
  assert_eq "$RC" 0 "$OUT"
  assert_file "$R/etc/pxe-dashboard.env"; assert_eq "$(_m8_mutations)" "" "uninstall dry-run tanpa mutasi"
  _m8_uninstall
  assert_ne "$RC" 0 "tanpa --yes non-interaktif ditolak"; assert_file "$R/etc/pxe-dashboard.env"
  export FAKE_ACTIVE=inactive
  : > "$FAKE_STATE/ss"
  _m8_uninstall --yes
  assert_eq "$RC" 0 "$OUT"
  local f
  for f in /etc/pxe-dashboard.env /etc/dnsmasq.d/pxe-dashboard.conf /etc/nginx/sites-available/pxe-dashboard \
    /etc/nginx/sites-enabled/pxe-dashboard /etc/systemd/system/pxe-dashboard.service /etc/exports.d/pxe-dashboard.exports \
    /etc/nfs.conf.d/pxe-dashboard.conf /etc/logrotate.d/pxe-dashboard /opt/pxe-dashboard /srv/pxe/tftp/snponly.efi \
    /etc/systemd/system/dnsmasq.service.d/pxe-dashboard.conf; do
    assert_no_file "$R$f"
  done
  # Tidak tercatat -> utuh; site default dipulihkan; baris fstab lain utuh.
  assert_eq "$(cat "$R/etc/dnsmasq.d/other.conf")" "# admin"
  assert_file "$R/srv/pxe/tftp/custom.cfg"
  assert_eq "$(readlink "$R/etc/nginx/sites-enabled/default")" /etc/nginx/sites-available/default "default dipulihkan"
  assert_eq "$(grep -cxF "$line" "$R/etc/fstab")" 0 "baris fstab installer dihapus"
  assert_contains "$(cat "$R/etc/fstab")" "UUID=abcd / ext4 defaults 0 1"
  assert_file "$R/srv-ubuntu.iso"
  assert_match "$(cat "$FAKE_LOG")" '^umount /srv/pxe/media/ubuntu-24\.04$'
  assert_match "$(cat "$FAKE_LOG")" '^systemctl disable --now pxe-dashboard\.service$'
  assert_match "$(cat "$FAKE_LOG")" '^systemctl stop dnsmasq\.service$'
  assert_match "$(cat "$FAKE_LOG")" '^systemctl disable dnsmasq\.service$' "dnsmasq milik installer dinonaktifkan"
  # Data dipertahankan (default).
  assert_eq "$(cat "$R/var/lib/pxe-dashboard/pxe.db")" db
  assert_file "$R/srv/pxe/media/ubuntu-24.04/marker"
  assert_no_match "$(cat "$FAKE_LOG")" '^(userdel|apt-get) ' "tanpa purge / remove-packages"
  assert_contains "$(_m8_mf)" $'data\t/srv/pxe'
  assert_contains "$(_m8_mf)" $'user\tpxe'
  assert_not_contains "$(_m8_mf)" $'file\t' "entri file sudah dihapus"
  # --purge: data + user dihapus, ISO sumber tetap, manifest hilang.
  : > "$FAKE_LOG"; unset FAKE_MOUNTED
  _m8_uninstall --purge --remove-packages --yes
  assert_eq "$RC" 0 "$OUT"
  assert_no_file "$R/srv/pxe"; assert_no_file "$R/var/lib/pxe-dashboard"
  assert_file "$R/srv-ubuntu.iso"
  assert_match "$(cat "$FAKE_LOG")" '^userdel pxe$'
  assert_match "$(cat "$FAKE_LOG")" '^apt-get purge -y dnsmasq nginx nfs-kernel-server ipxe '
  assert_eq "$(cat "$R/etc/dnsmasq.d/other.conf")" "# admin" "purge pun tidak menyentuh file tak tercatat"
  # Hanya direktori buatan installer yang masih berisi file tak tercatat yang tersisa di manifest.
  assert_eq "$(grep -v '^#' "$R/var/lib/pxe-dashboard-installer/install-manifest")" $'dir\t/etc/dnsmasq.d\t' "sisa manifest"
  rm -f "$R/etc/dnsmasq.d/other.conf"
  _m8_uninstall --yes; assert_eq "$RC" 0 "$OUT"
  assert_no_file "$R/etc/dnsmasq.d"; assert_no_file "$R/var/lib/pxe-dashboard-installer"
  # Uninstall ulang tanpa manifest = no-op.
  : > "$FAKE_LOG"; _m8_uninstall --yes
  assert_eq "$RC" 0; assert_contains "$OUT" "tidak ada yang dihapus"; assert_eq "$(_m8_mutations)" ""
}

test_m8_uninstall_preexisting_packages_kept() {
  _m8_setup
  export FAKE_DPKG_INSTALLED="dnsmasq nginx nfs-kernel-server ipxe curl ca-certificates xz-utils libarchive-tools python3 iproute2"
  _m8_full; assert_eq "$RC" 0 "$OUT"
  assert_contains "$(_m8_mf)" $'svc\tnginx.service\tpre'
  assert_not_contains "$(_m8_mf)" $'pkg\t'
  : > "$FAKE_LOG"; export FAKE_ACTIVE=inactive; : > "$FAKE_STATE/ss"
  _m8_uninstall --yes --remove-packages
  assert_eq "$RC" 0 "$OUT"
  assert_no_match "$(cat "$FAKE_LOG")" '^apt-get ' "paket yang sudah ada sebelum install tidak di-purge"
  assert_match "$(cat "$FAKE_LOG")" '^systemctl reload-or-restart nginx\.service$' "nginx milik admin dimuat ulang, bukan dimatikan"
  assert_no_match "$(cat "$FAKE_LOG")" '^systemctl disable --now nginx'
}

test_m8_uninstall_rejects_bad_manifest() {
  _m8_setup
  _m8_full; assert_eq "$RC" 0 "$OUT"
  local mf="$R/var/lib/pxe-dashboard-installer/install-manifest" before
  echo "victim" > "$R/etc/passwd"
  printf 'file\t/etc/passwd\t\n' >> "$mf"
  before="$(_m8_tree)"; : > "$FAKE_LOG"
  _m8_uninstall --yes
  assert_ne "$RC" 0 "manifest dengan path asing ditolak"; assert_contains "$OUT" "tidak valid"
  assert_eq "$(_m8_tree)" "$before" "tanpa perubahan"; assert_eq "$(_m8_mutations)" ""
  sed -i '$d' "$mf"
  for bad in $'tree\t/etc' $'data\t/home' $'file\t/opt/pxe-dashboard/../../etc/shadow' $'restore-link\t/etc/nginx/sites-enabled/default\t/etc/shadow' $'bogus\t/opt/pxe-dashboard' $'pkg\tlibc6;rm'; do
    cp "$mf" "$SB/mf.ok"; printf '%s\n' "$bad" >> "$mf"
    _m8_uninstall --yes; assert_ne "$RC" 0 "harus ditolak: $bad"
    cp "$SB/mf.ok" "$mf"
  done
  chmod 0662 "$mf"; _m8_uninstall --yes; assert_ne "$RC" 0 "manifest group-writable"; assert_contains "$OUT" "bisa ditulis group/other"
  chmod 0600 "$mf"
  assert_eq "$(_m8_tree)" "$before" "semua penolakan tanpa perubahan"
  FAKE_UID=1000 _m8_uninstall --yes; assert_ne "$RC" 0; assert_contains "$OUT" "harus dijalankan sebagai root"
  _m8_uninstall --bogus; assert_eq "$RC" 2
}

test_m8_vlan_install_dry_run() {
  _m8_setup
  _m8_install "${_M8_ARGS[@]}" --vlan-id 10 --vlan-networks '20:10.20.20.0/24:10.20.20.1' --dry-run \
    --admin-password-file "$SB/admin.pass" --release "$SB/release.tar.xz"
  assert_eq "$RC" 0 "$OUT"
  assert_match "$OUT" '^DRY-RUN: tulis /etc/netplan/60-pxe-dashboard\.yaml \(mode 0600 root:root\)$'
  assert_match "$OUT" '^DRY-RUN: netplan apply$'
  # pxe10 belum ada -> probe DHCP SETELAH netplan (sebelum dnsmasq start).
  local log; log="$(cat "$FAKE_LOG")"
  assert_match "$log" '^dhcp-probe .*--iface pxe10 '
  assert_eq "$(_m8_mutations)" ""
  # Sub-interface sudah ada tanpa alamat dan bukan buatan installer -> tolak.
  mkdir -p "$R/sys/class/net/pxe10"
  _m8_install "${_M8_ARGS[@]}" --vlan-id 10 --dry-run --admin-password-file "$SB/admin.pass" --release "$SB/release.tar.xz"
  assert_ne "$RC" 0; assert_contains "$OUT" "pxe10 sudah ada tanpa alamat"
}

test_m8_install_vm_dry_run() {
  export INFRA_DRY_RUN=1 PXE_RUN=m8
  run_infra install-vm.sh up
  assert_eq "$RC" 0 "$OUT"
  local o; o="$(unq "$OUT")"
  assert_match "$o" '^DRY-RUN: virt-install .*--name pxe-test-install '
  assert_match "$o" '--network network=pxe-test,mac=52:54:00:99:01:02,model=virtio'
  assert_match "$o" '--network network=pxe-test-nat,mac=52:54:00:99:01:03,model=virtio'
  assert_match "$o" 'pxe-test-install-seed\.iso,device=disk,bus=virtio,readonly=on'
  assert_match "$o" 'ubuntu-24\.04\.5-live-server-amd64\.iso,device=cdrom,bus=sata,readonly=on'
  assert_match "$o" 'Rocky-9-latest-x86_64-minimal\.iso,device=cdrom,bus=sata,readonly=on'
  assert_match "$o" '^DRY-RUN: qemu-img convert -O qcow2 .*ubuntu-24\.04-server-cloudimg-amd64\.img .*/vms/pxe-test-install\.qcow2$'
  assert_no_match "$o" '--network network=(default|int)' "network terlindungi"
  assert_no_match "$o" 'pxe-provision-root|dnsmasq|nginx' "VM bersih tanpa provisioning lab"
  local n; while IFS= read -r n; do [[ "$n" == pxe-test* || "$n" == XML:* ]] || _fail "nama non pxe-test: $n"; done < <(names_in_mutations "$OUT")
  assert_empty "$(mutating_calls)" "dry-run tanpa mutasi"
  run_infra install-vm.sh down
  assert_eq "$RC" 0 "$OUT"
  assert_match "$(unq "$OUT")" '^DRY-RUN: rm -f .*/vms/pxe-test-install\.qcow2 .*/vms/pxe-test-install-seed\.iso$'
  run_infra install-vm.sh bogus; assert_ne "$RC" 0
  # Server lab berjalan (IP sama) -> up ditolak.
  unset INFRA_DRY_RUN
  mkdir -p "$FAKE_STATE/dom"; echo running > "$FAKE_STATE/dom/pxe-test-server"
  run_infra install-vm.sh up
  assert_ne "$RC" 0
  assert_empty "$(mutating_calls)" "ditolak tanpa mutasi"
}

test_m8_readme_documents_installer() {
  local r; r="$(awk '/^## Deploy/,/^## Topologi VLAN/' "$REPO_UNDER_TEST/README.md")"
  assert_contains "$r" "./install.sh"; assert_contains "$r" "./uninstall.sh"
  assert_contains "$r" "--purge"; assert_contains "$r" "--dry-run"; assert_contains "$r" "--admin-password-file"
  # Contoh config yang dirujuk README valid dan tanpa password.
  _m8_render "$SB/r" --config "$REPO_UNDER_TEST/deploy/install.conf.example"
  assert_eq "$RC" 0 "$OUT"; assert_match "$(cat "$SB/r/dnsmasq.conf")" '^interface=eth1$'
  assert_no_match "$(cat "$REPO_UNDER_TEST/deploy/install.conf.example")" '^ADMIN_PASSWORD=' "tanpa password"
}

t "M8 install/uninstall: sintaks, set -euo pipefail, tanpa set -x, probe selftest, Node dipin" test_m8_static
t "M8 install: argumen invalid/password di argv ditolak (exit 2) tanpa mutasi"   test_m8_args_rejected
t "M8 install: --config < env < flag; password di config/env ditolak"           test_m8_config_env_precedence
t "M8 render: dnsmasq interface= NIC + bind-interfaces, tanpa sisa lab, DNS"      test_m8_render_dnsmasq_bound
t "M8 render: VLAN (sub-interface, netplan, PXE_VLAN_NETWORKS, ekspor ro)"       test_m8_render_vlan
t "M8 render: nginx listen/allowlist + log map tanpa query (DEC-027)"           test_m8_render_nginx_logmap
t "M8 render: env tanpa rahasia, trust proxy + lease, nilai produksi"           test_m8_render_env_no_secret
t "M8 preflight: non-root/OS salah/NIC hilang/port/DHCP asing ditolak"          test_m8_preflight_refusals
t "M8 install --dry-run: rencana lengkap tanpa perubahan apa pun"                test_m8_dry_run_no_changes
t "M8 install penuh (sandbox): env 0640 root:pxe tanpa plaintext, manifest"     test_m8_full_install_env_manifest
t "M8 install ulang: idempoten (no-op), tweak env dipertahankan, upgrade rilis" test_m8_rerun_idempotent
t "M8 verifikasi gagal -> dnsmasq dihentikan, exit != 0"                        test_m8_verify_failure_stops_dnsmasq
t "M8 install: file/dir asing tidak pernah ditimpa"                             test_m8_foreign_file_not_overwritten
t "M8 install: SHA256 Node tidak cocok -> batal"                                test_m8_node_sha_mismatch
t "M8 uninstall: hanya isi manifest, data tetap; --purge hapus data + user"     test_m8_uninstall_keep_then_purge
t "M8 uninstall: paket/layanan yang sudah ada sebelum install dipertahankan"    test_m8_uninstall_preexisting_packages_kept
t "M8 uninstall: manifest rusak/asing/group-writable & non-root ditolak"        test_m8_uninstall_rejects_bad_manifest
t "M8 install VLAN dry-run: netplan + probe DHCP di sub-interface"              test_m8_vlan_install_dry_run
t "M8 install-vm.sh: VM bersih pxe-test-install (dry-run), down, tolak bentrok" test_m8_install_vm_dry_run
t "M8 README §Deploy + contoh config install.sh/uninstall.sh"                   test_m8_readme_documents_installer

# ---------------------------------------------------------------------------------------------
# Perbaikan temuan KVM M8 (iterasi 1). Setiap test merah bila perbaikannya di-revert
# (.agent/runs/m8/mutation-dev-fix.txt).

# Temuan 1: NIC bernama pxe0 / domain pxe.test sah (cek sisa lab per baris, bukan per kata).
test_m8_fix_nic_pxe0_allowed() {
  _m8_setup
  _m8_render "$SB/r" --interface pxe0 --address 10.99.0.2/24 --dhcp-range 10.99.0.100-10.99.0.200 \
    --gateway 10.99.0.1 --dns 10.99.0.2 --admin-allow 10.99.0.1 --domain pxe.test
  assert_eq "$RC" 0 "$OUT"
  local c; c="$(cat "$SB/r/dnsmasq.conf")"
  assert_match "$c" '^interface=pxe0$'; assert_match "$c" '^dhcp-range=pxe0,10\.99\.0\.100,'
  assert_match "$c" '^domain=pxe\.test$'; assert_no_match "$c" '^except-interface=nat0$'
  # NIC nat0 pun sah; baris lab except-interface=nat0 tetap dibuang.
  _m8_render "$SB/r2" --interface nat0 --address 10.99.0.2/24 --dhcp-range 10.99.0.100-10.99.0.200 \
    --gateway 10.99.0.1 --dns 10.99.0.2 --admin-allow 10.99.0.1
  assert_eq "$RC" 0 "$OUT"; assert_eq "$(grep -v '^#' "$SB/r2/dnsmasq.conf" | grep -c 'nat0')" 2 "interface= + dhcp-range saja"
}

# Temuan 2: ss satu-protokol mencetak 6 kolom (tanpa Netid); parser menerima kedua format.
_m8_ss6() { # ubah fixture ss 7 kolom -> 6 kolom (format `ss -lunpH` / `ss -ltnpH`)
  sed -E 's/^(tcp|udp) +//' "$FAKE_STATE/ss" > "$SB/ss6" && cp "$SB/ss6" "$FAKE_STATE/ss"
}
test_m8_fix_ss_formats() {
  _m8_setup
  _m8_ss6
  assert_match "$(head -1 "$FAKE_STATE/ss")" '^UNCONN 0 0 ' "fixture 6 kolom"
  _m8_full
  assert_eq "$RC" 0 "6 kolom: $OUT"
  assert_contains "$OUT" "OK   DHCP dnsmasq listen udp %eth1:67"
  assert_contains "$OUT" "OK   dnsmasq udp 10.10.10.1:53"
  assert_no_match "$(cat "$FAKE_LOG")" '^systemctl stop dnsmasq'
  # Format nyata Ubuntu 24.04 (spasi lebar, beberapa proses, proses berspasi) — 7 kolom.
  cat > "$FAKE_STATE/ss" <<'SS'
udp   UNCONN 0      0          10.10.10.1:53        0.0.0.0:*    users:(("dnsmasq",pid=1460,fd=6))
udp   UNCONN 0      0      0.0.0.0%eth1:67        0.0.0.0:*    users:(("dnsmasq",pid=1460,fd=4))
udp   UNCONN 0      0         127.0.0.54:53        0.0.0.0:*    users:(("systemd-resolve",pid=578,fd=16))
udp   UNCONN 0      0            0.0.0.0:111       0.0.0.0:*    users:(("rpcbind",pid=14624,fd=5),("systemd",pid=1,fd=77))
tcp   LISTEN 0      511        10.10.10.1:80        0.0.0.0:*    users:(("nginx",pid=124390,fd=6),("nginx",pid=124389,fd=6))
tcp   LISTEN 0      511         127.0.0.1:3000      0.0.0.0:*    users:(("next-server (v1",pid=30,fd=20))
SS
  : > "$FAKE_LOG"
  _m8_install "${_M8_ARGS[@]}" --release "$SB/release.tar.xz" --yes
  assert_eq "$RC" 0 "7 kolom nyata: $OUT"
  # Bentrok port juga terdeteksi dari format 6 kolom.
  _m8_ss6
  echo 'LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:(("apache2",pid=7,fd=4))' >> "$FAKE_STATE/ss"
  _m8_install "${_M8_ARGS[@]}" --release "$SB/release.tar.xz" --yes
  assert_ne "$RC" 0; assert_contains "$OUT" "port bentrok"; assert_contains "$OUT" "apache2"
}

# Temuan 3: install ulang dengan ISO ter-mount (ro, diekspor) tidak chmod/chown mountpoint.
test_m8_fix_rerun_with_mounted_media() {
  _m8_setup
  : > "$R/srv-ubuntu.iso"
  _m8_full --iso-ubuntu /srv-ubuntu.iso; assert_eq "$RC" 0 "$OUT"
  export FAKE_MOUNTED="$R/srv/pxe/media/ubuntu-24.04" FAKE_RO="$R/srv/pxe/media/ubuntu-24.04"
  : > "$FAKE_LOG"
  _m8_full --iso-ubuntu /srv-ubuntu.iso
  assert_eq "$RC" 0 "rerun dengan ISO ter-mount: $OUT"
  assert_no_match "$(cat "$FAKE_LOG")" "^chown .* $R/srv/pxe/media/ubuntu-24\.04$" "mountpoint tidak di-chown"
  assert_no_match "$(cat "$FAKE_LOG")" '^mount ' "sudah ter-mount -> tidak mount ulang"
  assert_match "$(cat "$FAKE_LOG")" "^chown root:root $R/srv/pxe/media/rocky-9$" "direktori biasa tetap dirapikan"
}

# Temuan 4: setelah --purge tanpa --remove-packages, paket tercatat tetap milik installer.
test_m8_fix_pkg_ownership_after_purge() {
  _m8_setup
  _m8_full; assert_eq "$RC" 0 "$OUT"
  export FAKE_ACTIVE=inactive; : > "$FAKE_STATE/ss"
  _m8_uninstall --purge --yes; assert_eq "$RC" 0 "$OUT"
  assert_contains "$(_m8_mf)" $'pkg\tnginx\trequested'
  unset FAKE_ACTIVE; _m8_setup
  : > "$FAKE_LOG"
  _m8_full; assert_eq "$RC" 0 "install ulang: $OUT"
  assert_no_match "$(cat "$FAKE_LOG")" '^apt-get install' "paket masih terpasang"
  local m; m="$(_m8_mf)"
  assert_contains "$m" $'svc\tnginx.service\tours'; assert_contains "$m" $'svc\tdnsmasq.service\tours'
  assert_contains "$m" $'svc\tnfs-server.service\tours'
  export FAKE_ACTIVE=inactive; : > "$FAKE_STATE/ss"; : > "$FAKE_LOG"
  _m8_uninstall --yes; assert_eq "$RC" 0 "$OUT"
  assert_match "$(cat "$FAKE_LOG")" '^systemctl disable --now nginx\.service$'
  assert_match "$(cat "$FAKE_LOG")" '^systemctl disable dnsmasq\.service$'
  assert_match "$(cat "$FAKE_LOG")" '^systemctl disable --now nfs-server\.service$'
  # Entri svc 'pre' lama yang keliru (pkg tercatat) dikoreksi saat install ulang.
  unset FAKE_ACTIVE; _m8_setup
  printf 'svc\tnginx.service\tpre\n' >> "$R/var/lib/pxe-dashboard-installer/install-manifest"
  _m8_full; assert_eq "$RC" 0 "$OUT"
  assert_contains "$(_m8_mf)" $'svc\tnginx.service\tours'; assert_not_contains "$(_m8_mf)" $'svc\tnginx.service\tpre'
}

# Kecil (a): ISO Debian sebagai perangkat blok -> modul diekstrak dari mountpoint.
_m8_initrd() { # _m8_initrd <out.gz> <kver> <rel...>
  local out="$1" kver="$2" root p; shift 2
  root="$(mktemp -d "$SB/initrd.XXXXXX")"
  for p in "$@"; do mkdir -p "$root/lib/modules/$kver/$(dirname "$p")"; printf 'ko %s\n' "$p" > "$root/lib/modules/$kver/$p"; done
  (cd "$root" && bsdtar --format newc -cf - .) | gzip -c > "$out"
}
test_m8_fix_debian_modules_device() {
  _m8_setup
  local k=6.1.0-50-amd64 h="$INFRA_DIR_UNDER_TEST/server/debian-disk-modules.sh" out rc=0
  mkdir -p "$SB/dvd/install.amd" "$SB/nb"
  _m8_initrd "$SB/dvd/install.amd/initrd.gz" "$k" kernel/drivers/block/virtio_blk.ko kernel/drivers/scsi/virtio_scsi.ko
  _m8_initrd "$SB/nb/initrd.gz" "$k" kernel/drivers/net/virtio_net.ko
  echo kernel > "$SB/nb/linux"
  # Script: direktori ISO ter-mount diterima.
  out="$("$h" "$SB/dvd" "$SB/nb/initrd.gz" "$SB/mods" 2>&1)" || rc=$?
  assert_eq "$rc" 0 "$out"; assert_eq "$out" "$k"
  assert_file "$SB/mods/$k/virtio_blk.ko"
  # install.sh: --iso-debian /dev/sr1 (perangkat, ter-mount di /srv/pxe/media/debian-12).
  mkdir -p "$R/dev" "$R/srv/pxe/media/debian-12/install.amd"; : > "$R/dev/sr1"
  cp "$SB/dvd/install.amd/initrd.gz" "$R/srv/pxe/media/debian-12/install.amd/initrd.gz"
  export FAKE_MOUNTED="$R/srv/pxe/media/debian-12"
  _m8_full --iso-debian /dev/sr1 --debian-netboot "$SB/nb"
  assert_eq "$RC" 0 "$OUT"
  assert_eq "$(cat "$R/srv/pxe/media/debian-netboot/modules/$k/virtio_blk.ko")" "ko kernel/drivers/block/virtio_blk.ko"
  assert_contains "$OUT" "modul disk Debian $k"
  assert_match "$(grep -F '/dev/sr1 ' "$R/etc/fstab")" '^/dev/sr1 /srv/pxe/media/debian-12 iso9660 ro,nofail' "perangkat tanpa loop"
}

# Kecil (b): install ulang dengan password yang sama -> hash lama dipertahankan, tanpa restart.
test_m8_fix_same_password_keeps_hash() {
  _m8_setup
  _m8_full; assert_eq "$RC" 0 "$OUT"
  local env1; env1="$(cat "$R/etc/pxe-dashboard.env")"
  : > "$FAKE_LOG"; rm -f "$FAKE_STATE/node.stdin"
  FAKE_VERIFY_RC=0 _m8_full
  assert_eq "$RC" 0 "$OUT"
  assert_contains "$OUT" "hash yang ada dipertahankan"
  assert_eq "$(cat "$R/etc/pxe-dashboard.env")" "$env1" "env tidak ditulis ulang"
  assert_no_match "$(cat "$FAKE_LOG")" '^node .*admin-hash\.mjs' "tidak di-hash ulang"
  assert_no_match "$(cat "$FAKE_LOG")" '^systemctl restart pxe-dashboard' "tanpa restart"
  # Verifikasi lewat stdin (hash lama + password), bukan argv.
  assert_eq "$(head -1 "$FAKE_STATE/node-verify.stdin")" "$_M8_HASH"
  assert_eq "$(tail -n +2 "$FAKE_STATE/node-verify.stdin")" "$_M8_PW"
  assert_match "$(grep '^node ' "$FAKE_LOG")" '^node .*/deploy/admin-verify\.mjs$'
  _m8_no_secret
  # Password berbeda -> hash baru.
  : > "$FAKE_LOG"
  FAKE_VERIFY_RC=1 _m8_full; assert_eq "$RC" 0 "$OUT"
  assert_match "$(cat "$FAKE_LOG")" '^node .*admin-hash\.mjs$'
}

# Paritas admin-verify.mjs dengan admin-hash.mjs (node asli, tanpa jaringan).
test_m8_fix_admin_verify_parity() {
  local node h rc
  node="$(PATH=/usr/bin:/bin:/usr/local/bin command -v node)" || _fail "node tidak ada (dibutuhkan dashboard)"
  h="$(printf '%s' "$_M8_PW" | "$node" "$REPO_UNDER_TEST/dashboard/scripts/admin-hash.mjs")"
  assert_match "$h" '^scrypt\$15\$8\$1\$'
  rc=0; printf '%s\n%s' "$h" "$_M8_PW" | "$node" "$REPO_UNDER_TEST/deploy/admin-verify.mjs" || rc=$?; assert_eq "$rc" 0 "cocok"
  rc=0; printf '%s\n%s\n' "$h" "$_M8_PW" | "$node" "$REPO_UNDER_TEST/deploy/admin-verify.mjs" || rc=$?; assert_eq "$rc" 0 "akhiran baris dibuang"
  rc=0; printf '%s\n%s' "$h" "${_M8_PW}x" | "$node" "$REPO_UNDER_TEST/deploy/admin-verify.mjs" || rc=$?; assert_eq "$rc" 1 "tidak cocok"
  rc=0; printf 'scrypt$99$8$1$x$y\n%s' "$_M8_PW" | "$node" "$REPO_UNDER_TEST/deploy/admin-verify.mjs" || rc=$?; assert_eq "$rc" 2 "format"
  rc=0; printf '%s' "$h" | "$node" "$REPO_UNDER_TEST/deploy/admin-verify.mjs" || rc=$?; assert_eq "$rc" 2 "tanpa password"
}

# Kecil (c): unit berhenti normal saat stop (exit 143).
test_m8_fix_unit_success_exit() {
  _m8_setup
  _m8_render "$SB/r" "${_M8_ARGS[@]}"
  assert_match "$(cat "$SB/r/pxe-dashboard.service")" '^SuccessExitStatus=143$'
  assert_match "$(cat "$INFRA_DIR_UNDER_TEST/server/pxe-dashboard.service")" '^SuccessExitStatus=143$' "template lab"
}

# Kecil (d): --remove-packages mem-purge paket yang diminta + dependensi yang autoremovable saja.
test_m8_fix_remove_packages_deps() {
  _m8_setup
  export FAKE_DPKG_INSTALLED="openssh-server" FAKE_APT_DEPS="nginx-common rpcbind"
  _m8_full; assert_eq "$RC" 0 "$OUT"
  local m; m="$(_m8_mf)"
  assert_contains "$m" $'pkg\tnginx-common\tdep'; assert_contains "$m" $'pkg\trpcbind\tdep'
  assert_contains "$m" $'pkg\tnginx\trequested'; assert_not_contains "$m" $'pkg\topenssh-server'
  export FAKE_ACTIVE=inactive FAKE_AUTOREMOVE="nginx-common libfoo"; : > "$FAKE_STATE/ss"; : > "$FAKE_LOG"
  _m8_uninstall --yes --remove-packages; assert_eq "$RC" 0 "$OUT"
  assert_match "$(cat "$FAKE_LOG")" '^apt-get purge -y dnsmasq nginx nfs-kernel-server ipxe '
  assert_match "$(cat "$FAKE_LOG")" '^apt-get purge -y nginx-common$' "dep autoremovable di-purge"
  assert_no_match "$(cat "$FAKE_LOG")" '^apt-get purge.*(rpcbind|libfoo|openssh-server)' "dep yang masih dipakai / paket asing tidak disentuh"
  assert_no_match "$(cat "$FAKE_LOG")" '^apt-get (-y )?autoremove' "tanpa autoremove global"
  assert_contains "$(_m8_mf)" $'pkg\trpcbind\tdep' "dep tersisa tetap tercatat"
  assert_match "$(cat "$FAKE_LOG")" '^systemctl disable --now nginx\.service$'
}

# Kecil (e): install gagal -> unit yang di-enable run ini dinonaktifkan lagi.
test_m8_fix_failed_install_rollback_enable() {
  _m8_setup
  grep -v '%eth1:67' "$FAKE_STATE/ss" > "$SB/ss" && cp "$SB/ss" "$FAKE_STATE/ss"
  _m8_full
  assert_ne "$RC" 0
  local l; l="$(grep '^systemctl disable --now' "$FAKE_LOG" || true)"
  assert_contains "$l" "dnsmasq.service"; assert_contains "$l" "nginx.service"
  assert_contains "$l" "nfs-server.service"; assert_contains "$l" "pxe-dashboard.service"
  # Server kedua: unit sudah enabled + paket sudah ada sebelum run -> tidak disentuh saat gagal.
  export FAKE_ENABLED=enabled FAKE_DPKG_INSTALLED="dnsmasq nginx nfs-kernel-server ipxe curl ca-certificates xz-utils libarchive-tools python3 iproute2"
  _m8_fresh
  grep -v '%eth1:67' "$FAKE_STATE/ss" > "$SB/ss" && cp "$SB/ss" "$FAKE_STATE/ss"
  _m8_full
  assert_ne "$RC" 0
  assert_no_match "$(cat "$FAKE_LOG")" '^systemctl disable' "unit milik admin tetap enabled"
}

t "M8 fix1: --interface pxe0 / --domain pxe.test sah (cek sisa lab per baris)"   test_m8_fix_nic_pxe0_allowed
t "M8 fix2: ss 6 kolom (tanpa Netid) & 7 kolom nyata diparse benar"              test_m8_fix_ss_formats
t "M8 fix3: install ulang dengan ISO ter-mount ro tidak chmod/chown mountpoint"  test_m8_fix_rerun_with_mounted_media
t "M8 fix4: paket tercatat tetap milik installer setelah --purge"                 test_m8_fix_pkg_ownership_after_purge
t "M8 fix-a: ISO Debian perangkat blok -> modul dari mountpoint"                  test_m8_fix_debian_modules_device
t "M8 fix-b: password sama -> hash lama dipertahankan, tanpa restart"             test_m8_fix_same_password_keeps_hash
t "M8 fix-b: admin-verify.mjs paritas dengan admin-hash.mjs (node asli)"          test_m8_fix_admin_verify_parity
t "M8 fix-c: unit SuccessExitStatus=143 (template + render)"                      test_m8_fix_unit_success_exit
t "M8 fix-d: --remove-packages purge diminta + dep autoremovable saja"            test_m8_fix_remove_packages_deps
t "M8 fix-e: install gagal -> enablement unit run ini di-rollback"                test_m8_fix_failed_install_rollback_enable
