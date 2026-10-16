// 배정기 속성 시험(9절 I1·I4·I5·I6·I8, 필터 불변식). 불변식마다 10,000회, 시드 고정 xoshiro128**.
// 필터 확인은 배정기 코드(feasible.ts)를 쓰지 않고 명세 식을 이 파일에서 따로 계산한다.
import { describe, expect, it } from "vitest";
import type { HouseholdView, PlannerView, ResourceView } from "../domain/types";
import { planArrivalS, travelProfile, type TravelProfile } from "../engine/arrival";
import { computeLowerBoundDetail, type EngineDb } from "../engine/lowerBound";
import { qE, qT } from "../engine/quantize";
import { computeRestorationView } from "../engine/restoration";
import { PROPERTY_RUNS } from "../engine/test-rng";
import { ALL_POLICIES, runPolicy } from "./baselines";
import type { AllocOptions } from "./feasible";
import { renderReason } from "./reasons";
import { recheckApproved, rule, type AllocResult, type PolicyId } from "./rule";
import { randomCase, renamedClassDb, type RandomCase } from "./test-scenario";

function profileOf(o: AllocOptions): TravelProfile {
  return typeof o.travel === "object" ? o.travel : travelProfile(o.travel ?? "standard");
}

/** 명세 4.1절 4단계를 그대로 옮긴 독립 확인(물리 필터) */
function indepPhys(c: RandomCase, hh: HouseholdView, res: ResourceView): { phys: boolean; aS: number } {
  const db: EngineDb = c.db;
  const d = hh.device.specId ? db.devices.get(hh.device.specId) : undefined;
  let drawHi = 0;
  for (const x of db.devices.values()) drawHi = Math.max(drawHi, x.drawW.value.hi);
  const conns = d ? d.connectors : ["AC220"];
  const invSens = d ? d.inverterSensitive : true;
  if (d) drawHi = d.drawW.value.hi;
  const aS = planArrivalS(res, hh, c.view.restoration.cause, profileOf(c.opts));
  const nowS = qT(c.view.now);
  const r80 = qT(c.view.restoration.p80);
  const hNeed = Math.min(86400, Math.max(3600, r80 - (nowS + aS)));
  const common = res.connectors.filter((x) => (conns as string[]).includes(x));
  if (!res.available || common.length === 0) return { phys: false, aS };
  if (invSens && res.inverterSafe !== true) return { phys: false, aS };
  const o2 = common.length === 1 && common[0] === "O2_FLOW";
  if (o2) return { phys: 10 * 3600 >= hNeed, aS };
  if (!(qE(res.outputW) * 4 >= qE(drawHi) * 5)) return { phys: false, aS };
  const have = Math.floor((qE(res.energyWh) * 17) / 20);
  const need = Math.floor((qE(drawHi) * hNeed + 1800) / 3600);
  return { phys: have >= need, aS };
}

