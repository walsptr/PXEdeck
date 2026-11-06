#!/usr/bin/env bash
# Diff pemakaian ulang bukti KVM (gate-iter1 §Bukti ulang 4/5, DEC-028 §4) → kvm/reuse-diff-final.txt.
# Pakai: reuse-diff.sh <final-commit>
set -uo pipefail
cd "$(dirname "$0")/../../../.."
F="${1:?final commit}"
NT=(':(exclude)**/*.test.ts' ':(exclude)**/*.test.tsx' ':(exclude)infra/test/**')
echo "# reuse-diff-final — basis d9d5308 / 6a26cc6 / 339f234 → final $(git rev-parse --short "$F") ($(date -u +%FT%TZ))"
echo "# Path: dashboard/src infra (+ dashboard/e2e-kvm terpisah, karena URL_CRED DEC-028 §2 ada di m7-shared.ts)."
for B in d9d5308 6a26cc6 339f234; do
  echo; echo "################ $B..$(git rev-parse --short "$F") ################"
  echo "## stat (dashboard/src infra)"; git diff --stat "$B" "$F" -- dashboard/src infra
  echo "## stat dashboard/e2e-kvm"; git diff --stat "$B" "$F" -- dashboard/e2e-kvm
  echo "## isi lengkap file non-test (dashboard/src infra dashboard/e2e-kvm; tanpa *.test.ts(x), infra/test/**)"
  git diff "$B" "$F" -- dashboard/src infra dashboard/e2e-kvm "${NT[@]}"
done
B=339f234
echo; echo "################ cek syarat 'tanpa run KVM ulang' ($B..$(git rev-parse --short "$F")) ################"
echo "## file non-test berubah"; git diff --name-only "$B" "$F" -- dashboard/src infra dashboard/e2e-kvm "${NT[@]}"
echo "## file jalur KVM terlarang yang berubah (lib.sh, kvm-run.sh, nginx*, server/**, switch/**, vlan/** relay, installers/**, validasi, boot/iPXE) — harus kosong"
git diff --name-only "$B" "$F" -- infra/lib.sh infra/kvm-run.sh 'infra/**/nginx*' infra/server infra/switch infra/vlan \
  dashboard/src/lib/server/installers 'dashboard/src/lib/**/valid*' 'dashboard/src/lib/**/*schema*' dashboard/src/app/boot 'dashboard/src/lib/server/boot*' 'dashboard/src/**/ipxe*' "${NT[@]}" \
  | grep -v '^infra/server/vlan/apply-profile.sh$' || true
echo "## apply-profile.sh: baris non-komentar berubah (harus kosong)"
git diff -U0 "$B" "$F" -- infra/server/vlan/apply-profile.sh | grep -E '^[+-]' | grep -vE '^(\+\+\+|---) ' | grep -vE '^[+-]\s*#' || echo "(kosong)"
echo "## lib.sh run()/ssh_server: diff (harus kosong)"; git diff "$B" "$F" -- infra/lib.sh; echo "(akhir)"
echo "## deploy-dashboard.sh: pipeline non-dry lama vs baru, spasi awal dibuang (harus identik)"
ext() { git show "$1:infra/deploy-dashboard.sh" | awk '/^ *\{$/ && !s {buf=$0; s=1; next} s==1 {buf=buf"\n"$0; if ($0 ~ /\| ssh_server "umask 077 && cat > /) {print buf; exit}}' | sed -E 's/^[[:space:]]+//'; }
diff <(ext "$B") <(ext "$F") && echo "IDENTIK ($(ext "$F" | wc -l) baris)"; ext "$F" | sed 's/^/    /'
echo "## deploy-dashboard.sh dengan -w (perubahan lain di luar cabang is_dry harus nihil)"; git diff -w "$B" "$F" -- infra/deploy-dashboard.sh
echo "## login-form.tsx: diff setelah komentar dibuang (CR-7-3 hanya posisi JSDoc, harus kosong)"
strip() { git show "$1:dashboard/src/components/auth/login-form.tsx" | python3 -I -c 'import re,sys; s=sys.stdin.read(); s=re.sub(r"/\*\*.*?\*/","",s,flags=re.S); print("\n".join(l for l in s.splitlines() if l.strip()))'; }
diff <(strip "$B") <(strip "$F") && echo "(kosong: kode identik, hanya JSDoc pindah)"
echo "## plan-table.tsx / passwords-dialog.tsx (CR-7-4): pemakaian di spec e2e-kvm/m7-* + m7-shared/kvm-harness (harus kosong)"
grep -nE 'Area gulir|Preview |Password yang dibuat|PasswordsDialog|PlanTable|role: *"region"|getByRole\("region"' dashboard/e2e-kvm/m7-*.ts dashboard/e2e-kvm/kvm-harness.ts || echo "(kosong)"
echo "## selector login di spec e2e-kvm/m7-* (label Username/Password + tombol; tidak berubah oleh CR-7-3)"
grep -nE 'getByLabel|getByRole\("button"' dashboard/e2e-kvm/m7-vlan.spec.ts dashboard/e2e-kvm/m7-vlanneg.spec.ts | head -12
echo "## label/teks yang dipakai selector itu di login-form.tsx $B vs final (harus sama)"
for c in "$B" "$F"; do echo "-- $c"; git show "$c:dashboard/src/components/auth/login-form.tsx" | grep -nE 'htmlFor|<Label|>Masuk<|type="submit"' ; done
echo "## dashboard/e2e-kvm: perubahan (hanya URL_CRED m7-shared.ts, DEC-028 §2)"; git diff --stat "$B" "$F" -- dashboard/e2e-kvm
