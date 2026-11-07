# shellcheck shell=bash
# deploy/render.sh — render konfigurasi server dari template lab infra/server/* (M8, DEC-029 §1).
# Di-source oleh install.sh setelah deploy/lib.sh. Template TIDAK disalin ulang: setiap baris lab yang
# diganti diasersi ada tepat sekali (template berubah -> render gagal keras, bukan diam-diam salah).
#
# Input (global, sudah divalidasi install.sh):
#   IFACE (NIC tempat dnsmasq terikat), NIC (NIC fisik), SERVER_IP, PREFIX, NET_CIDR, NETMASK,
#   RANGE_START, RANGE_END, GATEWAY, DNS (dipisah koma), DOMAIN, DHCP_ROUTER (yes|no),
#   DNS_LOCAL (1 = dnsmasq melayani DNS), LISTEN_IPS[] (nginx), ADMIN_ALLOW_LIST[], ALLOWED_HOSTS,
#   VLAN_ID, VLAN_IFACE, VLAN_NETWORKS, NFS_CIDRS[], FIREWALL (yes|no), NETPLAN_PARENT (1 = parent
#   NIC perlu didefinisikan di netplan installer), NODE_DIR, UPSTREAM_MODE (servers|resolv|none),
#   UPSTREAM_SERVERS[], RESOLV_FILE.

# _expect <file> <regex> <count>: template wajib memuat baris yang cocok tepat <count> kali.
_expect() {
  local n; n="$(grep -cE -- "$2" "$1" || true)"
  [[ "$n" == "$3" ]] || die "template ${1#"$REPO_DIR"/}: pola '$2' muncul $n kali (harus $3) — template berubah?"
}
# _strip_header <file>: buang blok komentar pembuka template (deskripsi khusus lab).
_strip_header() { awk 'f || !/^#/ { f = 1; print }' "$1"; }
_gen_header() { # _gen_header <target> <template>
  printf '# %s — dibuat install.sh (PXE dashboard) dari %s.\n' "$1" "${2#"$REPO_DIR"/}"
  printf '# Jangan diedit manual: ditimpa saat install.sh dijalankan ulang, dihapus uninstall.sh.\n'
}

