"""하한 L (spec 3.2절) 독립 구현. 정수 초 연산.

입력: HouseholdView(spec 2장) 한 가구, 기기·외장 DB, 장부.
출력: {"status", "hoursS", "capS", "flags", "terms"}  (endS는 rule.py가 tReport 기준으로 붙인다)
"""
from common import qT, mul_div, chk

FLAG_ORDER = [
    "CHARGE_UNKNOWN", "AGE_UNKNOWN", "EXT_UNVERIFIED_ZERO", "SCREEN_CAPPED", "USER_INPUT_DISCOUNTED",
    "SETTING_USER_MIN", "OPERATOR_LOWER", "EXT_CHARGE_UNKNOWN", "USER_AGE_IGNORED", "MODEL_AI_UNCONFIRMED",
]


def norm_key(s):
    """정규화: 대문자, 공백·하이픈 제거 (2장 matchKeys 주석)."""
    return "".join(ch for ch in s.upper() if ch not in " -")


def edit_distance(a, b):
    """Levenshtein 거리."""
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


class DeviceDb:
    def __init__(self, device_db, ext_db):
        self.devices = {d["specId"]: d for d in device_db["devices"]}
        self.ext = {e["extSpecId"]: e for e in ext_db["ext"]}

    def get(self, spec_id):
        if spec_id is None:
            return None
        return self.devices.get(spec_id)

    def neighbors(self, dev, max_d):
        """판독 키(=그 기종 matchKeys)와 편집거리 ≤ max_d인 DB 연속 기종(자기 자신 포함)."""
        keys = [norm_key(k) for k in dev["matchKeys"]]
        out = []
        for d in self.devices.values():
            if not d["continuous"]:
                continue
            dk = [norm_key(k) for k in d["matchKeys"]]
            if min(edit_distance(a, b) for a in keys for b in dk) <= max_d:
                out.append(d)
        return sorted(out, key=lambda d: d["specId"])


def age_factor(age, P):
    """f_age 구간표: <1 → 9/10, 1≤age<2 → 8/10, 그 밖·null → 7/10. 반환 (분자, 분모, 미상 여부)."""
    e1 = P.value("lb.ageBand.edge1Y")
    e2 = P.value("lb.ageBand.edge2Y")
    if age is None:
        n, d = P.ratio("lb.fAge.default")
        return n, d, True
    if age < e1:
        n, d = P.ratio("lb.fAge.lt1")
    elif age < e2:
        n, d = P.ratio("lb.fAge.lt2")
    else:
        n, d = P.ratio("lb.fAge.default")
    return n, d, False


def _interp_setting(table, setting):
    """운영자 확인 setting의 선형 보간(정수 초, floor). 정수 setting만, 표 범위 밖이면 None."""
    if not isinstance(setting, int) and not (isinstance(setting, float) and setting == int(setting)):
        return None
    s = int(setting)
    pts = sorted(((int(p["setting"]), qT(p["runtimeH"])) for p in table), key=lambda x: x[0])
    for (s1, r1) in pts:
        if s1 == s:
            return r1
    for (s1, r1), (s2, r2) in zip(pts, pts[1:]):
        if s1 < s < s2:
            return chk(r1 * (s2 - s1) + (r2 - r1) * (s - s1)) // (s2 - s1)
    return None


def t_spec_one(dev, device_state):
    """한 기종의 T_spec(정수 초)과 max 가동시간(L_cap 첫 항용)."""
    table = dev.get("settingTable")
    if table:
        runtimes = [qT(p["runtimeH"]) for p in table]
        setting = device_state.get("setting")
        src = device_state.get("settingSource")
        if setting is not None and src == "operator":
            v = _interp_setting(table, setting)
            if v is not None:
                return v, max(runtimes)
        return min(runtimes), max(runtimes)
    t = qT(dev["internalH"]["value"])
    return t, t


