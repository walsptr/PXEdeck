#!/bin/bash
# M7-T8 mutation spot-check E2E: satu mutasi per build (atribusi tidak ambigu). Jalankan dari mana saja.
cd "$(dirname "$0")/../../../../dashboard" || exit 1
D=../.agent/runs/m7/mutation-te-T8
for j in "$D"/TM*.json; do
  echo "=== $(basename "$j") $(date -Is) — $(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["desc"])' "$j")"
  python3 -I "$D/mutate-e2e.py" "$j"
done
echo "=== git status produk setelah semua mutasi:"; git status --short src
