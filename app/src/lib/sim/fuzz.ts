// 경계 퍼즈 500건 (spec.md 8절 '경계 퍼즈 500건', 봉인 S2b '경계 퍼즈 생성 규칙'). 비AI, 결정적 — Math.random·Date 없음.
// 작은 materialize 시나리오(sim/materialize.ts, LHS θ)를 바탕으로 만든 뒤, 8절 목록의 경계에 정확히 걸리도록 계획자 입력을 고친다.
// 경계 값은 TS 엔진 함수(planArrivalS·computeLowerBoundDetail·arrivalLimitS 등)로 풀고, 정본 JSON으로 다시 읽은 뒤
// 범주별 검사(check)로 경계가 실제로 걸렸는지 확인한다(걸리지 않으면 다음 시도). Python 오라클은 같은 JSON만 읽는다.
// 진실(truth) 값은 바탕 시나리오 것을 쓰고, 가구·자원을 더하거나 뺄 때만 같은 규칙으로 맞춘다(차등 시험은 두 구현이 같은 입력을
// 같게 처리하는지만 본다). 범주와 건수는 FUZZ_PLAN이 정한다. 시험 전용 기기(미끼 기종)는 overrides.devices로만 넣는다(oracle/FORMAT.md).
// 퍼즈 입력의 숫자는 모두 합성 시험값이다(출처 유형 assumed: 경계를 만들려고 고른 값, 실제 사양·사건 아님).
import type { DeviceSpec, ResourceView } from "../domain/types";
import { CAUSES } from "../domain/types";
import { plan119S, planArrivalS, transport119S } from "../engine/arrival";
import { computeLowerBoundDetail, DEFAULT_DB, buildDb, type EngineDb, type LowerBoundDetail } from "../engine/lowerBound";
import { arrivalLimitS } from "../engine/margin";
import { pRatio } from "../engine/params";
import { mulDivFloor, qE, qT, sToH } from "../engine/quantize";
import { quantileTable } from "../engine/restoration";
import type { MatHousehold } from "./generator";
import { lhsSample, round6, type Theta } from "./lhs";
import { canonicalJson, materializeRaw, restorationAtS, sha256Hex, type MaterializedScenario } from "./materialize";
import { rngFor, type Rng } from "./prng";

export const FUZZ_COUNT = 500;
/** PRNG master(봉인 대상). 개발 시드 범위와 겹치지 않는 문자열 */
export const FUZZ_MASTER = "PL26-BOUNDARY-FUZZ-v1";
const MAX_ATTEMPTS = 40;

/** 시험 전용 입력(oracle/FORMAT.md `overrides`). TS는 diff 실행기가 buildDb로 같은 DB를 만든다 */
export interface FuzzScenario extends MaterializedScenario {
  overrides?: { devices: DeviceSpec[] };
}

export interface FuzzCase {
  scenarioId: string;
  category: string;
  /** 경계 변형(예: d-1, d+0, d+1) */
  variant: string;
  json: string;
  sha256: string;
}

type M = FuzzScenario;
type HH = MatHousehold;
interface Built { m: M; variant: string; check?: (m: M) => boolean }
interface Ctx { rng: Rng; k: number; caseNo: number; attempt: number; theta: Theta }
type Builder = (c: Ctx) => Built | null;

// ---------- 보조 ----------
const DELTAS = [-1, 0, 1] as const;
const dOf = (k: number) => DELTAS[k % 3];
const dName = (d: number) => (d < 0 ? `d${d}` : `d+${d}`);
const round1 = (x: number) => Math.round(x * 10) / 10;

/** TS 쪽 기기 DB(시험 전용 overrides.devices가 있으면 그것으로) — diff 실행기도 쓴다 */
export function fuzzDb(m: M): EngineDb {
  return m.overrides ? buildDb(m.overrides.devices, [...DEFAULT_DB.ext.values()]) : DEFAULT_DB;
}
function strip(h: HH) {
  const { reentry: _r, ...rest } = h;
  void _r;
  return rest;
}
export function fuzzLbd(m: M, h: HH): LowerBoundDetail {
  return computeLowerBoundDetail(strip(h), fuzzDb(m));
}
export function fuzzT0S(m: M): number {
  return Math.max(...m.planner.households.map((h) => qT(h.tReport)));
}
function arrS(m: M, h: HH, r: ResourceView): number {
  return planArrivalS(r, h, m.planner.restoration.cause, m.sim.travel);
}
function hh(m: M, id: string): HH {
  const h = m.planner.households.find((x) => x.id === id);
  if (!h) throw new Error(`퍼즈: 가구 없음 ${id}`);
  return h;
}
function res(m: M, id: string): ResourceView {
  const r = m.planner.resources.find((x) => x.id === id);
  if (!r) throw new Error(`퍼즈: 자원 없음 ${id}`);
  return r;
}
function autoIds(m: M): string[] {
  return m.planner.households.filter((h) => fuzzLbd(m, h).lb.status === "AUTO").map((h) => h.id);
}

