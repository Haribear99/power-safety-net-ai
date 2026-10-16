"""오라클 자체 시험: 손계산 사례(oracle/tests/hand_cases.json) + 결정성 + 하한 불변식 무작위 점검.

실행: python -I oracle/run_tests.py
"""
import copy
import json
import os
import random
import sys
from fractions import Fraction

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from common import Params, load_json, SPEC_DIR  # noqa: E402
from lower_bound import DeviceDb, lower_bound  # noqa: E402
from restoration import quantile_end  # noqa: E402
from run import dumps, run_scenario  # noqa: E402

HH_DEFAULTS = {"floor": 1, "mobilityNeed": False, "caregiver": True, "ext": [], "cylinder": None,
               "lEndPrev": None, "cell": {"x": 0, "y": 0}, "pseudonym": "H-000", "tReport": 0}
DEV_DEFAULTS = {"specBy": "db_exact", "batteryAgeY": None, "charge": {"value": None, "source": "unknown"}}
RES_DEFAULTS = {"available": True, "inverterSafe": True, "mock": True, "schemaRef": "data.go.kr/15151542"}


def expand_hh(h):
    out = copy.deepcopy(HH_DEFAULTS)
    out.update(copy.deepcopy(h))
    dev = copy.deepcopy(DEV_DEFAULTS)
    dev.update(out.get("device") or {})
    out["device"] = dev
    return out


