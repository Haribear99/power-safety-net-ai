// 결과 판정 (spec.md 3.8절). WorldTruth만으로 채점한다. 비AI, 결정적.
// 모든 시각은 정전 시작을 0으로 둔 절대 모의 시각의 정수 초다(3.9절). 지표 합은 정수 초 합(3.1절).
import type { ResourceKind, WorldTruth } from "../domain/types";
import { o2CylDeliveryS, transport119S } from "../engine/arrival";
import { pRatio } from "../engine/params";
import { INF_S, mulDivFloor, qE, qT } from "../engine/quantize";

export type ServedBy = "RESTORE" | "RESOURCE" | "LANE_119" | "SHELTER";

export interface GapInput {
  /** L_true의 절대 소진 시각(등록 가구 tReport + LTrueH, 미등록 가구 tOutage + LTrueH) */
  lTrueEndS: number;
  /** R_true 절대 시각 */
  rTrueS: number;
  /** 배정 자원 실제 도착 절대 시각 */
  resourceArrivalS?: number | null;
  /** 자원 지속 run(정수 초). backupFails면 0 */
  resourceRunS?: number;
  /** 119 실제 도착 + 이송 완료(0.33h)까지 더한 절대 시각 */
  lane119DoneS?: number | null;
  /** 쉼터 실제 도착 절대 시각(거부면 null/∞) */
  shelterArrivalS?: number | null;
  /** 자원이 멈춘 뒤 부른 119의 이송 완료 절대 시각(recallOnResourceStop) */
  recall119DoneS?: number | null;
}

export interface GapResult { tServeS: number; servedBy: ServedBy; gapS: number }

/**
 * T_serve = min(R_true, 자원 도착, 119 도착 + 0.33, 쉼터 도착(거부 ∞)).
 * G = max(0, T_serve − L_true) + [자원 공급] · max(0, R_true − (T_serve + run + max(0, L_true − T_serve))).
 * 둘째 항의 max(0, L_true − T_serve)는 자원이 L_true 전에 도착하면 그동안 배터리가 보존된다는 해석이다.
 * T_serve ≥ L_true이면 3.8절 식과 정확히 같다(DEVLOG 구현 중 결정 — 오라클 ENGINE_SPEC 반영 필요).
 * 동점이면 RESTORE > RESOURCE > LANE_119 > SHELTER 순으로 공급원을 고른다.
 */
export function judgeGap(g: GapInput): GapResult {
  let tServeS = g.rTrueS;
  let servedBy: ServedBy = "RESTORE";
  const cands: [ServedBy, number | null | undefined][] = [
    ["RESOURCE", g.resourceArrivalS], ["LANE_119", g.lane119DoneS], ["SHELTER", g.shelterArrivalS],
  ];
  for (const [by, t] of cands) {
    if (t != null && t < tServeS) { tServeS = t; servedBy = by; }
  }
  let gapS = Math.max(0, tServeS - g.lTrueEndS);
  if (servedBy === "RESOURCE") {
    const run = g.resourceRunS ?? 0;
    const reserve = Math.max(0, g.lTrueEndS - tServeS);
    const offS = Math.min(INF_S, tServeS + run + reserve);
    const endS = g.recall119DoneS != null ? Math.min(g.rTrueS, g.recall119DoneS) : g.rTrueS;
    gapS += Math.max(0, endS - offS);
  }
  return { tServeS, servedBy, gapS };
}

/** 자원 지속 run = energyWh × 0.85 / drawW.hi (정수 초). O2 실린더 배달은 10h, 소비 0W면 ∞ */
export function resourceRunS(kind: ResourceKind, energyWh: number, deviceDrawWHi: number, backupFails: boolean): number {
  if (backupFails) return 0;
  if (kind === "O2_CYL_DELIVERY") return o2CylDeliveryS();
  if (!(deviceDrawWHi > 0)) return INF_S;
  const [n, d] = pRatio("alloc.resourceEfficiency");
  return Math.min(INF_S, mulDivFloor(qE(energyWh), [3600, n], [d, qE(deviceDrawWHi)]));
}

// ---------- 시나리오 채점 ----------
export interface ServicePlan {
  householdId: string;
  /** 등록 가구만 tReport(h). 미등록이면 생략 */
  tReportH?: number;
  /** 자원 배정(PROPOSE_ASSIGN·GAP_REDUCE): 출발(결정) 시각 h. 실제 도착 = dispatchH + arrivalTrueH[`${hh}|${res}`] */
  resource?: { resourceId: string; dispatchH: number; kind: ResourceKind; energyWh: number; deviceDrawWHi: number };
  /** 119: 진실 대기열 슬롯 시작 h. 실제 도착 = 슬롯 시작 + a119TrueH[hh], 완료 = +0.33h */
  lane119?: { slotStartH: number };
  /** 자원이 멈춘 뒤 부른 119: 진실 대기열 슬롯 시작 h */
  recall119?: { slotStartH: number };
  /** 쉼터: 출발 시각 h. 실제 도착 = dispatchH + shelterTrueH[hh], 거부면 ∞ */
  shelter?: { dispatchH: number };
  /** 시뮬레이션 동안 한 번이라도 HOLD였는가(M3) */
  everHold?: boolean;
  /** 도구에 표시된 L(시간 길이, h). M4 과대예측 판정용. 수동검토 등으로 없으면 null */
  displayedLH?: number | null;
}

