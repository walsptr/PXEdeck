# M5 secret scan (teks + base64). Pakai: python3 -I b64-scan.py runs <dir>...  |  python3 -I b64-scan.py git <repo> <range>
# Pola teks: token 43 char pada path /boot/<mac>/, token=/"token": 43 char, hash SHA-512 crypt,
# header private key, password dummy fixture. Base64: blob >= 40 char, offset 0-3, UTF-8 & UTF-16LE,
# bertingkat hingga 2 lapis (blob dalam >= 16 char) — selaras redactSecrets / infra/redact-evidence.sh.
import base64, os, re, subprocess, sys

TEXT = {
    "token /boot/": re.compile(rb"/boot/[0-9a-fA-F:%-]{12,40}/[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])"),
    "token kv": re.compile(rb"token[\"']?\s*[=:]\s*[\"']?[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])", re.I),
    "hash $6$": re.compile(rb"\$6\$(?:rounds=\d+\$)?[./A-Za-z0-9]{1,16}\$[./A-Za-z0-9]{20,}"),
    "private key": re.compile(rb"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    "password fixture": re.compile(rb"Fixture-Pass-7319"),
}
B64 = re.compile(rb"[A-Za-z0-9+/]{40,}={0,2}")
INNER = re.compile(rb"[A-Za-z0-9+/]{16,}={0,2}")
DEC_BAD = re.compile(rb"/boot/[0-9a-fA-F:%-]{12,40}/[A-Za-z0-9_-]{43}|\$6\$|PRIVATE KEY|Fixture-Pass-7319")

def b64_secret(blob, depth=2):
    for off in range(4):
        s = blob[off:].split(b"=")[0]
        if len(s) < 16:
            continue
        s = s[: len(s) // 4 * 4]
        try:
            raw = base64.b64decode(s, validate=True)
        except Exception:
            continue
        for dec in (raw, raw.decode("utf-16le", "ignore").encode("utf-8", "ignore")):
            dec = dec.replace(b"\0", b"")
            m = DEC_BAD.search(dec)
            if m:
                return m.group(0)[:24]
            if depth > 0:
                for inner in set(INNER.findall(dec)):
                    h = b64_secret(inner, depth - 1)
                    if h:
                        return h
    return None

def scan(label, data, out):
    for name, rx in TEXT.items():
        for m in rx.finditer(data):
            out.append(f"{label}: {name}: {m.group(0)[:32]!r}")
    for blob in set(B64.findall(data)):
        h = b64_secret(blob)
        if h:
            out.append(f"{label}: base64 {blob[:20]!r}… -> {h!r}")

def main():
    mode = sys.argv[1]
    out = []
    n = 0
    if mode == "runs":
        for root in sys.argv[2:]:
            for dp, _, fs in os.walk(root):
                for f in fs:
                    p = os.path.join(dp, f)
                    if f in ("b64-scan.py", "secret-scan.sh", "secret-scan.txt"):
                        continue
                    n += 1
                    scan(p, open(p, "rb").read(), out)
    else:
        repo, rng = sys.argv[2], sys.argv[3]
        revs = subprocess.run(["git", "-C", repo, "rev-list", rng], capture_output=True, check=True).stdout.split()
        seen = set()
        for r in revs:
            tree = subprocess.run(["git", "-C", repo, "diff-tree", "-r", "--no-commit-id", "--root", "-M", r.decode()], capture_output=True, check=True).stdout.decode().splitlines()
            for line in tree:
                meta, path = line.split("\t", 1)
                parts = meta.split()
                sha, status = parts[3], parts[4]
                if status.startswith("D") or sha in seen or set(sha) == {"0"}:
                    continue
                seen.add(sha)
                n += 1
                data = subprocess.run(["git", "-C", repo, "cat-file", "-p", sha], capture_output=True, check=True).stdout
                scan(f"{r.decode()[:8]}:{path.split(chr(9))[-1]}", data, out)
    print(f"# {mode}: {n} file/blob dipindai, {len(out)} hit")
    for o in out:
        print(o)

main()