/** 긴 기기(ASTRAL150, 기기 화면 100%, 연식 0.5년 → L = 8 × 0.9 × 0.9 = 6.48h)로 바꾼다. L_end는 setLEnd로 낮춘다 */
function makeLong(h: HH): void {
  h.device = { specId: "ASTRAL150", specBy: "db_exact", batteryAgeY: 0.5, charge: { value: 100, source: "device_screen" } };
  h.ext = [];
  delete h.cylinder;
  delete h.reentry;
  h.lEndPrev = null;
}
/** L_end를 정확히 endS로(재신고 규칙 L_end = min(lEndPrev, tReport + L), 3.9절). 자연 L_end보다 크면 실패 */
function setLEnd(m: M, h: HH, endS: number): boolean {
  h.lEndPrev = null;
  const d = fuzzLbd(m, h);
  if (d.endS == null || endS > d.endS || endS < 0) return false;
  h.lEndPrev = sToH(endS);
  return true;
}
function lEndOf(m: M, h: HH): number | null {
  return fuzzLbd(m, h).endS;
}
/** 물리 필터를 넉넉히 통과하는 자원(ESS_L 꼴, 에너지 60kWh·출력 5kW·AC220+DC12·인버터 안전) */
function makeStrong(r: ResourceView): void {
  r.kind = "ESS_L";
  r.connectors = ["AC220", "DC12"];
  r.inverterSafe = true;
  r.outputW = 5000;
  r.energyWh = 60000;
  r.available = true;
}
/** 계획 도착 A_ij를 정확히 target 초로: 자원 셀을 가구에서 0.1km씩 옮기며 prepH.hi(정수 초)를 푼다 */
function setArrival(m: M, h: HH, r: ResourceView, target: number): boolean {
  const [n, d] = m.sim.travel.prepMult;
  for (let k = 0; k <= 80; k++) {
    const cell = { x: round1(h.cell.x + k * 0.1), y: h.cell.y };
    const base = planArrivalS({ cell, prepH: { lo: 0, hi: 0 } }, h, m.planner.restoration.cause, m.sim.travel);
    const rest = target - base;
    if (rest < 0) return false;
    const P = Math.ceil((rest * d) / n);
    if (mulDivFloor(P, [n], [d]) !== rest) continue;
    r.cell = cell;
    r.prepH = { lo: Math.min(r.prepH.lo, sToH(P)), hi: sToH(P) };
    return arrS(m, h, r) === target;
  }
  return false;
}
/** 복구 통보 CONFIRMED: R_q_end = now + floor(max(0, R_est_end − now) × ppm / 10⁶) (3.5·3.9절) */
function setConfirmed(m: M, rEstEndS: number, sigmaE: number, ppm = { p10: 1_000_000, p80: 1_000_000, p90: 1_000_000 }): void {
  m.planner.restoration.status = "CONFIRMED";
  m.planner.restoration.sigmaE = sigmaE;
  m.planner.restoration.confirmed = { rEstEndS, multPpm: ppm };
}
function setAssumed(m: M): void {
  m.planner.restoration.status = m.planner.restoration.cause === "ROTATING" ? "NEAR_CERTAIN" : "ASSUMED_RANGE";
  m.planner.restoration.sigmaE = null;
  delete m.planner.restoration.confirmed;
}
/** 가구·자원만 남긴다(진실 표도 같이) */
function restrict(m: M, keepHH: readonly string[] | null, keepRes: readonly string[] | null): void {
  const hs = keepHH ? new Set(keepHH) : null, rs = keepRes ? new Set(keepRes) : null;
  if (hs) {
    m.planner.households = m.planner.households.filter((h) => hs.has(h.id));
    for (const id of Object.keys(m.truth.hh)) if (!hs.has(id)) delete m.truth.hh[id];
    for (const id of Object.keys(m.truth.shelterTrueS)) if (!hs.has(id)) delete m.truth.shelterTrueS[id];
    const unreg = new Set(m.truth.unregistered.map((u) => u.id));
    for (const id of Object.keys(m.truth.a119TrueS)) if (!hs.has(id) && !unreg.has(id)) delete m.truth.a119TrueS[id];
    for (const id of Object.keys(m.labels)) if (!hs.has(id) && !unreg.has(id)) delete m.labels[id];
  }
  if (rs) m.planner.resources = m.planner.resources.filter((r) => rs.has(r.id));
  for (const key of Object.keys(m.truth.arrivalTrueS)) {
    const [h, r] = key.split("|");
    if ((hs && !hs.has(h)) || (rs && !rs.has(r))) delete m.truth.arrivalTrueS[key];
  }
}
/** 가구 복제(진실 표 포함). 새 id는 사전순 비교에 쓰인다 */
function cloneHH(m: M, srcId: string, newId: string): HH {
  const src = hh(m, srcId);
  const c = JSON.parse(JSON.stringify(src)) as HH;
  c.id = newId;
  c.pseudonym = newId;
  m.planner.households.push(c);
  m.truth.hh[newId] = JSON.parse(JSON.stringify(m.truth.hh[srcId]));
  for (const r of m.planner.resources) m.truth.arrivalTrueS[`${newId}|${r.id}`] = m.truth.arrivalTrueS[`${srcId}|${r.id}`];
  m.truth.a119TrueS[newId] = m.truth.a119TrueS[srcId];
  m.truth.shelterTrueS[newId] = m.truth.shelterTrueS[srcId];
  m.labels[newId] = m.labels[srcId];
  return c;
}
/** 수동검토로 바꾼다(DB 밖 기종). reentry는 호출자가 정한다 */
function makeUnknown(h: HH): void {
  h.device = { specId: null, specBy: null, batteryAgeY: null, charge: { value: null, source: "unknown" } };
  h.ext = [];
  delete h.cylinder;
  h.lEndPrev = null;
}
/** 화면용 now·복구 범위·구성 수를 고친 입력에 맞춘다(두 구현 모두 결정 시점을 따로 계산하므로 표시값일 뿐) */
function finalize(m: M): void {
  const t0 = fuzzT0S(m);
  m.planner.now = sToH(t0);
  const r = m.planner.restoration;
  const view = restorationAtS({ cause: r.cause, tOutage: r.tOutage, status: r.status, sigmaE: r.sigmaE, confirmed: r.confirmed, table: m.sim.table }, t0);
  m.planner.restoration = { ...view, ...(r.confirmed ? { confirmed: r.confirmed } : {}) };
  m.composition = {
    ...m.composition, nRegistered: m.planner.households.length, nResources: m.planner.resources.length, nUnregistered: m.truth.unregistered.length,
  };
}

