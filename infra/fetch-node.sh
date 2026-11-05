#!/usr/bin/env bash
# infra/fetch-node.sh — unduh Node 22 LTS resmi (nodejs.org) ke .agent/media/ + verifikasi sha256.
# Idempoten: tidak mengunduh ulang bila tarball sudah ada dan checksum cocok.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

NODE_VERSION="${NODE_VERSION:-22.23.4}"
NODE_TARBALL="node-v${NODE_VERSION}-linux-x64.tar.xz"
base="https://nodejs.org/dist/v${NODE_VERSION}"
mkdir -p "$MEDIA_DIR"
sums="$MEDIA_DIR/node-v${NODE_VERSION}.SHASUMS256.txt"
[[ -s "$sums" ]] || run curl -fsSL -o "$sums" "$base/SHASUMS256.txt"
is_dry && exit 0
want="$(awk -v f="$NODE_TARBALL" '$2==f{print $1}' "$sums")"
[[ -n "$want" ]] || die "$NODE_TARBALL tidak ada di SHASUMS256.txt"
if [[ -f "$MEDIA_DIR/$NODE_TARBALL" ]] && [[ "$(sha256sum "$MEDIA_DIR/$NODE_TARBALL" | cut -d' ' -f1)" == "$want" ]]; then
  log "$NODE_TARBALL sudah ada (sha256 cocok)"
else
  curl -fsSL -o "$MEDIA_DIR/$NODE_TARBALL.part" "$base/$NODE_TARBALL"
  got="$(sha256sum "$MEDIA_DIR/$NODE_TARBALL.part" | cut -d' ' -f1)"
  [[ "$got" == "$want" ]] || { rm -f "$MEDIA_DIR/$NODE_TARBALL.part"; die "sha256 $NODE_TARBALL tidak cocok"; }
  mv "$MEDIA_DIR/$NODE_TARBALL.part" "$MEDIA_DIR/$NODE_TARBALL"
  log "OK $NODE_TARBALL sha256=$got"
fi
echo "$MEDIA_DIR/$NODE_TARBALL"
