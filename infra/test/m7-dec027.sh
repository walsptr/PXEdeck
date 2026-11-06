# shellcheck shell=bash
# infra/test/m7-dec027.sh — DEC-027 §2 (defense in depth): access log nginx (flat + VLAN) tidak
# mencatat query string selain `/boot/<mac>.ipxe?platform=…&wait=…`. Di-source oleh run.sh.
# Host lab tidak punya biner nginx → blok `map $request_uri $pxe_log_uri` dibaca dari konfigurasi
# apa adanya dan dievaluasi oleh infra/test/nginx-logmap.py (urutan regex nginx). Merah bila map
# di-revert ke `default $request_uri` tanpa penyamaran query.

_D27_TOK="AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE" # 43 karakter base64url (dummy)
_D27_MAC="52:54:00:99:00:11"

_d27_conf_files() { echo "$INFRA_DIR_UNDER_TEST/server/nginx-pxe.conf"; echo "$INFRA_DIR_UNDER_TEST/server/vlan/nginx-pxe-vlan.conf"; }
_d27_map() { python3 -I "$INFRA_TEST_DIR/nginx-logmap.py" "$@"; }

# Kredensial di query non-/boot (termasuk /login, kasus vlandistro) tidak pernah tercatat.
test_d27_login_query_not_logged() {
  local conf out u
  local -a uris=(
    "/login?password=x"
    "/login?username=admin&password=S3cr3t-dummy"
    "/login/?password=x"
    "/api/auth/login?password=x"
    "/api/jobs?hostId=1&password=x"
    "/?password=x"
    "/media/ubuntu-24.04/casper/vmlinuz?password=x"
    "/boot/../login?password=x"
    "/boot/%2e%2e%2flogin?password=x"
    "/boot/$_D27_MAC/$_D27_TOK/user-data?password=x"
    "/boot/$_D27_MAC.ipxe?platform=efi?password=x"
    "//login?password=x"
    "/boot/%2e%2e/login.ipxe?password=x"
    "/boot/a/b.ipxe?password=x"
    "/boot/.hidden.ipxe?password=x"
  )
  while IFS= read -r conf; do
    out="$(_d27_map "$conf" "${uris[@]}")"
    assert_eq "$(wc -l <<<"$out")" "${#uris[@]}" "$conf: jumlah baris"
    assert_not_contains "$out" "password" "$conf"
    assert_not_contains "$out" "S3cr3t" "$conf"
    assert_not_contains "$out" "username" "$conf"
    # Path tetap tercatat, query diganti penanda.
    assert_eq "$(_d27_map "$conf" "/login?password=x")" "/login?***" "$conf /login"
    assert_eq "$(_d27_map "$conf" "/api/jobs?hostId=1")" "/api/jobs?***" "$conf /api/jobs"
    # Tanpa query: path apa adanya.
    for u in /login / /api/hosts /media/ubuntu-24.04/casper/initrd; do
      assert_eq "$(_d27_map "$conf" "$u")" "$u" "$conf $u"
    done
  done < <(_d27_conf_files)
}

# Penyamaran token /boot (M4/M5) tetap; query .ipxe (platform/wait) tetap sebagai bukti firmware.
test_d27_boot_masking_kept() {
  local conf
  while IFS= read -r conf; do
    assert_eq "$(_d27_map "$conf" "/boot/$_D27_MAC/$_D27_TOK/user-data")" "/boot/$_D27_MAC/***/user-data" "$conf token"
    assert_eq "$(_d27_map "$conf" "/boot/$_D27_MAC/$_D27_TOK/preseed.cfg")" "/boot/$_D27_MAC/***/preseed.cfg" "$conf preseed"
    assert_eq "$(_d27_map "$conf" "/boot/$_D27_MAC/$_D27_TOK/status")" "/boot/$_D27_MAC/***/status" "$conf status"
    assert_eq "$(_d27_map "$conf" "/boot/$_D27_MAC/$_D27_TOK/log?x=1")" "/boot/$_D27_MAC/***/log?***" "$conf token+query"
    assert_eq "$(_d27_map "$conf" "/boot/$_D27_MAC.ipxe?platform=efi")" "/boot/$_D27_MAC.ipxe?platform=efi" "$conf ipxe"
    assert_eq "$(_d27_map "$conf" "/boot/$_D27_MAC.ipxe?platform=pcbios&wait=3")" "/boot/$_D27_MAC.ipxe?platform=pcbios&wait=3" "$conf ipxe wait"
    assert_eq "$(_d27_map "$conf" "/boot/entry.ipxe")" "/boot/entry.ipxe" "$conf entry"
    assert_eq "$(_d27_map "$conf" "/boot/snponly.efi")" "/boot/snponly.efi" "$conf statis"
    assert_not_contains "$(_d27_map "$conf" "/boot/$_D27_MAC/$_D27_TOK/ks.cfg")" "$_D27_TOK" "$conf token bocor"
  done < <(_d27_conf_files)
}

