// E7: 평시 산소통 보급과 기기 맞춤 사전 배치 (실패 가정 점검 10/30, 사전등록 prereg/predictions_e7.md, S10). 비AI, 결정적.
// 근거: 영국 NHS 가정산소 서비스는 산소발생기 사용자에게 대형 예비 실린더를 두고 약 10~20시간 간다고 안내한다
// (spec/params.json lb.cyl.hoursLoPerUnitH와 같은 출처). 그 하한 10시간을 주 값으로, 3·5시간을 민감도로 둔다.
// 보완안처럼 진실만 바꾼다(계획자 화면은 그대로 → 도구는 집에 둔 산소통·배터리를 모르고 계획한다, 효과를 부풀리지 않는 쪽).
// 산소통 고장(연결 실패·빈 통)은 P7과 같은 failProb 축이지만 난수는 별도 CYL 스트림이다(배터리 고장과 독립).
// 같은 PATCH 스트림을 쓰는 상관 고장(R)은 민감도로만 둔다(봉인 전 레드팀 중대 2).
// 누가 산소 기기 가구인지 아는 방법(평시 등록부) 세 갈래:
// - S(자기신고): 등록 가구의 기기 종류(산소/인공호흡기)를 보호자가 체크 — 종류는 늘 맞다고 둔다(AI 없이 가능한 공정한 기준)
// - A(AI 판독만): 라벨 판독으로 DB 기종이 확정된 가구만(봉인 C1 미확인 24/90)
// - O(OCR만): OCR로 확정된 가구만(봉인 C1 미확인 74/90)
// 산소통 보급 범위: 기본 = 식별된 산소 기기 가구 전원, C = 보급률을 P7과 같게(0.6 × covMult, u_cov), K = P7과 같은 개수 k를 평시 하한 순으로.
// 배터리(P7과 같은 양 k = round(0.6 × covMult × N), 고장은 PATCH u_fail): P7P = E6 그대로(산소통을 모르고 순위),
// P7V = 자기신고상 산소 기기 가구는 빼고 인공호흡기 가구에만(남으면 버림), P7E = 인공호흡기 가구 먼저, 남는 개수는 산소 기기 가구에 순위대로(개수 = k).
// P7E는 산소통 없이도 돌린다(RULE+P7E): 배터리 1개가 인공호흡기(소비전력 낮음)에서 더 오래 가는 몫과 산소통과 겹치지 않는 몫을 나누려고(레드팀 2라운드 중대 1).
// 'U:' 변형은 등급 층화 없는 등록부(stratPerClass 0) 민감도다. 기본 등록부는 7등급 × 5가구 층화라 인공호흡기가 과대표집된다(레드팀 중대 3).
// 정전 길이·시드 규칙·정전 중 화면(AI 갈래)은 E5·E6와 같다.
import { DEFAULT_DB } from "../engine/lowerBound";
import { qT, sToH } from "../engine/quantize";
import { GEN_CLASSES, type GenClass } from "./labels";
import type { Theta } from "./lhs";
import { materialize, type MaterializedScenario } from "./materialize";
import { classDrawHiW, PATCH_GLOBAL, PATCHES, patchAxes, type PatchAxes } from "./patches";
import { rngFor } from "./prng";
import { runScenario, type SimPolicy } from "./run";
import { E5_CAUSE, e5Thetas } from "./e5";
import { applyPreOutageP7, preOutageKeyS } from "./e6";
import { e3Def, type E3Row } from "./sweep";

export const E7_LHS_MASTER = "E7";
/** 산소통 1개 가동시간(h): 주 10(NHS 하한), 민감도 3·5 */
export const E7_CYL_H = { primary: 10, sens: [3, 5] } as const;
const O2_CLASSES: ReadonlySet<string> = new Set(["O2_STAT", "O2_STAT_CYL", "O2_PORT"]);

/** 미확인 기종 비율. 봉인 C1(S3) 값을 상수로 고정한다(evidence.json을 읽지 않음, 레드팀 경미 7): AI 1 − 66/90, OCR 1 − 16/90 */
export const E7_ARMS = { AI: 0.266667, OCR: 0.822222, PERF: 0 } as const;

/** 변형 = [U:]정책 + 보급. 순서가 행의 m1·m2S·cls·used 열 순서다 */
export const E7_VARIANTS: readonly string[] = [
  "KR_BASELINE", "KR_BASELINE+P7P", "KR_BASELINE+CYL10S",
  "RULE", "RULE+P7P", "RULE+P7E", "RULE+CYL10S", "RULE+CYL10A", "RULE+CYL10O",
  "RULE+CYL3S", "RULE+CYL5S", "RULE+CYL10SC", "RULE+CYL10SK",
  "RULE+CYL10S+P7P", "RULE+CYL10S+P7V", "RULE+CYL10S+P7E",
  "RULE+CYL10SR+P7P", "RULE+CYL10SR+P7E",
  "U:RULE", "U:RULE+P7P", "U:RULE+P7E", "U:RULE+CYL10S", "U:RULE+CYL10S+P7P", "U:RULE+CYL10S+P7E",
];