def lower_bound(hh, db, P):
    dstate = hh["device"]
    flags = set()
    terms = []
    if dstate.get("userAgeY") is not None:
        flags.add("USER_AGE_IGNORED")
    dev = db.get(dstate.get("specId"))
    olh = dstate.get("operatorLowerH")

    # I4: DB 밖 기종(specId 없음·DB 미등록) 또는 비연속 기기
    if dev is None or not dev["continuous"]:
        if olh is None:
            return {"status": "MANUAL_REVIEW", "hoursS": None, "capS": None,
                    "flags": _sorted_flags(flags), "terms": []}
        L = qT(olh["hours"])
        flags.add("OPERATOR_LOWER")
        return {"status": "AUTO", "hoursS": L, "capS": L, "flags": _sorted_flags(flags),
                "terms": [["operatorLower", L]]}

    # T_spec
    spec_by = dstate.get("specBy")
    if spec_by == "ai_label_user_confirmed":
        nbrs = db.neighbors(dev, P.value("lb.neighbor.maxEditDistance"))
        pairs = [t_spec_one(d, dstate) for d in nbrs]
        T = min(p[0] for p in pairs)
        cap_first_T = min(p[1] for p in pairs)
        flags.add("MODEL_AI_UNCONFIRMED")
    else:
        T, cap_first_T = t_spec_one(dev, dstate)
    if dev.get("settingTable") and dstate.get("settingSource") == "user":
        flags.add("SETTING_USER_MIN")

    # f_age (운영자 VERIFY_AGE 값만)
    fa_n, fa_d, unknown = age_factor(dstate.get("batteryAgeY"), P)
    if unknown:
        flags.add("AGE_UNKNOWN")

    # c (정수 퍼센트)
    charge = dstate.get("charge") or {}
    src = charge.get("source")
    val = charge.get("value")
    if src in ("device_screen", "user") and val is not None:
        pct = int(val // 1)  # floor (int() 대신 // 사용, 규칙 3)
        pct = max(0, min(pct, 100))
        uf_n, uf_d = P.ratio("lb.charge.userFactor")
        c_n, c_d = pct * uf_n, 100 * uf_d
        flags.add("USER_INPUT_DISCOUNTED")
    else:
        c_n, c_d = P.ratio("lb.charge.unknown")
        flags.add("CHARGE_UNKNOWN")

    L_dev = mul_div([T, fa_n, c_n], [fa_d, c_d])
    if dstate.get("screenRemainingH") is not None:
        # 표지는 화면 값이 실제로 L_dev를 낮췄을 때만(차등 시험 결정, DEVLOG TASK D: 'CAPPED'가 거짓 표시가 되지 않게)
        scr = max(0, qT(dstate["screenRemainingH"]))
        if scr < L_dev:
            L_dev = scr
            flags.add("SCREEN_CAPPED")
    terms.append(["device", L_dev])

    # 외장: 운영자 확인분만 (I3)
    cap_n, cap_d = P.ratio("lb.cap.factor")
    L_ext = 0
    cap_ext = 0
    for e in hh.get("ext") or []:
        ov = e.get("opVerified")
        if ov is None:
            if (e.get("declaredCount") or 0) > 0:
                flags.add("EXT_UNVERIFIED_ZERO")
            continue
        es = db.ext.get(e.get("extSpecId"))
        declared = e.get("declaredCount") or 0
        cnt = ov.get("count")
        valid_count = isinstance(cnt, int) and 0 <= cnt <= declared   # count > declaredCount는 저장 불가(9절 I2)
        if es is None or dstate.get("specId") not in es["forSpecIds"] or not valid_count:
            if declared > 0:
                flags.add("EXT_UNVERIFIED_ZERO")
            continue
        count = cnt
        if count < declared:
            # 신고만 되고 확인되지 않은 나머지 외장은 0시간(3.2절 +EXT_UNVERIFIED_ZERO, 차등 시험 결정 DEVLOG TASK D)
            flags.add("EXT_UNVERIFIED_ZERO")
        R = qT(es["runtimeH"])
        if ov.get("chargeConfirmed") == "device_screen":
            ce_n, ce_d = P.ratio("lb.ext.chargeConfirmed")
        else:
            ce_n, ce_d = P.ratio("lb.ext.chargeUnknown")
            flags.add("EXT_CHARGE_UNKNOWN")
        if ov.get("extAgeY") is not None:
            fe_n, fe_d, _ = age_factor(ov["extAgeY"], P)
        else:
            fe_n, fe_d = P.ratio("lb.ext.ageUnknown")
        term = mul_div([count, R, fe_n, ce_n], [fe_d, ce_d])
        L_ext += term
        cap_ext += mul_div([count, R, cap_n, ce_n], [cap_d, ce_d])
        terms.append(["ext:" + es["extSpecId"], term])

    # 실린더: 운영자 확인분만
    L_cyl = 0
    cyl = hh.get("cylinder")
    if cyl and cyl.get("opVerified"):
        ov = cyl["opVerified"]
        per = P.hours_s("lb.cyl.hoursLoPerUnitH")
        L_cyl = qT(ov["hoursLo"])
        if L_cyl > per * int(ov["count"]):
            raise AssertionError("hoursLo > 10h x count (zod rule violated in input)")
        terms.append(["cylinder", L_cyl])

    L = L_dev + L_ext + L_cyl
    cap = mul_div([cap_first_T, cap_n], [cap_d]) + cap_ext + L_cyl
    if L > cap:   # I2
        raise AssertionError("I2 violated: L=%d > L_cap=%d" % (L, cap))
    return {"status": "AUTO", "hoursS": L, "capS": cap, "flags": _sorted_flags(flags), "terms": terms}


def _sorted_flags(flags):
    return [f for f in FLAG_ORDER if f in flags]
