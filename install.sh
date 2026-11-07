#!/usr/bin/env bash
# install.sh — pasang PXE server (dnsmasq DHCP/TFTP, iPXE, nginx, NFS ro, media ISO) + dashboard
# PXEdeck di server Ubuntu 24.04 sungguhan (M8, DEC-029). Jalankan sebagai root dari checkout repo.
#
# Idempoten: dijalankan ulang = upgrade (rilis dashboard baru bila sumber/tarball berubah) atau no-op.
# Semua file/direktori/unit/mount/paket yang dibuat dicatat di manifest
# /var/lib/pxe-dashboard-installer/install-manifest; uninstall.sh hanya menghapus isi manifest.
# Password admin hanya dibaca dari prompt tanpa echo / stdin / file 0600, di-hash scrypt lewat stdin
# (dashboard/scripts/admin-hash.mjs) dan tidak pernah ada di argv, log, atau file selain hash di
# /etc/pxe-dashboard.env (root:pxe 0640). Lihat `install.sh --help` dan README §Deploy.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/deploy/lib.sh"
source "$DEPLOY_DIR/render.sh"

usage() {
  cat <<'EOF'
Pakai: sudo ./install.sh [opsi]          (interaktif bila dijalankan di terminal)
       sudo ./install.sh --config FILE --yes [opsi]
       ./install.sh --render DIR [opsi]  (hanya render konfigurasi ke DIR, tanpa root)

Jaringan (wajib):
  --interface NIC          NIC provisioning (topologi VLAN: NIC induk/trunk)
  --address IP/PREFIX      alamat server di segmen PXE, mis. 10.10.10.1/24
  --dhcp-range A-B         range DHCP dinamis, mis. 10.10.10.100-10.10.10.200
  --gateway IP             gateway subnet PXE (PXE_MGMT_GATEWAY)
  --dns IP[,IP]            DNS untuk node; memuat alamat server = dnsmasq melayani DNS lokal
  --admin-allow CIDR[,..]  IP/CIDR yang boleh membuka UI + /api (allowlist nginx)
Opsional:
  --domain NAME            domain DHCP/DNS lokal (default pxe.lan)
  --no-dhcp-router         jangan kirim opsi router lewat DHCP (default: kirim; VLAN: tidak)
  --admin-user NAME        username admin dashboard (default pxeadmin)
  --admin-password-file F  file berisi password admin (mode 0600/0400, baris pertama)
  --admin-password-stdin   baca password admin dari stdin (satu baris)
  --admin-listen IP[,IP]   alamat server tambahan untuk UI admin (nginx listen + Host diizinkan)
  --allowed-hosts H[,H]    nama host tambahan untuk header Host (mis. FQDN server)
  --vlan-id N              VLAN PXE ber-tag: buat sub-interface di atas --interface
  --vlan-iface NAME        nama sub-interface VLAN (default pxe<N>)
  --vlan-networks SPEC     PXE_VLAN_NETWORKS "<vlan>:<cidr>:<gateway>[;...]"
  --iso-ubuntu PATH        ISO/perangkat Ubuntu 24.04 live-server -> /srv/pxe/media/ubuntu-24.04
  --iso-debian PATH        ISO/perangkat Debian 12 DVD-1           -> /srv/pxe/media/debian-12
  --iso-rocky PATH         ISO/perangkat Rocky 9                    -> /srv/pxe/media/rocky-9
  --debian-netboot auto|none|DIR  kernel/initrd netboot Debian (auto = unduh dari deb.debian.org)
  --release FILE           tarball rilis dari deploy/build-release.sh (default: build dari dashboard/)
  --node-tarball FILE      tarball Node resmi (offline); tetap diverifikasi SHA256
  --firewall               pasang tabel nftables pxe_dashboard di NIC PXE (opt-in)
  --rebuild                build/pasang rilis baru walau sumber tidak berubah
  --force-dhcp             lanjut walau DHCP server lain terdeteksi di segmen
  --config FILE            file KEY=VALUE (kunci = nama opsi huruf besar, '-' -> '_', mis. DHCP_RANGE)
  --dry-run                tampilkan rencana tanpa mengubah apa pun
  -y, --yes                non-interaktif, setujui konfirmasi
  --non-interactive        jangan pernah bertanya (nilai wajib harus lengkap)
Env: PXE_INSTALL_<KUNCI> (mis. PXE_INSTALL_INTERFACE). Prioritas: config < env < opsi.
EOF
}
usage_err() { printf '[pxe-install] ERROR: %s (lihat --help)\n' "$*" >&2; exit 2; }

KEYS=(INTERFACE ADDRESS DHCP_RANGE GATEWAY DNS DOMAIN DHCP_ROUTER ADMIN_USER ADMIN_ALLOW ADMIN_LISTEN
  ALLOWED_HOSTS VLAN_ID VLAN_IFACE VLAN_NETWORKS ISO_UBUNTU ISO_DEBIAN ISO_ROCKY DEBIAN_NETBOOT RELEASE
  NODE_TARBALL FIREWALL ADMIN_PASSWORD_FILE)
REQUIRED=(INTERFACE ADDRESS DHCP_RANGE GATEWAY DNS ADMIN_ALLOW)
declare -A CFG=([DOMAIN]=pxe.lan [DHCP_ROUTER]=auto [ADMIN_USER]=pxeadmin [DEBIAN_NETBOOT]=auto [FIREWALL]=no)
declare -A FLAGV=()
is_key() { local k; for k in "${KEYS[@]}"; do [[ "$k" == "$1" ]] && return 0; done; return 1; }

CONFIG_FILE=""; RENDER_DIR=""; FORCE_DHCP=0; YES=0; NONINTERACTIVE=0; PW_STDIN=0; REBUILD=0
while (($#)); do
  a="$1"; shift
  case "$a" in
    -h|--help) usage; exit 0 ;;
    --dry-run) DRY=1 ;;
    --force-dhcp) FORCE_DHCP=1 ;;
    -y|--yes) YES=1 ;;
    --non-interactive) NONINTERACTIVE=1 ;;
    --admin-password-stdin) PW_STDIN=1 ;;
    --rebuild) REBUILD=1 ;;
    --firewall) FLAGV[FIREWALL]=yes ;;
    --no-dhcp-router) FLAGV[DHCP_ROUTER]=no ;;
    --admin-password|--admin-password=*) usage_err "password tidak boleh lewat argumen; pakai prompt, --admin-password-file, atau --admin-password-stdin" ;;
    --config|--render|--[a-z]*)
      name="${a#--}"; val=""; has_val=0
      if [[ "$name" == *=* ]]; then val="${name#*=}"; name="${name%%=*}"; has_val=1; fi
      key="$(tr 'a-z-' 'A-Z_' <<<"$name")"
      [[ "$name" == config || "$name" == render ]] || is_key "$key" || usage_err "opsi tidak dikenal: --$name"
      if ((!has_val)); then (($#)) || usage_err "$a butuh nilai"; val="$1"; shift; fi
      case "$name" in
        config) CONFIG_FILE="$val" ;;
        render) RENDER_DIR="$val" ;;
        *) FLAGV[$key]="$val" ;;
      esac ;;
    *) usage_err "argumen tidak dikenal: $a" ;;
  esac