export function e7Thetas(draws: number, master: string = E7_LHS_MASTER): Theta[] {
  return e5Thetas(draws, master);
}

export type CylIdent = "S" | "A" | "O";
export type CylScope = "ALL" | "COV" | "TOPK";

/** P7과 같은 배터리 개수 k = round(coverage × covMult × 등록 가구 수) */
function p7Count(m: MaterializedScenario, ax: PatchAxes): number {
  return Math.round((PATCHES.get("P7")!.coverage ?? 0) * ax.covMult * m.planner.households.length);
}

function isO2By(m: MaterializedScenario, hid: string, ident: CylIdent, reg: Map<string, MaterializedScenario["planner"]["households"][number]>): boolean {
  if (ident === "S") return O2_CLASSES.has(m.labels[hid]);
  const specId = reg.get(hid)?.device.specId;
  const cls = specId != null ? DEFAULT_DB.devices.get(specId)?.cls : undefined;
  return cls != null && O2_CLASSES.has(cls);
}

/** 진실 잔여에 addS초를 더한다(KR-07 소진 시점 호출이던 가구는 호출을 미룬다, applyPatch와 같은 규칙) */
function addTruth(out: MaterializedScenario, m: MaterializedScenario, hid: string, addS: number) {
  const h = { ...out.truth.hh[hid] };
  const tRep = qT(m.planner.households.find((x) => x.id === hid)!.tReport);
  const oldEnd = tRep + h.LTrueS;
  h.LTrueS += addS;
  if (h.kr07CallS === oldEnd) h.kr07CallS = oldEnd + addS;
  out.truth.hh[hid] = h;
}

export interface Applied { m: MaterializedScenario; used: number }

/** 산소통: 식별된 산소 기기 가구에 cylH시간짜리 1개. scope·고장 상관(correlated)은 위 머리말 */
export function applyCylinders(m: MaterializedScenario, ax: PatchAxes, cylH: number, ident: CylIdent, registry: MaterializedScenario,
  scope: CylScope = "ALL", correlated = false, rankBy: MaterializedScenario = registry): Applied {
  const cov = (PATCHES.get("P7")!.coverage ?? 0) * ax.covMult;
  const out: MaterializedScenario = { ...m, truth: { ...m.truth, hh: { ...m.truth.hh } } };
  const ids = m.planner.households.map((h) => h.id).sort();
  const reg = new Map(registry.planner.households.map((h) => [h.id, h] as const));
  const patch = rngFor(m.seed, m.scenarioId, "PATCH"), cylR = rngFor(m.seed, m.scenarioId, "CYL");
  const uCov = new Map<string, number>(), uFail = new Map<string, number>();
  for (const hid of ids) {
    const c = patch.uniform(), f = patch.uniform(); patch.uniform(); // applyPatch와 같은 순서(u_cov, u_fail, u_plan)
    uCov.set(hid, c);
    uFail.set(hid, correlated ? f : cylR.uniform());
  }
  let pool = ids.filter((hid) => isO2By(m, hid, ident, reg));
  if (scope === "COV") pool = pool.filter((hid) => uCov.get(hid)! < cov);
  if (scope === "TOPK") {
    const rv = new Map(rankBy.planner.households.map((h) => [h.id, h] as const));
    const key = new Map(pool.map((hid) => [hid, preOutageKeyS(rv.get(hid) ?? m.planner.households.find((x) => x.id === hid)!)] as const));
    pool = [...pool].sort((a, b) => key.get(a)! - key.get(b)! || (a < b ? -1 : a > b ? 1 : 0)).slice(0, p7Count(m, ax));
  }
  for (const hid of pool) if (uFail.get(hid)! >= ax.failProb) addTruth(out, m, hid, qT(cylH));
  return { m: out, used: pool.length };
}

