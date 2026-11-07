# shellcheck shell=bash
# deploy/lib.sh — helper bersama install.sh / uninstall.sh (M8, DEC-029). Di-source, bukan dieksekusi.
#
# Dijalankan sebagai root di server Ubuntu 24.04 target. Tidak ada `set -x` di mana pun: nilai hash
# admin tidak boleh tercetak, password tidak pernah lewat argv/log/file.
#
# Env khusus test (infra/test/m8.sh), JANGAN diset di production:
#   PXE_INSTALL_ROOT  prefix filesystem (mis. sandbox test). Semua path target (/etc, /opt, /srv,
#                     /var, /sys, /usr/lib/ipxe, os-release) dibaca/ditulis di bawah prefix ini.
#                     Perintah sistem (systemctl, apt-get, ...) tetap dipanggil apa adanya; test
#                     menyediakan versi palsu di PATH.

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$DEPLOY_DIR/.." && pwd)"
TPL_DIR="$REPO_DIR/infra/server"

ROOT="${PXE_INSTALL_ROOT:-}"
if [[ -n "$ROOT" ]]; then
  [[ "$ROOT" == /* && "$ROOT" != / && "$ROOT" != *..* ]] || { echo "PXE_INSTALL_ROOT harus path absolut selain /" >&2; exit 2; }
  ROOT="${ROOT%/}"
fi

# --- path tetap di server target ------------------------------------------------------------
STATE_DIR=/var/lib/pxe-dashboard                       # DB SQLite (StateDirectory unit, milik pxe)
INSTALLER_DIR=/var/lib/pxe-dashboard-installer         # root:root 0700, BUKAN di STATE_DIR (milik pxe)
MANIFEST="$INSTALLER_DIR/install-manifest"
APP_DIR=/opt/pxe-dashboard
NODE_DIR="$APP_DIR/node"
RELEASES_DIR="$APP_DIR/releases"
ENV_FILE=/etc/pxe-dashboard.env
CONF_DIR=/etc/pxe-dashboard
UNIT_FILE=/etc/systemd/system/pxe-dashboard.service
FW_UNIT_FILE=/etc/systemd/system/pxe-dashboard-firewall.service
FW_FILE="$CONF_DIR/nftables.nft"
DNSMASQ_CONF=/etc/dnsmasq.d/pxe-dashboard.conf
DNSMASQ_DROPIN_DIR=/etc/systemd/system/dnsmasq.service.d
DNSMASQ_DROPIN="$DNSMASQ_DROPIN_DIR/pxe-dashboard.conf"
NGINX_SITE=/etc/nginx/sites-available/pxe-dashboard
NGINX_LINK=/etc/nginx/sites-enabled/pxe-dashboard
NGINX_DEFAULT_LINK=/etc/nginx/sites-enabled/default
NGINX_DEFAULT_SITE=/etc/nginx/sites-available/default
EXPORTS_FILE=/etc/exports.d/pxe-dashboard.exports
NFS_CONF=/etc/nfs.conf.d/pxe-dashboard.conf
# 99-: diurutkan SETELAH file netplan admin yang mendefinisikan NIC induk (netplan menolak `link:` ke
# interface yang didefinisikan di file yang diurutkan lebih belakang). 60- = nama lama (iterasi < 3).
NETPLAN_FILE=/etc/netplan/99-pxe-dashboard.yaml
NETPLAN_FILE_OLD=/etc/netplan/60-pxe-dashboard.yaml
LOGROTATE_FILE=/etc/logrotate.d/pxe-dashboard
FSTAB=/etc/fstab
SRV=/srv/pxe
TFTP_DIR="$SRV/tftp"
BOOT_DIR="$SRV/boot"
MEDIA_DIR="$SRV/media"
DNSMASQ_LOG=/var/log/dnsmasq-pxe.log
LEASE_FILE=/var/lib/misc/dnsmasq.leases
IPXE_SRC=/usr/lib/ipxe
POLICY_RC=/usr/sbin/policy-rc.d
PXE_USER=pxe
MEDIA_IDS=(ubuntu-24.04 debian-12 rocky-9 debian-netboot)

# Paket yang boleh dipasang (dan dicatat `pkg ... requested`) oleh installer. Entri `requested` di
# manifest dengan nama lain ditolak (SR-8-4); dependensi (`dep`) tetap di balik simulasi apt.
INSTALLER_PKGS=(dnsmasq nginx nfs-kernel-server ipxe curl ca-certificates xz-utils libarchive-tools python3
  iproute2 nftables gpgv debian-archive-keyring)

# Node 22 LTS resmi (nodejs.org). Versi + SHA256 tarball linux-x64 dipin (sama dengan
# infra/fetch-node.sh; diasersi infra/test/m8.sh). PXE_INSTALL_NODE_VERSION lain -> SHASUMS256.txt
# diunduh (integritas hanya TLS; diperingatkan).
NODE_VERSION_DEFAULT=22.23.4
NODE_SHA256_DEFAULT=1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce

# Format hash admin (DEC-017 §2), sama dengan infra/lib.sh.
SCRYPT_RE='^scrypt\$[0-9]{1,7}\$[0-9]{1,2}\$[0-9]{1,2}\$[A-Za-z0-9+/_=-]{16,}\$[A-Za-z0-9+/_=-]{16,}$'

# Path yang BOLEH dihapus uninstall.sh (lapis kedua terhadap manifest rusak/diubah). Semua entri
# manifest wajib cocok dengan salah satu pola ini; satu saja tidak cocok -> uninstall batal.
# Segmen path: tidak boleh diawali titik (menolak `.`/`..`); bentuk kanonik juga dicek manifest_canonical.
SEG='[A-Za-z0-9_-][A-Za-z0-9._-]*'
ALLOWED_PATH_RE='^(/etc/pxe-dashboard\.env|/etc/pxe-dashboard(/'"$SEG"')*|/etc/dnsmasq\.d|/etc/dnsmasq\.d/pxe-dashboard\.conf|/etc/systemd/system/dnsmasq\.service\.d|/etc/systemd/system/dnsmasq\.service\.d/pxe-dashboard\.conf|/etc/systemd/system/pxe-dashboard(-firewall)?\.service|/etc/nginx/sites-(available|enabled)/pxe-dashboard|/etc/nginx/sites-enabled/default|/etc/exports\.d|/etc/exports\.d/pxe-dashboard\.exports|/etc/nfs\.conf\.d|/etc/nfs\.conf\.d/pxe-dashboard\.conf|/etc/netplan/(60|99)-pxe-dashboard\.yaml|/etc/logrotate\.d/pxe-dashboard|/opt/pxe-dashboard(/'"$SEG"')*|/srv/pxe(/'"$SEG"')*|/var/lib/pxe-dashboard|/var/log/dnsmasq-pxe\.log)$'
# Tree yang boleh dihapus rekursif (rm -rf): hanya aplikasi (tree) dan data (data, --purge).
TREE_RE='^/opt/pxe-dashboard$'
DATA_RE='^(/var/lib/pxe-dashboard|/srv/pxe(/'"$SEG"')*|/var/log/dnsmasq-pxe\.log)$'
MEDIA_MNT_RE='^/srv/pxe/media/[a-z0-9][a-z0-9.-]*$'
# Root yang boleh dihapus rekursif oleh uninstall (setelah path di-resolve, SR-8-1).
RM_ROOTS=(/opt/pxe-dashboard /srv/pxe /var/lib/pxe-dashboard /var/log/dnsmasq-pxe.log)
MANIFEST_TYPES='file|link|dir|tree|data|restore-link|fstab|mount|unit|svc|pkg|user|vlanlink'

DRY=0
log() { printf '[pxe-install] %s\n' "$*" >&2; }
warn() { printf '[pxe-install] PERINGATAN: %s\n' "$*" >&2; }
die() { printf '[pxe-install] ERROR: %s\n' "$*" >&2; exit 1; }

# p <path-target>: path nyata (dengan prefix test bila ada).
p() { printf '%s%s' "$ROOT" "$1"; }

# run <cmd...>: perintah yang mengubah state; di --dry-run hanya dicetak.
run() {
  if ((DRY)); then printf 'DRY-RUN:'; printf ' %q' "$@"; printf '\n'; else "$@"; fi
}

is_root() { [[ "$(id -u)" == 0 ]]; }

# --- unduhan HTTPS (nodejs.org, deb.debian.org) -----------------------------------------------
# Semua unduhan internet installer WAJIB lewat fetch_https (diasersi infra/test/m8.sh): koneksi
# macet tidak boleh menggantung instalasi (gate m8 iter3: install KVM menggantung >17 menit).
#   --connect-timeout 20 s; batalkan bila < 1 KB/s selama 60 s (bukan --max-time tetap, agar tarball
#   besar di link lambat tetap jalan); --max-time per percobaan sebagai batas atas (besar:
#   PXE_INSTALL_DOWNLOAD_TIMEOUT, default 1800 s; kecil: PXE_INSTALL_DOWNLOAD_TIMEOUT_SMALL, default
#   120 s); --retry 3 (jeda 5 s, termasuk koneksi ditolak), tanpa percobaan baru setelah batas atas.
DL_CONNECT_TIMEOUT=20
DL_SPEED_LIMIT=1024
DL_SPEED_TIME=60
DL_RETRY=3
DL_RETRY_DELAY=5
DL_TIMEOUT_LARGE=1800
DL_TIMEOUT_SMALL=120

# download_limits_init: baca + validasi env batas waktu unduhan (detik, 30..86400). Gagal -> return 1
# dengan pesan di DL_ERR.
download_limits_init() {
  local v n
  for n in PXE_INSTALL_DOWNLOAD_TIMEOUT PXE_INSTALL_DOWNLOAD_TIMEOUT_SMALL; do
    v="${!n:-}"
    [[ -z "$v" ]] && continue
    if [[ ! "$v" =~ ^[1-9][0-9]{1,4}$ ]] || ((v < 30 || v > 86400)); then
      DL_ERR="$n '$v' harus bilangan detik 30..86400"; return 1
    fi
    if [[ "$n" == PXE_INSTALL_DOWNLOAD_TIMEOUT ]]; then DL_TIMEOUT_LARGE="$v"; else DL_TIMEOUT_SMALL="$v"; fi
  done
  return 0
}

# fetch_https <url> <out> [small|large]: unduh <url> (https saja, TLS >= 1.2) ke <out> dengan batas
# waktu/retry di atas. Gagal -> <out> dihapus, die dengan URL + exit code curl (trap rollback install.sh
# membersihkan sisanya). Di --dry-run hanya dicetak (lewat run).
fetch_https() {
  local url="$1" out="$2" kind="${3:-small}" max rc=0 why
  [[ "$url" == https://* ]] || die "fetch_https: hanya URL https:// ($url)"
  case "$kind" in
    large) max="$DL_TIMEOUT_LARGE" ;;
    small) max="$DL_TIMEOUT_SMALL" ;;
    *) die "fetch_https: jenis '$kind' tidak dikenal" ;;
  esac
  run curl -fsSL --proto '=https' --tlsv1.2 -o "$out" \
    --connect-timeout "$DL_CONNECT_TIMEOUT" --speed-limit "$DL_SPEED_LIMIT" --speed-time "$DL_SPEED_TIME" \
    --max-time "$max" --retry "$DL_RETRY" --retry-delay "$DL_RETRY_DELAY" --retry-connrefused \
    --retry-max-time "$max" "$url" || rc=$?
  ((rc == 0)) && return 0
  rm -f -- "$out"
  case "$rc" in
    28) why="batas waktu habis: koneksi ${DL_CONNECT_TIMEOUT}s, < ${DL_SPEED_LIMIT} B/s selama ${DL_SPEED_TIME}s, atau total ${max}s" ;;
    6|7) why="host tidak terjangkau" ;;
    22) why="HTTP error" ;;
    35|60) why="TLS gagal" ;;
    *) why="curl gagal" ;;
  esac
  die "unduhan gagal ($why, curl exit $rc, retry maks $DL_RETRY): $url"
}

# ss_sockets: socket listen tcp+udp sebagai baris "<netid> <local> <process...>". Tahan terhadap dua
# format `ss -H`: 7 kolom (Netid State Recv-Q Send-Q Local Peer Process, bila >1 protokol) dan 6 kolom
# tanpa Netid (satu protokol: -u atau -t saja). Netid yang hilang diturunkan dari State
# (UNCONN = udp, LISTEN = tcp). Kolom proses bisa memuat spasi ("next-server (v16)") -> digabung.
ss_sockets() {
  { ss -H -lntup 2>/dev/null || true; } | awk '
    NF == 0 { next }
    { if ($1 ~ /^(tcp|udp|raw|sctp|u_str|u_dgr|u_seq)$/) { n = $1; l = $5; s = 7 }
      else { n = ($1 == "UNCONN") ? "udp" : (($1 == "LISTEN") ? "tcp" : "?"); l = $4; s = 6 }
      pr = ""; for (i = s; i <= NF; i++) pr = pr (pr == "" ? "" : " ") $i
      print n, l, pr }'
}

# --- validasi -----------------------------------------------------------------------------------
valid_ipv4() {
  local ip="$1" o
  [[ "$ip" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]] || return 1
  IFS=. read -r -a _oct <<<"$ip"
  for o in "${_oct[@]}"; do
    [[ "$o" =~ ^(0|[1-9][0-9]{0,2})$ ]] && ((o <= 255)) || return 1
  done
}
ip2int() { local a b c d; IFS=. read -r a b c d <<<"$1"; echo $(((a << 24) | (b << 16) | (c << 8) | d)); }
int2ip() { local n="$1"; echo "$(((n >> 24) & 255)).$(((n >> 16) & 255)).$(((n >> 8) & 255)).$((n & 255))"; }
prefix2mask() { local pfx="$1"; int2ip $(((0xFFFFFFFF << (32 - pfx)) & 0xFFFFFFFF)); }
# net_of <ip> <prefix> -> alamat network
net_of() { local m=$(((0xFFFFFFFF << (32 - $2)) & 0xFFFFFFFF)); int2ip $(($(ip2int "$1") & m)); }
# in_net <ip> <net> <prefix>
in_net() { [[ "$(net_of "$1" "$3")" == "$2" ]]; }
valid_cidr() { # valid_cidr <a.b.c.d/nn> [min] [max]
  local c="$1" min="${2:-0}" max="${3:-32}"
  [[ "$c" == */* ]] || return 1
  valid_ipv4 "${c%/*}" || return 1
  [[ "${c#*/}" =~ ^[0-9]{1,2}$ ]] && ((${c#*/} >= min && ${c#*/} <= max))
}
valid_iface() { [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,14}$ ]]; }
valid_domain() { [[ "$1" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$ ]]; }
valid_user() { [[ "$1" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; }
# Path file/device ISO: absolut, tanpa spasi/karakter khusus fstab.
# Path file/device ISO: absolut kanonik, tanpa spasi/karakter khusus fstab, dan TIDAK di bawah direktori
# yang bisa dihapus installer/uninstall (/srv/pxe, /opt/pxe-dashboard, /var/lib/pxe-dashboard): ISO
# sumber tidak pernah ikut terhapus `--purge` (SR-8-5).
valid_iso_path() {
  [[ "$1" =~ ^/[A-Za-z0-9._/+-]+$ ]] && manifest_canonical "$1" || return 1
  case "$1" in /srv/pxe|/srv/pxe/*|/opt/pxe-dashboard|/opt/pxe-dashboard/*|/var/lib/pxe-dashboard|/var/lib/pxe-dashboard/*) return 1 ;; esac
}
# manifest_canonical <path>: absolut, tanpa `//`, tanpa segmen `.`/`..`, tanpa `/` di akhir (SR-8-1).
manifest_canonical() {
  local x="$1" seg
  [[ "$x" == /* && "$x" != */ && "$x" != *//* ]] || return 1
  IFS=/ read -r -a _segs <<<"${x#/}"
  for seg in "${_segs[@]}"; do [[ -n "$seg" && "$seg" != . && "$seg" != .. ]] || return 1; done
}
pkg_is_installer() { local x; for x in "${INSTALLER_PKGS[@]}"; do [[ "$x" == "$1" ]] && return 0; done; return 1; }

# --- manifest -----------------------------------------------------------------------------------
# Format baris: <type>\t<path>\t<extra>. Ditulis bertahap (setiap entri langsung disimpan) agar
# install yang gagal di tengah tetap bisa di-uninstall.
manifest_valid_line() { # manifest_valid_line <type> <path> <extra>
  local t="$1" path="$2" extra="$3"
  [[ "$t" =~ ^($MANIFEST_TYPES)$ ]] || return 1
  # Semua tipe ber-path: bentuk kanonik dulu (menolak `..`, `//`, `/./`, `/` akhir) sebelum regex.
  case "$t" in unit|svc|pkg|user|vlanlink) ;; *) manifest_canonical "$path" || return 1 ;; esac
  case "$t" in
    unit|svc) [[ "$path" =~ ^(pxe-dashboard|pxe-dashboard-firewall|dnsmasq|nginx|nfs-server)\.service$ ]] ;;
    pkg) [[ "$path" =~ ^[a-z0-9][a-z0-9.+-]+$ && "$extra" =~ ^(requested|dep)$ ]] || return 1
         [[ "$extra" == dep ]] || pkg_is_installer "$path" ;;
    user) [[ "$path" == "$PXE_USER" ]] ;;
    # Sub-interface VLAN yang dibuat installer (netplan): <iface> <parent>:<vlan-id>.
    vlanlink) valid_iface "$path" && [[ "$extra" =~ ^([A-Za-z0-9][A-Za-z0-9_.-]{0,14}):([1-9][0-9]{0,3})$ ]] ;;
    fstab) [[ "$path" =~ $MEDIA_MNT_RE && "$extra" =~ ^(/[A-Za-z0-9._/+-]+)\ (/srv/pxe/media/[a-z0-9.-]+)\ iso9660\ [a-z,=0-9.-]+\ 0\ 0$ ]] || return 1
           [[ "${BASH_REMATCH[2]}" == "$path" ]] && valid_iso_path "${BASH_REMATCH[1]}" ;;
    mount) [[ "$path" =~ $MEDIA_MNT_RE ]] ;;
    restore-link) [[ "$path" == "$NGINX_DEFAULT_LINK" && "$extra" == "$NGINX_DEFAULT_SITE" ]] ;;
    tree) [[ "$path" =~ $TREE_RE ]] ;;
    data) [[ "$path" =~ $DATA_RE ]] ;;
    *) [[ "$path" =~ $ALLOWED_PATH_RE && "$path" != *..* ]] ;;
  esac
}

