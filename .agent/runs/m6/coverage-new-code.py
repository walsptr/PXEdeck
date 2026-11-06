#!/usr/bin/env python3
"""Coverage kode baru/berubah M6 (DEC-004 include) — `git diff --diff-filter=AM <BASE>..HEAD -- dashboard/src`.

Dua ukuran:
  (a) per file (cara M5): lines/branches file yang ditambah/diubah, dari coverage-summary.json;
  (b) per baris berubah: baris yang DITAMBAH/diubah di diff yang dapat dieksekusi (punya statement di
      coverage-final.json) dan berapa yang tereksekusi.
Pakai (dari akar repo): python3 -I .agent/runs/m6/coverage-new-code.py [BASE]   (default 1a7be29)
Butuh: dashboard/coverage/coverage-summary.json + coverage-final.json
       (`npx vitest run --coverage --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=json`).
"""
import json
import os
import re
import subprocess
import sys

BASE = sys.argv[1] if len(sys.argv) > 1 else "1a7be29"
ROOT = os.getcwd()
DASH = os.path.join(ROOT, "dashboard")
INCLUDE = re.compile(r"^dashboard/src/(lib/|app/api/|app/boot/|hooks/|components/.*\.ts$)")
EXCLUDE = re.compile(r"(^dashboard/src/components/ui/|\.d\.ts$|\.test\.tsx?$|^dashboard/src/test/)")


def git(*a):
    return subprocess.run(["git", *a], capture_output=True, text=True, check=True).stdout


head = git("rev-parse", "--short", "HEAD").strip()
files = [f for f in git("diff", "--name-only", "--diff-filter=AM", f"{BASE}..HEAD", "--", "dashboard/src").splitlines()]
summary = json.load(open(os.path.join(DASH, "coverage/coverage-summary.json")))
final = json.load(open(os.path.join(DASH, "coverage/coverage-final.json")))
abs_ = lambda f: os.path.join(ROOT, f)


def added_lines(f):
    out = set()
    diff = git("diff", "-U0", f"{BASE}..HEAD", "--", f)
    for m in re.finditer(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", diff, re.M):
        start, n = int(m.group(1)), int(m.group(2) or "1")
        out.update(range(start, start + n))
    return out


print(f"# Coverage kode baru/berubah M6 (git diff --diff-filter=AM {BASE}..HEAD -- dashboard/src, non-test) @ {head}")
print("# Sumber: dashboard/coverage/coverage-summary.json + coverage-final.json (vitest v8, include DEC-004)")
tl = th = tb = tbh = 0
cl = ch = 0
low = []
rows = []
outside = []
for f in sorted(files):
    if not INCLUDE.search(f) or EXCLUDE.search(f):
        if not re.search(r"\.test\.tsx?$|/test/", f):
            outside.append(f)
        continue
    s = summary.get(abs_(f))
    if not s:
        rows.append(f"  TIDAK ADA DATA COVERAGE  {f}")
        low.append(f)
        continue
    L, B = s["lines"], s["branches"]
    tl += L["total"]; th += L["covered"]; tb += B["total"]; tbh += B["covered"]
    pl = 100.0 * L["covered"] / L["total"] if L["total"] else 100.0
    pb = 100.0 * B["covered"] / B["total"] if B["total"] else 100.0
    # (b) baris berubah yang punya statement
    fc = final.get(abs_(f), {})
    add = added_lines(f)
    stmt_lines = {}
    for k, loc in fc.get("statementMap", {}).items():
        ln = loc["start"]["line"]
        hit = fc["s"][k] > 0
        stmt_lines[ln] = stmt_lines.get(ln, False) or hit
    ch_lines = [ln for ln in add if ln in stmt_lines]
    ch_cov = [ln for ln in ch_lines if stmt_lines[ln]]
    cl += len(ch_lines); ch += len(ch_cov)
    unc = sorted(set(ch_lines) - set(ch_cov))
    rows.append(f"{pl:7.2f}% lines {pb:7.2f}% branches  baris-berubah {len(ch_cov)}/{len(ch_lines)}  {f}" + (f"  (tak tereksekusi: {unc[:12]})" if unc else ""))
    if pl < 80:
        low.append(f)
for f in outside:
    print(f"   (di luar include DEC-004: komponen .tsx/halaman/tipe/skrip) {f}")
for r in rows:
    print(r)
print()
print(f"TOTAL kode baru M6 per file (include DEC-004): lines {th}/{tl} = {100.0*th/max(tl,1):.2f}%  branches {tbh}/{tb} = {100.0*tbh/max(tb,1):.2f}%")
print(f"TOTAL baris berubah ber-statement: {ch}/{cl} = {100.0*ch/max(cl,1):.2f}%")
t = summary["total"]
print(f"Repo (All files): lines {t['lines']['pct']}%  branches {t['branches']['pct']}%  functions {t['functions']['pct']}%  statements {t['statements']['pct']}%")
print(f"File kode baru < 80% lines: {', '.join(low) if low else 'tidak ada'}")
print("Komponen .tsx di luar include DEC-004 dibuktikan per AC lewat E2E (m6-*.spec.ts) dan test komponen jsdom (m6-components.test.tsx).")
sys.exit(1 if low or (th / max(tl, 1)) < 0.8 else 0)
