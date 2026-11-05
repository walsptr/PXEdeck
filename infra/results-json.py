#!/usr/bin/env python3
"""infra/results-json.py — penulis results.json harness KVM (M6-T7, CR-5-10).

Pengganti penyisipan `sed` yang rapuh: semua nilai di-escape oleh modul json, berkas ditulis
atomik (tmp + rename). Hanya pustaka standar; dipanggil `python3 -I`.

Perintah:
  add-entry <results.json> <run> key=value ... [key:=<json>] ...
      tambah satu entri ke array "results" (urutan kunci dipertahankan).
  add <results.json> <run> <entries.json>
      tambah semua entri (array JSON) dari berkas ke "results".
  tsv-entries <in.tsv> <out.json>
      TSV "ac<TAB>node<TAB>status<TAB>note<TAB>evidence" -> array JSON entri.
  set <results.json> <run> <key> <json>
      set kunci level atas (mis. "harness").
  summary <combined.json> <milestone> <scenario> <results.json>
      salin results.json run ke combined["runs"][scenario] + status ringkas.

results.json yang ada tapi tidak valid tidak ditimpa diam-diam: dipindah ke
<results.json>.invalid-<ts> (dicatat di "harnessNotes") lalu dibuat baru.
Format keluaran: kunci level atas per baris, setiap entri "results" satu baris.
"""
import datetime
import json
import os
import sys


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load(path, run):
    notes = []
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, dict):
                raise ValueError("bukan objek JSON")
            if not isinstance(data.get("results", []), list):
                raise ValueError('"results" bukan array')
            data.setdefault("results", [])
            return data
        except (ValueError, OSError) as e:
            moved = f"{path}.invalid-{now().replace(':', '')}"
            os.replace(path, moved)
            notes.append(f"results.json lama tidak valid ({type(e).__name__}) -> {os.path.basename(moved)}")
            print(f"results-json: {path} tidak valid, dipindah ke {moved}", file=sys.stderr)
    data = {"run": run, "generatedAt": now(), "results": []}
    if notes:
        data["harnessNotes"] = notes
    return data


def dump(path, data):
    lines = ["{"]
    keys = list(data.keys())
    for i, k in enumerate(keys):
        v = data[k]
        sep = "," if i < len(keys) - 1 else ""
        if k == "results" and isinstance(v, list) and v:
            lines.append(f"  {json.dumps(k)}: [")
            for j, e in enumerate(v):
                lines.append(f"    {json.dumps(e, ensure_ascii=False)}" + ("," if j < len(v) - 1 else ""))
            lines.append("  ]" + sep)
        else:
            lines.append(f"  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}{sep}")
    lines.append("}")
    tmp = f"{path}.tmp-{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    os.replace(tmp, path)


def parse_kv(args):
    entry = {}
    for a in args:
        if ":=" in a and ("=" not in a or a.index(":=") < a.index("=")):
            k, v = a.split(":=", 1)
            entry[k] = json.loads(v)
        elif "=" in a:
            k, v = a.split("=", 1)
            entry[k] = v
        else:
            raise SystemExit(f"results-json: argumen '{a}' bukan key=value / key:=json")
    return entry


def main(argv):
    if len(argv) < 2:
        raise SystemExit(__doc__)
    cmd = argv[1]
    if cmd == "add-entry" and len(argv) >= 5:
        path, run = argv[2], argv[3]
        data = load(path, run)
        data["results"].append(parse_kv(argv[4:]))
        dump(path, data)
    elif cmd == "add" and len(argv) == 5:
        path, run, src = argv[2], argv[3], argv[4]
        with open(src, encoding="utf-8") as f:
            entries = json.load(f)
        if not isinstance(entries, list):
            raise SystemExit("results-json: entri harus array JSON")
        data = load(path, run)
        data["results"].extend(entries)
        dump(path, data)
    elif cmd == "tsv-entries" and len(argv) == 4:
        out = []
        with open(argv[2], encoding="utf-8") as f:
            for line in f:
                line = line.rstrip("\n")
                if not line:
                    continue
                ac, node, status, note, evidence = (line.split("\t") + [""] * 5)[:5]
                out.append({"ac": ac, "node": node, "status": status, "note": note,
                            "evidence": [e for e in evidence.split(",") if e]})
        with open(argv[3], "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
            f.write("\n")
    elif cmd == "set" and len(argv) == 6:
        path, run, key, val = argv[2], argv[3], argv[4], argv[5]
        data = load(path, run)
        data[key] = json.loads(val)
        dump(path, data)
    elif cmd == "summary" and len(argv) == 6:
        path, milestone, scenario, src = argv[2], argv[3], argv[4], argv[5]
        run = load(src, f"{milestone}{scenario}")
        statuses = [r.get("status") for r in run.get("results", []) if isinstance(r, dict)]
        bad = [s for s in statuses if s not in ("PASS", "SKIP-NA")]
        harness_exit = (run.get("harness") or {}).get("exit", 0)
        ok = bool(statuses) and not bad and harness_exit == 0
        run_summary = {"status": "PASS" if ok else "FAIL", "summarizedAt": now()}
        run_summary.update(run)
        comb = load(path, milestone)
        if not comb.get("results"):
            comb.pop("results", None)
        comb.setdefault("runs", {})[scenario] = run_summary
        dump(path, comb)
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