render_dnsmasq() { # render_dnsmasq <out>
  local tpl="$TPL_DIR/dnsmasq.conf" out="$1" router d
  _expect "$tpl" '^interface=pxe0$' 1
  _expect "$tpl" '^bind-interfaces$' 1
  _expect "$tpl" '^except-interface=lo$' 1
  _expect "$tpl" '^except-interface=nat0$' 1
  _expect "$tpl" '^domain=pxe\.test$' 1
  _expect "$tpl" '^local=/pxe\.test/$' 1
  _expect "$tpl" '^dhcp-range=pxe0,' 1
  _expect "$tpl" '^dhcp-option=option:router,' 1
  _expect "$tpl" '^dhcp-option=option:dns-server,' 1
  _expect "$tpl" '^dhcp-boot=.*10\.99\.0\.2' 3
  if [[ "$DHCP_ROUTER" == yes ]]; then router="dhcp-option=option:router,$GATEWAY"
  else router="dhcp-option=3"; fi
  {
    _gen_header "$DNSMASQ_CONF" "$tpl"
    echo "# HANYA di $IFACE ($SERVER_IP/$PREFIX): interface= + bind-interfaces (DEC-029 §2)."
    _strip_header "$tpl" | sed -E \
      -e "s|^interface=pxe0$|interface=$IFACE|" \
      -e '/^except-interface=nat0$/d' \
      -e "s|^domain=pxe\.test$|domain=$DOMAIN|" \
      -e "s|^local=/pxe\.test/$|local=/$DOMAIN/|" \
      -e "s|^dhcp-range=pxe0,.*$|dhcp-range=$IFACE,$RANGE_START,$RANGE_END,$NETMASK,1h|" \
      -e "s|^dhcp-option=option:router,.*$|$router|" \
      -e "s|^dhcp-option=option:dns-server,.*$|dhcp-option=option:dns-server,$DNS|" \
      -e "/^dhcp-boot=/s|10\.99\.0\.2|$SERVER_IP|g" \
      -e '/^# HANYA di NIC pxe0/d'
    if ((DNS_LOCAL)); then
      # DNS lokal (domain $DOMAIN); nama lain diteruskan ke upstream (CR-8-7): server= eksplisit,
      # resolver host (resolv-file, tanpa no-resolv), atau tidak sama sekali (none = isolasi).
      case "$UPSTREAM_MODE" in
        servers) for d in "${UPSTREAM_SERVERS[@]}"; do echo "server=$d"; done ;;
        resolv) echo "resolv-file=$RESOLV_FILE" ;;
        none) echo "# --dns-upstream none: hanya nama lokal $DOMAIN yang bisa di-resolve node" ;;
      esac
    else
      # Server ini bukan DNS klien (PXE_MGMT_DNS tidak memuatnya): DNS dnsmasq dimatikan total.
      echo "port=0"
    fi
  } > "$out.tmp"
  if ((!DNS_LOCAL)); then sed -i -E '/^(no-resolv|local=\/.*\/|log-queries)$/d' "$out.tmp"
  elif [[ "$UPSTREAM_MODE" == resolv ]]; then sed -i '/^no-resolv$/d' "$out.tmp"; fi
  mv "$out.tmp" "$out"
  # Pasca-render: terikat ke NIC yang dipilih, tanpa sisa nilai lab.
  [[ "$(grep -c '^interface=' "$out")" == 1 ]] && grep -qx "interface=$IFACE" "$out" && grep -qx 'bind-interfaces' "$out" \
    || die "render dnsmasq: interface=/bind-interfaces tidak valid"
  # Sisa baris lab: diperiksa per baris yang seharusnya diganti (bukan nama NIC/domain yang dipilih
  # admin — `--interface pxe0` atau `--domain pxe.test` sah).
  ! grep -qx 'except-interface=nat0' "$out" || die "render dnsmasq: sisa baris lab except-interface=nat0"
  [[ "$(grep -c '^domain=' "$out")" == 1 ]] && grep -qx "domain=$DOMAIN" "$out" || die "render dnsmasq: domain= tidak valid"
  ! grep -qE '^local=' "$out" || grep -qx "local=/$DOMAIN/" "$out" || die "render dnsmasq: local= tidak valid"
  [[ "$(grep -c '^dhcp-range=' "$out")" == 1 ]] && grep -qx "dhcp-range=$IFACE,$RANGE_START,$RANGE_END,$NETMASK,1h" "$out" \
    || die "render dnsmasq: dhcp-range tidak valid"
  [[ "$(grep -c "^dhcp-boot=.*[/,]$SERVER_IP\(/\|\$\)" "$out")" == 3 ]] || die "render dnsmasq: dhcp-boot tidak menunjuk $SERVER_IP"
  grep -qE '^dhcp-option=(3|option:router,'"$GATEWAY"')$' "$out" || die "render dnsmasq: opsi router tidak valid"
  grep -qx "dhcp-option=option:dns-server,$DNS" "$out" || die "render dnsmasq: opsi DNS tidak valid"
}

render_dnsmasq_dropin() { # render_dnsmasq_dropin <out>: tunggu NIC punya alamat (bind-interfaces)
  cat > "$1" <<'EOF'
# Dibuat install.sh (PXE dashboard): dnsmasq bind-interfaces butuh NIC sudah beralamat.
[Unit]
Wants=network-online.target
After=network-online.target
EOF
}

