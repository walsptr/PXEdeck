"""infra/test/nginx-logmap.py <nginx.conf> <request_uri>...

Emulator kecil `map $request_uri $pxe_log_uri { ... }` (DEC-027 §2) untuk test shell infra: host
lab tidak punya biner nginx, jadi blok map dibaca dari konfigurasi APA ADANYA lalu dievaluasi
seperti nginx (entri regex `~`/`~*` diuji berurutan, yang pertama cocok menang; selain itu
`default`; tanpa `default` = string kosong). Capture bernama dan `$request_uri` di nilai diekspansi.
Satu baris keluaran per argumen = nilai `$pxe_log_uri`. Exit 2 bila blok map tidak ditemukan atau
memuat sintaks yang tidak dikenali (test gagal, bukan diam-diam lolos).
"""

import re
import sys


def parse_map(text: str) -> tuple[list[tuple[re.Pattern[str], str]], str]:
    lines = [ln.split("#", 1)[0].rstrip() if not ln.lstrip().startswith('"') else ln.rstrip() for ln in text.splitlines()]
    try:
        start = next(i for i, ln in enumerate(lines) if re.match(r"^\s*map\s+\$request_uri\s+\$pxe_log_uri\s*\{\s*$", ln))
    except StopIteration:
        print("blok map $request_uri $pxe_log_uri tidak ditemukan", file=sys.stderr)
        sys.exit(2)
    entries: list[tuple[re.Pattern[str], str]] = []
    default = ""
    for ln in lines[start + 1 :]:
        s = ln.strip()
        if not s:
            continue
        if s == "}":
            return entries, default
        m = re.fullmatch(r'"(~\*?)((?:[^"\\]|\\.)*)"\s+("(?:[^"\\]|\\.)*"|\S+);', s)
        if m:
            flags = re.IGNORECASE if m.group(1) == "~*" else 0
            # PCRE `(?<name>` → Python `(?P<name>` (tanpa menyentuh lookbehind `(?<=` / `(?<!`).
            pat = re.sub(r"\(\?<(?=[A-Za-z_])", "(?P<", m.group(2))
            entries.append((re.compile(pat, flags), m.group(3).strip('"')))
            continue
        m = re.fullmatch(r'default\s+("(?:[^"\\]|\\.)*"|\S+);', s)
        if m:
            default = m.group(1).strip('"')
            continue
        print(f"baris map tidak dikenali: {s}", file=sys.stderr)
        sys.exit(2)
    print("blok map tidak ditutup", file=sys.stderr)
    sys.exit(2)


def expand(value: str, uri: str, groups: dict[str, str]) -> str:
    def var(m: re.Match[str]) -> str:
        name = m.group(1)
        if name == "request_uri":
            return uri
        if name in groups:
            return groups[name] or ""
        print(f"variabel tak dikenal di nilai map: ${name}", file=sys.stderr)
        sys.exit(2)

    return re.sub(r"\$([A-Za-z_][A-Za-z0-9_]*)", var, value)


def main() -> None:
    if len(sys.argv) < 3:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    with open(sys.argv[1], encoding="utf-8") as f:
        entries, default = parse_map(f.read())
    for uri in sys.argv[2:]:
        out = None
        for pat, value in entries:
            m = pat.search(uri)
            if m:
                out = expand(value, uri, m.groupdict())
                break
        print(expand(default, uri, {}) if out is None else out)


main()
