#!/usr/bin/env bash
# Perf watch iterasi 2: setiap file test performa redaksi dijalankan SENDIRIAN 10x (vitest, tanpa coverage),
# durasi test berlabel "ms" dicatat per iterasi + ringkasan min/median/max; lalu pengukuran langsung.
set -uo pipefail
cd "$(dirname "$0")/../../../../../dashboard"
OUT=../.agent/runs/m6/final-iter2/perf
J="${PERF_JSON_DIR:?set PERF_JSON_DIR (dir sementara untuk laporan json vitest)}"
FILES=(src/lib/server/m6-iter2-be.test.ts src/lib/server/m6-redact.test.ts src/lib/server/m5-iter3-redact.test.ts src/lib/server/m5-iter2-redact-timeout.test.ts)
echo "# Perf watch redaksi @ $(git rev-parse --short HEAD) $(date -u +%FT%TZ) — 10x per file, sendirian"
echo "# load awal: $(cat /proc/loadavg); nproc $(nproc)"
for f in "${FILES[@]}"; do
  b=$(basename "$f")
  for i in $(seq 1 10); do
    npx vitest run "$f" --reporter=json --outputFile="$J/$b.$i.json" >/dev/null 2>&1; rc=$?
    python3 -I - "$J/$b.$i.json" "$b" "$i" "$rc" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); b, i, rc = sys.argv[2], sys.argv[3], sys.argv[4]
print(f"{b} iter {i}: exit={rc} total {d['numPassedTests']}/{d['numTotalTests']} lulus, gagal {d['numFailedTests']}")
for r in d["testResults"]:
    for a in r["assertionResults"]:
        if "ms" in a["title"] and ("KB" in a["title"] or "16" in a["title"]):
            print(f"   {a['status']:8s} {a['duration']:7.2f} ms  {a['title'][:150]}")
PY
  done
done
echo
echo "# Ringkasan per test (n=10)"
python3 -I - "$J" <<'PY'
import glob, json, statistics, sys, collections
acc = collections.defaultdict(list); st = collections.Counter()
for p in sorted(glob.glob(sys.argv[1] + "/*.json")):
    d = json.load(open(p)); b = p.split("/")[-1].rsplit(".", 2)[0]
    for r in d["testResults"]:
        for a in r["assertionResults"]:
            if "ms" in a["title"] and ("KB" in a["title"] or "16" in a["title"]):
                acc[(b, a["title"])].append(a["duration"]); st[a["status"]] += 1
for (b, t), xs in acc.items():
    print(f"  {b:32s} n={len(xs):2d} min={min(xs):7.2f} median={statistics.median(xs):7.2f} max={max(xs):7.2f}  {t[:120]}")
print(f"status test perf: {dict(st)}")
PY
echo
echo "# Pengukuran langsung redactSecrets (node $(node --version) --experimental-strip-types, proses terpisah; pelengkap)"
node --experimental-strip-types --no-warnings "$OUT/perf-direct.mts" "$PWD/src/lib/server/redact.ts" 2>&1
