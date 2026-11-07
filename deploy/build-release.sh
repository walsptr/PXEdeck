#!/usr/bin/env bash
# deploy/build-release.sh — build dashboard Next mode standalone lalu kemas jadi tarball rilis yang
# bisa dipasang `install.sh --release <file>` (M8, DEC-029 §2). Tidak butuh root.
# Pakai: deploy/build-release.sh <dir-dashboard> <out.tar.xz>
#   - `npm ci` hanya bila <dir>/node_modules belum ada; lalu `PXE_STANDALONE=1 npm run build`.
#   - Isi tarball = .next/standalone (server.js di akar) + .next/static + public; tanpa .env*,
#     DB, data/, .next/cache (sama dengan infra/deploy-dashboard.sh).
# install.sh memanggil script ini sebagai user `pxe` terhadap salinan sumber di direktori build
# sementara (skrip lifecycle npm tidak pernah berjalan sebagai root).
set -euo pipefail

(($# == 2)) || { echo "pakai: $0 <dir-dashboard> <out.tar.xz>" >&2; exit 2; }
src="$(cd "$1" && pwd)"
out="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
[[ -f "$src/package.json" && -f "$src/next.config.ts" ]] || { echo "$src bukan direktori dashboard" >&2; exit 2; }
command -v npm >/dev/null || { echo "npm tidak ada di PATH" >&2; exit 2; }

cd "$src"
export NEXT_TELEMETRY_DISABLED=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
if [[ ! -d node_modules ]]; then
  npm ci --no-audit --no-fund
fi
PXE_STANDALONE=1 npm run build
[[ -f .next/standalone/server.js ]] || { echo ".next/standalone/server.js tidak ada (build bukan standalone?)" >&2; exit 1; }

stage="$(mktemp -d "${TMPDIR:-/tmp}/pxe-release.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/app/.next"
cp -a .next/standalone/. "$stage/app/"
cp -a .next/static "$stage/app/.next/static"
[[ -d public ]] && cp -a public "$stage/app/public"
rm -rf "$stage/app/data" "$stage/app/.next/cache"
find "$stage/app" -maxdepth 1 -name '.env*' -exec rm -f {} +
leaked="$(find "$stage/app" \( -name '*.db' -o -name '*.db-*' -o -name '*.sqlite' -o -name '.env*' \) -not -path '*/node_modules/*' -print -quit)"
[[ -z "$leaked" ]] || { echo "artefak terlarang ikut rilis: $leaked" >&2; exit 1; }
tar -C "$stage/app" -cJf "$out.tmp" .
mv -f "$out.tmp" "$out"
echo "$out"
