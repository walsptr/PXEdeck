#!/usr/bin/env bash
# skip/pelemahan M7 iter2 (test-engineer): (1) asersi file test lama vs m6-approved, (2) penanda skip,
# (3) config test, (4) test dihapus, (5) filter axe, (6) file test baru M7 awal vs HEAD, (7) perubahan
# test sejak 339f234 (iter2) dengan hitungan asersi per file.
set -uo pipefail
cd "$(dirname "$0")/../../../.."
echo "# skip/weakening M7 iter2 — $(date -u +%FT%TZ) @ $(git rev-parse --short HEAD)"
echo "## (1) Hitungan asersi file test lama vs m6-approved (count-assertions.py)"
python3 -I .agent/runs/m7/count-assertions.py m6-approved; echo "EXIT=$?"
echo; echo "## (2) Penanda skip/only/todo/fixme di semua file test"
echo '$ grep -rnE "\b(it|test|describe|suite)\.(skip|only|todo|fixme|skipIf|runIf)\b|\b(xit|xdescribe|xtest|fit|fdescribe)\(|test\.fail\(" dashboard/src dashboard/e2e dashboard/e2e-kvm'
h="$(grep -rnE "\b(it|test|describe|suite)\.(skip|only|todo|fixme|skipIf|runIf)\b|\b(xit|xdescribe|xtest|fit|fdescribe)\(|test\.fail\(" dashboard/src dashboard/e2e dashboard/e2e-kvm)"; echo "${h:-(0 hit)}"
echo '$ grep -nE "^\s*#\s*t \"|\bskip\b" infra/test/*.sh'
h="$(grep -nE "^\s*#\s*t \"|\bskip\b" infra/test/*.sh)"; echo "${h:-(0 hit)}"
echo; echo "## (3) Config test vs m6-approved dan vs 339f234"
for f in dashboard/vitest.config.mts dashboard/vitest.process.config.mts dashboard/vitest.setup.dom.ts dashboard/playwright.config.ts dashboard/e2e-kvm/playwright.config.ts; do
  echo "- $f: m6-approved: $(git diff --shortstat m6-approved HEAD -- "$f"); 339f234: $(git diff --shortstat 339f234 HEAD -- "$f")"
done
echo '$ git diff m6-approved HEAD -- dashboard/playwright.config.ts | grep -nE "^[+-].*(retries|forbidOnly|timeout|workers|testIgnore|grep)"'
h="$(git diff m6-approved HEAD -- dashboard/playwright.config.ts | grep -nE "^[+-].*(retries|forbidOnly|timeout|workers|testIgnore|grep)")"; echo "${h:-(0 baris)}"
echo; echo "## (4) File test dihapus sejak m6-approved"
h="$(git diff --diff-filter=D --name-only m6-approved HEAD -- dashboard infra | grep -E '\.test\.tsx?$|\.spec\.ts$|^infra/test/')"; echo "${h:-(0 file test dihapus)}"
echo; echo "## (5) Filter axe (dashboard/e2e/support/axe.ts): diff 339f234..HEAD (harus kosong) + stat vs m6-approved"
git diff 339f234 HEAD -- dashboard/e2e/support/axe.ts; echo "(akhir diff 339f234..HEAD)"; git diff --stat m6-approved HEAD -- dashboard/e2e/support/axe.ts
echo; echo "## (6) File test BARU M7 (merge-base main..HEAD): asersi saat pertama ditambahkan vs HEAD"
python3 -I - <<'PY'
import re, subprocess
g=lambda *a: subprocess.run(["git",*a],capture_output=True,text=True).stdout
base=g("merge-base","main","HEAD").strip()
TS=re.compile(r"\bexpect(TypeOf)?(\(|\.(poll|soft)\()"); SH=re.compile(r"\b(assert_[a-z_]+|_fail)\b")
cnt=lambda p,t: len((SH if p.endswith(".sh") else TS).findall(t))
TEST=re.compile(r"(\.test\.tsx?$|\.spec\.ts$|^dashboard/e2e(-kvm)?/.*\.ts$|^infra/test/.*\.sh$)")
bad=[]
print(f"{'file':<75}{'awal':>6}{'HEAD':>6}  commit-ubah")
for f in sorted(g("diff","--diff-filter=A","--name-only",base,"HEAD","--","dashboard","infra").split()):
    if not TEST.search(f): continue
    revs=g("log","--format=%h","--reverse",f"{base}..HEAD","--",f).split()
    first=cnt(f,g("show",f"{revs[0]}:{f}")); head=cnt(f,open(f).read())
    if head<first: bad.append(f)
    print(f"{f:<75}{first:>6}{head:>6}  {' '.join(revs[1:]) or '-'}")
print(f"file test baru turun asersi: {len(bad)} {bad}")
PY
echo; echo "## (7) Perubahan file test sejak 339f234 (iter2): asersi 339f234 vs HEAD"
python3 -I - <<'PY'
import re, subprocess
g=lambda *a: subprocess.run(["git",*a],capture_output=True,text=True).stdout
TS=re.compile(r"\bexpect(TypeOf)?(\(|\.(poll|soft)\()"); SH=re.compile(r"\b(assert_[a-z_]+|_fail)\b")
cnt=lambda p,t: len((SH if p.endswith(".sh") else TS).findall(t))
TEST=re.compile(r"(\.test\.tsx?$|\.spec\.ts$|^dashboard/e2e(-kvm)?/.*\.ts$|^infra/test/.*\.sh$)")
for f in sorted(g("diff","--name-only","339f234","HEAD","--","dashboard","infra").split()):
    if not TEST.search(f): continue
    old=g("show",f"339f234:{f}"); a=cnt(f,old) if old else 0
    b=cnt(f,open(f).read())
    print(f"{f:<75}{a:>6}{b:>6}  {'TURUN' if b<a else 'ok'}{'' if old else ' (baru)'}")
PY
