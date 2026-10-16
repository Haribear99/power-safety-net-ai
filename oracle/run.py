"""독립 오라클 실행기 (spec 8절). Python 3.12 표준 라이브러리만.

사용:
  python -I oracle/run.py <scenario.json | 시나리오 디렉터리> [-o <출력 파일 | 출력 디렉터리>]
입력 형식과 출력 형식은 oracle/FORMAT.md.
"""
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from common import SPEC_DIR, Params, load_json  # noqa: E402
from lower_bound import DeviceDb  # noqa: E402
from outcome import evaluate  # noqa: E402
from rule import Sim  # noqa: E402

FORMAT_OUT = "pl26-oracle-out/1"


def load_context(scen):
    P = Params.load()
    ov = scen.get("overrides") or {}
    dev_db = {"devices": ov["devices"]} if "devices" in ov else load_json(os.path.join(SPEC_DIR, "device_db.json"))
    ext_db = {"ext": ov["ext"]} if "ext" in ov else load_json(os.path.join(SPEC_DIR, "ext_db.json"))
    db = DeviceDb(dev_db, ext_db)
    if "qS" in ov:
        qs = ov["qS"]
    else:
        tables = load_json(os.path.join(SPEC_DIR, "restoration_quantiles.json"))["tables"]
        fam = (scen.get("sim") or {}).get("table", "gamma")
        qs = tables[fam][scen["planner"]["restoration"]["cause"]]["qS"]
    if len(qs) < 2 or any(not isinstance(x, int) for x in qs) or any(b < a for a, b in zip(qs, qs[1:])):
        raise AssertionError("quantile table must be nondecreasing integer seconds")
    return P, db, qs


def run_scenario(scen):
    P, db, qs = load_context(scen)
    sim = Sim(scen, P, db, qs).run()
    out_hh = {}
    for hid, st in sorted(sim.state.items()):
        L = st["L"]
        out_hh[hid] = {
            "lane": st["lane"], "resourceId": st["resourceId"], "order": st["order"],
            "decidedAtS": st["decidedAtS"], "delayed119": st["delayed119"],
            "everHold": st["everHold"], "holdRecheckByS": st["holdRecheckByS"],
            "reservedResourceId": st["reservedResourceId"], "reserved119": st["reserved119"],
            "L": None if L is None else {"status": L["status"], "hoursS": L["hoursS"], "endS": L["endS"],
                                         "capS": L["capS"], "flags": L["flags"]},
        }
    out = {"format": FORMAT_OUT, "scenarioId": scen.get("scenarioId"), "seed": scen.get("seed"),
           "households": out_hh, "decisions": sim.decisions}
    if scen.get("truth") is not None:
        m = evaluate(scen, sim, P)
        out["metrics"] = {"M1": m["M1"], "M2S": m["M2S"], "highRisk": m["highRisk"], "gapS": m["gapS"],
                          "serveSource": m["serveSource"]}
    return out


def dumps(obj):
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 2
    src = argv[0]
    dst = None
    if len(argv) >= 3 and argv[1] == "-o":
        dst = argv[2]
    if os.path.isdir(src):
        files = sorted(os.path.join(src, f) for f in os.listdir(src) if f.endswith(".json"))
    else:
        files = [src]
    results = {}
    for f in files:
        out = run_scenario(load_json(f))
        text = dumps(out)
        results[f] = (out, text)
        if dst is None:
            print(text)
        else:
            if os.path.isdir(dst) or len(files) > 1:
                os.makedirs(dst, exist_ok=True)
                path = os.path.join(dst, os.path.basename(f))
            else:
                path = dst
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(text + "\n")
            sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
            print("%s  %s" % (sha, path))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
