// 시나리오 materialize (spec.md 5.1절, 8절 입력 형식 oracle/FORMAT.md `pl26-materialized/1`). 비AI, 결정적.
// 시나리오의 모든 난수 추출 결과를 PlannerView + WorldTruth JSON으로 펼친다. Python 오라클은 이 JSON만 읽으므로
// PRNG 비트 일치가 필요 없다. 초월함수가 들어간 값(복구 표본, CONFIRMED 배수, 이동시간 잡음)은 정수 초·정수 ppm으로 저장한다(3.1절).
// 출력: 키 정렬 JSON, 숫자는 1e-6에서 반올림, sha256 기록(5.1절). 시뮬레이터는 이 JSON을 다시 읽어 돌린다(저장값 = 사용값).
import type { Cause, DeviceClass, PlannerView, RestorationView, WorldTruth } from "../domain/types";
import { RESTORATION_LABEL } from "../domain/types";
import { default119RangeH, travelProfile, truth119S, truthArrivalS, type TravelProfile, type TravelProfileName } from "../engine/arrival";
import { type EngineDb } from "../engine/lowerBound";
import { pNum, pRange } from "../engine/params";
import { computeRestoration, sampleRestorationS, type QuantileFamily } from "../engine/restoration";
import { mulDivFloor, qT, sToH } from "../engine/quantize";
import { kr07CallS } from "../alloc/baselines";
import { generatePopulation, sNum, type MatHousehold, type PopulationSpec } from "./generator";
import type { GenClass } from "./labels";
import { round6, type Theta } from "./lhs";
import { rngFor } from "./prng";

export const MAT_FORMAT = "pl26-materialized/1" as const;
const PPM = 1_000_000;

export interface MatRestoration extends RestorationView {
  /** CONFIRMED만: 운영자 통보 복구 예정 절대 시각(정수 초)과 배수 floor(exp(±zσ)·10⁶ + 0.5) */
  confirmed?: { rEstEndS: number; multPpm: { p10: number; p80: number; p90: number } };
}

export interface MatPlanner extends Omit<PlannerView, "households" | "restoration"> {
  households: MatHousehold[];
  restoration: MatRestoration;
}

export interface MatTruth {
  /** R_true(정전 시작 기준 길이, 정수 초) */
  restorationS: number;
  hh: Record<string, {
    /** 신고 시각 기준 진실 잔여(정수 초) */
    LTrueS: number;
    extWorks: boolean[];
    backupFails: boolean;
    shelterRefuses: boolean;
    mrDelayS: number;
    /** KR_BASELINE에서 이 가구가 119를 부르는 절대 시각(4.2절 p_early 규칙) */
    kr07CallS: number;
  }>;
  /** 명단 밖 가구: 정전 시작 기준 수명, KR-07 호출 절대 시각(모든 정책) */
  unregistered: { id: string; LTrueS: number; callS: number; cell: { x: number; y: number } }[];
  /** 자원 실제 도착 소요(결정 시각부터, 정수 초). 키 `${hh}|${res}` */
  arrivalTrueS: Record<string, number>;
  /** 119 슬롯 시작부터 실제 도착까지(정수 초) — 등록·미등록 모두 */
  a119TrueS: Record<string, number>;
  /** 쉼터 결정 시각부터 실제 도착까지(정수 초) */
  shelterTrueS: Record<string, number>;
}

export interface ScenarioDef {
  scenarioId: string;
  /** 시드(문자열). PRNG master */
  seed: string;
  cause: Cause;
  theta: Theta;
  nRegistered: number;
  nResources: number;
  focusClass?: GenClass | null;
  nFocus?: number;
  table?: QuantileFamily;
}

export interface MaterializedScenario {
  format: typeof MAT_FORMAT;
  scenarioId: string;
  seed: string;
  cause: Cause;
  sim: {
    table: QuantileFamily;
    travelProfile: TravelProfileName;
    travel: TravelProfile;
    stress119: number;
    pEarly: number;
  };
  theta: Theta;
  composition: { nRegistered: number; nUnregistered: number; nResources: number; focusClass: GenClass | null; nFocus: number };
  /** 분석 전용 등급 라벨(배정기 입력 아님, I5) */
  labels: Record<string, DeviceClass>;
  planner: MatPlanner;
  truth: MatTruth;
}