render_nginx() { # render_nginx <out>
  local tpl="$TPL_DIR/nginx-pxe.conf" out="$1" listen="" allow="" ip a
  _expect "$tpl" '^    listen 10\.99\.0\.2:80 default_server;$' 1
  _expect "$tpl" '^        allow [^;]+; # PXE_ADMIN_ALLOW$' 2
  _expect "$tpl" '^map \$request_uri \$pxe_log_uri \{$' 1
  _expect "$tpl" '^log_format pxe ' 1
  for ip in "${LISTEN_IPS[@]}"; do listen+="    listen $ip:80;\\n"; done
  listen="${listen/:80;/:80 default_server;}"
  # Alamat server sendiri + loopback selalu diizinkan (verifikasi install.sh dari server ini; proses
  # lokal sudah bisa menjangkau 127.0.0.1:3000 langsung, jadi tidak ada eksposur tambahan).
  for a in 127.0.0.1 "${LISTEN_IPS[@]}"; do allow+="        allow $a; # PXE_INSTALLER_LOCAL\\n"; done
  for a in "${ADMIN_ALLOW_LIST[@]}"; do allow+="        allow $a; # PXE_ADMIN_ALLOW\\n"; done
  {
    _gen_header "$NGINX_SITE" "$tpl"
    echo "# Listen: $(printf '%s:80 ' "${LISTEN_IPS[@]}")— UI + /api/** hanya untuk: ${ADMIN_ALLOW_LIST[*]} (PXE_ADMIN_ALLOW)."
    echo "# /boot/** dan /media/** terbuka untuk klien PXE. Access log tanpa query string (DEC-027)."
    _strip_header "$tpl" | sed -E \
      -e "s|^    listen 10\.99\.0\.2:80 default_server;$|${listen%\\n}|" \
      -e "s|^        allow [^;]+; # PXE_ADMIN_ALLOW$|${allow%\\n}|"
  } > "$out"
  [[ "$(grep -c '# PXE_ADMIN_ALLOW$' "$out")" == $((2 * ${#ADMIN_ALLOW_LIST[@]})) ]] || die "render nginx: allowlist admin"
  ! grep -q '10\.99\.0\.' "$out" || [[ "${LISTEN_IPS[*]} ${ADMIN_ALLOW_LIST[*]}" == *10.99.0.* ]] || die "render nginx: sisa alamat lab"
}

# render_env <out> <hash|@PXE_ADMIN_PASSWORD_HASH@> <existing-env-file|"">: env dashboard.
# Urutan nilai: template lab (daftar kunci) < default produksi .env.example (kunci yang dituning lab)
# < nilai env lama di server (tweak admin dipertahankan saat upgrade) < nilai yang dikelola installer.
ENV_PROD_DEFAULT_KEYS='PXE_JOB_INSTALLING_TIMEOUT_MIN|PXE_WATCHDOG_INTERVAL_SEC|PXE_KERNEL_EXTRA_ARGS|PXE_SESSION_IDLE_MIN'
render_env() {
  local out="$1" hash="$2" old="${3:-}" tpl="$TPL_DIR/dashboard.env" ex="$REPO_DIR/dashboard/.env.example"
  local -A val=(); local -a order=(); local k v line
  _expect "$tpl" '^PXE_ADMIN_PASSWORD_HASH=@PXE_ADMIN_PASSWORD_HASH@$' 1
  while IFS= read -r line; do
    [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] || continue
    k="${BASH_REMATCH[1]}"; [[ -v "val[$k]" ]] || order+=("$k"); val[$k]="${BASH_REMATCH[2]}"
  done < "$tpl"
  while IFS= read -r line; do
    [[ "$line" =~ ^($ENV_PROD_DEFAULT_KEYS)=(.*)$ ]] && val[${BASH_REMATCH[1]}]="${BASH_REMATCH[2]}"
  done < "$ex"
  if [[ -n "$old" && -f "$old" ]]; then
    while IFS= read -r line; do
      [[ "$line" =~ ^([A-Z][A-Z0-9_]*)=(.*)$ ]] || continue
      k="${BASH_REMATCH[1]}"; [[ -v "val[$k]" ]] || order+=("$k"); val[$k]="${BASH_REMATCH[2]}"
    done < "$old"
  fi
  local -A managed=(
    [NODE_ENV]=production [PXE_DB_PATH]="$STATE_DIR/pxe.db" [PXE_SEED]=empty
    [PXE_MGMT_CIDR]="$NET_CIDR" [PXE_MGMT_GATEWAY]="$GATEWAY" [PXE_MGMT_DNS]="$DNS"
    [PXE_SERVER_IP]="$SERVER_IP" [PXE_DHCP_RANGE]="$RANGE_START-$RANGE_END" [PXE_DHCP_INTERFACE]="$IFACE"
    [PXE_BASE_URL]="http://$SERVER_IP" [PXE_MEDIA_URL]="http://$SERVER_IP/media"
    [PXE_MEDIA_ROOT]="$MEDIA_DIR" [PXE_TFTP_ROOT]="$TFTP_DIR"
    [PXE_DNSMASQ_LEASES]="$LEASE_FILE" [PXE_DNSMASQ_PIDFILE]=/run/dnsmasq/dnsmasq.pid
    [PXE_TRUST_PROXY]=1 [PXE_INSECURE_NO_LEASE_CHECK]=0 [PXE_ALLOWED_HOSTS]="$ALLOWED_HOSTS"
    [PXE_ADMIN_USERNAME]="$ADMIN_USER" [PXE_ADMIN_PASSWORD_HASH]="'$hash'"
  )
  for k in "${!managed[@]}"; do [[ -v "val[$k]" ]] || order+=("$k"); val[$k]="${managed[$k]}"; done
  if [[ -n "$VLAN_NETWORKS" ]]; then
    [[ -v "val[PXE_VLAN_NETWORKS]" ]] || order+=(PXE_VLAN_NETWORKS); val[PXE_VLAN_NETWORKS]="$VLAN_NETWORKS"
  else
    unset 'val[PXE_VLAN_NETWORKS]'
  fi
  unset 'val[PXE_INSECURE_NO_LEASE_CHECK_CONFIRM]'
  {
    printf '# %s — env dashboard PXE, dibuat install.sh (root:%s 0640).\n' "$ENV_FILE" "$PXE_USER"
    printf '# Divalidasi saat start (src/lib/server/settings.ts). Kunci jaringan/admin dikelola installer;\n'
    printf '# kunci lain (timeout job, sesi, rate limit) boleh diubah dan dipertahankan saat install ulang.\n'
    for k in "${order[@]}"; do [[ -v "val[$k]" ]] && printf '%s=%s\n' "$k" "${val[$k]}"; done
  } > "$out"
}

render_unit() { # render_unit <out>
  local tpl="$TPL_DIR/pxe-dashboard.service"
  _expect "$tpl" '^ExecStart=/opt/node/bin/node server\.js$' 1
  _expect "$tpl" '^WorkingDirectory=/opt/pxe-dashboard/current$' 1
  _expect "$tpl" '^EnvironmentFile=/etc/pxe-dashboard\.env$' 1
  { _gen_header "$UNIT_FILE" "$tpl"
    _strip_header "$tpl" | sed -e "s|^ExecStart=/opt/node/bin/node server\.js$|ExecStart=$NODE_DIR/bin/node server.js|"; } > "$1"
}

render_exports() { # render_exports <out>: ekspor NFS read-only untuk subnet PXE (+ VLAN management)
  local tpl="$TPL_DIR/exports"
  _expect "$tpl" '^/srv/pxe/media/ubuntu-24\.04 10\.99\.0\.0/24\(ro,[^)]*\)$' 1
  _expect "$tpl" '^/srv/pxe/media/rocky-9 10\.99\.0\.0/24\(ro,[^)]*\)$' 1
  { _gen_header "$EXPORTS_FILE" "$tpl"
    _strip_header "$tpl" | awk -v cidrs="${NFS_CIDRS[*]}" '
      /^#/ || NF == 0 { print; next }
      { split(cidrs, c, " "); o = $2; sub(/^[^(]*/, "", o); line = $1
        for (i = 1; i in c; i++) line = line " " c[i] o
        print line }'; } > "$1"
  ! grep -qE '(^|[ (])10\.99\.0\.0/24' "$1" || [[ " ${NFS_CIDRS[*]} " == *" 10.99.0.0/24 "* ]] || die "render exports: sisa subnet lab"
  ! grep -vE '^#' "$1" | grep -qE '\((rw|[^)]*,rw)[,)]' || die "render exports: ekspor harus read-only"
}

render_nfs_conf() { # render_nfs_conf <out>: nfsd hanya di SERVER_IP; port mountd tetap (firewall)
  local tpl="$TPL_DIR/nfs.conf"
  _expect "$tpl" '^host=10\.99\.0\.2$' 1
  { _gen_header "$NFS_CONF" "$tpl"
    _strip_header "$tpl" | sed -e "s|^host=10\.99\.0\.2$|host=$SERVER_IP|"
    printf '[mountd]\nport=20048\n'; } > "$1"
}

render_netplan() { # render_netplan <out>: sub-interface VLAN PXE (hanya topologi VLAN)
  {
    printf '# %s — dibuat install.sh: VLAN PXE %s di atas %s.\n' "$NETPLAN_FILE" "$VLAN_ID" "$NIC"
    printf 'network:\n  version: 2\n'
    if ((NETPLAN_PARENT)); then printf '  ethernets:\n    %s:\n      dhcp4: false\n      dhcp6: false\n' "$NIC"; fi
    printf '  vlans:\n    %s:\n      id: %s\n      link: %s\n      addresses: [%s/%s]\n      dhcp4: false\n      dhcp6: false\n      link-local: []\n' \
      "$VLAN_IFACE" "$VLAN_ID" "$NIC" "$SERVER_IP" "$PREFIX"
  } > "$1"
}

render_logrotate() {
  cat > "$1" <<EOF
# Dibuat install.sh (PXE dashboard): log dnsmasq ($DNSMASQ_LOG).
$DNSMASQ_LOG {
    weekly
    rotate 8
    compress
    delaycompress
    missingok
    notifempty
    postrotate
        systemctl kill -s USR2 dnsmasq.service >/dev/null 2>&1 || true
    endscript
}
EOF
}

# Firewall opsional (--firewall): tabel nftables sendiri (tidak mem-flush ruleset lain), hanya
# memfilter koneksi baru di NIC PXE. SSH tetap diizinkan agar admin tidak terkunci.
render_firewall() { # render_firewall <nft-out> <unit-out>
  local dns=""
  ((DNS_LOCAL)) && dns="    iifname \"$IFACE\" meta l4proto { tcp, udp } th dport 53 accept"
  cat > "$1" <<EOF
#!/usr/sbin/nft -f
# $FW_FILE — dibuat install.sh (--firewall). Hanya tabel inet pxe_dashboard; aturan lain tidak diubah.
table inet pxe_dashboard
delete table inet pxe_dashboard
table inet pxe_dashboard {
  chain input {
    type filter hook input priority filter; policy accept;
    iifname "$IFACE" ct state established,related accept
    iifname "$IFACE" icmp type echo-request accept
    iifname "$IFACE" icmpv6 type { nd-neighbor-solicit, nd-neighbor-advert, nd-router-advert, nd-router-solicit, echo-request } accept
    iifname "$IFACE" udp dport { 67, 69 } accept
$dns
    iifname "$IFACE" tcp dport { 22, 80, 111, 2049, 20048 } accept
    iifname "$IFACE" udp dport { 111, 2049, 20048 } accept
    iifname "$IFACE" counter drop
  }
}
EOF
  cat > "$2" <<EOF
# $FW_UNIT_FILE — dibuat install.sh (--firewall).
[Unit]
Description=PXE dashboard nftables guard ($IFACE)
Before=dnsmasq.service nginx.service
After=network-pre.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/nft -f $FW_FILE
ExecStop=/usr/sbin/nft delete table inet pxe_dashboard

[Install]
WantedBy=multi-user.target
EOF
}

# fstab_line <iso-path> <media-id>
fstab_line() {
  local opts="ro,nofail"
  [[ "$1" == /dev/* ]] || opts="loop,ro,nofail"
  printf '%s %s/%s iso9660 %s,x-systemd.device-timeout=15s 0 0' "$1" "$MEDIA_DIR" "$2" "$opts"
}

# render_all <dir>: semua file konfigurasi ke <dir> (dipakai --render dan oleh install).
render_all() {
  local d="$1" hash="${2:-@PXE_ADMIN_PASSWORD_HASH@}" old="${3:-}"
  mkdir -p "$d"
  render_dnsmasq "$d/dnsmasq.conf"
  render_dnsmasq_dropin "$d/dnsmasq-dropin.conf"
  render_nginx "$d/nginx-site.conf"
  render_env "$d/pxe-dashboard.env" "$hash" "$old"
  render_unit "$d/pxe-dashboard.service"
  render_exports "$d/exports"
  render_nfs_conf "$d/nfs.conf"
  render_logrotate "$d/logrotate"
  [[ -n "$VLAN_ID" ]] && render_netplan "$d/netplan.yaml"
  [[ "$FIREWALL" == yes ]] && render_firewall "$d/nftables.nft" "$d/pxe-dashboard-firewall.service"
  local id iso
  : > "$d/fstab.lines"
  for id in ubuntu-24.04 debian-12 rocky-9; do
    iso="$(iso_for "$id")"
    [[ -n "$iso" ]] && { fstab_line "$iso" "$id"; echo; } >> "$d/fstab.lines"
  done
  return 0
}