function baseScenario(c: Ctx, nHH: number, nRes: number, opts: { cause?: (typeof CAUSES)[number]; theta?: Partial<Theta> } = {}): M {
  const cause = opts.cause ?? CAUSES[c.rng.int(0, CAUSES.length - 1)];
  const table = c.rng.bernoulli(0.2) ? "lognormal" : "gamma";
  return materializeRaw({
    scenarioId: `FUZZ-${String(c.caseNo).padStart(3, "0")}`, seed: `${FUZZ_MASTER}-${c.caseNo}-${c.attempt}`, cause,
    theta: { ...c.theta, ...opts.theta }, nRegistered: nHH, nResources: nRes, focusClass: null, nFocus: 0, table,
  }) as M;
}
const NOT_ROT = CAUSES.filter((x) => x !== "ROTATING");
const causeNotRot = (c: Ctx) => NOT_ROT[c.rng.int(0, NOT_ROT.length - 1)];
/** AUTO이고 남은 하한이 minRemS 이상인 가구. 없으면 아무 가구를 긴 기기로 바꾼다 */
function pickAuto(m: M, c: Ctx, minRemS: number): HH {
  const t0 = fuzzT0S(m);
  const ok = m.planner.households.filter((h) => { const e = lEndOf(m, h); return e != null && e - t0 >= minRemS; });
  if (ok.length > 0) return ok[c.rng.int(0, ok.length - 1)];
  const h = m.planner.households[c.rng.int(0, m.planner.households.length - 1)];
  makeLong(h);
  return h;
}
function allUnavailable(m: M): void {
  for (const r of m.planner.resources) r.available = false;
}
/** 계획 119 이송 완료 = s + A_119(계획) + 0.33h */
function a119Done(m: M, startS: number): number {
  return startS + plan119S(m.planner.lanes.a119H, m.sim.stress119) + transport119S();
}
function svcS(m: M): number {
  return qT(1 / m.planner.lanes.k119PerH);
}
function holdTh(lRem: number): number {
  const [n, d] = pRatio("alloc.hold.marginH");
  const [an, ad] = pRatio("alloc.arrivalFactor");
  return Math.min(mulDivFloor(lRem, [an], [ad]), lRem - mulDivFloor(3600, [n], [d]));
}
/** holdRecheckBy = L_end − 1.25·A_min */
function byOf(lEndS: number, aS: number): number {
  const [n, d] = pRatio("alloc.holdRecheckFactor");
  return lEndS - mulDivFloor(aS, [n], [d]);
}
/** holdRecheckBy가 byS가 되는 L_end */
function lEndForBy(byS: number, aS: number): number {
  const [n, d] = pRatio("alloc.holdRecheckFactor");
  return byS + mulDivFloor(aS, [n], [d]);
}

// ---------- 범주 ----------
// 1. slack 동점: 같은 가구를 복제해 (tier, slack, L)이 모두 같고 id 사전순만 다르게
const slackTie: Builder = (c) => {
  const m = baseScenario(c, c.rng.int(2, 5), c.rng.int(1, 4));
  const ids = autoIds(m);
  if (ids.length === 0) return null;
  const src = ids[c.rng.int(0, ids.length - 1)];
  cloneHH(m, src, `${src}a`);
  if (c.k % 2 === 1) cloneHH(m, src, "H000");
  return { m, variant: c.k % 2 === 1 ? "clone2" : "clone1", check: (x) => lEndOf(x, hh(x, src)) === lEndOf(x, hh(x, `${src}a`)) };
};

// 2. A = 0.8L 정확히(±1초): 도착 필터 qT(A) ≤ qT(0.8·L_rem)
const arrivalEq: Builder = (c) => {
  const m = baseScenario(c, c.rng.int(1, 4), c.rng.int(1, 3));
  const h = pickAuto(m, c, 900);
  const r = m.planner.resources[0];
  makeStrong(r);
  const t0 = fuzzT0S(m);
  const d = dOf(c.k);
  const target = arrivalLimitS(lEndOf(m, h)!, t0) + d;
  if (!setArrival(m, h, r, target)) return null;
  const hid = h.id, rid = r.id;
  return { m, variant: dName(d), check: (x) => arrS(x, hh(x, hid), res(x, rid)) === arrivalLimitS(lEndOf(x, hh(x, hid))!, fuzzT0S(x)) + d };
};

// 3. R80 = min(0.8L, L − 0.5) 정확히(±1초): HOLD 조건 셋째(CONFIRMED, ppm 10⁶이면 R80_end = R_est_end)
const holdThreshold: Builder = (c) => {
  const m = baseScenario(c, c.rng.int(1, 4), c.rng.int(1, 3), { cause: causeNotRot(c) });
  const h = pickAuto(m, c, 3600);
  makeStrong(m.planner.resources[0]);
  const t0 = fuzzT0S(m);
  const d = dOf(c.k);
  const sig = [0, 0.3, 0.5, 0.75][c.rng.int(0, 3)];
  setConfirmed(m, t0 + holdTh(lEndOf(m, h)! - t0) + d, sig);
  const hid = h.id;
  return {
    m, variant: dName(d),
    check: (x) => { const t = fuzzT0S(x); return x.planner.restoration.confirmed!.rEstEndS - t === holdTh(lEndOf(x, hh(x, hid))! - t) + d; },
  };
};

// 4. σ_e = 0.75 경계(1e-6 단위, 정본 JSON 정밀도)
const SIGMAS = [0.75, 0.750001, 0.749999, 0.7501, 0.7499, 0.76, 0.74, 0.75] as const;
const sigmaEdge: Builder = (c) => {
  const m = baseScenario(c, c.rng.int(1, 3), c.rng.int(1, 3), { cause: causeNotRot(c) });
  const h = pickAuto(m, c, 3600);
  makeStrong(m.planner.resources[0]);
  const t0 = fuzzT0S(m);
  const sig = SIGMAS[c.k % SIGMAS.length];
  setConfirmed(m, t0 + Math.max(1, holdTh(lEndOf(m, h)! - t0) - 60), sig);
  return { m, variant: `sigma=${sig}`, check: (x) => x.planner.restoration.sigmaE === sig };
};