export interface HouseholdOutcome extends GapResult {
  householdId: string; registered: boolean; highRisk: boolean;
  lTrueEndS: number; rTrueS: number; overPredicted: boolean; everHold: boolean;
}

export interface Ratio { num: number; den: number; value: number | null }
export interface Metrics {
  /** M1: 공백이 남은 고위험 가구 수 (M2와 공동 주 지표) */
  M1: number;
  /** M2: Σ qT(G_i) 정수 초 */
  M2S: number;
  /** M3: 한 번이라도 HOLD였던 가구 중 G>0 비율. 분모 0이면 value null(「해당 없음」) */
  M3: Ratio;
  /** M4: 표시 L > L_true 건수 */
  M4: number;
  /** M5: 미등록 가구 중 G>0 비율(명단 한계). 분모 0이면 value null */
  M5: Ratio;
  highRiskCount: number;
}

function ratio(num: number, den: number): Ratio {
  return { num, den, value: den === 0 ? null : num / den };
}

function need<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`WorldTruth에 ${what} 없음`);
  return v;
}

/**
 * WorldTruth와 서비스 계획(sim/run.ts가 만든 배정·대기열 결과)으로 가구별 공백과 지표를 낸다.
 * services에 없는 등록·미등록 가구는 '도움 없음'(T_serve = R_true)으로 채점한다.
 */
export function judgeScenario(
  truth: WorldTruth, tOutageH: number, services: readonly ServicePlan[], registeredReportH: Readonly<Record<string, number>>,
): { rows: HouseholdOutcome[]; metrics: Metrics } {
  const tOutageS = qT(tOutageH);
  const rTrueS = tOutageS + qT(truth.restorationH);
  const byId = new Map(services.map((s) => [s.householdId, s] as const));
  const done119 = transport119S();
  const rows: HouseholdOutcome[] = [];

  const judgeOne = (id: string, registered: boolean, lTrueEndS: number, LTrueH: number, backupFails: boolean, shelterRefuses: boolean) => {
    const s = byId.get(id);
    const g: GapInput = { lTrueEndS, rTrueS };
    if (s?.resource) {
      const a = need(truth.arrivalTrueH[`${id}|${s.resource.resourceId}`], `arrivalTrueH[${id}|${s.resource.resourceId}]`);
      g.resourceArrivalS = qT(s.resource.dispatchH) + qT(a);
      g.resourceRunS = resourceRunS(s.resource.kind, s.resource.energyWh, s.resource.deviceDrawWHi, backupFails);
    }
    if (s?.recall119) {
      g.recall119DoneS = qT(s.recall119.slotStartH) + qT(need(truth.a119TrueH[id], `a119TrueH[${id}]`)) + done119;
    }
    if (s?.lane119) {
      g.lane119DoneS = qT(s.lane119.slotStartH) + qT(need(truth.a119TrueH[id], `a119TrueH[${id}]`)) + done119;
    }
    if (s?.shelter && !shelterRefuses) {
      g.shelterArrivalS = qT(s.shelter.dispatchH) + qT(need(truth.shelterTrueH[id], `shelterTrueH[${id}]`));
    }
    const r = judgeGap(g);
    const shown = s?.displayedLH;
    rows.push({
      ...r, householdId: id, registered, highRisk: rTrueS > lTrueEndS, lTrueEndS, rTrueS,
      overPredicted: shown != null && qT(shown) > qT(LTrueH), everHold: s?.everHold === true,
    });
  };

  for (const id of Object.keys(truth.hh).sort()) {
    const h = truth.hh[id];
    const tRep = registeredReportH[id];
    if (tRep === undefined) throw new Error(`등록 가구 ${id}의 tReport 없음`);
    judgeOne(id, true, qT(tRep) + qT(h.LTrueH), h.LTrueH, h.backupFails, h.shelterRefuses);
  }
  for (const u of [...truth.unregistered].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    // 미등록 가구는 신고하지 않으므로 L_true는 정전 시작 기준. 예비전원·쉼터 진실은 없다(KR-07 119 호출만)
    judgeOne(u.id, false, tOutageS + qT(u.LTrueH), u.LTrueH, false, true);
  }

  let M1 = 0, M2S = 0, M4 = 0, hr = 0, holdN = 0, holdGap = 0, unregN = 0, unregGap = 0;
  for (const r of rows) {
    if (r.highRisk) { hr++; if (r.gapS > 0) M1++; }
    M2S += r.gapS;
    if (r.overPredicted) M4++;
    if (r.everHold) { holdN++; if (r.gapS > 0) holdGap++; }
    if (!r.registered) { unregN++; if (r.gapS > 0) unregGap++; }
  }
  return { rows, metrics: { M1, M2S, M3: ratio(holdGap, holdN), M4, M5: ratio(unregGap, unregN), highRiskCount: hr } };
}
