#!/usr/bin/env python3
"""Mutasi E2E (salinan M6 mutate-e2e.py untuk M7-T8, test-engineer): terapkan beberapa mutasi pada file BERBEDA sekaligus (satu
build), jalankan project Playwright terkait, catat test yang merah per mutasi, pulihkan semua file dengan
sha256 identik. Pakai (dari dashboard/): python3 -I ../.agent/runs/m7/mutation-te-T8/mutate-e2e.py <spec.json>
spec.json: {"cmd": [...], "mutations": [{"id", "file", "old", "new", "all": bool, "expect_red": [regex judul]}]}
"""
import hashlib
import json
import re
import subprocess
import sys

spec = json.load(open(sys.argv[1]))
saved = {}
try:
    for m in spec["mutations"]:
        p = m["file"]
        if p not in saved:
            saved[p] = open(p, "rb").read()
        text = open(p, encoding="utf8").read()
        n = text.count(m["old"])
        if n == 0 or (n > 1 and not m.get("all")):
            raise SystemExit(f"[{m['id']}] pola ditemukan {n}x di {p}")
        open(p, "w", encoding="utf8").write(text.replace(m["old"], m["new"]))
        print(f"[{m['id']}] {p}: {m['old'][:90]!r} -> {m['new'][:90]!r} ({n}x)")
    r = subprocess.run(spec["cmd"], capture_output=True, text=True, timeout=3000)
    out = r.stdout + r.stderr
finally:
    for p, b in saved.items():
        open(p, "wb").write(b)
failed = sorted(set(re.findall(r"^\s+\d+\) \[[^\]]+\] › (.+?)\s*$", out, re.M)))
print(f"perintah: {' '.join(spec['cmd'])} → exit {r.returncode}")
summary = [l.strip() for l in out.splitlines() if re.search(r"^\s+\d+ (passed|failed|did not run|flaky)", l)]
print("ringkasan: " + "; ".join(summary))
for m in spec["mutations"]:
    hits = [f for f in failed if any(re.search(x, f) for x in m["expect_red"])]
    print(f"[{m['id']}] test merah yang diharapkan: {len(hits)} → {'MERAH' if hits else 'HIJAU (TIDAK TERDETEKSI)'}")
    for h in hits:
        print(f"     × {h[:170]}")
others = [f for f in failed if not any(any(re.search(x, f) for x in m["expect_red"]) for m in spec["mutations"])]
print(f"merah lain (bukan dari mutasi; mis. bug terbuka): {len(others)}")
for o in others:
    print(f"     · {o[:170]}")
for p, b in saved.items():
    ok = hashlib.sha256(open(p, "rb").read()).hexdigest() == hashlib.sha256(b).hexdigest()
    print(f"pulih {p}: sha256 identik={'ya' if ok else 'TIDAK'}")
