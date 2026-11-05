import sys, re, base64, os
pat = re.compile(rb"[A-Za-z0-9+/]{40,}={0,2}")
bad = re.compile(rb"/boot/[0-9a-fA-F:.-]+/[A-Za-z0-9_-]{43}|\$6\$|PRIVATE KEY|password", re.I)
for root in sys.argv[1:]:
    for dp, _, fs in os.walk(root):
        for f in fs:
            p = os.path.join(dp, f)
            try: data = open(p, "rb").read()
            except Exception: continue
            for m in set(pat.findall(data)):
                s = m + b"=" * (-len(m) % 4)
                try: d = base64.b64decode(s, validate=True)
                except Exception: continue
                h = bad.search(d)
                if h: print(p, m[:24].decode(), "->", h.group(0)[:20])