function checkResult(c: RandomCase, r: AllocResult, policy: PolicyId): void {
  const v = c.view;
  const nowS = qT(v.now);
  const ids = r.rows.map((x) => x.rec.householdId).sort();
  expect(ids).toEqual(v.households.map((h) => h.id).sort());
  // 처리 순서는 0..n−1 순열, MANUAL_REVIEW가 앞
  expect(r.rows.map((x) => x.rec.order)).toEqual(r.rows.map((_, i) => i));
  const firstNonMr = r.rows.findIndex((x) => x.rec.lane !== "MANUAL_REVIEW");
  if (firstNonMr >= 0) expect(r.rows.slice(firstNonMr).some((x) => x.rec.lane === "MANUAL_REVIEW")).toBe(false);

  const usedBefore = new Set(c.state.usedResourceIds ?? []);
  const usedNow = new Set<string>();
  const reservedNow = new Set<string>();
  let reservations = 0;
  for (const row of r.rows) {
    const rec = row.rec;
    // I6: 배정기 출력은 모두 PROPOSED
    expect(row.status).toBe("PROPOSED");
    expect(() => renderReason(rec.reason as never)).not.toThrow();
    for (const n of row.notes) expect(() => renderReason(n)).not.toThrow();
    const hh = v.households.find((h) => h.id === rec.householdId)!;
    const lbd = computeLowerBoundDetail(hh, c.db);
    // I4: 하한 자동 계산 불가 ⇔ MANUAL_REVIEW, 수동검토 완료 전 PROPOSE_ASSIGN 0
    if (policy !== "NONE") expect(lbd.lb.status === "MANUAL_REVIEW").toBe(rec.lane === "MANUAL_REVIEW");
    if (lbd.lb.status === "MANUAL_REVIEW") expect(rec.lane === "PROPOSE_ASSIGN" || rec.lane === "GAP_REDUCE").toBe(false);
    if (rec.lane === "MANUAL_REVIEW") {
      if (rec.reservedResourceId) {
        reservations += 1;
        reservedNow.add(rec.reservedResourceId);
        expect(r.protectedResourceIds).not.toContain(rec.reservedResourceId);
        expect(usedBefore.has(rec.reservedResourceId)).toBe(false);
      } else expect(row.reservation?.noResourceWhy).not.toBeNull();
    }
    if (rec.lane === "PROPOSE_ASSIGN" || rec.lane === "GAP_REDUCE") {
      const res = v.resources.find((x) => x.id === rec.resourceId)!;
      expect(res).toBeDefined();
      expect(usedBefore.has(res.id)).toBe(false);
      expect(usedNow.has(res.id)).toBe(false);
      usedNow.add(res.id);
      // 호환·인버터·출력 1.25×·에너지 필터는 어떤 정책에서도 위반 0
      const ip = indepPhys(c, hh, res);
      expect(ip.phys).toBe(true);
      expect(row.aS).toBe(ip.aS);
      if (rec.lane === "PROPOSE_ASSIGN" && policy !== "ORACLE_INFO") {
        // 0.8L 도착 필터(전체 필터)
        expect(ip.aS).toBeLessThanOrEqual(Math.floor((((lbd.endS as number) - nowS) * 4) / 5));
      }
    }
    if (rec.lane === "HOLD") {
      expect(["RULE", "R_L", "RULE_NO_R", "RULE_FEASIBLE_FIRST", "RULE_NO_RESERVE", "ORACLE_INFO"]).toContain(policy);
      if (policy !== "ORACLE_INFO") expect(["CONFIRMED", "NEAR_CERTAIN"]).toContain(v.restoration.status);
      // now ≥ holdRecheckBy이면 HOLD가 남지 않음
      expect(nowS).toBeLessThan(qT(rec.holdRecheckBy as number));
      expect(rec.tier).toBeNull();
    }
    if (rec.lane === "FALLBACK_119" && row.late119 === false) {
      expect(qT(rec.etaH as number)).toBeLessThanOrEqual(row.lEndS as number);
    }
    // I8: 여유는 범위(lo ≤ hi)로만
    if (rec.marginH) expect(rec.marginH.lo).toBeLessThanOrEqual(rec.marginH.hi);
    expect(rec.R.label).toBe("가정 시나리오 범위 · 한전 실시간 예측 아님");
  }
  for (const id of reservedNow) expect(usedNow.has(id)).toBe(false);
  // 예약 총수 ≤ floor(가용 자원 × 1/5)
  const avail = v.resources.filter((x) => x.available && !usedBefore.has(x.id)).length;
  expect(reservations).toBeLessThanOrEqual(Math.floor(avail / 5));
  // 119 계획 대기열: 슬롯이 겹치지 않음
  const slots = [...r.slots119].sort((a, b) => a.startS - b.startS);
  for (let i = 1; i < slots.length; i++) expect(slots[i].startS).toBeGreaterThanOrEqual(slots[i - 1].endS);
  expect(r.shelterSeatsUsed).toBeLessThanOrEqual(v.lanes.shelter.seats);
}

function oracleFor(c: RandomCase) {
  const lEndS: Record<string, number> = {};
  for (const h of c.view.households) lEndS[h.id] = qT(h.tReport) + 3600 * 2;
  return { lEndS, rTrueS: qT(c.view.restoration.p50) };
}

const LONG = 300_000;

