"""결과 판정 M1·M2 (spec 3.8절) 독립 구현. WorldTruth와 RULE 결과(레인·결정 시각)만 쓴다.

공백 G (정수 초):
  G = max(0, T_serve − L_true) + (자원 공급이면 max(0, R_true − (T_serve + run + max(0, L_true − T_serve))))
  둘째 항의 `+ max(0, L_true − T_serve)`는 DEVLOG(TASK A) 수정: 자원이 배터리 소진 전에 오면 남은 배터리도
  쓴다. T_serve ≥ L_true이면 명세 원문 식과 같다.
"""
from common import qT, seconds


def evaluate(scen, sim, P):
    truth = scen["truth"]
    t_out = sim.t_out
    R_end = t_out + seconds(truth, "restoration")
    transport = P.hours_s("lane119.transportH")
    th = truth.get("hh") or {}

    def arr_dur(table_base, key):
        tS = truth.get(table_base + "S")
        if tS is not None and key in tS:
            return int(tS[key])
        tH = truth.get(table_base + "H")
        if tH is not None and key in tH:
            return qT(tH[key])
        raise KeyError("truth.%s[S|H] missing key %r" % (table_base, key))

    # 진실 119 대기열: RULE의 FALLBACK_119(결정 시각) + 미등록 가구 KR-07 호출
    calls = []
    for hid, st in sim.state.items():
        if st["lane"] == "FALLBACK_119":
            calls.append((st["decidedAtS"], hid))
    L_true_end = {}
    for hid in sim.hh:
        L_true_end[hid] = sim.t_report(hid) + seconds(th[hid], "LTrue")
    for u in truth.get("unregistered") or []:
        L_true_end[u["id"]] = t_out + seconds(u, "LTrue")
        call = seconds(u, "call", None)
        if call is None:
            call = L_true_end[u["id"]]
        calls.append((call, u["id"]))
    calls.sort()
    arrive119 = {}
    end = None
    for call, uid in calls:
        start = call if end is None else max(call, end)
        end = start + sim.svc
        arrive119[uid] = start + arr_dur("a119True", uid)

    gap = {}
    src = {}
    for hid in sorted(L_true_end):
        L = L_true_end[hid]
        st = sim.state.get(hid)
        lane = st["lane"] if st else "KR07_119"
        T = R_end
        source = "RESTORE"
        resource_run = None
        if lane in ("PROPOSE_ASSIGN", "GAP_REDUCE"):
            rid = st["resourceId"]
            arr = st["decidedAtS"] + arr_dur("arrivalTrue", hid + "|" + rid)
            if arr < T:
                T, source = arr, "RESOURCE"
                r = sim.res[rid]
                if th[hid].get("backupFails"):
                    resource_run = 0
                else:
                    resource_run = sim.run_s(r, sim.physical(hid))
        elif lane in ("FALLBACK_119", "KR07_119"):
            t119 = arrive119[hid] + transport
            if t119 < T:
                T, source = t119, "119"
        elif lane == "FALLBACK_SHELTER":
            if not th[hid].get("shelterRefuses"):
                arr = st["decidedAtS"] + arr_dur("shelterTrue", hid)
                if arr < T:
                    T, source = arr, "SHELTER"
        G = max(0, T - L)
        if resource_run is not None:
            G += max(0, R_end - (T + resource_run + max(0, L - T)))
        gap[hid] = G
        src[hid] = source

    high = [h for h in L_true_end if R_end > L_true_end[h]]
    M1 = sum(1 for h in high if gap[h] > 0)
    M2 = sum(gap.values())
    return {"M1": M1, "M2S": M2, "highRisk": len(high), "gapS": gap, "serveSource": src,
            "rTrueEndS": R_end, "lTrueEndS": L_true_end}