/** 배터리 P7V(인공호흡기에만, 남으면 버림)·P7E(인공호흡기 먼저, 남는 개수는 산소 기기 가구에). 양·고장 난수·평시 하한 순위는 E6 P7P와 같다 */
export function applyMatchedBatteries(m: MaterializedScenario, ax: PatchAxes, rankBy: MaterializedScenario, fill: boolean): Applied {
  const p = PATCHES.get("P7")!;
  const out: MaterializedScenario = { ...m, truth: { ...m.truth, hh: { ...m.truth.hh } } };
  const rng = rngFor(m.seed, m.scenarioId, "PATCH");
  const ids = m.planner.households.map((h) => h.id).sort();
  const rankView = new Map(rankBy.planner.households.map((h) => [h.id, h] as const));
  const fail = new Map<string, number>();
  for (const hid of ids) { rng.uniform(); fail.set(hid, rng.uniform()); rng.uniform(); }
  const key = new Map(ids.map((hid) => [hid, preOutageKeyS(rankView.get(hid) ?? m.planner.households.find((x) => x.id === hid)!)] as const));
  const byKey = (xs: string[]) => [...xs].sort((a, b) => key.get(a)! - key.get(b)! || (a < b ? -1 : a > b ? 1 : 0));
  const vent = byKey(ids.filter((hid) => !O2_CLASSES.has(m.labels[hid])));
  const o2 = byKey(ids.filter((hid) => O2_CLASSES.has(m.labels[hid])));
  const chosen = (fill ? [...vent, ...o2] : vent).slice(0, p7Count(m, ax));
  for (const hid of chosen) {
    if (fail.get(hid)! < ax.failProb) continue;
    addTruth(out, m, hid, Math.floor((3600 * (p.energyWh ?? 0) * PATCH_GLOBAL.inverterEff.value) / classDrawHiW(m.labels[hid] as GenClass)));
  }
  return { m: out, used: chosen.length };
}

type ClassCounts = Partial<Record<GenClass, number[]>>;
/** E3Row + 변형별 [산소통 개수, 배터리 개수](고장 전, 보급한 수) */
export type E7Row = E3Row & { used: [number, number][] };

export function runE7(d: number, theta: Theta, seedLo: number): E7Row {
  const mk = (rate: number, strat: boolean) => {
    const def = e3Def(d, E5_CAUSE, { ...theta, unknownModelRate: rate }, seedLo, "E7"); // 갈래끼리 시드·시나리오 id가 같다(공통 난수)
    return materialize(strat ? def : { ...def, stratPerClass: 0 }).scenario;
  };
  const ms = { AI: mk(E7_ARMS.AI, true), OCR: mk(E7_ARMS.OCR, true), PERF: mk(E7_ARMS.PERF, true) };
  const us = { AI: mk(E7_ARMS.AI, false), PERF: mk(E7_ARMS.PERF, false) };
  const mAI = ms.AI;
  const ax = patchAxes(mAI.seed);
  const cls: ClassCounts = {};
  const regIds = new Set(mAI.planner.households.map((h) => h.id));
  for (const id of regIds) {
    const c = mAI.labels[id] as GenClass;
    if (!GEN_CLASSES.includes(c)) continue;
    cls[c] ??= [0, ...E7_VARIANTS.map(() => 0)];
    cls[c]![0]++;
  }
  const m1: number[] = [], m2S: number[] = [], used: [number, number][] = [];
  E7_VARIANTS.forEach((v, j) => {
    const unstrat = v.startsWith("U:");
    const S = unstrat ? { AI: us.AI, OCR: us.AI, PERF: us.PERF } : ms;
    if (unstrat && /CYL\d+[AO]/.test(v)) throw new Error(`U: 변형은 자기신고(S) 식별만 ${v}`); // U:에는 OCR 등록부를 만들지 않는다
    const [pol, ...patches] = (unstrat ? v.slice(2) : v).split("+") as [SimPolicy, ...string[]];
    let m = S.AI, nCyl = 0, nBat = 0;
    for (const p of patches) {
      if (p === "P7P") { m = applyPreOutageP7(m, ax, S.PERF); nBat += p7Count(m, ax); }
      else if (p === "P7V" || p === "P7E") { const a = applyMatchedBatteries(m, ax, S.PERF, p === "P7E"); m = a.m; nBat += a.used; }
      else {
        const mt = /^CYL(\d+)([SAO])([CKR]?)$/.exec(p);
        if (!mt) throw new Error(`E7 변형 해석 불가 ${v}`);
        const ident = mt[2] as CylIdent;
        const a = applyCylinders(m, ax, Number(mt[1]), ident, ident === "O" ? S.OCR : S.AI,
          mt[3] === "C" ? "COV" : mt[3] === "K" ? "TOPK" : "ALL", mt[3] === "R", S.PERF);
        m = a.m; nCyl += a.used;
      }
    }
    const r = runScenario(m, pol);
    m1.push(r.outcome.metrics.M1); m2S.push(r.outcome.metrics.M2S); used.push([nCyl, nBat]);
    if (unstrat) return; // 등급별 공백률은 층화 등록부(기본) 변형만 센다
    for (const row of r.outcome.rows) {
      if (!row.registered || !regIds.has(row.householdId) || row.gapS <= 0) continue;
      const c = mAI.labels[row.householdId] as GenClass;
      if (cls[c]) cls[c]![1 + j]++;
    }
  });
  return { d, seed: Number(mAI.seed), cause: E5_CAUSE, rTrueH: sToH(mAI.truth.restorationS), ax, m1, m2S, cls, used };
}