describe("배정기 속성 시험 (불변식마다 10,000회)", () => {
  it("모든 정책: PROPOSED만, 물리 필터·1.25× 출력·에너지·호환 위반 0, PROPOSE_ASSIGN은 0.8L 도착, 예약 상한, 대기열", () => {
    for (let s = 1; s <= PROPERTY_RUNS; s++) {
      const c = randomCase(s);
      const pol = ALL_POLICIES[s % ALL_POLICIES.length];
      const o = oracleFor(c);
      const r = runPolicy(pol, c.view, c.opts, c.state, o);
      if (pol === "ORACLE_INFO") {
        const R = c.view.restoration;
        const t = o.rTrueS / 3600;
        checkResult({ ...c, view: { ...c.view, restoration: { ...R, p10: t, p50: t, p80: t, p90: t } } }, r, pol);
      } else checkResult(c, r, pol);
      if (pol !== "RULE") checkResult(c, rule(c.view, c.opts, c.state), "RULE");
    }
  }, LONG);

  it("I5: 등급 이름만 바꾸면 결정이 같다(배정기는 등급을 읽지 않는다)", () => {
    for (let s = 1; s <= PROPERTY_RUNS; s++) {
      const c = randomCase(s);
      const a = rule(c.view, c.opts, c.state);
      const b = rule(c.view, { ...c.opts, db: renamedClassDb(c.db) }, c.state);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    }
  }, LONG);

  it("결정성: 같은 입력 두 번이면 같은 결과", () => {
    for (let s = 1; s <= 2000; s++) {
      const c = randomCase(s);
      expect(JSON.stringify(rule(c.view, c.opts, c.state))).toBe(JSON.stringify(rule(c.view, c.opts, c.state)));
    }
  }, LONG);

  it("I1: R만 늘리면 HOLD가 '필요'로 바뀐다", () => {
    let holds = 0;
    for (let s = 1; s <= PROPERTY_RUNS; s++) {
      const c = randomCase(s);
      const a = rule(c.view, c.opts, c.state);
      if (!a.rows.some((x) => x.rec.lane === "HOLD")) continue;
      holds += 1;
      const big = 1000;
      const R = c.view.restoration;
      const v2: PlannerView = { ...c.view, restoration: { ...R, p10: R.p10 + big, p50: R.p50 + big, p80: R.p80 + big, p90: R.p90 + big } };
      const b = rule(v2, c.opts, c.state);
      expect(b.rows.some((x) => x.rec.lane === "HOLD")).toBe(false);
    }
    expect(holds).toBeGreaterThan(50);
  }, LONG);

  it("I1: RULE 순서가 L만의 정렬·거리만의 정렬과 다른 사례가 존재하고, ASSUMED_RANGE에서 원인(R 분위)만 바꿔도 순서가 바뀌는 사례가 존재", () => {
    let diffL = 0, diffDist = 0, diffCause = 0;
    for (let s = 1; s <= 3000; s++) {
      const c = randomCase(s);
      const a = rule(c.view, c.opts, c.state);
      const auto = a.rows.filter((x) => x.lEndS != null && x.rec.lane !== "HOLD");
      const ordIds = auto.map((x) => x.rec.householdId);
      const byL = [...auto].sort((x, y) => (x.lEndS as number) - (y.lEndS as number) || (x.rec.householdId < y.rec.householdId ? -1 : 1)).map((x) => x.rec.householdId);
      const dist = (id: string) => {
        const h = c.view.households.find((x) => x.id === id)!;
        return Math.min(Infinity, ...c.view.resources.map((r) => Math.abs(r.cell.x - h.cell.x) + Math.abs(r.cell.y - h.cell.y)));
      };
      const byD = [...auto].sort((x, y) => dist(x.rec.householdId) - dist(y.rec.householdId) || (x.rec.householdId < y.rec.householdId ? -1 : 1)).map((x) => x.rec.householdId);
      if (JSON.stringify(ordIds) !== JSON.stringify(byL)) diffL += 1;
      if (JSON.stringify(ordIds) !== JSON.stringify(byD)) diffDist += 1;
      if (c.view.restoration.status === "ASSUMED_RANGE") {
        const other = c.view.restoration.cause === "APT_FIRE" ? "KEPCO_DIST" : "APT_FIRE";
        const v2 = { ...c.view, restoration: { ...c.view.restoration, ...(() => {
          const rv = randomCaseRestoration(other, c.view);
          return { p10: rv.p10, p50: rv.p50, p80: rv.p80, p90: rv.p90, cause: other };
        })() } } as PlannerView;
        const b = rule(v2, c.opts, c.state);
        const o1 = a.rows.filter((x) => x.rec.lane !== "MANUAL_REVIEW").map((x) => x.rec.householdId);
        const o2 = b.rows.filter((x) => x.rec.lane !== "MANUAL_REVIEW").map((x) => x.rec.householdId);
        if (JSON.stringify(o1) !== JSON.stringify(o2)) diffCause += 1;
      }
    }
    expect(diffL).toBeGreaterThan(0);
    expect(diffDist).toBeGreaterThan(0);
    expect(diffCause).toBeGreaterThan(0);
  }, LONG);

  it("I5: 수동검토 재진입(비연속·DB 밖) 가구가 모두 같은 순번 구간에 몰리지 않는다", () => {
    let eligible = 0, contiguous = 0;
    for (let s = 1; s <= PROPERTY_RUNS; s++) {
      const c = randomCase(s);
      const a = rule(c.view, c.opts, c.state);
      const rows = a.rows.filter((x) => x.rec.lane !== "MANUAL_REVIEW" && x.rec.lane !== "HOLD");
      const re = rows.map((x, i) => ({ i, op: x.rec.L.flags.includes("OPERATOR_LOWER") })).filter((x) => x.op).map((x) => x.i);
      if (re.length < 2 || rows.length - re.length < 2) continue;
      eligible += 1;
      if (re[re.length - 1] - re[0] === re.length - 1) contiguous += 1;
    }
    expect(eligible).toBeGreaterThan(100);
    expect(contiguous / eligible).toBeLessThan(0.5);
  }, LONG);
  it("I6: 승인 뒤 재신고로 L_end가 줄어 도착 조건이 깨지면 RECHECK_FLAG와 새 PROPOSED 대안, 승인 배정은 바뀌지 않음", () => {
    let flaggedRuns = 0;
    for (let s = 1; s <= PROPERTY_RUNS; s++) {
      const c = randomCase(s);
      const a = rule(c.view, c.opts, c.state);
      const approved = a.rows
        .filter((x) => ["PROPOSE_ASSIGN", "GAP_REDUCE", "FALLBACK_119", "FALLBACK_SHELTER"].includes(x.rec.lane))
        .map((x) => ({ householdId: x.rec.householdId, lane: x.rec.lane, resourceId: x.rec.resourceId, etaH: x.rec.etaH, slot119: x.slot119, late119: x.late119 }));
      if (approved.length === 0) continue;
      const frozen = JSON.stringify(approved);
      // 재신고: 충전량을 무작위로 낮춰 다시 신고(lEndPrev = 직전 L_end, 정전 중 비증가), 모의시계 조금 경과
      const g = (s * 2654435761) >>> 0;
      const dt = (g % 1800) / 3600;
      const now2 = c.view.now + dt;
      const hs = c.view.households.map((h) => {
        const prev = computeLowerBoundDetail(h, c.db);
        if (prev.endS == null || (g >> 3) % 2 === 0) return h;
        return { ...h, tReport: now2, lEndPrev: prev.endS / 3600, device: { ...h.device, charge: { value: (g >> 5) % 30, source: "device_screen" as const } } };
      });
      const v2: PlannerView = { ...c.view, now: now2, households: hs };
      const out = recheckApproved(v2, approved, "2026-10-17T22:00:00+09:00", c.opts);
      expect(JSON.stringify(approved)).toBe(frozen);
      const nowS = qT(now2);
      for (const ap of approved) {
        if (ap.lane !== "PROPOSE_ASSIGN") continue;
        const h = hs.find((x) => x.id === ap.householdId)!;
        const lEnd = computeLowerBoundDetail(h, c.db).endS as number;
        const aEnd = qT(ap.etaH as number);
        const broken = nowS < aEnd && aEnd - nowS > Math.floor(((lEnd - nowS) * 4) / 5);
        if (broken) expect(out.flagged.map((f) => f.householdId)).toContain(ap.householdId);
      }
      for (const e of out.audit) {
        expect(e.actor).toBe("system");
        expect(e.action).toBe("RECHECK_FLAG");
      }
      expect(out.audit.length).toBe(out.flagged.length);
      const fl = new Set(out.flagged.map((f) => f.householdId));
      expect(new Set(out.alternatives.map((r) => r.rec.householdId))).toEqual(fl);
      for (const r of out.alternatives) expect(r.status).toBe("PROPOSED");
      // 대안은 다른 승인 배정의 자원을 쓰지 않는다
      const otherRes = new Set(approved.filter((x) => !fl.has(x.householdId) && x.resourceId).map((x) => x.resourceId));
      for (const r of out.alternatives) if (r.rec.resourceId) expect(otherRes.has(r.rec.resourceId)).toBe(false);
      if (out.flagged.length > 0) flaggedRuns += 1;
    }
    expect(flaggedRuns).toBeGreaterThan(100);
  }, LONG);
});

function randomCaseRestoration(cause: PlannerView["restoration"]["cause"], v: PlannerView) {
  return computeRestorationView({ cause, tOutageH: v.tOutage, nowH: v.now });
}
