#!/usr/bin/env python3
"""infra/test/m8-kvm/etc-diff.py — bandingkan dua snapshot /etc (vm-snapshot.sh) untuk uji M8.

Pakai:
  etc-diff.py <snap-a.tsv> <snap-b.tsv> --manifest <manifest-copy> [--new-pkgs <file>] [--label X]

Setiap path yang berbeda (tambah/hapus/ubah isi, mode, owner, target) diklasifikasikan:
  manifest      path tercatat di manifest (file/link/dir/tree, atau di bawah tree)
  fstab         /etc/fstab (manifest memuat entri fstab)
  restore-link  symlink default nginx yang dicatat restore-link
  enable-link   symlink enablement systemd untuk unit/svc di manifest (*.wants/<unit>)
  pkg-new       dimiliki paket yang tidak terpasang sebelum install (--new-pkgs = daftar paket baru)
  account-db    /etc/passwd|group|shadow|gshadow(-) (perubahan user diperiksa terpisah)
  UNEXPLAINED   selain di atas -> dihitung sebagai temuan
Keluaran teks; exit 0 bila UNEXPLAINED kosong, 1 bila tidak.
"""
import argparse
import re
import sys


def load(path):
    rows = {}
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) != 6:
                continue
            rows[parts[0]] = parts[1:]
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("a")
    ap.add_argument("b")
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--new-pkgs")
    ap.add_argument("--label", default="")
    args = ap.parse_args()
    a, b = load(args.a), load(args.b)
    if not a or not b:
        print(f"FAIL snapshot kosong ({len(a)}/{len(b)} entri)")
        return 2
    mpaths, mtrees, munits, mrestore, has_fstab = set(), [], set(), set(), False
    with open(args.manifest, encoding="utf-8") as f:
        for line in f:
            p = line.rstrip("\n").split("\t")
            if len(p) < 2 or p[0].startswith("#"):
                continue
            t, path = p[0], p[1]
            if t in ("file", "link", "dir", "data"):
                mpaths.add(path)
            elif t == "tree":
                mtrees.append(path)
            elif t in ("unit", "svc"):
                munits.add(path)
            elif t == "restore-link":
                mrestore.add(path)
            elif t == "fstab":
                has_fstab = True
    # Unit terkait yang di-enable/disable bersama (Also= / dependensi unit paket).
    units_related = set(munits) | {"nfs-server.service", "rpcbind.service", "rpcbind.socket", "nfs-client.target", "nfs-blkmap.service", "nfs-mountd.service"}
    new_pkgs = set()
    if args.new_pkgs:
        with open(args.new_pkgs, encoding="utf-8") as f:
            new_pkgs = {l.strip() for l in f if l.strip()}

    def classify(path):
        if path in mpaths or any(path == t or path.startswith(t + "/") for t in mtrees):
            return "manifest"
        if path == "/etc/fstab" and has_fstab:
            return "fstab"
        if path in mrestore:
            return "restore-link"
        base = path.rsplit("/", 1)[-1]
        if path.startswith("/etc/systemd/system/") and ".wants/" in path and base in units_related:
            return "enable-link"
        # Link SysV /etc/rcN.d/[SK]NN<svc> yang ditulis systemd-sysv-install saat `systemctl
        # enable/disable` unit/svc yang tercatat di manifest (dnsmasq, nginx).
        m = re.match(r"^/etc/rc[0-6S]\.d/[SK][0-9]{2}(.+)$", path)
        if m and f"{m.group(1)}.service" in munits:
            return "enable-link"
        if path.startswith("/etc/systemd/system/") and path.endswith(".wants") and new_pkgs:
            return "enable-link"
        own = (b.get(path) or a.get(path) or [None] * 5)[4]
        if own and own != "-" and own in new_pkgs:
            return "pkg-new"
        if base in ("passwd", "group", "shadow", "gshadow", "passwd-", "group-", "shadow-", "gshadow-", "subuid", "subgid", "subuid-", "subgid-") and path.count("/") == 2:
            return "account-db"
        return "UNEXPLAINED"

    changes = []
    for path in sorted(set(a) | set(b)):
        ra, rb = a.get(path), b.get(path)
        if ra == rb:
            continue
        if ra is None:
            kind = "TAMBAH"
        elif rb is None:
            kind = "HAPUS"
        else:
            diffs = [n for n, x, y in zip(("type", "mode", "owner", "content", "pkg"), ra, rb) if x != y]
            if diffs == ["pkg"]:
                continue
            kind = "UBAH(" + ",".join(diffs) + ")"
        changes.append((classify(path), kind, path))
    unexplained = [c for c in changes if c[0] == "UNEXPLAINED"]
    print(f"# etc-diff {args.label}: {args.a.rsplit('/', 1)[-1]} ({len(a)} entri) -> {args.b.rsplit('/', 1)[-1]} ({len(b)} entri)")
    counts = {}
    for c in changes:
        counts[c[0]] = counts.get(c[0], 0) + 1
    print("# ringkasan: " + (", ".join(f"{k}={v}" for k, v in sorted(counts.items())) or "tidak ada perubahan"))
    for cls, kind, path in changes:
        print(f"{cls:12s} {kind:22s} {path}")
    print(f"# UNEXPLAINED={len(unexplained)}")
    return 1 if unexplained else 0


if __name__ == "__main__":
    sys.exit(main())