// 5. 출력 = 1.25 × W 정확히(±1mW)
const outputEq: Builder = (c) => {
  const m = baseScenario(c, c.rng.int(1, 3), c.rng.int(1, 3));
  const ids = autoIds(m).filter((id) => hh(m, id).device.specId != null);
  if (ids.length === 0) return null;
  const h = hh(m, ids[c.rng.int(0, ids.length - 1)]);
  const draw = DEFAULT_DB.devices.get(h.device.specId!)!.drawW.value.hi;
  const r = m.planner.resources[0];
  makeStrong(r);
  const d = dOf(c.k);
  r.outputW = (qE(draw) * 5 / 4 + d) / 1000;
  const t0 = fuzzT0S(m);
  const lim = arrivalLimitS(lEndOf(m, h)!, t0);
  if (lim > 600) setArrival(m, h, r, Math.floor(lim / 2));
  const rid = r.id;
  return { m, variant: dName(d), check: (x) => qE(res(x, rid).outputW) * 4 - qE(draw) * 5 === d * 4 };
};

// 6. L = 0 (충전 0%, 무배터리 산소, 신고 시각 = t0이면 L_rem = 0)
const lZero: Builder = (c) => {
  const m = baseScenario(c, c.rng.int(1, 4), c.rng.int(1, 3));
  const h = m.planner.households[c.rng.int(0, m.planner.households.length - 1)];
  const kind = c.k % 3;
  if (kind === 0) {
    h.device = { specId: ["TRILOGY100", "LTV1150", "TRILOGY_EVO", "INOGEN_G5"][c.rng.int(0, 3)], specBy: "db_exact", batteryAgeY: null, charge: { value: 0, source: "user" } };
    h.ext = [];
  } else {
    h.device = { specId: "PERFECTO2", specBy: "db_exact", batteryAgeY: c.rng.bernoulli(0.5) ? 1 : null, charge: { value: c.rng.int(0, 100), source: "device_screen" } };
    h.ext = [];
    delete h.cylinder;
  }
  delete h.reentry;
  h.lEndPrev = null;
  if (kind === 2) h.tReport = sToH(fuzzT0S(m));
  const hid = h.id;
  return { m, variant: ["charge0", "noBattery", "noBattery@t0"][kind], check: (x) => fuzzLbd(x, hh(x, hid)).Ls === 0 };
};

// 7. 미확인 모델(DB 밖 → 수동검토, 재진입 DB 기종·operatorLowerH·없음, 검토 완료가 t0 이전이면 t0로)
const unknownModel: Builder = (c) => {
  const m = baseScenario(c, c.rng.int(2, 6), c.rng.int(1, 5), { theta: { unknownModelRate: 0.5 } });
  const n = c.rng.int(1, 2);
  const t0 = fuzzT0S(m);
  for (const h of c.rng.shuffle(m.planner.households).slice(0, n)) {
    makeUnknown(h);
    const kind = c.rng.int(0, 2);
    if (kind === 0) h.reentry = { specId: ["LTV1150", "TRILOGY100", "TRILOGY_EVO", "ASTRAL150", "PERFECTO2", "INOGEN_G5"][c.rng.int(0, 5)] };
    else if (kind === 1) h.reentry = { operatorLowerH: round6(c.rng.range(0.5, 4)) };
    else delete h.reentry;
    const early = c.rng.bernoulli(0.3);
    m.truth.hh[h.id].mrDelayS = early ? Math.max(0, t0 - qT(h.tReport) - c.rng.int(0, 300)) : c.rng.int(900, 3600);
  }
  return { m, variant: `mr${n}`, check: (x) => x.planner.households.some((h) => fuzzLbd(x, h).lb.status === "MANUAL_REVIEW") };
};

// 8. 119 용량 경계: qT(s + A_119 + 0.33) ≤ qT(L_end) 정확히(±1초), s = t0(대기열 비어 있음, 물리 자원 없음)
const lane119OnTime: Builder = (c) => {
  const m = baseScenario(c, 1, c.rng.int(1, 3));
  const h = m.planner.households[0];
  makeLong(h);
  allUnavailable(m);
  const d = dOf(c.k);
  const t0 = fuzzT0S(m);
  if (!setLEnd(m, h, a119Done(m, t0) + d)) return null;
  const hid = h.id;
  return { m, variant: dName(d), check: (x) => lEndOf(x, hh(x, hid)) === a119Done(x, fuzzT0S(x)) + d };
};

// 9. 119 슬롯 시작 = 앞 슬롯 종료 정확히: 둘째 가구의 s = t0 + 1/k
const lane119PrevEnd: Builder = (c) => {
  const m = baseScenario(c, 2, c.rng.int(1, 2), { cause: causeNotRot(c) });
  const [h1, h2] = m.planner.households;
  makeLong(h1);
  makeLong(h2);
  allUnavailable(m);
  const t0 = fuzzT0S(m);
  setConfirmed(m, t0 + 48 * 3600, 0); // 둘 다 tier 0, HOLD 아님
  const d = dOf(c.k);
  const e1 = a119Done(m, t0);
  if (!setLEnd(m, h1, e1) || !setLEnd(m, h2, e1 + svcS(m) + d)) return null;
  const i1 = h1.id, i2 = h2.id;
  return {
    m, variant: dName(d),
    check: (x) => lEndOf(x, hh(x, i1)) === a119Done(x, fuzzT0S(x)) && lEndOf(x, hh(x, i2)) === a119Done(x, fuzzT0S(x) + svcS(x)) + d,
  };
};

// 10. 슬롯 시작 = L_end 정확히: 6단계 (c) qT(s) < qT(L_end)
const lane119StartEqLEnd: Builder = (c) => {
  const m = baseScenario(c, 1, c.rng.int(1, 2));
  const h = m.planner.households[0];
  makeLong(h);
  allUnavailable(m);
  const d = dOf(c.k);
  const t0 = fuzzT0S(m);
  if (!setLEnd(m, h, t0 + d)) return null;
  const hid = h.id;
  return { m, variant: dName(d), check: (x) => lEndOf(x, hh(x, hid)) === fuzzT0S(x) + d };
};

