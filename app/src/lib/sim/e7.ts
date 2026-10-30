// E7: 평시 산소통 보급 — 산소 기기 가구 전원에 예비 산소통 1개 (실패 가정 점검 10/30, 사전등록 prereg/predictions_e7.md, S10). 비AI, 결정적.
// 근거: 영국 NHS 가정산소 서비스는 산소발생기 사용자에게 대형 예비 실린더를 두고 약 10~20시간 간다고 안내한다
// (spec/params.json lb.cyl.hoursLoPerUnitH와 같은 출처). 그 하한 10시간을 주 값으로, 3·5시간을 민감도로 둔다.
// 보완안처럼 진실만 바꾼다(계획자 화면은 그대로 → 도구는 집에 둔 산소통을 모르고 계획한다, 효과를 부풀리지 않는 쪽).
// 고장(연결 실패·빈 통) 난수는 P7과 같은 PATCH 스트림(u_fail)·같은 failProb 축이다(산소통에 배터리와 같은 고장률을 주는 보수 가정).
// 누가 산소 기기 가구인지 아는 방법(평시 등록부) 세 갈래:
// - S(자기신고): 등록 가구의 기기 종류(산소/인공호흡기)를 보호자가 체크 — 종류는 늘 맞다고 둔다(AI 없이 가능한 공정한 기준)
// - A(AI 판독만): 라벨 판독으로 DB 기종이 확정된 가구만(미확인 24/90)
// - O(OCR만): OCR로 확정된 가구만(미확인 74/90)
// 정전 길이·시드 규칙·정전 중 화면(AI 갈래)은 E5·E6와 같다. 비교 기준 P7P는 E6의 평시 표적 배터리(PERF 순위)다.
// P7V(맞춤 조합): P7과 같은 양의 배터리를 자기신고상 산소 기기가 아닌 등록 가구(인공호흡기)에만, E6와 같은 평시 하한 순으로 준다.
import ev from "../../data/evidence.json";
import { DEFAULT_DB } from "../engine/lowerBound";
import { qT, sToH } from "../engine/quantize";
import { GEN_CLASSES, type GenClass } from "./labels";
import type { Theta } from "./lhs";
import { materialize, type MaterializedScenario } from "./materialize";
import { patchAxes, type PatchAxes } from "./patches";
import { rngFor } from "./prng";
import { runScenario, type SimPolicy } from "./run";
import { E5_ARMS, E5_CAUSE, e5Thetas } from "./e5";
import { applyPreOutageP7, preOutageKeyS } from "./e6";
import { classDrawHiW, PATCH_GLOBAL, PATCHES } from "./patches";
import { e3Def, type E3Row } from "./sweep";

export const E7_LHS_MASTER = "E7";
/** 산소통 1개 가동시간(h): 주 10(NHS 하한), 민감도 3·5 */
export const E7_CYL_H = { primary: 10, sens: [3, 5] } as const;
const O2_CLASSES: ReadonlySet<string> = new Set(["O2_STAT", "O2_STAT_CYL", "O2_PORT"]);

/** 봉인 C1(S3) OCR의 DB 등록 기종 자동 확정 실패율 = 1 − k/n (evidence.json c1.tesseract.dbMatchRate) */
export function ocrUnknownRate(): number {
  const r = (ev as unknown as { c1: { tesseract: { dbMatchRate: { k: number; n: number } } } }).c1.tesseract.dbMatchRate;
  return Math.round((1 - r.k / r.n) * 1e6) / 1e6;
}
export const E7_ARMS = { AI: E5_ARMS.AI, OCR: ocrUnknownRate(), PERF: E5_ARMS.PERF } as const;

/** 변형 = 정책 + 보급. CYL{h}{S|A|O}[C] = 산소통 h시간·식별 갈래(C = 보급률을 P7과 같게 0.6 × covMult로 제한, u_cov). 순서가 행의 m1·m2S·cls 열 순서다 */
export const E7_VARIANTS: readonly string[] = [
  "KR_BASELINE", "KR_BASELINE+P7P", "KR_BASELINE+CYL10S", "KR_BASELINE+CYL10A", "KR_BASELINE+CYL10O",
  "RULE", "RULE+P7P", "RULE+CYL10S", "RULE+CYL10A", "RULE+CYL10O",
  "RULE+CYL3S", "RULE+CYL5S", "RULE+CYL10S+P7P", "RULE+CYL10S+P7V", "RULE+CYL10SC",
];

export function e7Thetas(draws: number, master: string = E7_LHS_MASTER): Theta[] {
  return e5Thetas(draws, master);
}

export type CylIdent = "S" | "A" | "O";