done

# --- config file (KEY=VALUE, tidak di-source) -> env -> flag ---------------------------------------
if [[ -n "$CONFIG_FILE" ]]; then
  [[ -f "$CONFIG_FILE" && -r "$CONFIG_FILE" ]] || usage_err "file config $CONFIG_FILE tidak terbaca"
  n=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    n=$((n + 1))
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*(#.*)?$ ]] && continue
    [[ "$line" =~ ^[[:space:]]*([A-Z_]+)[[:space:]]*=[[:space:]]*(.*)$ ]] || usage_err "$CONFIG_FILE baris $n: bukan KEY=VALUE"
    k="${BASH_REMATCH[1]}"; v="${BASH_REMATCH[2]}"
    [[ "$k" == ADMIN_PASSWORD ]] && usage_err "$CONFIG_FILE baris $n: password tidak boleh di file config (pakai ADMIN_PASSWORD_FILE)"
    is_key "$k" || usage_err "$CONFIG_FILE baris $n: kunci tidak dikenal $k"
    if [[ "$v" =~ ^\"(.*)\"$ || "$v" =~ ^\'(.*)\'$ ]]; then v="${BASH_REMATCH[1]}"; fi
    CFG[$k]="$v"
  done < "$CONFIG_FILE"
fi
for k in "${KEYS[@]}"; do ev="PXE_INSTALL_$k"; [[ -n "${!ev:-}" ]] && CFG[$k]="${!ev}"; done
[[ -n "${PXE_INSTALL_ADMIN_PASSWORD:-}" ]] && usage_err "PXE_INSTALL_ADMIN_PASSWORD tidak didukung; pakai --admin-password-file/--admin-password-stdin"
for k in "${!FLAGV[@]}"; do CFG[$k]="${FLAGV[$k]}"; done

INTERACTIVE=0
if [[ -z "$RENDER_DIR" ]] && ((!YES && !NONINTERACTIVE && !PW_STDIN && !DRY)) && [[ -t 0 ]]; then INTERACTIVE=1; fi

ask() { # ask <KEY> <prompt> [default]
  local k="$1" q="$2" def="${3:-}" ans
  [[ -n "${CFG[$k]:-}" ]] && return 0
  read -r -p "$q${def:+ [$def]}: " ans || true
  CFG[$k]="${ans:-$def}"
}
if ((INTERACTIVE)); then
  echo "== Konfigurasi PXE server (Enter = nilai default dalam [..]) =="
  ask INTERFACE "NIC provisioning"
  ask VLAN_ID "VLAN PXE ber-tag (kosong = tanpa VLAN)"
  ask ADDRESS "Alamat server IP/PREFIX"
  if [[ -n "${CFG[ADDRESS]:-}" ]] && valid_cidr "${CFG[ADDRESS]}" 8 30; then
    _ip="${CFG[ADDRESS]%/*}"; _base="${_ip%.*}"
    ask DHCP_RANGE "Range DHCP" "$([[ "${CFG[ADDRESS]#*/}" == 24 ]] && echo "$_base.100-$_base.200")"
    ask GATEWAY "Gateway"
    ask DNS "DNS node" "$_ip"
    ask ADMIN_ALLOW "IP/CIDR admin yang boleh membuka dashboard" "$(net_of "$_ip" "${CFG[ADDRESS]#*/}")/${CFG[ADDRESS]#*/}"
  fi
  ask ADMIN_USER "Username admin" pxeadmin
  [[ -n "${CFG[VLAN_ID]:-}" ]] && ask VLAN_NETWORKS "PXE_VLAN_NETWORKS (kosong = tidak ada)"
  ask ISO_UBUNTU "Path ISO Ubuntu 24.04 (kosong = lewati)"
  ask ISO_DEBIAN "Path ISO Debian 12 DVD-1 (kosong = lewati)"
  ask ISO_ROCKY "Path ISO Rocky 9 (kosong = lewati)"
fi

missing=()
for k in "${REQUIRED[@]}"; do [[ -n "${CFG[$k]:-}" ]] || missing+=("--$(tr 'A-Z_' 'a-z-' <<<"$k")"); done
((${#missing[@]} == 0)) || usage_err "nilai wajib belum diisi: ${missing[*]}"

# --- validasi + nilai turunan -------------------------------------------------------------------
split_csv() { local IFS=,; read -r -a _csv <<<"$1"; }
NIC="${CFG[INTERFACE]}"
valid_iface "$NIC" || usage_err "--interface '$NIC' tidak valid"
valid_cidr "${CFG[ADDRESS]}" 8 30 || usage_err "--address '${CFG[ADDRESS]}' harus IPv4/PREFIX (prefix 8-30)"
SERVER_IP="${CFG[ADDRESS]%/*}"; PREFIX="${CFG[ADDRESS]#*/}"
NET="$(net_of "$SERVER_IP" "$PREFIX")"; NET_CIDR="$NET/$PREFIX"; NETMASK="$(prefix2mask "$PREFIX")"
BCAST="$(int2ip $(($(ip2int "$NET") | (0xFFFFFFFF >> PREFIX))))"
[[ "$SERVER_IP" != "$NET" && "$SERVER_IP" != "$BCAST" ]] || usage_err "--address: alamat network/broadcast"
[[ "${CFG[DHCP_RANGE]}" =~ ^([0-9.]+)-([0-9.]+)$ ]] || usage_err "--dhcp-range harus A-B"
RANGE_START="${BASH_REMATCH[1]}"; RANGE_END="${BASH_REMATCH[2]}"
for x in "$RANGE_START" "$RANGE_END"; do
  valid_ipv4 "$x" && in_net "$x" "$NET" "$PREFIX" && [[ "$x" != "$NET" && "$x" != "$BCAST" ]] || usage_err "--dhcp-range: $x bukan alamat host di $NET_CIDR"
done
(($(ip2int "$RANGE_START") <= $(ip2int "$RANGE_END"))) || usage_err "--dhcp-range: awal > akhir"
in_range() { local n; n="$(ip2int "$1")"; ((n >= $(ip2int "$RANGE_START") && n <= $(ip2int "$RANGE_END"))); }
in_range "$SERVER_IP" && usage_err "--dhcp-range memuat alamat server $SERVER_IP"
GATEWAY="${CFG[GATEWAY]}"
valid_ipv4 "$GATEWAY" && in_net "$GATEWAY" "$NET" "$PREFIX" || usage_err "--gateway '$GATEWAY' harus di $NET_CIDR"
in_range "$GATEWAY" && usage_err "--dhcp-range memuat gateway $GATEWAY"
split_csv "${CFG[DNS]}"; DNS_LIST=("${_csv[@]}")
((${#DNS_LIST[@]} >= 1 && ${#DNS_LIST[@]} <= 4)) || usage_err "--dns: 1-4 alamat"
DNS_LOCAL=0
for x in "${DNS_LIST[@]}"; do
  valid_ipv4 "$x" || usage_err "--dns: '$x' bukan IPv4"
  [[ "$x" == "$SERVER_IP" ]] && DNS_LOCAL=1
done
DNS="$(IFS=,; echo "${DNS_LIST[*]}")"
DOMAIN="${CFG[DOMAIN]}"; valid_domain "$DOMAIN" || usage_err "--domain '$DOMAIN' tidak valid"
ADMIN_USER="${CFG[ADMIN_USER]}"; valid_user "$ADMIN_USER" || usage_err "--admin-user '$ADMIN_USER' tidak valid (^[a-z_][a-z0-9_-]{0,31}$)"
split_csv "${CFG[ADMIN_ALLOW]}"; ADMIN_ALLOW_LIST=("${_csv[@]}")
for x in "${ADMIN_ALLOW_LIST[@]}"; do valid_ipv4 "$x" || valid_cidr "$x" 0 32 || usage_err "--admin-allow: '$x' bukan IPv4/CIDR"; done
LISTEN_IPS=("$SERVER_IP")
if [[ -n "${CFG[ADMIN_LISTEN]:-}" ]]; then
  split_csv "${CFG[ADMIN_LISTEN]}"
  for x in "${_csv[@]}"; do
    valid_ipv4 "$x" || usage_err "--admin-listen: '$x' bukan IPv4"
    [[ " ${LISTEN_IPS[*]} " == *" $x "* ]] || LISTEN_IPS+=("$x")
  done
fi
ALLOWED_HOSTS="$(IFS=,; echo "${LISTEN_IPS[*]}")"
if [[ -n "${CFG[ALLOWED_HOSTS]:-}" ]]; then
  split_csv "${CFG[ALLOWED_HOSTS]}"
  for x in "${_csv[@]}"; do [[ "$x" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]{0,252})$ ]] || usage_err "--allowed-hosts: '$x' tidak valid"; ALLOWED_HOSTS+=",$x"; done
fi
VLAN_ID="${CFG[VLAN_ID]:-}"; VLAN_IFACE=""; IFACE="$NIC"
if [[ -n "$VLAN_ID" ]]; then
  [[ "$VLAN_ID" =~ ^[1-9][0-9]{0,3}$ ]] && ((VLAN_ID <= 4094)) || usage_err "--vlan-id harus 1-4094"
  VLAN_IFACE="${CFG[VLAN_IFACE]:-pxe$VLAN_ID}"
  valid_iface "$VLAN_IFACE" || usage_err "--vlan-iface '$VLAN_IFACE' tidak valid"
  [[ "$VLAN_IFACE" != "$NIC" ]] || usage_err "--vlan-iface sama dengan --interface"
  IFACE="$VLAN_IFACE"
elif [[ -n "${CFG[VLAN_IFACE]:-}" ]]; then usage_err "--vlan-iface butuh --vlan-id"
fi
VLAN_NETWORKS="${CFG[VLAN_NETWORKS]:-}"; NFS_CIDRS=("$NET_CIDR")
if [[ -n "$VLAN_NETWORKS" ]]; then
  IFS=';' read -r -a _vn <<<"$VLAN_NETWORKS"
  ((${#_vn[@]} <= 16)) || usage_err "--vlan-networks maks 16 entri"
  for e in "${_vn[@]}"; do
    [[ "$e" =~ ^([0-9]{1,4}):([0-9./]+):([0-9.]+)$ ]] || usage_err "--vlan-networks: entri '$e' bukan <vlan>:<cidr>:<gateway>"
    vid="${BASH_REMATCH[1]}"; vc="${BASH_REMATCH[2]}"; vg="${BASH_REMATCH[3]}"
    ((vid >= 1 && vid <= 4094)) && valid_cidr "$vc" 8 30 && valid_ipv4 "$vg" || usage_err "--vlan-networks: entri '$e' tidak valid"
    c="$(net_of "${vc%/*}" "${vc#*/}")/${vc#*/}"
    [[ "$c" == "$vc" ]] || usage_err "--vlan-networks: '$vc' bukan alamat network"
    in_net "$vg" "${vc%/*}" "${vc#*/}" || usage_err "--vlan-networks: gateway $vg di luar $vc"
    NFS_CIDRS+=("$c")
  done
fi
DHCP_ROUTER="${CFG[DHCP_ROUTER]}"
[[ "$DHCP_ROUTER" == auto ]] && { [[ -n "$VLAN_ID" ]] && DHCP_ROUTER=no || DHCP_ROUTER=yes; }
[[ "$DHCP_ROUTER" =~ ^(yes|no)$ ]] || usage_err "DHCP_ROUTER harus yes|no"
FIREWALL="${CFG[FIREWALL]}"; [[ "$FIREWALL" =~ ^(yes|no)$ ]] || usage_err "FIREWALL harus yes|no"
iso_for() { case "$1" in ubuntu-24.04) echo "${CFG[ISO_UBUNTU]:-}" ;; debian-12) echo "${CFG[ISO_DEBIAN]:-}" ;; rocky-9) echo "${CFG[ISO_ROCKY]:-}" ;; esac; }
for k in ISO_UBUNTU ISO_DEBIAN ISO_ROCKY; do
  [[ -z "${CFG[$k]:-}" ]] || valid_iso_path "${CFG[$k]}" || usage_err "--$(tr 'A-Z_' 'a-z-' <<<"$k") '${CFG[$k]}' harus path absolut tanpa spasi"
done
DEBIAN_NETBOOT="${CFG[DEBIAN_NETBOOT]}"
[[ "$DEBIAN_NETBOOT" =~ ^(auto|none)$ || "$DEBIAN_NETBOOT" == /* ]] || usage_err "--debian-netboot harus auto|none|<dir absolut>"
RELEASE="${CFG[RELEASE]:-}"; NODE_TARBALL="${CFG[NODE_TARBALL]:-}"; PW_FILE="${CFG[ADMIN_PASSWORD_FILE]:-}"
NETPLAN_PARENT=0

# --- mode render (tanpa root) ---------------------------------------------------------------------
if [[ -n "$RENDER_DIR" ]]; then
  render_all "$RENDER_DIR"
  log "konfigurasi dirender ke $RENDER_DIR ($(cd "$RENDER_DIR" && ls | tr '\n' ' '))"
  exit 0
fi

# --- preflight -----------------------------------------------------------------------------------
is_root || die "harus dijalankan sebagai root (sudo ./install.sh)"
osr="$(p /etc/os-release)"
[[ -r "$osr" ]] || die "/etc/os-release tidak ada; hanya Ubuntu 24.04 yang didukung"
os_id="$(sed -n 's/^ID=//p' "$osr" | tr -d '"')"; os_ver="$(sed -n 's/^VERSION_ID=//p' "$osr" | tr -d '"')"
[[ "$os_id" == ubuntu && "$os_ver" == 24.04 ]] || die "OS $os_id $os_ver tidak didukung; hanya Ubuntu 24.04"
[[ -e "$(p "/sys/class/net/$NIC")" ]] || die "NIC $NIC tidak ada (lihat: ip -br link)"
iface_has_addr() { ip -4 -o addr show dev "$1" 2>/dev/null | grep -q " $2/$3 "; }
IFACE_EXISTS=1
if [[ -z "$VLAN_ID" ]]; then
  iface_has_addr "$NIC" "$SERVER_IP" "$PREFIX" || die "NIC $NIC belum memiliki alamat $SERVER_IP/$PREFIX (atur dulu lewat netplan)"
else
  if [[ -e "$(p "/sys/class/net/$VLAN_IFACE")" ]]; then
    manifest_has file "$NETPLAN_FILE" || iface_has_addr "$VLAN_IFACE" "$SERVER_IP" "$PREFIX" \
      || die "$VLAN_IFACE sudah ada tanpa alamat $SERVER_IP/$PREFIX dan bukan buatan installer"
  else
    IFACE_EXISTS=0
  fi
  [[ "$(netplan get "ethernets.$NIC" 2>/dev/null || echo null)" == null ]] && NETPLAN_PARENT=1
fi
for x in "${LISTEN_IPS[@]:1}"; do
  ip -4 -o addr show 2>/dev/null | grep -q " $x/" || die "--admin-listen $x tidak terpasang di interface mana pun"
done
for id in ubuntu-24.04 debian-12 rocky-9; do
  iso="$(iso_for "$id")"; [[ -z "$iso" || -e "$(p "$iso")" ]] || die "ISO $iso ($id) tidak ada"
done
[[ -z "$RELEASE" || -f "$RELEASE" ]] || die "--release $RELEASE tidak ada"
[[ -z "$NODE_TARBALL" || -f "$NODE_TARBALL" ]] || die "--node-tarball $NODE_TARBALL tidak ada"
[[ "$DEBIAN_NETBOOT" != /* || -f "$DEBIAN_NETBOOT/linux" ]] || die "--debian-netboot $DEBIAN_NETBOOT tanpa file linux/initrd.gz"
# File konfigurasi target yang sudah ada tetapi bukan milik installer: tolak sebelum ada perubahan.
targets=("$ENV_FILE" "$DNSMASQ_CONF" "$DNSMASQ_DROPIN" "$NGINX_SITE" "$NGINX_LINK" "$UNIT_FILE" "$EXPORTS_FILE"
  "$NFS_CONF" "$LOGROTATE_FILE" "$TFTP_DIR/snponly.efi" "$TFTP_DIR/undionly.kpxe")
[[ -n "$VLAN_ID" ]] && targets+=("$NETPLAN_FILE")
[[ "$FIREWALL" == yes ]] && targets+=("$FW_FILE" "$FW_UNIT_FILE")
for x in "${targets[@]}"; do
  if [[ -e "$(p "$x")" || -L "$(p "$x")" ]] && ! manifest_owns "$x"; then
    die "$x sudah ada dan bukan milik installer (tidak tercatat di manifest); pindahkan dulu"
  fi
done
if [[ -d "$(p "$APP_DIR")" ]] && ! manifest_has tree "$APP_DIR"; then
  die "$APP_DIR sudah ada tetapi bukan buatan installer ini (tidak ada di manifest); pindahkan dulu"
fi

check_ports() {
  local netid state rq sq local peer proc port addr base dev bad=""
  while read -r netid state rq sq local peer proc; do
    [[ -z "${local:-}" ]] && continue
    port="${local##*:}"; addr="${local%:*}"; base="${addr%%\%*}"; dev=""
    [[ "$addr" == *%* ]] && dev="${addr#*%}"
    case "$netid:$port" in tcp:80|tcp:3000|udp:67|udp:69|tcp:2049|udp:53|tcp:53) ;; *) continue ;; esac
    [[ "$port" == 53 ]] && ((!DNS_LOCAL)) && continue
    [[ -n "$dev" && "$dev" != "$IFACE" ]] && continue
    case "$base" in
      0.0.0.0|'*'|'[::]'|::|"$SERVER_IP") ;;
      127.0.0.1) [[ "$port" == 3000 ]] || continue ;;
      *) [[ " ${LISTEN_IPS[*]} " == *" $base "* && "$port" == 80 ]] || continue ;;
    esac
    case "$port" in
      80) [[ "$proc" == *'"nginx"'* ]] && continue ;;
      3000) [[ "$proc" == *'"node"'* || "$proc" == *'"next-server'* ]] && continue ;;
      67|69|53) [[ "$proc" == *'"dnsmasq"'* && ( "$dev" == "$IFACE" || "$base" == "$SERVER_IP" ) ]] && continue ;;
      2049) [[ -z "${proc:-}" ]] && continue ;;
    esac
    bad+=$'\n'"  $netid $local ${proc:-}"
  done < <(ss -lntupH 2>/dev/null || true)
  [[ -z "$bad" ]] || die "port bentrok dengan proses lain:$bad"
}
check_ports

dhcp_probe() {
  local out rc=0
  log "memeriksa DHCP server lain di $IFACE (DHCPDISCOVER, 6 dtk)"
  out="$(python3 -I "$DEPLOY_DIR/dhcp-probe.py" --iface "$IFACE" --timeout 6 --ignore "$SERVER_IP" 2>&1)" || rc=$?
  case "$rc" in
    0) log "tidak ada DHCP server lain di $IFACE" ;;
    1) if ((FORCE_DHCP)); then warn "DHCP server lain terdeteksi di $IFACE (--force-dhcp):"$'\n'"$out"
       else die "DHCP server lain terdeteksi di $IFACE — dua DHCP di satu segmen bisa memasang ulang mesin yang salah. Matikan DHCP itu atau pakai --force-dhcp:"$'\n'"$out"; fi ;;
    *) if ((FORCE_DHCP)); then warn "probe DHCP gagal (--force-dhcp): $out"
       else die "probe DHCP di $IFACE gagal ($out); pakai --force-dhcp untuk melewati"; fi ;;
  esac
}
((IFACE_EXISTS)) && dhcp_probe

# --- ringkasan + konfirmasi ----------------------------------------------------------------------
cat >&2 <<EOF
== Rencana instalasi PXE dashboard$( ((DRY)) && echo " (DRY-RUN: tidak ada yang diubah)") ==
  NIC DHCP/TFTP : $IFACE$( [[ -n "$VLAN_ID" ]] && echo " (VLAN $VLAN_ID di $NIC)")
  Server        : $SERVER_IP/$PREFIX (subnet $NET_CIDR)
  DHCP          : $RANGE_START-$RANGE_END, gateway $GATEWAY (opsi router: $DHCP_ROUTER), DNS $DNS
  Admin         : $ADMIN_USER, UI dari ${ADMIN_ALLOW_LIST[*]} di http://${LISTEN_IPS[0]}/
  VLAN mgmt     : ${VLAN_NETWORKS:-(tidak ada)}
  Media ISO     : ubuntu=${CFG[ISO_UBUNTU]:--} debian=${CFG[ISO_DEBIAN]:--} rocky=${CFG[ISO_ROCKY]:--}
  Rilis         : ${RELEASE:-build dari $REPO_DIR/dashboard}
  Firewall      : $FIREWALL
EOF
if ((INTERACTIVE)); then
  read -r -p "Lanjutkan instalasi? [y/N] " ans || true
  [[ "$ans" =~ ^[yY]$ ]] || die "dibatalkan"
elif ((!YES && !DRY)); then
  die "mode non-interaktif butuh --yes (atau --dry-run)"
fi

# --- password admin (memori saja) --------------------------------------------------------------
ADMIN_PW=""; OLD_HASH=""
if [[ -f "$(p "$ENV_FILE")" ]]; then
  OLD_HASH="$(sed -n "s/^PXE_ADMIN_PASSWORD_HASH=//p" "$(p "$ENV_FILE")" | tail -n 1)"
  OLD_HASH="${OLD_HASH#\'}"; OLD_HASH="${OLD_HASH%\'}"
  [[ "$OLD_HASH" =~ $SCRYPT_RE ]] || OLD_HASH=""
fi
pw_ok() { local n=${#1}; ((n >= 12 && n <= 256)) && [[ "$1" != *$'\n'* ]]; }
if ((PW_STDIN)); then
  IFS= read -r ADMIN_PW || [[ -n "$ADMIN_PW" ]] || die "password admin dari stdin kosong"
elif [[ -n "$PW_FILE" ]]; then
  [[ -f "$PW_FILE" && ! -L "$PW_FILE" ]] || die "--admin-password-file $PW_FILE tidak ada"
  ((8#$(stat -c '%a' "$PW_FILE") & 8#077)) && die "--admin-password-file $PW_FILE harus mode 0600/0400"
  IFS= read -r ADMIN_PW < "$PW_FILE" || [[ -n "$ADMIN_PW" ]] || die "--admin-password-file kosong"
elif ((INTERACTIVE)); then
  if [[ -n "$OLD_HASH" ]]; then
    read -r -p "Password admin sudah ada. Ganti? [y/N] " ans || true
    [[ "$ans" =~ ^[yY]$ ]] || ans=keep
  fi
  if [[ "${ans:-}" != keep ]]; then
    read -r -s -p "Password admin baru (12-256 karakter): " ADMIN_PW; echo >&2
    read -r -s -p "Ulangi password admin: " pw2; echo >&2
    [[ "$ADMIN_PW" == "$pw2" ]] || die "password tidak sama"
    unset pw2
  fi
fi
ADMIN_PW="${ADMIN_PW%$'\r'}"
if [[ -n "$ADMIN_PW" ]]; then pw_ok "$ADMIN_PW" || die "password admin harus 12-256 karakter"
elif [[ -z "$OLD_HASH" ]]; then die "password admin belum ada: pakai prompt, --admin-password-file, atau --admin-password-stdin"
fi

# --- pembersihan ---------------------------------------------------------------------------------
TMP=""; POLICY_CREATED=0; DNSMASQ_STARTED=0
cleanup() {
  local rc=$?
  ADMIN_PW=""
  [[ -n "$TMP" && -d "$TMP" ]] && rm -rf "$TMP"
  ((POLICY_CREATED)) && rm -f "$(p "$POLICY_RC")"
  if ((rc != 0 && DNSMASQ_STARTED && !DRY)); then
    printf '[pxe-install] GAGAL (exit %s) — menghentikan dnsmasq agar tidak ada DHCP dari instalasi setengah jadi\n' "$rc" >&2
    systemctl stop dnsmasq.service || true
  fi
  exit "$rc"
}
trap cleanup EXIT
TMP="$(mktemp -d "${TMPDIR:-/tmp}/pxe-install.XXXXXX")"

# --- 1. manifest ---------------------------------------------------------------------------------
if ((!DRY)); then
  mkdir -p "$(p "$INSTALLER_DIR")"; chmod 0700 "$(p "$INSTALLER_DIR")"
  [[ -f "$(p "$MANIFEST")" ]] || (umask 077 && printf '# manifest install.sh PXE dashboard — jangan diedit (uninstall.sh)\n' > "$(p "$MANIFEST")")
  chmod 0600 "$(p "$MANIFEST")"
fi
log "manifest: $MANIFEST"

# --- 2. paket apt -----------------------------------------------------------------------------
PKGS=(dnsmasq nginx nfs-kernel-server ipxe curl ca-certificates xz-utils libarchive-tools python3 iproute2)
[[ "$FIREWALL" == yes ]] && PKGS+=(nftables)
pkg_installed() { [[ "$(dpkg-query -W -f='${Status}' "$1" 2>/dev/null || true)" == "install ok installed" ]]; }
declare -A PKG_OURS=()
missing_pkgs=()
for x in "${PKGS[@]}"; do pkg_installed "$x" || missing_pkgs+=("$x"); done
for x in dnsmasq nginx nfs-kernel-server; do
  [[ " ${missing_pkgs[*]} " == *" $x "* ]] && PKG_OURS[$x]=ours || PKG_OURS[$x]=pre
done
if ((${#missing_pkgs[@]})); then
  log "memasang paket: ${missing_pkgs[*]}"
  # Layanan paket baru TIDAK langsung start (policy-rc.d 101): dnsmasq baru boleh jalan setelah
  # konfigurasi terikat NIC terpasang dan diverifikasi.
  if [[ ! -e "$(p "$POLICY_RC")" ]]; then
    if ((DRY)); then echo "DRY-RUN: tulis $POLICY_RC (exit 101, sementara)"
    else printf '#!/bin/sh\n# sementara oleh install.sh PXE dashboard\nexit 101\n' > "$(p "$POLICY_RC")"; chmod 0755 "$(p "$POLICY_RC")"; POLICY_CREATED=1; fi
  else
    warn "$POLICY_RC sudah ada (bukan milik installer); layanan paket baru mungkin langsung start"
  fi
  run apt-get update
  run env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${missing_pkgs[@]}"
  for x in "${missing_pkgs[@]}"; do manifest_add pkg "$x"; done
  if ((POLICY_CREATED)); then rm -f "$(p "$POLICY_RC")"; POLICY_CREATED=0; fi
fi
manifest_add svc dnsmasq.service "${PKG_OURS[dnsmasq]}"
manifest_add svc nginx.service "${PKG_OURS[nginx]}"
manifest_add svc nfs-server.service "${PKG_OURS[nfs-kernel-server]}"

# --- 3. user + direktori -----------------------------------------------------------------------
if ! getent passwd "$PXE_USER" >/dev/null 2>&1; then
  manifest_add user "$PXE_USER"
  run useradd --system --user-group --home-dir "$STATE_DIR" --no-create-home --shell /usr/sbin/nologin "$PXE_USER"
fi
[[ -d "$(p "$STATE_DIR")" ]] || manifest_add data "$STATE_DIR"
[[ -e "$(p "$DNSMASQ_LOG")" ]] || manifest_add data "$DNSMASQ_LOG"
ensure_dir "$SRV" 0755 root:root data
ensure_dir "$TFTP_DIR" 0755 root:root dir
ensure_dir "$BOOT_DIR" 0755 root:root dir
ensure_dir "$MEDIA_DIR" 0755 root:root data
for id in "${MEDIA_IDS[@]}"; do ensure_dir "$MEDIA_DIR/$id" 0755 root:root data; done
if [[ ! -d "$(p "$APP_DIR")" ]]; then manifest_add tree "$APP_DIR"; fi
run mkdir -p "$(p "$RELEASES_DIR")"

# --- 4. iPXE (paket ipxe Ubuntu) -----------------------------------------------------------------
for f in snponly.efi undionly.kpxe; do
  if [[ -f "$(p "$IPXE_SRC/$f")" ]]; then put_file "$(p "$IPXE_SRC/$f")" "$TFTP_DIR/$f" 0644 root:root
  elif ((DRY)); then echo "DRY-RUN: salin $IPXE_SRC/$f -> $TFTP_DIR/$f"; manifest_add file "$TFTP_DIR/$f"
  else die "$IPXE_SRC/$f tidak ada (paket ipxe)"; fi
done

# --- 5. Node 22 (nodejs.org, SHA256) ----------------------------------------------------------
NODE_VERSION="${NODE_VERSION:-$NODE_VERSION_DEFAULT}"
[[ "$NODE_VERSION" =~ ^22\.[0-9]+\.[0-9]+$ ]] || die "NODE_VERSION '$NODE_VERSION' harus 22.x.y"
node_tgz_name="node-v$NODE_VERSION-linux-x64.tar.xz"
node_base="https://nodejs.org/dist/v$NODE_VERSION"
if [[ "$NODE_VERSION" == "$NODE_VERSION_DEFAULT" ]]; then node_sha="$NODE_SHA256_DEFAULT"
elif ((DRY)); then node_sha="(dari $node_base/SHASUMS256.txt)"
else
  curl -fsSL --proto '=https' --tlsv1.2 -o "$TMP/SHASUMS256.txt" "$node_base/SHASUMS256.txt"
  node_sha="$(awk -v f="$node_tgz_name" '$2 == f { print $1 }' "$TMP/SHASUMS256.txt")"
  [[ "$node_sha" =~ ^[0-9a-f]{64}$ ]] || die "$node_tgz_name tidak ada di SHASUMS256.txt"
fi
node_marker="$(p "$NODE_DIR")/.pxe-node-sha256"
if [[ -x "$(p "$NODE_DIR")/bin/node" && -f "$node_marker" && "$(cat "$node_marker")" == "$node_sha" ]]; then
  log "Node $NODE_VERSION sudah terpasang ($NODE_DIR)"
else
  tgz="${NODE_TARBALL:-$TMP/$node_tgz_name}"
  [[ -n "$NODE_TARBALL" ]] || run curl -fsSL --proto '=https' --tlsv1.2 -o "$tgz" "$node_base/$node_tgz_name"
  if ((DRY)); then echo "DRY-RUN: verifikasi sha256 $node_tgz_name == $node_sha; ekstrak ke $NODE_DIR"
  else
    got="$(sha256sum "$tgz" | cut -d' ' -f1)"
    [[ "$got" == "$node_sha" ]] || die "SHA256 $node_tgz_name tidak cocok (dapat $got, harus $node_sha)"
    rm -rf "$(p "$NODE_DIR").new"; mkdir -p "$(p "$NODE_DIR").new"
    tar -xJf "$tgz" -C "$(p "$NODE_DIR").new" --strip-components=1 --no-same-owner
    rm -rf "$(p "$NODE_DIR")"; mv "$(p "$NODE_DIR").new" "$(p "$NODE_DIR")"
    echo "$node_sha" > "$node_marker"
    log "Node $NODE_VERSION terpasang di $NODE_DIR (sha256 $got)"
  fi
fi

# --- 6. hash admin (password -> stdin node, tidak pernah argv) ---------------------------------
HASH="$OLD_HASH"
if [[ -n "$ADMIN_PW" ]]; then
  if ((DRY)); then echo "DRY-RUN: hash password admin (stdin) dengan $NODE_DIR/bin/node dashboard/scripts/admin-hash.mjs"; HASH="@PXE_ADMIN_PASSWORD_HASH@"
  else
    HASH="$(printf '%s' "$ADMIN_PW" | "$(p "$NODE_DIR")/bin/node" "$REPO_DIR/dashboard/scripts/admin-hash.mjs" 2>/dev/null)" \
      || die "admin-hash gagal (keluaran tidak dicetak)"
    HASH="$(tr -d '\r' <<<"$HASH" | tail -n 1)"
    [[ "$HASH" =~ $SCRYPT_RE ]] || die "admin-hash: keluaran bukan format scrypt (tidak dicetak)"
  fi
  ADMIN_PW=""
fi

# --- 7. rilis dashboard --------------------------------------------------------------------------
RELEASE_CHANGED=0
if [[ -n "$RELEASE" ]]; then
  rel_id="sha256:$(sha256sum "$RELEASE" | cut -d' ' -f1)"
else
  [[ -f "$REPO_DIR/dashboard/package.json" ]] || die "$REPO_DIR/dashboard tidak ada; pakai --release"
  rel_id="src:$(tar -C "$REPO_DIR/dashboard" --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner \
    --exclude=./node_modules --exclude=./.next --exclude=./data --exclude='./.env*' --exclude=./coverage \
    --exclude=./test-results --exclude=./playwright-report -cf - . | sha256sum | cut -d' ' -f1)"
fi
cur_id="$(cat "$(p "$APP_DIR")/current/.pxe-release-id" 2>/dev/null || true)"
if [[ "$cur_id" == "$rel_id" ]] && ((!REBUILD)); then
  log "rilis dashboard tidak berubah ($rel_id) — dilewati"
else
  tarball="$RELEASE"
  if [[ -z "$tarball" ]]; then
    if ((DRY)); then bdir="/var/tmp/pxe-dashboard-build.XXXXXX"
    else bdir="$(mktemp -d "$(p /var/tmp)/pxe-dashboard-build.XXXXXX")"; fi
    log "build dashboard standalone sebagai user $PXE_USER (npm ci + next build) di $bdir"
    run mkdir -p "$bdir/src" "$bdir/home"
    if ((DRY)); then echo "DRY-RUN: salin $REPO_DIR/dashboard -> $bdir/src (tanpa node_modules/.next/data/.env*)"
    else
      tar -C "$REPO_DIR/dashboard" --exclude=./node_modules --exclude=./.next --exclude=./data --exclude='./.env*' \
        --exclude=./coverage -cf - . | tar -C "$bdir/src" -xf - --no-same-owner
      cp "$DEPLOY_DIR/build-release.sh" "$bdir/build-release.sh"
    fi
    run chown -R "$PXE_USER:$PXE_USER" "$bdir"
    run runuser -u "$PXE_USER" -- env -i HOME="$bdir/home" npm_config_cache="$bdir/home/.npm" \
      PATH="$NODE_DIR/bin:/usr/bin:/bin" bash "$bdir/build-release.sh" "$bdir/src" "$bdir/release.tar.xz"
    tarball="$bdir/release.tar.xz"
  fi
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  rel="$RELEASES_DIR/$ts"
  if ((DRY)); then echo "DRY-RUN: ekstrak rilis ke $rel, symlink $APP_DIR/current -> releases/$ts"
  else
    mkdir -p "$(p "$rel")"
    tar -xJf "$tarball" -C "$(p "$rel")" --no-same-owner
    [[ -f "$(p "$rel")/server.js" ]] || { rm -rf "$(p "$rel")"; die "tarball rilis tanpa server.js di akar"; }
    leaked="$(find "$(p "$rel")" \( -name '*.db' -o -name '*.sqlite' -o -name '.env*' \) -not -path '*/node_modules/*' -print -quit)"
    [[ -z "$leaked" ]] || { rm -rf "$(p "$rel")"; die "rilis memuat artefak terlarang: ${leaked#"$ROOT"}"; }
    chown -R root:root "$(p "$rel")"
    mkdir -p "$(p "$rel")/.next/cache"; chown "$PXE_USER:$PXE_USER" "$(p "$rel")/.next/cache"
    echo "$rel_id" > "$(p "$rel")/.pxe-release-id"
    ln -sfn "releases/$ts" "$(p "$APP_DIR")/current.new"
    mv -T "$(p "$APP_DIR")/current.new" "$(p "$APP_DIR")/current"
    [[ -z "${bdir:-}" ]] || rm -rf "$bdir"
    log "rilis $rel aktif"
    # Simpan 3 rilis terbaru (selain current).
    cur="$(readlink "$(p "$APP_DIR")/current")"
    mapfile -t olds < <(find "$(p "$RELEASES_DIR")" -mindepth 1 -maxdepth 1 -type d -name '20*T*Z' -printf '%f\n' | sort -r | tail -n +4)
    for o in "${olds[@]}"; do [[ "releases/$o" == "$cur" ]] || rm -rf "$(p "$RELEASES_DIR")/$o"; done
  fi
  RELEASE_CHANGED=1
fi

# --- 8. konfigurasi ----------------------------------------------------------------------------
old_env=""; [[ -f "$(p "$ENV_FILE")" ]] && old_env="$(p "$ENV_FILE")"
render_all "$TMP/r" "${HASH:-@PXE_ADMIN_PASSWORD_HASH@}" "$old_env"
((DRY)) || ! grep -q '@PXE_ADMIN_PASSWORD_HASH@' "$TMP/r/pxe-dashboard.env" || die "hash admin belum terisi"

CHANGED=0
ensure_dir /etc/dnsmasq.d 0755 root:root dir
put_file "$TMP/r/dnsmasq.conf" "$DNSMASQ_CONF" 0644 root:root
ensure_dir "$DNSMASQ_DROPIN_DIR" 0755 root:root dir
put_file "$TMP/r/dnsmasq-dropin.conf" "$DNSMASQ_DROPIN" 0644 root:root
DNSMASQ_CHANGED=$CHANGED

CHANGED=0
put_file "$TMP/r/nginx-site.conf" "$NGINX_SITE" 0644 root:root
ensure_link "$NGINX_LINK" "$NGINX_SITE"
if [[ -L "$(p "$NGINX_DEFAULT_LINK")" ]]; then
  # Site default nginx listen 0.0.0.0:80; dipulihkan uninstall.sh.
  manifest_add restore-link "$NGINX_DEFAULT_LINK" "$NGINX_DEFAULT_SITE"
  run rm -f "$(p "$NGINX_DEFAULT_LINK")"
  CHANGED=1
fi
NGINX_CHANGED=$CHANGED

CHANGED=0
put_file "$TMP/r/pxe-dashboard.env" "$ENV_FILE" 0640 "root:$PXE_USER"
put_file "$TMP/r/pxe-dashboard.service" "$UNIT_FILE" 0644 root:root
APP_CHANGED=$CHANGED

CHANGED=0
ensure_dir /etc/exports.d 0755 root:root dir
put_file "$TMP/r/exports" "$EXPORTS_FILE" 0644 root:root
ensure_dir /etc/nfs.conf.d 0755 root:root dir
put_file "$TMP/r/nfs.conf" "$NFS_CONF" 0644 root:root
NFS_CHANGED=$CHANGED

put_file "$TMP/r/logrotate" "$LOGROTATE_FILE" 0644 root:root

if [[ -n "$VLAN_ID" ]]; then
  CHANGED=0
  put_file "$TMP/r/netplan.yaml" "$NETPLAN_FILE" 0600 root:root
  if ((CHANGED)) || ((!IFACE_EXISTS)); then
    run netplan generate
    run netplan apply
    if ((!DRY)); then
      for _ in $(seq 1 30); do iface_has_addr "$VLAN_IFACE" "$SERVER_IP" "$PREFIX" && break; sleep 1; done
      iface_has_addr "$VLAN_IFACE" "$SERVER_IP" "$PREFIX" || die "$VLAN_IFACE tidak mendapat $SERVER_IP/$PREFIX setelah netplan apply"
    fi
    DNSMASQ_CHANGED=1
  fi
  ((IFACE_EXISTS)) || dhcp_probe
elif manifest_has file "$NETPLAN_FILE"; then
  warn "$NETPLAN_FILE (VLAN) dari instalasi sebelumnya masih ada; jalankan uninstall.sh untuk mencopotnya"
fi

FW_CHANGED=0
if [[ "$FIREWALL" == yes ]]; then
  CHANGED=0
  ensure_dir "$CONF_DIR" 0755 root:root dir
  put_file "$TMP/r/nftables.nft" "$FW_FILE" 0644 root:root
  put_file "$TMP/r/pxe-dashboard-firewall.service" "$FW_UNIT_FILE" 0644 root:root
  FW_CHANGED=$CHANGED
fi

# --- 9. media ISO (fstab + mount) ---------------------------------------------------------------
fstab_real="$(p "$FSTAB")"
for id in ubuntu-24.04 debian-12 rocky-9; do
  iso="$(iso_for "$id")"; [[ -n "$iso" ]] || continue
  mnt="$MEDIA_DIR/$id"; line="$(fstab_line "$iso" "$id")"
  if ! grep -qxF -- "$line" "$fstab_real" 2>/dev/null; then
    # Mountpoint yang sama milik baris fstab lain (bukan dari installer) -> jangan disentuh.
    other="$(awk -v m="$mnt" '$1 !~ /^#/ && $2 == m' "$fstab_real" 2>/dev/null || true)"
    if [[ -n "$other" ]]; then
      if manifest_has fstab "$mnt"; then die "baris fstab installer untuk $mnt berubah; jalankan uninstall.sh dulu sebelum mengganti ISO"; fi
      die "$mnt sudah dipakai baris fstab lain: $other"
    fi
    manifest_add fstab "$mnt" "$line"
    if ((DRY)); then echo "DRY-RUN: tambah ke $FSTAB: $line"; else printf '%s\n' "$line" >> "$fstab_real"; fi
  else
    manifest_add fstab "$mnt" "$line"
  fi
  manifest_add mount "$mnt"
  mountpoint -q "$(p "$mnt")" 2>/dev/null || run mount "$mnt"
done

# Debian netboot (kernel/initrd d-i) + modul disk virtio dari DVD (infra/server/debian-disk-modules.sh).
if [[ -n "${CFG[ISO_DEBIAN]:-}" && "$DEBIAN_NETBOOT" != none ]]; then
  nb="$MEDIA_DIR/debian-netboot"
  if [[ "$DEBIAN_NETBOOT" == auto ]]; then
    url="https://deb.debian.org/debian/dists/bookworm/main/installer-amd64/current/images"
    if [[ -f "$(p "$nb")/linux" && -f "$(p "$nb")/initrd.gz" ]]; then log "Debian netboot sudah ada di $nb"
    elif ((DRY)); then echo "DRY-RUN: unduh $url/netboot/debian-installer/amd64/{linux,initrd.gz} + SHA256SUMS -> $nb"
    else
      curl -fsSL --proto '=https' --tlsv1.2 -o "$TMP/SHA256SUMS" "$url/SHA256SUMS"
      for f in linux initrd.gz; do
        curl -fsSL --proto '=https' --tlsv1.2 -o "$TMP/$f" "$url/netboot/debian-installer/amd64/$f"
        want="$(awk -v f="./netboot/debian-installer/amd64/$f" '$2 == f { print $1 }' "$TMP/SHA256SUMS")"
        [[ -n "$want" && "$(sha256sum "$TMP/$f" | cut -d' ' -f1)" == "$want" ]] || die "SHA256 Debian netboot $f tidak cocok"
        install -m 0644 "$TMP/$f" "$(p "$nb")/$f"
      done
      log "Debian netboot terpasang di $nb"
    fi
  else
    for f in linux initrd.gz; do run install -m 0644 "$DEBIAN_NETBOOT/$f" "$(p "$nb")/$f"; done
  fi
  if ((DRY)); then echo "DRY-RUN: $TPL_DIR/debian-disk-modules.sh ${CFG[ISO_DEBIAN]} $nb/initrd.gz $nb/modules"
  elif ! kver="$(bash "$TPL_DIR/debian-disk-modules.sh" "$(p "${CFG[ISO_DEBIAN]}")" "$(p "$nb")/initrd.gz" "$(p "$nb")/modules" 2>&1)"; then
    warn "modul disk Debian tidak diekstrak ($kver); install Debian ke disk virtio mungkin gagal"
  else
    log "modul disk Debian $kver di $nb/modules"
  fi
fi

# --- 10. layanan ----------------------------------------------------------------------------------
run dnsmasq --test
run nginx -t
run systemctl daemon-reload
if [[ "$FIREWALL" == yes ]]; then
  manifest_add unit pxe-dashboard-firewall.service
  run systemctl enable pxe-dashboard-firewall.service
  if ((FW_CHANGED)); then run systemctl restart pxe-dashboard-firewall.service; else run systemctl start pxe-dashboard-firewall.service; fi
fi
manifest_add unit pxe-dashboard.service
run systemctl enable dnsmasq.service nginx.service nfs-server.service pxe-dashboard.service
DNSMASQ_STARTED=1
active() { [[ "$(systemctl is-active "$1" 2>/dev/null || true)" == active ]]; }
if ((DNSMASQ_CHANGED)) || ! active dnsmasq.service; then run systemctl restart dnsmasq.service; fi
if ((NFS_CHANGED)) || ! active nfs-server.service; then run systemctl restart nfs-server.service; fi
run exportfs -ra
if ! active nginx.service; then run systemctl restart nginx.service
elif ((NGINX_CHANGED)); then run systemctl reload nginx.service; fi
if ((RELEASE_CHANGED || APP_CHANGED)) || ! active pxe-dashboard.service; then run systemctl restart pxe-dashboard.service
else log "pxe-dashboard tidak berubah — tidak di-restart"; fi

# --- 11. verifikasi ------------------------------------------------------------------------------
verify() {
  local code=000 noauth bad=0 netid state rq sq local peer proc dhcp=0
  for _ in $(seq 1 90); do
    code="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "http://$SERVER_IP/login" 2>/dev/null)" || code=000
    [[ "$code" == 200 ]] && break
    sleep 1
  done
  if [[ "$code" == 200 ]]; then log "OK   GET http://$SERVER_IP/login -> 200"
  else log "FAIL GET http://$SERVER_IP/login -> $code (harus 200)"; bad=1; fi
  noauth="$(curl -sS --max-time 5 -o /dev/null -w '%{http_code}' "http://$SERVER_IP/api/settings" 2>/dev/null)" || noauth=000
  if [[ "$noauth" == 401 ]]; then log "OK   GET /api/settings tanpa sesi -> 401"
  else log "FAIL GET /api/settings tanpa sesi -> $noauth (harus 401)"; bad=1; fi
  for _ in 1 2 3 4 5; do
    ss -lunpH 2>/dev/null | grep -q '"dnsmasq"' && break
    sleep 1
  done
  while read -r netid state rq sq local peer proc; do
    [[ "$proc" == *'"dnsmasq"'* ]] || continue
    if [[ "$local" == "$SERVER_IP:"* || "$local" == *"%$IFACE:"* ]]; then log "OK   dnsmasq udp $local"
    else log "FAIL dnsmasq udp $local (harus $SERVER_IP / %$IFACE)"; bad=1; fi
    [[ "$local" == *"%$IFACE:67" ]] && dhcp=1
  done < <(ss -lunpH 2>/dev/null || true)
  if ((dhcp)); then log "OK   DHCP dnsmasq listen udp %$IFACE:67"
  else log "FAIL dnsmasq tidak listen DHCP udp %$IFACE:67 (ss -lunp)"; bad=1; fi
  while read -r netid state rq sq local peer proc; do
    [[ "$local" == *:3000 ]] || continue
    [[ "$local" == 127.0.0.1:3000 ]] || { log "FAIL dashboard listen $local (harus 127.0.0.1:3000)"; bad=1; }
  done < <(ss -ltnpH 2>/dev/null || true)
  return "$bad"
}
if ((DRY)); then
  echo "DRY-RUN: verifikasi: GET http://$SERVER_IP/login == 200, /api/settings tanpa sesi == 401, ss -lunp: dnsmasq hanya $SERVER_IP/%$IFACE"
else
  verify || die "verifikasi gagal (lihat FAIL di atas; journalctl -u pxe-dashboard -u dnsmasq)"
fi

trap - EXIT
cleanup_ok() { [[ -n "$TMP" && -d "$TMP" ]] && rm -rf "$TMP"; return 0; }
cleanup_ok
cat >&2 <<EOF

== PXE dashboard $( ((DRY)) && echo "(dry-run) ")siap ==
  Dashboard : $(for x in "${LISTEN_IPS[@]}"; do printf 'http://%s/ ' "$x"; done)(login: $ADMIN_USER)
  DHCP/TFTP : dnsmasq hanya di $IFACE ($SERVER_IP)
  Manifest  : $MANIFEST
  Copot     : sudo ./uninstall.sh   (data dipertahankan; --purge untuk menghapus data)
EOF