# log_format hanya memakai $pxe_log_uri (bukan $request_uri/$args/$query_string/$request) dan setiap
# access_log memakai format `pxe`; map flat == VLAN.
test_d27_log_format_static() {
  local conf nc lf
  while IFS= read -r conf; do
    nc="$(sed -e 's/#.*$//' "$conf")"
    lf="$(grep -E '^\s*log_format ' <<<"$nc")"
    assert_eq "$(wc -l <<<"$lf")" 1 "$conf: tepat satu log_format"
    assert_contains "$lf" '$pxe_log_uri' "$conf"
    assert_no_match "$lf" '\$(request_uri|args|arg_[A-Za-z_]+|query_string|request|uri)\b' "$conf: log_format memuat variabel query mentah"
    assert_match "$(grep -E '^\s*access_log ' <<<"$nc")" '^\s*access_log /var/log/nginx/pxe-access\.log pxe;$' "$conf access_log"
    assert_eq "$(grep -cE '^\s*access_log ' <<<"$nc")" 1 "$conf: satu access_log"
  done < <(_d27_conf_files)
  assert_eq "$(sed -n '/^map \$request_uri \$pxe_log_uri {/,/^}/p' "$INFRA_DIR_UNDER_TEST/server/vlan/nginx-pxe-vlan.conf")" \
    "$(sed -n '/^map \$request_uri \$pxe_log_uri {/,/^}/p' "$INFRA_DIR_UNDER_TEST/server/nginx-pxe.conf")" "map flat == VLAN"
}

# Konsumen log: baris log yang dirender dari format `pxe` + map baru tetap cocok dengan pola
# assert-server-logs.sh, kvm-run.sh (grep `"GET /boot/<mac>.ipxe`), m7-shared.ts nginxLinesFor,
# m6-core (`" 404 `) dan m6-bulk (`" 429 `).
test_d27_log_consumers_still_match() {
  local conf d line u
  d="$SB/runs/m7/kvm"; mkdir -p "$d"
  : > "$d/server-dnsmasq.txt"
  while IFS= read -r conf; do
    : > "$d/server-nginx.txt"
    for u in "/boot/$_D27_MAC.ipxe?platform=efi" "/boot/$_D27_MAC/$_D27_TOK/user-data" "/boot/$_D27_MAC/$_D27_TOK/preseed.cfg" "/login?username=admin&password=x"; do
      printf '10.99.0.50 [2026-11-06T00:00:00+00:00] "GET %s" 200 10 "iPXE/1.21"\n' "$(_d27_map "$conf" "$u")" >> "$d/server-nginx.txt"
    done
    printf '10.99.0.50 [2026-11-06T00:00:00+00:00] "POST %s" 204 0 "curl"\n' "$(_d27_map "$conf" "/boot/$_D27_MAC/$_D27_TOK/status")" >> "$d/server-nginx.txt"
    printf '10.99.0.1 [2026-11-06T00:00:00+00:00] "GET %s" 404 0 "x"\n' "$(_d27_map "$conf" "/nope?a=1")" >> "$d/server-nginx.txt"
    rm -f "$d/results.json"
    run_infra assert-server-logs.sh "$d" "pxe-test-m7-node11=$_D27_MAC=bios=1=user-data" "pxe-test-m7-node12=$_D27_MAC=bios=1=preseed.cfg"
    assert_eq "$RC" 0 "$conf assert-server-logs: $OUT"
    assert_eq "$(grep -cF "\"GET /boot/$_D27_MAC.ipxe" "$d/server-nginx.txt")" 1 "$conf kvm-run grep ipxe"
    assert_eq "$(grep -cF '" 404 ' "$d/server-nginx.txt")" 1 "$conf 404"
    # Regex nginxLinesFor (m7-shared.ts) mem-parse semua baris; uri status berakhir /status.
    while IFS= read -r line; do
      assert_match "$line" '^(\S+) \[([^]]+)\] "(\S+) (\S+)" ([0-9]{3}) ' "$conf nginxLinesFor"
    done < "$d/server-nginx.txt"
    assert_match "$(grep -F '"POST ' "$d/server-nginx.txt" | awk '{print $4}')" '/status"$' "$conf status"
    assert_not_contains "$(cat "$d/server-nginx.txt")" "password" "$conf"
  done < <(_d27_conf_files)
}

t "DEC-027 nginx: query /login & non-/boot tidak tercatat (flat+VLAN)"   test_d27_login_query_not_logged
t "DEC-027 nginx: token /boot tetap disamarkan, query .ipxe tetap"       test_d27_boot_masking_kept
t "DEC-027 nginx: log_format hanya \$pxe_log_uri, map flat == VLAN"      test_d27_log_format_static
t "DEC-027 nginx: konsumen log (assert-server-logs/kvm-run/e2e) tetap cocok" test_d27_log_consumers_still_match