/** 시나리오 정의 → materialize 객체(키 정렬·반올림 전) */
export function materializeRaw(def: ScenarioDef, db?: EngineDb): MaterializedScenario {
  const theta = def.theta;
  const table: QuantileFamily = def.table ?? "gamma";
  const pop = generatePopulation({
    scenarioId: def.scenarioId, seed: def.seed, cause: def.cause, theta,
    nRegistered: def.nRegistered, nResources: def.nResources, focusClass: def.focusClass ?? null, nFocus: def.nFocus ?? 0, db,
  } satisfies PopulationSpec);
  const tOutageS = qT(sNum("sim.tOutageH"));
  const profile = travelProfile(theta.travelProfile);
  const a119H = default119RangeH();
  const shelterPrep = pRange("shelter.prepH");

  // ---- 진실 복구(TRUTH_R)와 운영자 추정(EST) ----
  const uR = rngFor(def.seed, def.scenarioId, "TRUTH_R").uniform();
  const restorationS = sampleRestorationS(def.cause, uR, { scaleMult: def.cause === "ROTATING" ? 1 : theta.scaleMult, family: table });
  const est = rngFor(def.seed, def.scenarioId, "EST");
  const uConfirm = est.uniform();
  const z = est.normal();
  let status: RestorationView["status"] = def.cause === "ROTATING" ? "NEAR_CERTAIN" : "ASSUMED_RANGE";
  let confirmed: MatRestoration["confirmed"];
  if (status === "ASSUMED_RANGE" && uConfirm < theta.pConfirm) {
    status = "CONFIRMED";
    const s = theta.sigmaE;
    const z90 = pNum("restoration.confirmed.z90"), z80 = pNum("restoration.confirmed.z80");
    const ppm = (x: number) => Math.floor(x * PPM + 0.5);
    confirmed = {
      rEstEndS: tOutageS + qT(sToH(restorationS) * Math.exp(s * z)),
      multPpm: { p10: ppm(Math.exp(-z90 * s)), p80: ppm(Math.exp(z80 * s)), p90: ppm(Math.exp(z90 * s)) },
    };
  }

  // ---- 가구 진실(LANE: 예비전원 고장·쉼터 거부·119·쉼터 도착) ----
  const lane = rngFor(def.seed, def.scenarioId, "LANE");
  const hhTruth: MatTruth["hh"] = {};
  const a119TrueS: Record<string, number> = {};
  const shelterTrueS: Record<string, number> = {};
  for (const g of pop.households) {
    const u = Array.from({ length: 4 }, () => lane.uniform());
    const id = g.view.id;
    const lTrueEndS = qT(g.view.tReport) + g.lTrueS;
    hhTruth[id] = {
      LTrueS: g.lTrueS, extWorks: g.extWorks,
      backupFails: u[0] < theta.backupFailProb,
      shelterRefuses: u[1] < theta.shelterRefuseRate,
      mrDelayS: g.mrDelayS,
      kr07CallS: kr07CallS(tOutageS, lTrueEndS, theta.pEarly, g.kr07U[0], g.kr07U[1]),
    };
    a119TrueS[id] = truth119S(a119H, theta.stress119, u[2]);
    shelterTrueS[id] = qT(shelterPrep.lo + (shelterPrep.hi - shelterPrep.lo) * u[3]);
  }
  const unregistered: MatTruth["unregistered"] = [];
  for (const g of pop.unregistered) {
    const u = Array.from({ length: 4 }, () => lane.uniform());
    unregistered.push({
      id: g.id, LTrueS: g.lTrueS, cell: g.cell,
      callS: kr07CallS(tOutageS, tOutageS + g.lTrueS, theta.pEarly, g.kr07U[0], g.kr07U[1]),
    });
    a119TrueS[g.id] = truth119S(a119H, theta.stress119, u[2]);
  }

  // ---- 진실 도착(ARRIVAL): 등록 가구 × 자원, id 순 ----
  const arr = rngFor(def.seed, def.scenarioId, "ARRIVAL");
  const arrivalTrueS: Record<string, number> = {};
  const hhSorted = [...pop.households].sort((a, b) => (a.view.id < b.view.id ? -1 : 1));
  const resSorted = [...pop.resources].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const g of hhSorted) {
    for (const r of resSorted) {
      const uPrep = arr.uniform();
      const zz = arr.normal();
      arrivalTrueS[`${g.view.id}|${r.id}`] = truthArrivalS(r, g.view, def.cause, profile, uPrep, zz);
    }
  }

  // ---- PlannerView(첫 결정 시점 t0 기준 복구 범위는 참고값, 시뮬레이터는 결정 시점마다 다시 계산) ----
  const t0S = Math.max(...pop.households.map((g) => qT(g.view.tReport)));
  const restoration: MatRestoration = {
    ...restorationAtS({ cause: def.cause, tOutage: sToH(tOutageS), status, sigmaE: status === "CONFIRMED" ? theta.sigmaE : null, confirmed, table }, t0S),
    ...(confirmed ? { confirmed } : {}),
  };
  const seats = Math.max(1, Math.floor(def.nRegistered * sNum("sim.shelterSeatsPerHH")));
  const labels: Record<string, DeviceClass> = {};
  for (const g of pop.households) labels[g.view.id] = g.label;
  for (const g of pop.unregistered) labels[g.id] = g.label;

  return {
    format: MAT_FORMAT,
    scenarioId: def.scenarioId,
    seed: def.seed,
    cause: def.cause,
    sim: { table, travelProfile: theta.travelProfile, travel: profile, stress119: theta.stress119, pEarly: theta.pEarly },
    theta,
    composition: {
      nRegistered: def.nRegistered, nUnregistered: pop.unregistered.length, nResources: def.nResources,
      focusClass: def.focusClass ?? null, nFocus: def.focusClass ? (def.nFocus ?? 0) : 0,
    },
    labels,
    planner: {
      scenarioId: def.scenarioId, now: sToH(t0S), tOutage: sToH(tOutageS),
      households: pop.households.map((g) => g.view),
      resources: pop.resources,
      restoration,
      lanes: { k119PerH: theta.k119PerH, a119H: { lo: round6(a119H.lo), hi: round6(a119H.hi) }, shelter: { seats, prepH: shelterPrep } },
    },
    truth: { restorationS, hh: hhTruth, unregistered, arrivalTrueS, a119TrueS, shelterTrueS },
  };
}

