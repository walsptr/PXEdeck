#!/usr/bin/env python3
"""Hitung asersi per file test LAMA (ada di BASE) yang berubah: BASE vs working tree (AC-7.13; salinan skrip M6 AC-6.39).

Metrik TS: jumlah `expect(` + `expectTypeOf(` (termasuk `expect.poll(`/`expect.soft(` via `expect.`) ;
metrik shell: jumlah pemanggilan `assert_*` + `_fail`. Keluar 1 bila ada file yang turun.
Pakai: python3 -I .agent/runs/m7/count-assertions.py [BASE]   (default m6-approved)
"""
import re
import subprocess
import sys

BASE = sys.argv[1] if len(sys.argv) > 1 else "m6-approved"
TEST_RE = re.compile(r"(\.test\.tsx?$|\.spec\.ts$|^dashboard/e2e/.*\.ts$|^infra/test/.*\.sh$)")
TS_RE = re.compile(r"\bexpect(TypeOf)?(\(|\.(poll|soft)\()")
SH_RE = re.compile(r"\b(assert_[a-z_]+|_fail)\b")


def git(*a: str) -> str:
    return subprocess.run(["git", *a], capture_output=True, text=True, check=True).stdout


def count(path: str, text: str) -> int:
    return len((SH_RE if path.endswith(".sh") else TS_RE).findall(text))


changed = [l for l in git("diff", "--name-only", BASE, "--", "dashboard", "infra").splitlines() if TEST_RE.search(l)]
untracked = set(git("ls-files", "--others", "--exclude-standard").splitlines())
rows, dropped = [], []
for f in sorted(changed):
    try:
        before_text = git("show", f"{BASE}:{f}")
    except subprocess.CalledProcessError:
        continue  # file baru (bukan test lama)
    try:
        after_text = open(f, encoding="utf8").read()
    except FileNotFoundError:
        rows.append((f, count(f, before_text), "DIHAPUS"))
        dropped.append(f)
        continue
    b, a = count(f, before_text), count(f, after_text)
    rows.append((f, b, a))
    if a < b:
        dropped.append(f)

skip_re = re.compile(r"\b(test|it|describe)\.(skip|only|fixme|todo)\b|\btest\.fixme\(|\bxit\(|\bxdescribe\(")
skips = []
for f in git("ls-files", "dashboard/e2e", "dashboard/src", "dashboard/test", "infra/test").splitlines() + sorted(
    x for x in untracked if TEST_RE.search(x)
):
    if not TEST_RE.search(f) and not f.startswith("dashboard/test/"):
        continue
    try:
        for i, line in enumerate(open(f, encoding="utf8"), 1):
            if skip_re.search(line):
                skips.append(f"{f}:{i}: {line.strip()}")
    except (FileNotFoundError, IsADirectoryError, UnicodeDecodeError):
        pass

print(f"BASE={BASE}  metrik TS: expect( + expectTypeOf( + expect.poll/soft( ; shell: assert_* + _fail")
print(f"{'file':<70} {'sebelum':>8} {'sesudah':>8}")
for f, b, a in rows:
    print(f"{f:<70} {b:>8} {a:>8}")
print(f"\nfile lama berubah: {len(rows)}; turun/dihapus: {len(dropped)} {dropped}")
print(f"grep skip/only/fixme/todo (test & e2e & infra/test): {len(skips)}")
for s in skips:
    print("  " + s)
sys.exit(1 if dropped or skips else 0)
