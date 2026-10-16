// 가능성 필터와 배정 문맥 (spec.md 4.1절 4단계, 3.6·3.9절). 비AI, 결정 경로 — 정수 초·정수 mWh·정수 유리수만.
// 기기 등급(cls)은 읽지 않는다(I5). 판단은 PlannerView만 쓴다(WorldTruth import 금지, 2장).
//   phys(i)     = 가용 ∧ 커넥터 호환 ∧ 인버터 ∧ 출력 1.25× ∧ 에너지
//   feasible(i) = phys(i) ∧ qT(A_ij) ≤ qT(0.8 × L_rem)
import type { Connector, HouseholdView, PlannerView, ResourceView } from "../domain/types";
import { planArrivalS, travelProfile, type TravelProfile, type TravelProfileName } from "../engine/arrival";
import { computeLowerBoundDetail, DEFAULT_DB, type EngineDb, type LowerBoundDetail } from "../engine/lowerBound";
import { arrivalLimitS } from "../engine/margin";
import { pNum, pRange, pRatio } from "../engine/params";
import { clampInt, INF_S, mulDivFloor, qE, qT } from "../engine/quantize";

// ---------- 기기 전력 외피 ----------
export interface DeviceEnvelope {
  /** drawW.hi (W) */
  drawHiW: number;
  connectors: readonly Connector[];
  inverterSensitive: boolean;
  /** false: DB 밖 기종 → DB 전체의 보수 외피(최대 소비·AC220만·인버터 민감)를 쓴다(DEVLOG 구현 중 결정) */
  known: boolean;
}

/** DB 밖 기종의 보수 외피: 최대 drawW.hi, AC220만, 인버터 민감. 상수 없이 DB에서 유도한다 */
export function unknownEnvelope(db: EngineDb): DeviceEnvelope {
  let hi = 0;
  for (const d of db.devices.values()) if (d.drawW.value.hi > hi) hi = d.drawW.value.hi;
  return { drawHiW: hi, connectors: ["AC220"], inverterSensitive: true, known: false };
}

export function deviceEnvelope(hh: HouseholdView, db: EngineDb): DeviceEnvelope {
  const d = hh.device.specId != null ? db.devices.get(hh.device.specId) : undefined;
  if (!d) return unknownEnvelope(db);
  return { drawHiW: d.drawW.value.hi, connectors: d.connectors, inverterSensitive: d.inverterSensitive, known: true };
}

// ---------- 개별 필터 ----------
/** 커넥터 교집합 ≠ ∅ (산소는 O2_FLOW 또는 AC: 기기 DB의 커넥터 목록으로 표현한다) */
export function compatible(env: DeviceEnvelope, res: ResourceView): boolean {
  return res.connectors.some((c) => env.connectors.includes(c));
}

/** O2_FLOW로 공급하는 쌍인가(출력 필터 면제, 에너지는 10h ≥ H_need) */
export function isO2Flow(env: DeviceEnvelope, res: ResourceView): boolean {
  return res.connectors.includes("O2_FLOW") && env.connectors.includes("O2_FLOW") &&
    !res.connectors.some((c) => c !== "O2_FLOW" && env.connectors.includes(c));
}

/** 인버터 민감 기기면 inverterSafe === true여야 한다("unknown" 제외) */
export function inverterOk(env: DeviceEnvelope, res: ResourceView): boolean {
  return !env.inverterSensitive || res.inverterSafe === true;
}

/** outputW ≥ 1.25 × drawW.hi → 4·qE(out) ≥ 5·qE(draw) (O2_FLOW 면제) */
export function outputOk(env: DeviceEnvelope, res: ResourceView): boolean {
  if (isO2Flow(env, res)) return true;
  const [n, d] = pRatio("alloc.outputFactor");
  return qE(res.outputW) * d >= qE(env.drawHiW) * n;
}

/** H_need = clamp(R80_end − A_end, 1h, 24h) (정수 초) */
export function hNeedS(r80EndS: number, aEndS: number): number {
  const r = pRange("alloc.hNeedH");
  return clampInt(r80EndS - aEndS, qT(r.lo), qT(r.hi));
}

