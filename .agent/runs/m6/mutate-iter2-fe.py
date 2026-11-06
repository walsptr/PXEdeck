#!/usr/bin/env python3
"""Mutasi frontend-dev M6 iter2 (DEC-018 §6): SATU mutasi per perbaikan, berurutan — terapkan, build +
jalankan test terkait (E2E project m6-ui-iter2 dengan -g, opsional unit vitest), pulihkan file dan cek
sha256 identik. Pakai (dari dashboard/): python3 -I ../.agent/runs/m6/mutate-iter2-fe.py <spec.json> <out.txt>
spec.json: [{"id", "file", "old", "new" | "new_file", "e2e_grep", "unit": [file...]?}]
"""
import hashlib
import re
import subprocess
import sys
import json

spec = json.load(open(sys.argv[1]))
out_path = sys.argv[2]
only = set(sys.argv[3:])


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def summary(out: str, pat: str) -> str:
    lines = [l.strip() for l in out.splitlines() if re.search(pat, l)]
    return "; ".join(lines[-3:])


for m in spec:
    if only and m["id"] not in only:
        continue
    p = m["file"]
    orig = open(p, "rb").read()
    text = orig.decode("utf8")
    if "new_file" in m:
        mutated = open(m["new_file"], encoding="utf8").read()
        desc = f"seluruh file → {m['new_file'].split('/')[-1]}"
    else:
        n = text.count(m["old"])
        if n != 1:
            raise SystemExit(f"[{m['id']}] pola ditemukan {n}x di {p}")
        mutated = text.replace(m["old"], m["new"])
        desc = f"s/{m['old'][:80]}/{m['new'][:80]}/".replace("\n", "⏎")
    res = []
    try:
        open(p, "w", encoding="utf8").write(mutated)
        if m.get("unit"):
            r = subprocess.run(["npx", "vitest", "run", *m["unit"]], capture_output=True, text=True, timeout=600)
            res.append(f"unit exit={r.returncode} [{summary(r.stdout + r.stderr, r'Tests\s+\d')}]")
        r = subprocess.run(
            ["npx", "playwright", "test", "--project=m6-ui-iter2", "-g", m["e2e_grep"]],
            capture_output=True, text=True, timeout=1800,
        )
        out = r.stdout + r.stderr
        red = sorted(set(re.findall(r"^\s+\d+\) \[m6-ui-iter2\] › (.+?)\s*$", out, re.M)))
        res.append(f"e2e exit={r.returncode} [{summary(out, r'^\s+\d+ (passed|failed|did not run|flaky)')}] merah: {' | '.join(x[:110] for x in red) or '-'}")
    finally:
        open(p, "wb").write(orig)
    ok = sha(open(p, "rb").read()) == sha(orig)
    line = f"[{m['id']}] {p} :: {desc} => {' ; '.join(res)} ; pulih sha256 identik={'ya' if ok else 'TIDAK'}"
    print(line, flush=True)
    with open(out_path, "a", encoding="utf8") as f:
        f.write(line + "\n")
