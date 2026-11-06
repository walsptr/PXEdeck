#!/usr/bin/env python3
"""Mutation run iter2 backend: apply mutation -> run tests (expect red) -> restore -> sha256 check."""
import hashlib
import subprocess
import sys
from pathlib import Path

DASH = Path("/home/syawal/Project/PXE-BOOT/.agent/wt-m6/dashboard")
REPO = DASH.parent
OUT = REPO / ".agent/runs/m6/mutation-dev-iter2-be.txt"

D = "src/lib/server/installers/debian.ts"
IS = "src/lib/server/install-service.ts"
CS = "src/lib/server/config-service.ts"
ST = "src/lib/server/startup.ts"
RD = "src/lib/server/redact.ts"
RM = "../infra/README.md"
T_DEB = "src/lib/server/installers/m6-iter2-debian.test.ts"
T_SMOKE = "src/lib/server/installers/m6-smoke-fixes.test.ts"
T_INST = "src/lib/server/installers/installers.test.ts"
T_BE = "src/lib/server/m6-iter2-be.test.ts"
T_BK = "src/lib/server/m6-backend.test.ts"

MUTATIONS = [
    ("M1 R4 generator: requireLocalMedia jadi no-op (trusted=yes ke media eksternal)", D,
     "  if (!isLocalMedia(c.mediaUrl, c.serverIp)) throw new InstallerInputError(debianExternalMediaError(c.mediaUrl, c.serverIp))",
     "  void isLocalMedia; void debianExternalMediaError",
     [T_DEB, T_SMOKE]),
    ("M2 R4 install: blocker Debian media eksternal dihapus (422 hilang)", IS,
     "  if (img.method === \"preseed\" && !isLocalMedia(media.mediaUrl, media.serverIp))",
     "  if (false && img.method === \"preseed\" && !isLocalMedia(media.mediaUrl, media.serverIp))",
     [T_BE]),
    ("M3 SR-6-6: DEBIAN_UNTRUST_CMD kembali SETELAH firstbootInstallCmds", D,
     "    DEBIAN_UNTRUST_CMD,\n    ...firstbootInstallCmds(\"\", \"preseed\", c.mac),\n",
     "    ...firstbootInstallCmds(\"\", \"preseed\", c.mac),\n    DEBIAN_UNTRUST_CMD,\n",
     [T_DEB, T_SMOKE, T_INST]),
    ("M4 CR-6-1 API: batas total authorized_keys dihapus", CS,
     "    if (keyBytes > AUTHORIZED_KEYS_MAX_BYTES) {",
     "    if (keyBytes > AUTHORIZED_KEYS_MAX_BYTES * 1000) {",
     [T_BE]),
    ("M5 CR-6-1 generator: guard late_command > 100000 byte dihapus", D,
     "  if (lateBytes > DEBIAN_LATE_COMMAND_MAX_BYTES)",
     "  if (lateBytes > DEBIAN_LATE_COMMAND_MAX_BYTES * 10)",
     [T_DEB]),
    ("M6 SR-6-3: trustProxyWarnings tidak dipanggil saat start", ST,
     "...authWarnings(s), ...trustProxyWarnings(s)]",
     "...authWarnings(s), ...(trustProxyWarnings, [])]",
     [T_BE, T_BK]),
    ("M7 SR-6-4: pass base64 ter-wrap dinonaktifkan", RD,
     "  out = fillRanges(out, wrappedB64Ranges(out), MARK_B64)\n",
     "  void wrappedB64Ranges\n",
     [T_BE]),
    ("M8 SR-6-4: aturan baris penutup kelipatan 4 dihapus (over-redaksi kata di bawah blok)", RD,
     "(!last || (total + core.length) % 4 === 0)",
     "(!last || true)",
     [T_BE]),
    ("M9 SR-6-4: base64 lapis dalam ter-wrap tidak digabung", RD,
     "clean.replace(/[\\r\\n]+/g, \"\").matchAll(B64_INNER_RE)",
     "clean.matchAll(B64_INNER_RE)",
     [T_BE]),
    ("M10 R5: butir DEC-021 dihapus dari README", RM,
     "- **Sisa risiko DEC-021 (apt Debian tanpa verifikasi tanda tangan selama instalasi).**",
     "- **Sisa risiko (apt Debian).**",
     [T_BE]),
    ("M11 R5: butir DEC-019 dihapus dari README", RM,
     "- **Sesi: polling memperpanjang idle (DEC-019 §1).**",
     "- **Sesi.**",
     [T_BE]),
    ("M12 R5: butir SR-6-3 dihapus dari README", RM,
     "- **Rate limit login tanpa `PXE_TRUST_PROXY` (SR-6-3).**",
     "- **Rate limit login.**",
     [T_BE]),
    ("M13 SR-6-4 perf: lewati UTF-16LE tanpa byte nol dihapus (ekuivalen, hanya performa)", RD,
     "buf.includes(0) ? [buf.toString(\"utf8\"), buf.toString(\"utf16le\")] : [buf.toString(\"utf8\")]",
     "[buf.toString(\"utf8\"), buf.toString(\"utf16le\")]",
     [T_BE, "src/lib/server/m6-redact.test.ts", "src/lib/server/m5-iter3-redact.test.ts"]),
]


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main() -> int:
    log = []
    only = set(sys.argv[1:])
    for name, rel, old, new, tests in MUTATIONS:
        if only and name.split()[0] not in only:
            continue
        f = (DASH / rel).resolve()
        orig = f.read_bytes()
        h0 = sha(f)
        text = orig.decode()
        assert text.count(old) == 1, f"{name}: pola tidak unik/tidak ada"
        f.write_text(text.replace(old, new))
        try:
            r = subprocess.run(["npx", "vitest", "run", *tests], cwd=DASH, capture_output=True, text=True, timeout=600)
            tail = [l for l in (r.stdout + r.stderr).splitlines() if "Tests " in l or l.strip().startswith("×")]
        finally:
            f.write_bytes(orig)
        h1 = sha(f)
        status = "RED" if r.returncode != 0 else "GREEN"
        log.append(f"## {name}\nfile: {rel}\nmutasi: {old!r} -> {new!r}\ntest: {' '.join(tests)}\nhasil mutasi: {status} (exit {r.returncode})")
        log += [f"  {l.strip()}" for l in tail[:12]]
        log.append(f"restore sha256: {h0} -> {h1} {'IDENTIK' if h0 == h1 else 'BERBEDA'}\n")
        print(name, status, "identik" if h0 == h1 else "BEDA", flush=True)
    OUT.write_text("\n".join(log) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