// 11. Δ = Δ_min 정확히(±1초): 5단계 ② GAP_REDUCE. 둘째 가구가 같은 자원을 PROPOSE로 받을 수 있어 ②의 성패가 배정에 드러난다
const deltaMin: Builder = (c) => {
  const m = baseScenario(c, 2, 1, { cause: causeNotRot(c) });
  const [h1, h2] = m.planner.households;
  makeLong(h1);
  makeLong(h2);
  const r = m.planner.resources[0];
  makeStrong(r);
  m.planner.lanes.a119H = { lo: 2.5, hi: 3 }; // 계획 119가 제때 못 오게(① 실패)
  const t0 = fuzzT0S(m);
  const d = dOf(c.k);
  const lBound = c.k % 2 === 0; // Δ = R80 − L_end (자원이 L_end 전 도착) / Δ = R80 − A_end (자원이 L_end 뒤 도착)
  const L1 = lBound ? 7200 : 3600;
  const A = lBound ? 6600 : 4000;
  const L2 = lBound ? 9000 : 5500;
  if (!setLEnd(m, h1, t0 + L1) || !setLEnd(m, h2, t0 + L2) || !setArrival(m, h1, r, A)) return null;
  if (arrS(m, h2, r) > mulDivFloor(L2, [4], [5])) return null;
  setConfirmed(m, t0 + Math.max(L1, A) + 3600 + d, 0);
  const i1 = h1.id, rid = r.id;
  return {
    m, variant: `${lBound ? "Lbound" : "Abound"}-${dName(d)}`,
    check: (x) => {
      const t = fuzzT0S(x);
      const aEnd = t + arrS(x, hh(x, i1), res(x, rid));
      return x.planner.restoration.confirmed!.rEstEndS - Math.max(aEnd, lEndOf(x, hh(x, i1))!) === 3600 + d;
    },
  };
};

// 12. slack 음수·−∞ (물리 자원 없음·비호환·비가용·먼 자원)
const slackNegInf: Builder = (c) => {
  const m = baseScenario(c, c.rng.int(3, 6), c.rng.int(2, 4));
  for (const r of m.planner.resources) {
    const u = c.rng.int(0, 3);
    if (u === 0) r.available = false;
    else if (u === 1) r.connectors = ["VENDOR_EXT"];
    else if (u === 2) r.prepH = { lo: r.prepH.lo, hi: round6(r.prepH.hi + c.rng.range(3, 12)) };
  }
  for (const h of m.planner.households) {
    if (c.rng.bernoulli(0.3) && h.device.specId != null) h.device = { ...h.device, charge: { value: c.rng.int(0, 5), source: "user" } };
  }
  return { m, variant: "mixed" };
};

// 13. 경과시간: e = 0, P10·P50·P90 근처(±1초), F(e) = 1 (3.9절, 3.1절 규칙 5)
const ELAPSED = ["e0", "p10", "p50", "p90", "F1"] as const;
const elapsed: Builder = (c) => {
  const kind = ELAPSED[c.k % ELAPSED.length];
  const m = baseScenario(c, c.rng.int(1, 4), c.rng.int(1, 3), { cause: causeNotRot(c) });
  setAssumed(m);
  const qs = quantileTable(m.planner.restoration.cause, m.sim.table);
  const d = DELTAS[Math.floor(c.k / ELAPSED.length) % 3];
  const tOut = qT(m.planner.tOutage);
  const e = kind === "e0" ? 0 : Math.max(0, { p10: qs[100], p50: qs[500], p90: qs[900], F1: qs[qs.length - 1] }[kind] + d);
  const target = tOut + e;
  const hs = m.planner.households;
  const top = c.rng.int(0, hs.length - 1);
  for (let i = 0; i < hs.length; i++) hs[i].tReport = sToH(i === top ? target : Math.max(tOut, target - c.rng.int(0, 1800)));
  return { m, variant: kind === "e0" ? "e0" : `${kind}-${dName(d)}`, check: (x) => fuzzT0S(x) === target };
};

// 14. now = holdRecheckBy 정확히(±1초): HOLD 세 조건 참, holdRecheckBy = L_end − 1.25·A_min = t0 + δ
const nowEqBy: Builder = (c) => {
  const m = baseScenario(c, 1, c.rng.int(1, 3), { cause: causeNotRot(c) });
  const h = m.planner.households[0];
  makeLong(h);
  const [r, ...rest] = m.planner.resources;
  for (const x of rest) x.available = false;
  makeStrong(r);
  const t0 = fuzzT0S(m);
  const A = c.rng.int(1600, 4000);
  if (!setArrival(m, h, r, A)) return null;
  const d = dOf(c.k);
  if (!setLEnd(m, h, lEndForBy(t0 + d, A))) return null;
  setConfirmed(m, t0 + 1, [0, 0.5][c.rng.int(0, 1)]);
  const hid = h.id, rid = r.id;
  return { m, variant: dName(d), check: (x) => byOf(lEndOf(x, hh(x, hid))!, arrS(x, hh(x, hid), res(x, rid))) === fuzzT0S(x) + d };
};

// 15. 재진입 시점 = holdRecheckBy (4.3절 ② 같은 시각 결정 시점 병합)
const reentryEqBy: Builder = (c) => {
  const m = baseScenario(c, 2, c.rng.int(1, 2), { cause: causeNotRot(c) });
  const [h, mr] = m.planner.households;
  makeLong(h);
  const [r, ...rest] = m.planner.resources;
  for (const x of rest) x.available = false;
  makeStrong(r);
  makeUnknown(mr);
  mr.reentry = c.rng.bernoulli(0.5) ? { specId: ["TRILOGY100", "ASTRAL150", "INOGEN_G5"][c.rng.int(0, 2)] } : { operatorLowerH: round6(c.rng.range(0.5, 4)) };
  const t0 = fuzzT0S(m);
  const A = c.rng.int(1600, 4000);
  if (!setArrival(m, h, r, A)) return null;
  const D = c.rng.int(300, 3000);
  if (!setLEnd(m, h, lEndForBy(t0 + D, A))) return null;
  setConfirmed(m, t0 + 1, 0);
  m.truth.hh[mr.id].mrDelayS = t0 + D - qT(mr.tReport);
  const hid = h.id, mid = mr.id, rid = r.id;
  return {
    m, variant: "merge",
    check: (x) => qT(hh(x, mid).tReport) + x.truth.hh[mid].mrDelayS === byOf(lEndOf(x, hh(x, hid))!, arrS(x, hh(x, hid), res(x, rid))),
  };
};

