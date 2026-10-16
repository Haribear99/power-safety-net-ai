"""차등 비교 (spec 8절 통과 기준: 레인·배정·처리 순서·M1·M2 100% 일치).

사용: python -I oracle/diff.py <oracle 출력.json|디렉터리> <TS 출력.json|디렉터리>
두 쪽 모두 oracle/FORMAT.md의 출력 형식. 불일치가 있으면 목록을 찍고 종료 코드 1.
"""
import json
import os
import sys

FIELDS = ("lane", "resourceId", "order")


def load(p):
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


def compare(a, b):
    errs = []
    ha, hb = a.get("households", {}), b.get("households", {})
    for hid in sorted(set(ha) | set(hb)):
        if hid not in ha or hid not in hb:
            errs.append("household %s missing on one side" % hid)
            continue
        for f in FIELDS:
            if ha[hid].get(f) != hb[hid].get(f):
                errs.append("%s.%s: oracle=%r ts=%r" % (hid, f, ha[hid].get(f), hb[hid].get(f)))
    ma, mb = a.get("metrics") or {}, b.get("metrics") or {}
    for f in ("M1", "M2S"):
        if ma.get(f) != mb.get(f):
            errs.append("metrics.%s: oracle=%r ts=%r" % (f, ma.get(f), mb.get(f)))
    return errs


def main(argv):
    if len(argv) != 2:
        print(__doc__)
        return 2
    a, b = argv
    if os.path.isdir(a):
        pairs = [(os.path.join(a, f), os.path.join(b, f)) for f in sorted(os.listdir(a)) if f.endswith(".json")]
    else:
        pairs = [(a, b)]
    bad = 0
    for pa, pb in pairs:
        errs = compare(load(pa), load(pb)) if os.path.exists(pb) else ["missing TS output " + pb]
        if errs:
            bad += 1
            print("MISMATCH %s" % os.path.basename(pa))
            for e in errs:
                print("  " + e)
    print("%d/%d scenarios match" % (len(pairs) - bad, len(pairs)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