/** 정본 materialize: 키 정렬·1e-6 반올림 JSON 문자열과 그 sha256, 그리고 그 문자열을 다시 읽은 객체(저장값 = 사용값) */
export function materialize(def: ScenarioDef, db?: EngineDb): { json: string; sha256: string; scenario: MaterializedScenario } {
  const json = canonicalJson(materializeRaw(def, db));
  return { json, sha256: sha256Hex(json), scenario: JSON.parse(json) as MaterializedScenario };
}

// ---------- 결정 시점의 복구 범위 ----------
export interface RestorationSource {
  cause: Cause;
  tOutage: number;
  status: RestorationView["status"];
  sigmaE: number | null;
  confirmed?: MatRestoration["confirmed"];
  table?: QuantileFamily;
}

/**
 * 결정 시점 nowS의 RestorationView(3.5·3.9절). 값은 정수 초를 h로 바꾼 것(qT로 정확히 되돌아간다).
 * CONFIRMED는 materialize한 정수 ppm으로 R_q_end = now + floor(max(0, R_est_end − now) × ppm / 10⁶)(오라클과 같은 식).
 */
export function restorationAtS(src: RestorationSource, nowS: number): RestorationView {
  if (src.status === "CONFIRMED") {
    const c = src.confirmed;
    if (!c) throw new Error("CONFIRMED에는 confirmed(rEstEndS, multPpm)가 필요");
    const rem = Math.max(0, c.rEstEndS - nowS);
    const at = (ppm: number) => nowS + mulDivFloor(rem, [ppm], [PPM]);
    return {
      cause: src.cause, tOutage: src.tOutage,
      p10: sToH(at(c.multPpm.p10)), p50: sToH(Math.max(nowS, c.rEstEndS)), p80: sToH(at(c.multPpm.p80)), p90: sToH(at(c.multPpm.p90)),
      status: "CONFIRMED", sigmaE: src.sigmaE, label: RESTORATION_LABEL,
    };
  }
  const d = computeRestoration({ cause: src.cause, tOutageH: src.tOutage, nowH: sToH(nowS), status: src.status, family: src.table ?? "gamma" });
  return { ...d.view, p10: sToH(d.p10S), p50: sToH(d.p50S), p80: sToH(d.p80S), p90: sToH(d.p90S) };
}

// ---------- WorldTruth 변환(outcome.ts 입력) ----------
export function toWorldTruth(m: MaterializedScenario): WorldTruth {
  const mapH = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, sToH(v)]));
  const hh: WorldTruth["hh"] = {};
  for (const [id, h] of Object.entries(m.truth.hh)) {
    hh[id] = { LTrueH: sToH(h.LTrueS), extWorks: h.extWorks, backupFails: h.backupFails, shelterRefuses: h.shelterRefuses, mrDelayH: sToH(h.mrDelayS) };
  }
  return {
    seed: m.seed, restorationH: sToH(m.truth.restorationS), hh,
    unregistered: m.truth.unregistered.map((u) => ({ id: u.id, LTrueH: sToH(u.LTrueS), cell: u.cell })),
    arrivalTrueH: mapH(m.truth.arrivalTrueS), a119TrueH: mapH(m.truth.a119TrueS), shelterTrueH: mapH(m.truth.shelterTrueS),
  };
}

// ---------- 정본 JSON ----------
/** 키 정렬, 숫자 1e-6 반올림(정수는 그대로), undefined 키 생략, −0 → 0. NaN·∞는 예외 */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(canon(v));
}

function canon(v: unknown): unknown {
  if (v === null) return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`정본 JSON: 유한하지 않은 수 ${v}`);
    if (Number.isInteger(v)) return v === 0 ? 0 : v;
    return round6(v);
  }
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : canon(x)));
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) {
      if (o[k] === undefined) continue;
      out[k] = canon(o[k]);
    }
    return out;
  }
  throw new Error(`정본 JSON: 지원하지 않는 값 ${typeof v}`);
}

// ---------- sha256 (순수 TS, Node·Worker 공용) ----------
const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Hex(text: string): string {
  const msg = new TextEncoder().encode(text);
  const bitLen = msg.length * 8;
  const padLen = (((msg.length + 9 + 63) >> 6) << 6);
  const buf = new Uint8Array(padLen);
  buf.set(msg);
  buf[msg.length] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(padLen - 4, bitLen >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("");
}