/** qE(energyWh × 0.85) — 정수 mWh, floor */
export function usableMWh(res: ResourceView): number {
  const [n, d] = pRatio("alloc.resourceEfficiency");
  return mulDivFloor(qE(res.energyWh), [n], [d]);
}

/**
 * qE(drawW.hi × H_need) = floor(qE(draw) × H_s / 3600) — 정수 mWh.
 * 3.1절 규칙 2(분자 곱 먼저, 나눗셈은 마지막 한 번 floor)를 따른다. 좌변 qE(energyWh × 0.85)도 같은 규칙(floor)이다
 * (차등 시험 결정, DEVLOG TASK D: 이전 half-up 판은 오라클 floor와 경계에서 달랐다).
 */
export function needMWh(env: DeviceEnvelope, hNeed: number): number {
  return mulDivFloor(qE(env.drawHiW), [hNeed], [3600]);
}

/** 에너지 필터. O2_FLOW 쌍은 10h ≥ H_need */
export function energyOk(env: DeviceEnvelope, res: ResourceView, hNeed: number): boolean {
  if (isO2Flow(env, res)) return qT(pNum("alloc.o2CylDeliveryH")) >= hNeed;
  return usableMWh(res) >= needMWh(env, hNeed);
}

/**
 * 낭비 = energyWh×0.85 − drawW.hi×H_need (정수 mWh). O2_FLOW 쌍은 남는 산소 시간 × 기기 소비로 환산한
 * 기기 에너지 등가(DEVLOG 구현 중 결정).
 */
export function wasteMWh(env: DeviceEnvelope, res: ResourceView, hNeed: number): number {
  if (isO2Flow(env, res)) return needMWh(env, qT(pNum("alloc.o2CylDeliveryH")) - hNeed);
  return usableMWh(res) - needMWh(env, hNeed);
}

/** 자원 지속 run_j = energyWh×0.85 / drawW.hi (정수 초). O2_FLOW 쌍은 10h, 소비 0W면 ∞ */
export function runS(env: DeviceEnvelope, res: ResourceView): number {
  if (isO2Flow(env, res)) return qT(pNum("alloc.o2CylDeliveryH"));
  if (!(env.drawHiW > 0)) return INF_S;
  const [n, d] = pRatio("alloc.resourceEfficiency");
  return Math.min(INF_S, mulDivFloor(qE(res.energyWh), [3600, n], [d, qE(env.drawHiW)]));
}

// ---------- 배정 문맥 ----------
export interface HHInfo {
  hh: HouseholdView;
  lbd: LowerBoundDetail;
  /** L_end 절대 모의 시각(정수 초). MANUAL_REVIEW면 null */
  lEndS: number | null;
  env: DeviceEnvelope;
  manual: boolean;
}

export interface RestorationS {
  p10S: number; p50S: number; p80S: number; p90S: number;
  status: PlannerView["restoration"]["status"];
  sigmaE: number | null;
}

/** ORACLE_INFO 기준선용: 진실값을 평범한 숫자로 넣는다(WorldTruth 타입을 import하지 않는다) */
export interface OracleInput {
  /** 등록 가구 id → L_true 소진 절대 시각(정수 초) */
  lEndS: Readonly<Record<string, number>>;
  /** R_true 절대 시각(정수 초) */
  rTrueS: number;
}

export interface AllocOptions {
  db?: EngineDb;
  /** 계획 이동시간 분포(3.6절). 기본 standard */
  travel?: TravelProfileName | TravelProfile;
  /** 119 지연 배수(3.6절). PlannerView.lanes.a119H에 곱한다. 기본 1 */
  stress119?: number;
  oracle?: OracleInput;
}

export interface AllocCtx {
  view: PlannerView;
  db: EngineDb;
  profile: TravelProfile;
  stress119: number;
  nowS: number;
  tOutageS: number;
  r: RestorationS;
  infos: HHInfo[];
  byId: Map<string, HHInfo>;
  arrivalMemo: Map<string, number>;
}