def make_qs(case):
    knots = case.get("qSKnots")
    if knots is not None:   # 정수 매듭 사이 선형(정수 결과만 쓰도록 매듭을 고른다)
        qs = []
        for (i0, v0), (i1, v1) in zip(knots, knots[1:]):
            for i in range(i0, i1):
                qs.append(v0 + (v1 - v0) * (i - i0) // (i1 - i0))
        qs.append(knots[-1][1])
        assert len(qs) == 1001
        return qs
    step = case.get("qSLinearStep")
    if step is None:
        return None
    cap = case.get("qSCapS")
    return [min(step * i, cap) if cap is not None else step * i for i in range(1001)]


def subset_mismatch(expected, actual, path=""):
    errs = []
    if isinstance(expected, dict):
        if not isinstance(actual, dict):
            return ["%s: expected object, got %r" % (path, actual)]
        for k, v in expected.items():
            errs += subset_mismatch(v, actual.get(k, "<missing>"), path + "." + k)
    elif isinstance(expected, list) and expected and isinstance(expected[0], dict):
        if not isinstance(actual, list) or len(actual) < len(expected):
            return ["%s: expected list of %d, got %r" % (path, len(expected), actual)]
        for i, v in enumerate(expected):
            errs += subset_mismatch(v, actual[i], "%s[%d]" % (path, i))
    elif expected != actual:
        errs.append("%s: expected %r, got %r" % (path, expected, actual))
    return errs


def run_hand_cases(P, db):
    data = load_json(os.path.join(HERE, "tests", "hand_cases.json"))
    passed = failed = 0
    for case in data["cases"]:
        kind = case["kind"]
        errs = []
        try:
            if kind == "lower_bound":
                got = lower_bound(expand_hh(case["input"]), db, P)
                errs = subset_mismatch(case["expected"], got)
            elif kind == "cond_quantile":
                qs = make_qs(case)
                for i, c in enumerate(case["checks"]):
                    rest = {"status": c["status"], "confirmed": c.get("confirmed")}
                    got = quantile_end(rest, qs, c["nowS"], c["tOutageS"], Fraction(*c["q"]), P, c["qKey"])
                    if got != c["expectedEndS"]:
                        errs.append("check[%d] %s: expected %d, got %d" % (i, c["arithmetic"], c["expectedEndS"], got))
            elif kind == "scenario":
                scen = copy.deepcopy(case["scenario"])
                scen["planner"]["households"] = [expand_hh(h) for h in scen["planner"]["households"]]
                scen["planner"]["resources"] = [dict(RES_DEFAULTS, **r) for r in scen["planner"]["resources"]]
                for v in scen["truth"]["hh"].values():
                    v.setdefault("backupFails", False)
                    v.setdefault("shelterRefuses", False)
                    v.setdefault("mrDelayS", 0)
                qs = make_qs(case)
                if qs is not None:
                    scen.setdefault("overrides", {})["qS"] = qs
                out1 = run_scenario(scen)
                out2 = run_scenario(copy.deepcopy(scen))
                if dumps(out1) != dumps(out2):
                    errs.append("non-deterministic output")
                errs += subset_mismatch(case["expected"], out1)
            else:
                errs.append("unknown kind " + kind)
        except Exception as e:  # 사례 하나의 예외가 전체를 멈추지 않게
            errs.append("exception: %r" % (e,))
        if errs:
            failed += 1
            print("FAIL %s  %s" % (case["id"], case["title"]))
            for e in errs:
                print("    " + e)
        else:
            passed += 1
            print("ok   %s  %s" % (case["id"], case["title"]))
    return passed, failed


def run_invariants(P, db, n=3000):
    """I2·I3 무작위 점검(오라클 자기 일관성): 이용자 입력을 바꿔도 L ≤ L_cap, 신고만 된 외장은 L 불변."""
    rng = random.Random(20261017)
    specs = ["TRILOGY100", "TRILOGY_EVO", "ASTRAL150", "LTV1150", "INOGEN_G5", "PERFECTO2"]
    ext_for = {"TRILOGY100": "TRILOGY100_DETACH", "TRILOGY_EVO": "TRILOGY_EVO_DETACH",
               "ASTRAL150": "ASTRAL_EXT", "INOGEN_G5": "INOGEN_G5_DOUBLE"}
    bad = 0
    for _ in range(n):
        spec = rng.choice(specs)
        src = rng.choice(["device_screen", "user", "unknown"])
        dev = {"specId": spec, "specBy": "db_exact",
               "batteryAgeY": rng.choice([None, 0.3, 1.2, 2.5]),
               "charge": {"value": None if src == "unknown" else rng.randint(0, 150), "source": src},
               "setting": rng.choice([None, 1, 2, 3, 5]), "settingSource": rng.choice([None, "user", "operator"]),
               "userAgeY": rng.choice([None, 0.1, 5])}
        if rng.random() < 0.3:
            dev["screenRemainingH"] = rng.choice([0.5, 2, 9])
        ext = []
        if spec in ext_for:
            ov = None
            if rng.random() < 0.5:
                ov = {"count": rng.randint(1, 2), "chargeConfirmed": rng.choice([None, "device_screen"]),
                      "extAgeY": rng.choice([None, 0.5, 3]), "auditId": "x"}
            ext.append({"extSpecId": ext_for[spec], "declaredCount": 2, "opVerified": ov})
        hh = expand_hh({"device": dev, "ext": ext})
        try:
            a = lower_bound(hh, db, P)
        except AssertionError:
            bad += 1
            continue
        # I3: 신고만 된 외장 추가 → L 불변
        hh2 = copy.deepcopy(hh)
        hh2["ext"].append({"extSpecId": ext_for.get(spec, "ASTRAL_EXT"), "declaredCount": 5, "opVerified": None})
        b = lower_bound(hh2, db, P)
        if a["hoursS"] != b["hoursS"]:
            bad += 1
        # 이용자 입력 연식 변경 → L 불변
        hh3 = copy.deepcopy(hh)
        hh3["device"]["userAgeY"] = 0.0
        if lower_bound(hh3, db, P)["hoursS"] != a["hoursS"]:
            bad += 1
    return n, bad


LANES = {"MANUAL_REVIEW", "PROPOSE_ASSIGN", "FALLBACK_119", "GAP_REDUCE", "FALLBACK_SHELTER", "HOLD",
         "UNSERVED_VISIBLE"}
CAUSES = ["KEPCO_DIST", "APT_SHORT", "APT_NIGHT_XFMR", "APT_PARTS", "APT_FIRE", "TYPHOON_WEAK",
          "TYPHOON_STRONG", "ROTATING"]


def smoke_scenario(seed):
    """실제 분위 표·DB·자원 목록으로 만든 무작위 시나리오(오라클 자체 점검용, 차등 시험 입력 아님)."""
    rng = random.Random(seed)
    mock = {k["kind"]: k for k in load_json(os.path.join(SPEC_DIR, "resources_mock.json"))["kinds"]}
    cause = CAUSES[seed % len(CAUSES)]
    status = "NEAR_CERTAIN" if cause == "ROTATING" else rng.choice(["ASSUMED_RANGE", "CONFIRMED"])
    sigma = None if status == "NEAR_CERTAIN" else rng.choice([0, 0.5, 1.0])
    rest = {"cause": cause, "tOutage": 0, "status": status, "sigmaE": sigma}
    if status == "CONFIRMED":
        rest["confirmed"] = {"rEstEndS": rng.randint(1800, 60000),
                             "multPpm": {"p10": 600000, "p80": rng.randint(1000000, 2400000), "p90": 2500000}}
    specs = ["TRILOGY100", "TRILOGY_EVO", "ASTRAL150", "LTV1150", "INOGEN_G5", "PERFECTO2", "COUGH_E70", None]
    hhs, thh = [], {}
    for i in range(30):
        hid = "H%02d" % i
        spec = rng.choice(specs)
        src = rng.choice(["device_screen", "user", "unknown"])
        dev = {"specId": spec, "specBy": "db_exact" if spec else None, "batteryAgeY": rng.choice([None, 0.5, 1.5, 3]),
               "charge": {"value": None if src == "unknown" else rng.randint(20, 100), "source": src}}
        h = {"id": hid, "tReport": rng.randint(0, 1800) / 3600, "floor": rng.randint(1, 15),
             "mobilityNeed": rng.random() < 0.42, "caregiver": rng.random() < 0.5,
             "cell": {"x": rng.randint(0, 100) / 10, "y": rng.randint(0, 100) / 10}, "device": dev}
        if spec is None:
            h["reentry"] = rng.choice([{"specId": "TRILOGY100"}, {"operatorLowerH": rng.randint(1, 8) / 2}, None])
        elif spec == "COUGH_E70":
            h["reentry"] = {"operatorLowerH": rng.randint(1, 8) / 2}
        hhs.append(expand_hh(h))
        thh[hid] = {"LTrueS": rng.randint(0, 40000), "backupFails": rng.random() < 0.3,
                    "shelterRefuses": rng.random() < 0.3, "mrDelayS": rng.randint(900, 3600)}
    res = []
    for j in range(rng.randint(4, 10)):
        k = mock[rng.choice(["ESS_S", "ESS_L", "MOBILE_GEN", "O2_CYL_DELIVERY", "EV_V2L"])]
        res.append({"id": "R%02d" % j, "kind": k["kind"], "cell": {"x": rng.randint(0, 10), "y": rng.randint(0, 10)},
                    "outputW": k["outputW"], "energyWh": k["energyWh"], "connectors": k["connectors"],
                    "inverterSafe": k["inverterSafe"], "prepH": k["prepH"], "available": rng.random() < 0.9,
                    "mock": True, "schemaRef": "data.go.kr/15151542"})
    unreg = [{"id": "U%02d" % i, "LTrueS": rng.randint(0, 30000)} for i in range(rng.randint(0, 5))]
    for u in unreg:
        u["callS"] = rng.randint(0, u["LTrueS"]) if rng.random() < 0.4 else u["LTrueS"]
    truth = {"restorationS": rng.randint(1800, 100000), "hh": thh, "unregistered": unreg,
             "arrivalTrueS": {"%s|%s" % (h["id"], r["id"]): rng.randint(600, 20000) for h in hhs for r in res},
             "a119TrueS": {x: rng.randint(600, 7200) for x in list(thh) + [u["id"] for u in unreg]},
             "shelterTrueS": {x: rng.randint(1800, 7200) for x in thh}}
    prof = rng.choice([{"prepMult": [1, 2], "speedKmh": 40, "congest": [1, 1]},
                       {"prepMult": [1, 1], "speedKmh": 25, "congest": [3, 2]},
                       {"prepMult": [2, 1], "speedKmh": 15, "congest": [5, 2]}])
    return {"scenarioId": "smoke-%d" % seed, "seed": str(seed),
            "sim": {"table": rng.choice(["gamma", "lognormal"]), "travel": prof, "stress119": rng.randint(1, 4)},
            "planner": {"tOutage": 0, "restoration": rest, "households": hhs, "resources": res,
                        "lanes": {"k119PerH": rng.choice([1, 2, 3.5, 6]), "a119H": {"lo": 1 / 6, "hi": 0.5},
                                  "shelter": {"seats": rng.randint(0, 3), "prepH": {"lo": 0.5, "hi": 2}}}},
            "truth": truth}


def run_smoke(n=200):
    """실제 표 위 무작위 시나리오: 예외 0, 결정성, 자원 중복 배정 0, 레인 집합, I4, M1 ≤ 고위험 수."""
    bad = 0
    for seed in range(1, n + 1):
        scen = smoke_scenario(seed)
        try:
            out = run_scenario(scen)
            errs = []
            if dumps(out) != dumps(run_scenario(copy.deepcopy(scen))):
                errs.append("non-deterministic")
            used = [h["resourceId"] for h in out["households"].values() if h["resourceId"] is not None]
            if len(used) != len(set(used)):
                errs.append("resource assigned twice")
            for hid, h in out["households"].items():
                if h["lane"] not in LANES:
                    errs.append("%s bad lane %r" % (hid, h["lane"]))
                if h["L"] is not None and h["L"]["status"] == "MANUAL_REVIEW" and h["resourceId"] is not None:
                    errs.append("%s MANUAL_REVIEW but resource assigned (I4)" % hid)
            m = out["metrics"]
            if not (0 <= m["M1"] <= m["highRisk"]) or m["M2S"] < 0 or m["M2S"] != sum(m["gapS"].values()):
                errs.append("metric inconsistency")
        except Exception as e:
            errs = ["exception %r" % (e,)]
        if errs:
            bad += 1
            print("SMOKE FAIL seed %d: %s" % (seed, "; ".join(errs[:5])))
    return n, bad


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    P = Params.load()
    db = DeviceDb(load_json(os.path.join(SPEC_DIR, "device_db.json")), load_json(os.path.join(SPEC_DIR, "ext_db.json")))
    passed, failed = run_hand_cases(P, db)
    n, bad = run_invariants(P, db)
    sn, sbad = run_smoke()
    print("hand cases: %d passed, %d failed" % (passed, failed))
    print("invariant checks (I2 L<=L_cap, I3 declared-only ext, USER_AGE_IGNORED): %d samples, %d violations" % (n, bad))
    print("smoke scenarios on real tables (determinism, no double booking, I4, metric sums): %d run, %d failed" % (sn, sbad))
    return 0 if failed == 0 and bad == 0 and sbad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