manifest_has() { # manifest_has <type> <path>
  [[ -f "$(p "$MANIFEST")" ]] || return 1
  awk -F'\t' -v t="$1" -v q="$2" '$1 == t && $2 == q { f = 1 } END { exit !f }' "$(p "$MANIFEST")"
}
manifest_has_extra() { # manifest_has_extra <type> <path> <extra>
  [[ -f "$(p "$MANIFEST")" ]] || return 1
  awk -F'\t' -v t="$1" -v q="$2" -v e="$3" '$1 == t && $2 == q && $3 == e { f = 1 } END { exit !f }' "$(p "$MANIFEST")"
}
manifest_del() { # manifest_del <type> <path>: hapus entri (untuk koreksi sebelum manifest_add)
  local f; f="$(p "$MANIFEST")"
  if ((DRY)); then echo "MANIFEST- $1 $2"; return 0; fi
  awk -F'\t' -v t="$1" -v q="$2" '!($1 == t && $2 == q)' "$f" > "$f.tmp" && chmod 0600 "$f.tmp" && mv -f "$f.tmp" "$f"
}
# Path terdaftar di manifest dengan tipe apa pun yang menandai "milik installer".
manifest_owns() { manifest_has file "$1" || manifest_has link "$1"; }

manifest_add() { # manifest_add <type> <path> [extra]
  local t="$1" path="$2" extra="${3:-}"
  manifest_valid_line "$t" "$path" "$extra" || die "entri manifest tidak valid: $t $path"
  manifest_has "$t" "$path" && return 0
  if ((DRY)); then echo "MANIFEST+ $t $path${extra:+ $extra}"; return 0; fi
  printf '%s\t%s\t%s\n' "$t" "$path" "$extra" >> "$(p "$MANIFEST")"
}