export function buildCtx(view: PlannerView, opts: AllocOptions = {}): AllocCtx {
  const db = opts.db ?? DEFAULT_DB;
  const profile = typeof opts.travel === "object" ? opts.travel : travelProfile(opts.travel ?? "standard");
  const rv = view.restoration;
  let r: RestorationS = {
    p10S: qT(rv.p10), p50S: qT(rv.p50), p80S: qT(rv.p80), p90S: qT(rv.p90), status: rv.status, sigmaE: rv.sigmaE,
  };
  if (opts.oracle) {
    const t = opts.oracle.rTrueS;
    r = { p10S: t, p50S: t, p80S: t, p90S: t, status: "CONFIRMED", sigmaE: 0 };
  }
  const infos: HHInfo[] = [];
  const byId = new Map<string, HHInfo>();
  const seen = new Set<string>();
  for (const hh of view.households) {
    if (seen.has(hh.id)) throw new Error(`가구 id 중복 ${hh.id}`);
    seen.add(hh.id);
    const lbd = computeLowerBoundDetail(hh, db);
    const manual = lbd.lb.status === "MANUAL_REVIEW";
    let lEndS = lbd.endS;
    if (!manual && opts.oracle) {
      const o = opts.oracle.lEndS[hh.id];
      if (o == null) throw new Error(`ORACLE_INFO: L_true 없음 ${hh.id}`);
      lEndS = o;
    }
    const info: HHInfo = { hh, lbd, lEndS, env: deviceEnvelope(hh, db), manual };
    infos.push(info);
    byId.set(hh.id, info);
  }
  const ids = new Set<string>();
  for (const res of view.resources) {
    if (ids.has(res.id)) throw new Error(`자원 id 중복 ${res.id}`);
    ids.add(res.id);
  }
  return {
    view, db, profile, stress119: opts.stress119 ?? 1, nowS: qT(view.now), tOutageS: qT(view.tOutage), r,
    infos, byId, arrivalMemo: new Map(),
  };
}

/** 계획 도착 A_ij(정수 초, '지금' 기준 길이) */
export function arrivalS(ctx: AllocCtx, info: HHInfo, res: ResourceView): number {
  const key = `${info.hh.id}|${res.id}`;
  let a = ctx.arrivalMemo.get(key);
  if (a == null) {
    a = planArrivalS(res, info.hh, ctx.view.restoration.cause, ctx.profile);
    ctx.arrivalMemo.set(key, a);
  }
  return a;
}

export interface FilterReport {
  available: boolean; compatible: boolean; inverter: boolean; output: boolean; energy: boolean;
  /** 0.8L 도착(물리 필터에는 들어가지 않는다) */
  arrival: boolean;
  aS: number; aEndS: number; hNeedS: number; wasteMWh: number; runS: number;
  phys: boolean; feasible: boolean;
}

/**
 * (i,j) 필터 보고. aEndOverrideS는 승인 행 재평가용(이미 출발한 자원의 도착 절대 시각).
 */
export function filterReport(ctx: AllocCtx, info: HHInfo, res: ResourceView, aEndOverrideS?: number): FilterReport {
  const aS = aEndOverrideS != null ? Math.max(0, aEndOverrideS - ctx.nowS) : arrivalS(ctx, info, res);
  const aEndS = ctx.nowS + aS;
  const hn = hNeedS(ctx.r.p80S, aEndS);
  const env = info.env;
  const available = res.available;
  const comp = compatible(env, res);
  const inv = inverterOk(env, res);
  const out = outputOk(env, res);
  const en = energyOk(env, res, hn);
  const phys = available && comp && inv && out && en;
  const arrival = info.lEndS != null && aS <= arrivalLimitS(info.lEndS, ctx.nowS);
  return {
    available, compatible: comp, inverter: inv, output: out, energy: en, arrival,
    aS, aEndS, hNeedS: hn, wasteMWh: wasteMWh(env, res, hn), runS: runS(env, res),
    phys, feasible: phys && arrival,
  };
}

export interface Candidate { res: ResourceView; f: FilterReport }

/** phys(i)를 풀에서 계산(A 오름차순, id 사전순) */
export function physCandidates(ctx: AllocCtx, info: HHInfo, pool: readonly ResourceView[]): Candidate[] {
  const out: Candidate[] = [];
  for (const res of pool) {
    const f = filterReport(ctx, info, res);
    if (f.phys) out.push({ res, f });
  }
  return out.sort((a, b) => a.f.aS - b.f.aS || cmpStr(a.res.id, b.res.id));
}

export function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