// 16. tReport 동시각
const tReportTie: Builder = (c) => {
  const m = baseScenario(c, c.rng.int(3, 6), c.rng.int(1, 4));
  const hs = m.planner.households;
  const v = c.k % 2 === 0 ? fuzzT0S(m) : qT(hs[0].tReport);
  const n = c.rng.int(2, hs.length);
  for (const h of c.rng.shuffle(hs).slice(0, n)) h.tReport = sToH(v);
  return { m, variant: c.k % 2 === 0 ? "at-t0" : "below-t0", check: (x) => x.planner.households.filter((h) => qT(h.tReport) === v).length >= 2 };
};

// 17. 결정 시점 동시각 병합: 수동검토 완료 시각이 같거나, t0와 같거나, t0 이전(→ t0로 당김)
const decisionMerge: Builder = (c) => {
  const m = baseScenario(c, c.rng.int(3, 6), c.rng.int(2, 5));
  const t0 = fuzzT0S(m);
  const [a, b] = c.rng.shuffle(m.planner.households);
  for (const h of [a, b]) {
    makeUnknown(h);
    h.reentry = c.rng.bernoulli(0.5) ? { specId: ["LTV1150", "TRILOGY100", "ASTRAL150", "INOGEN_G5"][c.rng.int(0, 3)] } : { operatorLowerH: round6(c.rng.range(0.5, 4)) };
  }
  const kind = c.k % 3;
  const at = kind === 0 ? t0 + c.rng.int(600, 3600) : kind === 1 ? t0 : t0 - c.rng.int(0, 600);
  for (const h of [a, b]) m.truth.hh[h.id].mrDelayS = Math.max(0, at - qT(h.tReport));
  return { m, variant: ["same-review", "review@t0", "review<t0"][kind] };
};

// 18. 119 호출 시각 동점의 id 순(진실 대기열): 미등록 호출 = t0, 미등록끼리 같은 시각, id가 'H'보다 앞서는 미등록
const callTie: Builder = (c) => {
  const m = baseScenario(c, c.rng.int(1, 3), c.rng.int(1, 2), { theta: { unregisteredRate: 0.4 } });
  if (m.truth.unregistered.length === 0) return null;
  allUnavailable(m);
  const t0 = fuzzT0S(m);
  for (const h of m.planner.households) {
    makeLong(h);
    setLEnd(m, h, Math.min(lEndOf(m, h)!, a119Done(m, t0) + c.rng.int(0, 7200)));
  }
  const us = m.truth.unregistered;
  us[0].callS = t0;
  if (us.length > 1) us[1].callS = t0;
  if (c.k % 3 === 2) {
    const old = us[0].id, nu = "A-U01";
    us[0].id = nu;
    m.truth.a119TrueS[nu] = m.truth.a119TrueS[old];
    delete m.truth.a119TrueS[old];
    m.labels[nu] = m.labels[old];
    delete m.labels[old];
  }
  return { m, variant: c.k % 3 === 2 ? "id-before-H" : "tie", check: (x) => x.truth.unregistered[0].callS === fuzzT0S(x) };
};

// 19. HOLD였다가 재배정(M3 분모): CONFIRMED·짧은 R80으로 HOLD를 만들고 시한 뒤 다시 돈다
const holdReassign: Builder = (c) => {
  const m = baseScenario(c, c.rng.int(3, 6), c.rng.int(2, 5), { cause: causeNotRot(c) });
  const t0 = fuzzT0S(m);
  setConfirmed(m, t0 + c.rng.int(300, 7200), [0, 0.5][c.rng.int(0, 1)]);
  for (const h of m.planner.households) if (c.rng.bernoulli(0.5)) makeLong(h);
  return { m, variant: "confirmed" };
};

// 20. c_ext 1/2·9/10, f_age_ext (3.2절 L_ext·L_cap)
const EXT_FOR: Record<string, string> = { TRILOGY100: "TRILOGY100_DETACH", TRILOGY_EVO: "TRILOGY_EVO_DETACH", ASTRAL150: "ASTRAL_EXT", INOGEN_G5: "INOGEN_G5_DOUBLE" };
const cExt: Builder = (c) => {
  const m = baseScenario(c, c.rng.int(2, 4), c.rng.int(1, 3));
  for (const h of m.planner.households.slice(0, 2)) {
    const spec = Object.keys(EXT_FOR)[c.rng.int(0, 3)];
    h.device = { specId: spec, specBy: "db_exact", batteryAgeY: [null, 0.5, 1, 2.5][c.rng.int(0, 3)], charge: { value: c.rng.int(10, 100), source: "device_screen" } };
    delete h.reentry;
    h.lEndPrev = null;
    const declared = c.rng.int(1, 3);
    const verified = c.rng.int(0, declared);
    h.ext = [{
      extSpecId: c.rng.bernoulli(0.85) ? EXT_FOR[spec] : "ASTRAL_EXT", declaredCount: declared,
      opVerified: verified === 0 ? null : {
        count: verified, chargeConfirmed: c.rng.bernoulli(0.5) ? "device_screen" : null,
        extAgeY: [null, 0.2, 1, 1.5, 3][c.rng.int(0, 4)], auditId: `fz-ext-${h.id}`,
      },
    }];
  }
  return { m, variant: "ext" };
};

