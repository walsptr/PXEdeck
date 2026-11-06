// Pemeriksaan DEC-021 §2 / DEC-022 §2 di target terpasang (suite KVM m6-distro): `/etc/apt` tidak
// menyimpan sumber tak terautentikasi — tidak ada `trusted=yes`, tidak ada
// `/etc/apt/apt.conf.d/00AllowUnauthenticated`, dan `grep -ri AllowUnauthenticated /etc/apt` kosong.
// Dibuat fail-closed (tidak hampa): setiap pemeriksaan harus mencetak penanda eksplisit; bila `sudo`
// gagal, direktori tidak terbaca, atau grep error (rc 2), penanda yang dituntut tidak muncul → FAIL.
// Modul tanpa env/IO agar bisa diuji unit (src/lib/server/m6-kvm-apt-trust.test.ts) terhadap root palsu.

/** Script bash (dikirim lewat stdin `bash -s`). `root` = prefix path (""), `pre` = mis. "sudo -n". */
export function aptTrustScript(root = "", pre = "sudo -n"): string {
  const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`
  return [
    `R=${q(root)}`,
    `if [ -d "$R/etc/apt" ]; then echo "apt_dir=ADA"; else echo "apt_dir=TIDAK"; fi`,
    `${pre} sh -c 'grep -rl "trusted=yes" "$1/etc/apt"; echo "trusted_rc=$?"' _ "$R" 2>&1`,
    `${pre} sh -c 'if [ -e "$1/etc/apt/apt.conf.d/00AllowUnauthenticated" ]; then echo allow_file=ADA; else echo allow_file=TIDAK; fi' _ "$R" 2>&1`,
    `${pre} sh -c 'grep -ril "AllowUnauthenticated" "$1/etc/apt"; echo "allow_grep_rc=$?"' _ "$R" 2>&1`,
    // Status keluar sengaja selalu 0: kelulusan hanya dari penanda eksplisit di atas (evalAptTrust).
    "true",
  ].join("\n") + "\n"
}

export type AptTrust = { aptDir: boolean; problems: string[] }

/**
 * Nilai keluaran `aptTrustScript`. `requireApt` (Debian): /etc/apt wajib ada dan bersih. Tanpa
 * `requireApt` (Rocky): bila /etc/apt tidak ada → tidak relevan (tanpa masalah); bila ada → wajib bersih.
 */
export function evalAptTrust(out: string, requireApt: boolean): AptTrust {
  const aptDir = /^apt_dir=ADA$/m.test(out)
  const problems: string[] = []
  if (!aptDir && !/^apt_dir=TIDAK$/m.test(out)) problems.push("penanda apt_dir tidak ada")
  if (!aptDir) {
    if (requireApt) problems.push("/etc/apt tidak ada di target")
    return { aptDir, problems }
  }
  if (!/^trusted_rc=1$/m.test(out)) problems.push(`trusted=yes ditemukan atau grep gagal (${/^trusted_rc=\d+$/m.exec(out)?.[0] ?? "tanpa penanda"})`)
  if (!/^allow_file=TIDAK$/m.test(out)) problems.push(`00AllowUnauthenticated ada atau tidak terperiksa (${/^allow_file=\w+$/m.exec(out)?.[0] ?? "tanpa penanda"})`)
  if (!/^allow_grep_rc=1$/m.test(out)) problems.push(`grep -ri AllowUnauthenticated /etc/apt tidak kosong atau gagal (${/^allow_grep_rc=\d+$/m.exec(out)?.[0] ?? "tanpa penanda"})`)
  return { aptDir, problems }
}