/** 산소 기기로 식별된 등록 가구 전원에 산소통 1개(cylH). 식별: S = 진실 종류, A·O = 그 갈래 등록부에서 DB 기종이 산소 기기로 확정된 가구 */
export function applyCylinders(m: MaterializedScenario, ax: PatchAxes, cylH: number, ident: CylIdent, registry: MaterializedScenario, coverageLimited = false): MaterializedScenario {
  const cov = (PATCHES.get("P7")!.coverage ?? 0) * ax.covMult;
  const out: MaterializedScenario = { ...m, truth: { ...m.truth, hh: { ...m.truth.hh } } };
  const rng = rngFor(m.seed, m.scenarioId, "PATCH");
  const ids = m.planner.households.map((h) => h.id).sort();
  const view = new Map(m.planner.households.map((h) => [h.id, h] as const));
  const reg = new Map(registry.planner.households.map((h) => [h.id, h] as const));
  const addS = qT(cylH);
  for (const hid of ids) {
    const uCov = rng.uniform(), uFail = rng.uniform(); rng.uniform(); // applyPatch와 같은 순서(u_cov, u_fail, u_plan)
    let isO2: boolean;
    if (ident === "S") isO2 = O2_CLASSES.has(m.labels[hid]);
    else {
      const specId = reg.get(hid)?.device.specId;
      const cls = specId != null ? DEFAULT_DB.devices.get(specId)?.cls : undefined;
      isO2 = cls != null && O2_CLASSES.has(cls);
    }
    if (!isO2 || uFail < ax.failProb || (coverageLimited && uCov >= cov)) continue;
    const h = { ...m.truth.hh[hid] };
    const oldEnd = qT(view.get(hid)!.tReport) + h.LTrueS;
    h.LTrueS += addS;
    if (h.kr07CallS === oldEnd) h.kr07CallS = oldEnd + addS;
    out.truth.hh[hid] = h;
  }
  return out;
}

/** P7V: E6 P7P와 같은 양·같은 고장 난수·같은 평시 하한 순위(rankBy), 단 자기신고상 산소 기기 가구는 뺀다 */
export function applyVentBatteries(m: MaterializedScenario, ax: PatchAxes, rankBy: MaterializedScenario): MaterializedScenario {
  const p = PATCHES.get("P7")!;
  const out: MaterializedScenario = { ...m, truth: { ...m.truth, hh: { ...m.truth.hh } } };
  const rng = rngFor(m.seed, m.scenarioId, "PATCH");
  const ids = m.planner.households.map((h) => h.id).sort();
  const view = new Map(m.planner.households.map((h) => [h.id, h] as const));
  const rankView = new Map(rankBy.planner.households.map((h) => [h.id, h] as const));
  const fail = new Map<string, number>();
  for (const hid of ids) { rng.uniform(); fail.set(hid, rng.uniform()); rng.uniform(); }
  const k = Math.round((p.coverage ?? 0) * ax.covMult * ids.length); // 양은 P7·P7P와 같다(전체 등록 가구 기준)
  const pool = ids.filter((hid) => !O2_CLASSES.has(m.labels[hid]));
  const key = new Map(pool.map((hid) => [hid, preOutageKeyS(rankView.get(hid) ?? view.get(hid)!)] as const));
  const ranked = [...pool].sort((a, b) => key.get(a)! - key.get(b)! || (a < b ? -1 : a > b ? 1 : 0));
  for (const hid of ranked.slice(0, k)) {
    if (fail.get(hid)! < ax.failProb) continue;
    const h = { ...m.truth.hh[hid] };
    const extraS = Math.floor((3600 * (p.energyWh ?? 0) * PATCH_GLOBAL.inverterEff.value) / classDrawHiW(m.labels[hid] as GenClass));
    const oldEnd = qT(view.get(hid)!.tReport) + h.LTrueS;
    h.LTrueS += extraS;
    if (h.kr07CallS === oldEnd) h.kr07CallS = oldEnd + extraS;
    out.truth.hh[hid] = h;
  }
  return out;
}

type ClassCounts = Partial<Record<GenClass, number[]>>;

export function runE7(d: number, theta: Theta, seedLo: number): E3Row {
  const ms = Object.fromEntries((Object.keys(E7_ARMS) as (keyof typeof E7_ARMS)[]).map((arm) => {
    const def = e3Def(d, E5_CAUSE, { ...theta, unknownModelRate: E7_ARMS[arm] }, seedLo, "E7"); // 갈래끼리 시드·시나리오 id가 같다(공통 난수)
    return [arm, materialize(def).scenario];
  })) as Record<keyof typeof E7_ARMS, MaterializedScenario>;
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
  const registryOf: Record<CylIdent, MaterializedScenario> = { S: mAI, A: mAI, O: ms.OCR };
  const m1: number[] = [], m2S: number[] = [];
  E7_VARIANTS.forEach((v, j) => {
    const [pol, ...patches] = v.split("+") as [SimPolicy, ...string[]];
    let m = mAI;
    for (const p of patches) {
      if (p === "P7P") m = applyPreOutageP7(m, ax, ms.PERF);
      else if (p === "P7V") m = applyVentBatteries(m, ax, ms.PERF);
      else {
        const mt = /^CYL(\d+)([SAO])(C?)$/.exec(p);
        if (!mt) throw new Error(`E7 변형 해석 불가 ${v}`);
        const ident = mt[2] as CylIdent;
        m = applyCylinders(m, ax, Number(mt[1]), ident, registryOf[ident], mt[3] === "C");
      }
    }
    const r = runScenario(m, pol);
    m1.push(r.outcome.metrics.M1); m2S.push(r.outcome.metrics.M2S);
    for (const row of r.outcome.rows) {
      if (!row.registered || !regIds.has(row.householdId) || row.gapS <= 0) continue;
      const c = mAI.labels[row.householdId] as GenClass;
      if (cls[c]) cls[c]![1 + j]++;
    }
  });
  return { d, seed: Number(mAI.seed), cause: E5_CAUSE, rTrueH: sToH(mAI.truth.restorationS), ax, m1, m2S, cls };
}