// 21. 예약 상한 floor(가용 × 0.2) 경계: 가용 자원 4·5·9·10, 119 용량 k 4·5·9·10(1h 창 슬롯 수 경계)
const RES_N = [4, 5, 9, 10] as const;
const reserveCap: Builder = (c) => {
  const nAvail = RES_N[c.k % RES_N.length];
  const nMR = c.rng.int(2, 4);
  const m = baseScenario(c, nMR + c.rng.int(1, 2), nAvail + 1, { theta: { k119PerH: [4, 5, 9, 10][c.rng.int(0, 3)] } });
  for (const r of m.planner.resources) r.available = true;
  m.planner.resources[nAvail].available = false;
  for (const h of m.planner.households.slice(0, nMR)) {
    makeUnknown(h);
    if (c.rng.bernoulli(0.6)) h.reentry = { specId: ["TRILOGY100", "ASTRAL150", "INOGEN_G5", "PERFECTO2"][c.rng.int(0, 3)] };
    else delete h.reentry;
    m.truth.hh[h.id].mrDelayS = c.rng.int(900, 3600);
  }
  return { m, variant: `avail${nAvail}`, check: (x) => x.planner.resources.filter((r) => r.available).length === nAvail };
};

// 22. ai_label_user_confirmed 이웃 기종 최소값(편집거리 ≤ 2, 시험 전용 미끼 기종 overrides.devices)
const DECOY_PROV = { type: "assumed" as const, sourceIds: [], note: "경계 퍼즈 시험 전용 미끼 기종(spec.md 9절 I2 혼동 쌍). 실제 사양 아님" };
function decoys(): DeviceSpec[] {
  const copy = (id: string): DeviceSpec => JSON.parse(JSON.stringify(DEFAULT_DB.devices.get(id)!)) as DeviceSpec;
  const astral100 = copy("ASTRAL150");
  astral100.specId = "ASTRAL100";
  astral100.model = "Astral 100 (decoy)";
  astral100.matchKeys = ["ASTRAL100"];
  astral100.internalH = { value: 6, condition: "시험 전용", prov: DECOY_PROV };
  const ltv1105 = copy("LTV1150");
  ltv1105.specId = "LTV1105";
  ltv1105.model = "LTV 1105 (decoy)";
  ltv1105.matchKeys = ["LTV1105"];
  ltv1105.internalH = { value: 1.5, condition: "시험 전용", prov: DECOY_PROV };
  return [...DEFAULT_DB.devices.values(), astral100, ltv1105];
}
const aiLabel: Builder = (c) => {
  const m = baseScenario(c, c.rng.int(1, 3), c.rng.int(1, 3));
  m.overrides = { devices: decoys() };
  let n = 0;
  for (const h of m.planner.households) {
    if (n > 0 && !c.rng.bernoulli(0.7)) continue;
    n++;
    h.device = {
      specId: ["ASTRAL100", "ASTRAL150", "LTV1105", "LTV1150", "TRILOGY100"][c.rng.int(0, 4)], specBy: "ai_label_user_confirmed",
      batteryAgeY: [null, 0.5, 1.5][c.rng.int(0, 2)], charge: { value: c.rng.int(20, 100), source: c.rng.bernoulli(0.5) ? "device_screen" : "user" },
    };
    h.ext = [];
    delete h.cylinder;
    delete h.reentry;
    h.lEndPrev = null;
  }
  return { m, variant: "neighbors", check: (x) => x.planner.households.some((h) => h.device.specBy === "ai_label_user_confirmed") };
};

// 23. 연식·충전·화면 경계(f_age 1년·2년 경계, 충전 0·1·99·100%, 화면 남은 시간 = L_dev ±1초, 설정 출처)
const CHARGES = [
  { value: 0, source: "user" }, { value: 100, source: "device_screen" }, { value: 1, source: "user" },
  { value: null, source: "unknown" }, { value: 99, source: "device_screen" },
] as const;
const ageCharge: Builder = (c) => {
  const m = baseScenario(c, c.rng.int(2, 4), c.rng.int(1, 3));
  for (const h of m.planner.households) {
    const dev = h.device.specId != null ? DEFAULT_DB.devices.get(h.device.specId) : undefined;
    if (!dev || !dev.continuous) continue;
    const ch = CHARGES[c.rng.int(0, CHARGES.length - 1)];
    h.device = { ...h.device, batteryAgeY: [0, 0.99, 1, 1.99, 2, null][c.rng.int(0, 5)], charge: { value: ch.value, source: ch.source } };
    delete h.device.screenRemainingH;
    if (dev.settingTable && c.rng.bernoulli(0.5)) {
      h.device.setting = c.rng.int(1, 5);
      h.device.settingSource = c.rng.bernoulli(0.5) ? "operator" : "user";
    }
    const L = fuzzLbd(m, h).Ls;
    if (L != null && c.rng.bernoulli(0.5)) h.device.screenRemainingH = sToH(Math.max(0, L + [-1, 0, 1][c.rng.int(0, 2)]));
  }
  return { m, variant: "age-charge" };
};

// 24. 혼합(작은 시나리오, LHS θ, 재신고 lEndPrev 무작위, 미등록 없는 건 포함)
const mixed: Builder = (c) => {
  const m = baseScenario(c, c.rng.int(2, 8), c.rng.int(1, 6));
  for (const h of m.planner.households) {
    if (!c.rng.bernoulli(0.2)) continue;
    const e = lEndOf(m, h);
    if (e != null) h.lEndPrev = sToH(Math.max(0, e - c.rng.int(0, 7200)));
  }
  if (c.rng.bernoulli(0.2)) restrict(m, null, m.planner.resources.slice(0, 1).map((r) => r.id));
  return { m, variant: "lhs" };
};

