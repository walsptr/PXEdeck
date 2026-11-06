#!/usr/bin/env python3
"""Ringkas bukti axe (writeAxeEvidence): pelanggaran tersisa (kept) per audit + jumlah filter per kategori DEC-019 §3."""
import collections, json, sys
for p in sys.argv[1:]:
    d = json.load(open(p))
    print(f"== {p.split('/')[-1]} generatedAt={d['generatedAt']} audits={len(d['audits'])}")
    print(f"filteredCount {d['filteredCount']}")
    kept_total = 0
    for a in d["audits"]:
        cats = collections.Counter(); kept = 0; ids = set()
        for v in a["violations"]:
            ids.add(v["id"])
            for x in v.get("detail", []):
                cats[x["category"]] += 1
                if x["category"] == "kept": kept += 1
        if a["label"] != "self-test sintetis": kept_total += kept
        print(f"  {a['label'][:44]:44s} viol={sorted(ids)} kept={kept} {dict(cats)}")
    print(f"TOTAL kept (non-selftest) = {kept_total}")
