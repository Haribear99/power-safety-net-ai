"""RULE (spec 4.1절) + 이산 사건 규약(4.3절) 독립 구현. 정수 초·정수 mWh.

계획자 쪽만 본다: scenario["planner"]와 scenario["sim"](이동 분포·119 stress·분위 표 계열),
그리고 사건 시각을 정하는 데 필요한 truth.hh[*].mrDelay(검토 완료 시각, 4.3절 ①)만 읽는다.
L_true·R_true·실제 도착은 읽지 않는다(그것은 outcome.py).
"""
import copy
import heapq
import math
from fractions import Fraction

from common import NEG_SENT, SENT, qE, qT, chk, mul_div, seconds
from lower_bound import lower_bound
from restoration import quantile_end

FIXED_LANES = ("PROPOSE_ASSIGN", "GAP_REDUCE", "FALLBACK_119", "FALLBACK_SHELTER")


class Sim:
    def __init__(self, scen, P, db, qs):
        self.P = P
        self.db = db
        self.qs = qs
        pl = scen["planner"]
        self.sim = scen.get("sim") or {}
        self.rest = pl["restoration"]
        self.t_out = qT(pl["tOutage"])
        self.cause = self.rest["cause"]
        self.hh = {}
        for h in pl["households"]:
            h2 = copy.deepcopy(h)
            self.hh[h2["id"]] = h2
        self.res = {r["id"]: r for r in pl["resources"]}
        self.res_free = {rid: bool(r.get("available", True)) for rid, r in self.res.items()}
        # DB 밖 기종의 보수 외피(차등 시험 결정, DEVLOG TASK D): DB 전체 최대 drawW.hi, AC220만, 인버터 민감
        self.unknown_draw_hi = max(qE(d["drawW"]["value"]["hi"]) for d in db.devices.values())
        self.reserved = {}          # resId -> hhId (검토 예약)
        lanes = pl["lanes"]
        self.k = lanes["k119PerH"]
        self.svc = qT(1 / self.k)                     # 서비스 시간 1/k h (4.3절 ③)
        stress = self.sim.get("stress119", lanes.get("stress119", 1))
        self.a119_plan = qT(lanes["a119H"]["hi"] * stress)
        self.transport = P.hours_s("lane119.transportH")
        self.seats = int(lanes["shelter"]["seats"])
        tr = self.sim.get("travel") or {"prepMult": [1, 1], "speedKmh": P.value("arrival.speedKmh"), "congest": [1, 1]}
        self.pm = (int(tr["prepMult"][0]), int(tr["prepMult"][1]))
        self.speed = tr["speedKmh"]
        if not isinstance(self.speed, int):
            raise AssertionError("sim.travel.speedKmh must be an integer")
        self.cg = (int(tr["congest"][0]), int(tr["congest"][1]))
        self.floor_delay = P.hours_s("arrival.floorDelayH")
        self.floor_min = P.value("arrival.floorDelayMinFloor")
        # 장부 상수
        self.af = P.ratio("alloc.arrivalFactor")          # 4/5
        self.hrf = P.ratio("alloc.holdRecheckFactor")     # 5/4
        self.of = P.ratio("alloc.outputFactor")           # 5/4
        self.eff = P.ratio("alloc.resourceEfficiency")    # 17/20
        lo, hi = P.range("alloc.hNeedH")
        self.hneed_lo, self.hneed_hi = qT(lo), qT(hi)
        self.delta_min = P.hours_s("alloc.deltaMinH")
        self.sigma_max = P.ratio("alloc.hold.sigmaEMax")   # 3/4
        self.hold_margin = P.hours_s("alloc.hold.marginH")
        self.mr_hold = P.hours_s("alloc.mrHoldH")
        self.mr_cap = P.ratio("alloc.mrReserveCap")       # 1/5
        self.o2_s = P.hours_s("alloc.o2CylDeliveryH")
        self.q80 = Fraction(*P.ratio("restoration.q.p80"))
        self.q90 = Fraction(*P.ratio("restoration.q.p90"))
        # 진실 쪽에서 사건 시각만: 수동검토 지연
        truth = scen.get("truth") or {}
        self.mr_delay = {hid: seconds(v, "mrDelay", 0) for hid, v in (truth.get("hh") or {}).items()}
        # 상태
        self.queue119 = []          # 계획자 대기열 [callS, hhId, kind] (삽입 순서)
        self.state = {hid: {"lane": None, "resourceId": None, "order": None, "decidedAtS": None,
                            "delayed119": False, "everHold": False, "holdRecheckByS": None,
                            "reservedResourceId": None, "reserved119": False, "reviewed": False,
                            "L": None, "forcedNeed": False}
                      for hid in self.hh}
        self.order = 0
        self.decisions = []
        self.events = []            # heap of decision times

    # ---------- 계획자 계산 ----------
    def t_report(self, hid):
        return qT(self.hh[hid]["tReport"])

    def lb(self, hid):
        h = self.hh[hid]
        L = lower_bound(h, self.db, self.P)
        if L["status"] == "AUTO":
            end = self.t_report(hid) + L["hoursS"]
            prev = h.get("lEndPrev")
            if prev is not None:
                end = min(qT(prev), end)
            L["endS"] = end
        else:
            L["endS"] = None
        return L

    def physical(self, hid):
        """기기 물리 속성: DB 기종이면 DB, DB 밖이면 reentry.physical 또는 보수 외피.

        산소 호환은 기기 등급(cls)이 아니라 커넥터 교집합 하나로 판정한다(I5: 등급 이름만 바꾸면 결정 동일).
        산소발생기의 O2_FLOW는 spec/device_db.json 커넥터에 있다(차등 시험 결정, DEVLOG TASK D).
        """
        h = self.hh[hid]
        dev = self.db.get(h["device"].get("specId"))
        if dev is not None:
            return {"drawHi": qE(dev["drawW"]["value"]["hi"]), "connectors": set(dev["connectors"]),
                    "inverterSensitive": bool(dev["inverterSensitive"])}
        ph = h["device"].get("physical")
        if ph:
            return {"drawHi": qE(ph["drawW"]["hi"]), "connectors": set(ph["connectors"]),
                    "inverterSensitive": bool(ph.get("inverterSensitive", True))}
        return {"drawHi": self.unknown_draw_hi, "connectors": {"AC220"}, "inverterSensitive": True}

    @staticmethod
    def compatible(ph, r):
        return bool(ph["connectors"] & set(r["connectors"]))

    @staticmethod
    def inverter_ok(ph, r):
        return not ph["inverterSensitive"] or r.get("inverterSafe") is True

    def arrival(self, hid, rid):
        h = self.hh[hid]
        r = self.res[rid]
        prep = mul_div([qT(r["prepH"]["hi"]), self.pm[0]], [self.pm[1]])
        km = abs(h["cell"]["x"] - r["cell"]["x"]) + abs(h["cell"]["y"] - r["cell"]["y"])
        dist_m = qE(km)   # floor(km*1000 + 0.5) m
        travel = mul_div([dist_m, 3600, self.cg[0]], [self.speed, 1000, self.cg[1]])
        fd = 0
        if h.get("floor", 0) >= self.floor_min and h.get("mobilityNeed") and self.cause.startswith("APT_"):
            fd = self.floor_delay
        return prep + travel + fd

    def free_resources(self):
        return sorted(rid for rid, ok in self.res_free.items() if ok and rid not in self.reserved)

    def h_need(self, r80_end, a_end):
        return min(max(r80_end - a_end, self.hneed_lo), self.hneed_hi)

    def energy_left(self, r):
        return mul_div([qE(r["energyWh"]), self.eff[0]], [self.eff[1]])

    @staticmethod
    def o2_flow(ph, r):
        """O2_FLOW로 공급하는 쌍: 공통 커넥터가 O2_FLOW뿐(출력 필터 면제, 에너지는 10h ≥ H_need)."""
        return (ph["connectors"] & set(r["connectors"])) == {"O2_FLOW"}

    def run_s(self, r, ph):
        if self.o2_flow(ph, r):
            return self.o2_s
        draw_hi = ph["drawHi"]
        if not draw_hi:
            return SENT
        return mul_div([qE(r["energyWh"]), self.eff[0], 3600], [self.eff[1], draw_hi])

    def phys_check(self, ph, r, A, now, r80_end):
        """물리 필터(가용·호환·인버터·출력·에너지). 통과하면 waste(mWh), 아니면 None."""
        if not self.compatible(ph, r):
            return None
        if not self.inverter_ok(ph, r):
            return None
        hneed = self.h_need(r80_end, now + A)
        draw = ph["drawHi"]
        if self.o2_flow(ph, r):
            if self.o2_s < hneed:
                return None
            return mul_div([self.o2_s - hneed, draw or 0], [3600])
        if draw is None:
            return self.energy_left(r)
        if chk(qE(r["outputW"]) * self.of[1]) < chk(draw * self.of[0]):
            return None
        left = self.energy_left(r)
        right = mul_div([draw, hneed], [3600])
        if left < right:
            return None
        return left - right

    def phys_list(self, hid, now, r80_end, pool=None):
        """[(A, rid, waste)] — 물리 필터 통과 자원."""
        ph = self.physical(hid)
        out = []
        for rid in (pool if pool is not None else self.free_resources()):
            A = self.arrival(hid, rid)
            w = self.phys_check(ph, self.res[rid], A, now, r80_end)
            if w is not None:
                out.append((A, rid, w))
        return out

    def next119(self, now):
        end = None
        for call, _hid, _kind in self.queue119:
            start = call if end is None else max(call, end)
            end = start + self.svc
        return now if end is None else max(now, end)

    # ---------- 결정 기록 ----------
    def assign(self, hid, lane, now, order, rid=None, delayed=False, log=None):
        """order = 5단계에서 그 가구를 고른 전역 순번(1.4절 '가장 급한 가구가 레인과 무관하게 위').
        6단계로 넘긴 가구도 5단계에서 뽑힌 순번을 유지한다(차등 시험 결정, DEVLOG TASK D)."""
        st = self.state[hid]
        st.update({"lane": lane, "resourceId": rid, "order": order, "decidedAtS": now,
                   "delayed119": delayed, "forcedNeed": False})
        if rid is not None:
            self.res_free[rid] = False
        if lane == "FALLBACK_119":
            self.queue119.append([now, hid, "call"])
        if lane == "FALLBACK_SHELTER":
            self.seats -= 1
        if log is not None:
            log.append([order, hid, lane, rid])

    # ---------- 한 결정 시점의 RULE ----------
    def rule(self, now, cands, first):
        log = []
        r80 = quantile_end(self.rest, self.qs, now, self.t_out, self.q80, self.P, "p80")
        r90 = quantile_end(self.rest, self.qs, now, self.t_out, self.q90, self.P, "p90")
        Ls = {}
        mr, auto = [], []
        for hid in cands:
            L = self.lb(hid)
            Ls[hid] = L
            self.state[hid]["L"] = L
            (mr if L["status"] == "MANUAL_REVIEW" else auto).append(hid)

        def slack_tier(hid, plist):
            L_end = Ls[hid]["endS"]
            L_rem = L_end - now
            lim = mul_div([L_rem, self.af[0]], [self.af[1]])
            slack = NEG_SENT if not plist else lim - min(p[0] for p in plist)
            tier = 0 if L_end < r90 else 1
            return slack, tier, lim

        # 2단계: 수동검토 + 검토 예약 (예약은 대기 중인 가구에 1회)
        new_mr = [h for h in mr if not self.state[h]["reviewed"]]
        for hid in mr:
            self.state[hid]["lane"] = "MANUAL_REVIEW"
            self.state[hid]["order"] = None
            self.state[hid]["decidedAtS"] = now
        if new_mr and first:
            protected = set()
            for hid in auto:
                pl = self.phys_list(hid, now, r80)
                slack, tier, _ = slack_tier(hid, pl)
                if len(pl) == 1 and tier == 0 and slack < self.mr_hold:
                    protected.add(pl[0][1])
            free = self.free_resources()
            cap = mul_div([len(free), self.mr_cap[0]], [self.mr_cap[1]])
            win_end = now + self.mr_hold
            s0 = self.next119(now)
            nslots = 0 if s0 >= win_end else (win_end - s0 + self.svc - 1) // self.svc
            cap119 = mul_div([nslots, self.mr_cap[0]], [self.mr_cap[1]])
            n_res = n_119 = 0
            for hid in sorted(new_mr, key=lambda x: (self.t_report(x), x)):
                if n_res < cap:
                    best = None
                    ph = self.physical(hid)
                    for rid in self.free_resources():
                        if rid in protected:
                            continue
                        r = self.res[rid]
                        # 4.1절 2단계: 기기 사양을 모르므로 '에너지·출력 필터'만 뺀다 → 가용·호환·인버터는 적용(DEVLOG TASK D)
                        if not (self.compatible(ph, r) and self.inverter_ok(ph, r)):
                            continue
                        width = len(set(r["connectors"]) & {"AC220", "DC12"})
                        key = (self.arrival(hid, rid), -width, -r["outputW"], rid)
                        if best is None or key < best:
                            best = key
                    if best is not None:
                        self.reserved[best[3]] = hid
                        self.state[hid]["reservedResourceId"] = best[3]
                        n_res += 1
                if n_119 < cap119 and self.next119(now) < win_end:
                    self.queue119.append([now, hid, "reserve"])
                    self.state[hid]["reserved119"] = True
                    n_119 += 1

        # 3단계: 필요성 판정
        U = []
        for hid in auto:
            st = self.state[hid]
            if st["forcedNeed"]:
                U.append(hid)
                continue
            if self.is_hold(hid, Ls[hid], now, r80):
                continue
            U.append(hid)

        # 5단계: least-slack 탐욕 배정
        fallback = []
        while U:
            best = None
            info = {}
            for hid in U:
                pl = self.phys_list(hid, now, r80)
                slack, tier, lim = slack_tier(hid, pl)
                info[hid] = (pl, slack, tier, lim)
                key = (tier, slack, Ls[hid]["endS"], hid)
                if best is None or key < best:
                    best = key
            hid = best[3]
            U.remove(hid)
            self.order += 1
            ordn = self.order
            pl, slack, tier, lim = info[hid]
            L_end = Ls[hid]["endS"]
            feas = [p for p in pl if p[0] <= lim]
            if feas:
                A, rid, w = min(feas, key=lambda p: (p[2], p[0], p[1]))
                self.assign(hid, "PROPOSE_ASSIGN", now, ordn, rid, log=log)
                continue
            s = self.next119(now)
            if s + self.a119_plan + self.transport <= L_end:
                self.assign(hid, "FALLBACK_119", now, ordn, log=log)
                continue
            ph = self.physical(hid)
            bestd = None
            for A, rid, _w in pl:
                a_end = now + A
                run = self.run_s(self.res[rid], ph)
                d = min(r80, a_end + run) - max(a_end, L_end)
                key = (-d, A, rid)
                if bestd is None or key < bestd:
                    bestd = key
            if bestd is not None and -bestd[0] >= self.delta_min:
                self.assign(hid, "GAP_REDUCE", now, ordn, bestd[2], log=log)
                continue
            fallback.append((hid, ordn))

        # 6단계: 대체 레인 (마감 L_end 오름차순, id)
        for hid, ordn in sorted(fallback, key=lambda x: (Ls[x[0]]["endS"], x[0])):
            L_end = Ls[hid]["endS"]
            h = self.hh[hid]
            s = self.next119(now)
            if s + self.a119_plan + self.transport <= L_end:
                self.assign(hid, "FALLBACK_119", now, ordn, log=log)
                continue
            pl = self.phys_list(hid, now, r80)
            if pl:
                A, rid, _w = min(pl, key=lambda p: (p[0], p[1]))
                self.assign(hid, "GAP_REDUCE", now, ordn, rid, log=log)
                continue
            if s < L_end:
                self.assign(hid, "FALLBACK_119", now, ordn, delayed=True, log=log)
                continue
            if not (h.get("mobilityNeed") and not h.get("caregiver")) and self.seats > 0:
                self.assign(hid, "FALLBACK_SHELTER", now, ordn, log=log)
                continue
            self.assign(hid, "UNSERVED_VISIBLE", now, ordn, log=log)

        log.sort(key=lambda x: x[0])
        self.decisions.append({"tS": now, "r80EndS": r80, "r90EndS": r90, "assigned": log})

    def is_hold(self, hid, L, now, r80):
        if self.rest.get("status") not in ("CONFIRMED", "NEAR_CERTAIN"):
            return False
        sig = self.rest.get("sigmaE")
        # σ_e ≤ 0.75를 정수로 평가(3.1절): σ_e는 정본 JSON 정밀도(10⁻⁶) 정수 ppm으로 양자화(차등 시험 결정, DEVLOG TASK D)
        if sig is not None and math.floor(sig * 1000000 + 0.5) * self.sigma_max[1] > 1000000 * self.sigma_max[0]:
            return False
        L_rem = L["endS"] - now
        th = min(mul_div([L_rem, self.af[0]], [self.af[1]]), L_rem - self.hold_margin)
        if not (r80 - now <= th):
            return False
        pl = self.phys_list(hid, now, r80)
        a_min = min(p[0] for p in pl) if pl else SENT
        recheck = L["endS"] - mul_div([a_min, self.hrf[0]], [self.hrf[1]])
        if now >= recheck:
            return False
        st = self.state[hid]
        st.update({"lane": "HOLD", "order": None, "decidedAtS": now, "everHold": True,
                   "holdRecheckByS": recheck, "resourceId": None})
        heapq.heappush(self.events, recheck)
        return True

    # ---------- 이산 사건 루프 (4.3절) ----------
    def run(self):
        hids = sorted(self.hh)
        if not hids:
            return self
        t0 = max(self.t_report(h) for h in hids)
        review_at = {}
        for hid in hids:
            if self.lb(hid)["status"] == "MANUAL_REVIEW":
                t = max(t0, self.t_report(hid) + self.mr_delay.get(hid, 0))
                review_at[hid] = t
                heapq.heappush(self.events, t)
        heapq.heappush(self.events, t0)
        first = True
        done = set()
        while self.events:
            t = heapq.heappop(self.events)
            if t in done:
                continue
            done.add(t)
            # 이 시각에 검토가 끝나는 가구: 예약 해제 + 재진입 값 적용
            reentered = []
            for hid, rt in sorted(review_at.items()):
                if rt == t and not self.state[hid]["reviewed"]:
                    self.review(hid)
                    reentered.append(hid)
            if first:
                cands = hids
            else:
                cands = []
                for hid in hids:
                    st = self.state[hid]
                    if hid in reentered and st["lane"] != "MANUAL_REVIEW_FINAL":
                        cands.append(hid)
                    elif st["lane"] == "UNSERVED_VISIBLE":
                        cands.append(hid)
                    elif st["lane"] == "HOLD" and st["holdRecheckByS"] <= t:
                        st["forcedNeed"] = True
                        cands.append(hid)
            if first or cands:
                self.rule(t, cands, first)
            first = False
        for st in self.state.values():
            if st["lane"] == "MANUAL_REVIEW_FINAL":
                st["lane"] = "MANUAL_REVIEW"
        return self

    def review(self, hid):
        st = self.state[hid]
        st["reviewed"] = True
        rid = st["reservedResourceId"]
        if rid is not None and self.reserved.get(rid) == hid:
            del self.reserved[rid]
        if st["reserved119"]:
            self.queue119 = [q for q in self.queue119 if not (q[1] == hid and q[2] == "reserve")]
        re = self.hh[hid].get("reentry")
        dev = self.hh[hid]["device"]
        if re:
            if "specId" in re:
                dev["specId"] = re["specId"]
                dev["specBy"] = "operator"
            if re.get("operatorLowerH") is not None:
                dev["operatorLowerH"] = {"hours": re["operatorLowerH"], "basis": "sim-reentry", "auditId": "sim"}
            if re.get("physical"):
                dev["physical"] = re["physical"]
        if lower_bound(self.hh[hid], self.db, self.P)["status"] == "MANUAL_REVIEW":
            st["lane"] = "MANUAL_REVIEW_FINAL"   # 재진입 값이 없으면 수동검토로 남는다