// 25. 에너지 필터 경계: qE(E × 0.85) = qE(draw × H_need) ± 1mWh. 2/3는 draw × H_need의 소수부가 ½ 이상(floor ≠ 반올림)
const energyEq: Builder = (c) => {
  const m = baseScenario(c, 1, 1, { cause: causeNotRot(c) });
  const h = m.planner.households[0];
  makeLong(h);
  const r = m.planner.resources[0];
  makeStrong(r);
  if (!setArrival(m, h, r, c.rng.int(300, 1500))) return null;
  const t0 = fuzzT0S(m);
  const A = arrS(m, h, r);
  const drawM = qE(DEFAULT_DB.devices.get("ASTRAL150")!.drawW.value.hi);
  let H = c.rng.int(3601, 20 * 3600);
  if (c.k % 3 !== 1) while ((drawM * H) % 3600 < 1800) H++;
  setConfirmed(m, t0 + A + H, 0); // R80_end − A_end = H (1h < H < 24h → H_need = H)
  const [en, ed] = pRatio("alloc.resourceEfficiency");
  const d = dOf(Math.floor(c.k / 3));
  const target = mulDivFloor(drawM, [H], [3600]) + d;
  let qe = Math.ceil((target * ed) / en);
  while (mulDivFloor(qe, [en], [ed]) < target) qe++;
  if (mulDivFloor(qe, [en], [ed]) !== target) return null;
  r.energyWh = qe / 1000;
  const hid = h.id, rid = r.id;
  return {
    m, variant: `${c.k % 3 !== 1 ? "frac>=.5" : "any"}-${dName(d)}`,
    check: (x) => {
      const hNeed = x.planner.restoration.confirmed!.rEstEndS - (fuzzT0S(x) + arrS(x, hh(x, hid), res(x, rid)));
      return mulDivFloor(qE(res(x, rid).energyWh), [en], [ed]) - mulDivFloor(drawM, [hNeed], [3600]) === d;
    },
  };
};

// 26. tier 경계: qT(L_end) = qT(R90_end) ± 1초. tier가 바뀌면 처리 순서(order)가 바뀌도록 slack이 더 큰 tier 0 가구를 둔다
const tierEq: Builder = (c) => {
  const m = baseScenario(c, 2, 2, { cause: causeNotRot(c) });
  const [T, B] = m.planner.households;
  for (const h of [T, B]) { makeLong(h); h.floor = 1; }
  const [r1, r2] = m.planner.resources;
  makeStrong(r1);
  makeStrong(r2);
  B.cell = { x: round1(T.cell.x + 20), y: T.cell.y }; // 멀리 둬 각자 자기 자원이 최단 도착이 되게
  const t0 = fuzzT0S(m);
  if (!setLEnd(m, T, t0 + 7200) || !setLEnd(m, B, t0 + 6000)) return null;
  if (!setArrival(m, T, r1, 5000) || !setArrival(m, B, r2, 600)) return null;
  const d = dOf(c.k);
  setConfirmed(m, t0 + 7200 + d, 0); // R90_end = R_est_end
  const ti = T.id, bi = B.id;
  const slack = (x: M, id: string) => {
    const h0 = hh(x, id);
    return arrivalLimitS(lEndOf(x, h0)!, fuzzT0S(x)) - Math.min(...x.planner.resources.map((r) => arrS(x, h0, r)));
  };
  return {
    m, variant: dName(d),
    check: (x) => slack(x, ti) < slack(x, bi) && x.planner.restoration.confirmed!.rEstEndS - lEndOf(x, hh(x, ti))! === d,
  };
};

/** 범주·건수(합 500). 순서와 건수가 생성 규칙의 일부다(S2b 봉인) */
export const FUZZ_PLAN: readonly (readonly [string, number, Builder])[] = [
  ["slack-tie", 15, slackTie],
  ["arrival-eq-0.8L", 30, arrivalEq],
  ["hold-R80-threshold", 30, holdThreshold],
  ["sigma-0.75", 12, sigmaEdge],
  ["output-eq-1.25W", 24, outputEq],
  ["L-zero", 16, lZero],
  ["unknown-model", 25, unknownModel],
  ["119-capacity-ontime", 30, lane119OnTime],
  ["119-slot-eq-prev-end", 15, lane119PrevEnd],
  ["119-slot-eq-Lend", 15, lane119StartEqLEnd],
  ["delta-eq-deltaMin", 30, deltaMin],
  ["slack-neg-inf", 20, slackNegInf],
  ["elapsed-e", 35, elapsed],
  ["now-eq-holdRecheckBy", 15, nowEqBy],
  ["reentry-eq-holdRecheckBy", 12, reentryEqBy],
  ["tReport-tie", 15, tReportTie],
  ["decision-merge", 15, decisionMerge],
  ["119-call-tie-id", 15, callTie],
  ["hold-then-reassign", 15, holdReassign],
  ["c-ext", 15, cExt],
  ["reserve-cap", 20, reserveCap],
  ["ai-label-neighbor", 15, aiLabel],
  ["age-charge-screen", 15, ageCharge],
  ["energy-eq", 15, energyEq],
  ["tier-eq-R90", 15, tierEq],
  ["mixed", 21, mixed],
];

let cache: FuzzCase[] | null = null;

/** 경계 퍼즈 500건(정본 JSON). 같은 코드·장부면 같은 바이트 */
export function boundaryFuzz(): FuzzCase[] {
  if (cache) return cache;
  const total = FUZZ_PLAN.reduce((s, [, n]) => s + n, 0);
  if (total !== FUZZ_COUNT) throw new Error(`퍼즈 계획 합 ${total} ≠ ${FUZZ_COUNT}`);
  const thetas = lhsSample(FUZZ_COUNT, FUZZ_MASTER, "boundary-fuzz");
  const out: FuzzCase[] = [];
  let caseNo = 0;
  for (const [category, n, build] of FUZZ_PLAN) {
    for (let k = 0; k < n; k++, caseNo++) {
      let made: FuzzCase | null = null;
      for (let attempt = 0; attempt < MAX_ATTEMPTS && !made; attempt++) {
        const rng = rngFor(FUZZ_MASTER, `FUZZ-${caseNo}-${attempt}`, "LHS");
        const b = build({ rng, k, caseNo, attempt, theta: thetas[caseNo] });
        if (!b) continue;
        finalize(b.m);
        const json = canonicalJson(b.m);
        const back = JSON.parse(json) as M;
        if (b.check && !b.check(back)) continue;
        made = { scenarioId: b.m.scenarioId, category, variant: b.variant, json, sha256: sha256Hex(json) };
      }
      if (!made) throw new Error(`퍼즈 ${category}#${k}: ${MAX_ATTEMPTS}회 안에 경계를 만들지 못함`);
      out.push(made);
    }
  }
  cache = out;
  return out;
}