# manifest_load: isi array M_TYPE/M_PATH/M_EXTRA; batal bila ada baris tidak valid atau file manifest
# bisa ditulis selain pemiliknya (dibuat root, 0600 di direktori 0700).
manifest_load() {
  local f; f="$(p "$MANIFEST")"
  M_TYPE=(); M_PATH=(); M_EXTRA=()
  [[ -f "$f" && ! -L "$f" ]] || return 1
  local mode owner
  mode="$(stat -c '%a' "$f")"; owner="$(stat -c '%u' "$f")"
  # $EUID (bukan `id -u`): di test pemilik sandbox = user test; di production = root (0).
  [[ "$owner" == "$EUID" ]] || die "manifest $MANIFEST bukan milik user ini (uid $owner)"
  ((8#$mode & 8#022)) && die "manifest $MANIFEST bisa ditulis group/other (mode $mode)"
  local n=0 t path extra
  while IFS=$'\t' read -r t path extra || [[ -n "$t" ]]; do
    n=$((n + 1))
    [[ -z "$t" || "$t" == \#* ]] && continue
    manifest_valid_line "$t" "$path" "$extra" || die "manifest baris $n tidak valid ($t $path) — uninstall dibatalkan tanpa perubahan"
    M_TYPE+=("$t"); M_PATH+=("$path"); M_EXTRA+=("$extra")
  done < "$f"
}

# parent_resolved_ok <path-target>: direktori induk path, sesudah symlink di-resolve, HARUS sama dengan
# bentuk kanoniknya (tidak ada induk yang symlink ke tempat lain). Dipakai uninstall sebelum setiap rm
# (SR-8-1, lapis ketiga setelah validasi manifest).
parent_resolved_ok() {
  local path="$1" rr parent want
  manifest_canonical "$path" || return 1
  rr="$(realpath -m -- "${ROOT:-/}")"; [[ "$rr" == / ]] && rr=""
  parent="$(realpath -m -- "$(dirname -- "$(p "$path")")")"
  want="$rr$(dirname -- "$path")"
  [[ "$parent" == "${want%/}" || ( "$want" == / && "$parent" == / ) ]]
}
# safe_rm_tree <path-target>: boleh `rm -rf` hanya bila induk ter-resolve kanonik DAN path di RM_ROOTS.
safe_rm_tree() {
  local r
  parent_resolved_ok "$1" || return 1
  for r in "${RM_ROOTS[@]}"; do [[ "$1" == "$r" || "$1" == "$r/"* ]] && return 0; done
  return 1
}

# --- file terkelola --------------------------------------------------------------------------------
# put_file <src> <target> <mode> <owner:group>: pasang file milik installer (atomik). Target yang sudah
# ada tetapi TIDAK tercatat di manifest tidak pernah ditimpa (installer tidak menyentuh file orang lain).
# Mengeset CHANGED=1 bila isi/mode berubah.
put_file() {
  local src="$1" target="$2" mode="$3" og="$4" real tmp
  real="$(p "$target")"
  if [[ -e "$real" || -L "$real" ]] && ! manifest_owns "$target"; then
    die "$target sudah ada dan bukan milik installer (tidak tercatat di manifest); pindahkan dulu"
  fi
  if [[ -f "$real" ]] && cmp -s "$src" "$real" && [[ "$(stat -c '%a' "$real")" == "${mode#0}" ]]; then
    manifest_add file "$target"
    # Isi + mode sama, pemilik bergeser (CR-8-12): perbaiki pemilik dan anggap berubah (restart).
    if [[ "$(stat -c '%U:%G' "$real")" != "$og" ]]; then
      CHANGED=1; run chown "$og" "$real"; log "pemilik $target diperbaiki -> $og"
    fi
    return 0
  fi
  CHANGED=1
  if ((DRY)); then echo "DRY-RUN: tulis $target (mode $mode $og)"; manifest_add file "$target"; return 0; fi
  mkdir -p "$(dirname "$real")"
  manifest_add file "$target"
  tmp="$(mktemp "$(dirname "$real")/.pxe-install.XXXXXX")"
  cat "$src" > "$tmp"
  chmod "$mode" "$tmp"
  mv -f "$tmp" "$real"
  chown "$og" "$real"
  log "terpasang $target ($mode $og)"
}

# ensure_dir <path> <mode> <owner:group> <dir|data>: buat direktori bila belum ada lalu catat; direktori
# yang sudah ada sebelumnya tidak dicatat (uninstall tidak menyentuhnya).
ensure_dir() {
  local d="$1" mode="$2" og="$3" kind="$4"
  if [[ -d "$(p "$d")" ]]; then
    # Mountpoint (mis. /srv/pxe/media/<id> berisi ISO iso9660 read-only, diekspor NFS) tidak pernah
    # di-chmod/chown ulang: mode/pemilik milik filesystem yang ter-mount, dan operasi itu gagal (EROFS).
    if manifest_has "$kind" "$d" && ! mountpoint -q "$(p "$d")" 2>/dev/null; then
      run chmod "$mode" "$(p "$d")"; run chown "$og" "$(p "$d")"
    fi
    return 0
  fi
  manifest_add "$kind" "$d"
  run mkdir -p "$(p "$d")"
  run chmod "$mode" "$(p "$d")"
  run chown "$og" "$(p "$d")"
}

# ensure_link <target-link> <points-to>
ensure_link() {
  local l="$1" to="$2" real; real="$(p "$l")"
  if [[ -e "$real" || -L "$real" ]] && ! manifest_owns "$l"; then
    die "$l sudah ada dan bukan milik installer"
  fi
  [[ -L "$real" && "$(readlink "$real")" == "$to" ]] && { manifest_add link "$l"; return 0; }
  CHANGED=1
  manifest_add link "$l"
  run ln -sfn "$to" "$real"
}
