#!/usr/bin/env python3
"""Mutasi terkontrol (M6, test-engineer): ganti string persis di file produk/test, jalankan perintah test,
catat ringkasan hasil, pulihkan file dengan sha256 identik. Pakai (dari dashboard/):
  python3 -I ../.agent/runs/m6/mutate.py <spec.json>
spec.json: [{"id":..,"file":..,"old":..,"new":..,"cmd":[..],"expect":"red"}]
"""
import hashlib
import json
import re
import subprocess
import sys

specs = json.load(open(sys.argv[1]))
for s in specs:
    path = s["file"]
    orig = open(path, "rb").read()
    h0 = hashlib.sha256(orig).hexdigest()
    text = orig.decode("utf8")
    n = text.count(s["old"])
    if n != 1:
        print(f"[{s['id']}] {path}: pola ditemukan {n}x (harus 1) — DILEWATI")
        continue
    open(path, "w", encoding="utf8").write(text.replace(s["old"], s["new"]))
    try:
        r = subprocess.run(s["cmd"], capture_output=True, text=True, timeout=s.get("timeout", 900))
        out = r.stdout + r.stderr
        summ = [l.strip() for l in out.splitlines() if re.search(r"^\s*(Tests|Test Files)\s|\d+ (failed|passed)\b|^\s*(FAIL|×|✘)", l)]
    finally:
        open(path, "wb").write(orig)
    h1 = hashlib.sha256(open(path, "rb").read()).hexdigest()
    verdict = "MERAH" if r.returncode != 0 else "HIJAU"
    print(f"[{s['id']}] {path}")
    print(f"   mutasi: {s['old'][:110]!r} -> {s['new'][:110]!r}")
    print(f"   perintah: {' '.join(s['cmd'])}")
    print(f"   hasil: {verdict} (exit {r.returncode}); diharapkan {s.get('expect', 'red').upper()}")
    for l in summ[:12]:
        print(f"     {l[:200]}")
    print(f"   pulih sha256 identik={'ya' if h0 == h1 else 'TIDAK'}")
    sys.stdout.flush()
