// E6: 평시 정보만 쓰는 표적 사전 배치 (레드팀 3라운드 10/18 대응, 사전등록 prereg/predictions_e6.md, S8). 비AI, 결정적.
// E5의 P7T는 순위 키로 정전 중 신고 시각(tReport)과 그때의 충전량이 들어간 하한 끝을 썼다 — 정전 전에는 알 수 없는 정보다.
// E6의 P7P는 정전 전 등록부에 있을 정보만 쓴다: 기종 사양(평시 수동검토로 확인된 기종, PERF 화면)·배터리 연식·외장 신고,
// 충전량은 모름(source unknown), 신고 시각 0. 그 하한 시간(Ls)이 짧은 가구부터 P7과 같은 양을 준다. 고장 난수는 P7과 같다.
// 정전 길이·갈래·시드 규칙은 E5와 같고, 비교를 위해 E5의 P7T(정전 시점 정보 사용, 낙관 상한)도 같은 시나리오에서 다시 돌린다.
import { computeLowerBoundDetail, DEFAULT_DB } from "../engine/lowerBound";
import { qT, sToH } from "../engine/quantize";
import type { HouseholdView } from "../domain/types";
import { GEN_CLASSES, type GenClass } from "./labels";
import type { Theta } from "./lhs";
import { materialize, type MaterializedScenario } from "./materialize";
import { applyPatch, classDrawHiW, PATCH_GLOBAL, PATCHES, patchAxes, type PatchAxes } from "./patches";
import { rngFor } from "./prng";
import { runScenario } from "./run";
import { applyTargetedP7, E5_ARMS, E5_CAUSE, e5Thetas } from "./e5";
import { e3Def, type E3Row } from "./sweep";

export const E6_LHS_MASTER = "E6";
export const E6_VARIANTS: readonly string[] = ["AI@RULE", "AI@RULE+P7", "AI@RULE+P7P", "AI@RULE+P7T"];

export function e6Thetas(draws: number, master: string = E6_LHS_MASTER): Theta[] {
  return e5Thetas(draws, master);
}

/** 정전 전 등록부 화면: 충전량 모름, 신고 시각 0, 이전 하한 없음 */
export function preOutageView(h: HouseholdView): HouseholdView {
  return { ...h, tReport: 0, lEndPrev: null, device: { ...h.device, charge: { value: null, source: "unknown" } } };
}

/** 평시 하한 시간(초). 모르면 -Infinity(맨 앞) */
export function preOutageKeyS(h: HouseholdView): number {
  const d = computeLowerBoundDetail(preOutageView(h), DEFAULT_DB);
  return d.Ls == null ? -Infinity : d.Ls;
}

/** P7과 같은 양을 평시 하한이 짧은 등록 가구부터. 순위는 rankBy(평시 검토가 끝난 화면) 기준, 진실만 바꾼다 */
export function applyPreOutageP7(m: MaterializedScenario, ax: PatchAxes, rankBy: MaterializedScenario = m): MaterializedScenario {
  const p = PATCHES.get("P7")!;
  const out: MaterializedScenario = { ...m, truth: { ...m.truth, hh: { ...m.truth.hh } } };
  const rng = rngFor(m.seed, m.scenarioId, "PATCH");
  const ids = m.planner.households.map((h) => h.id).sort();
  const view = new Map(m.planner.households.map((h) => [h.id, h] as const));
  const rankView = new Map(rankBy.planner.households.map((h) => [h.id, h] as const));
  const fail = new Map<string, number>();
  for (const hid of ids) { rng.uniform(); fail.set(hid, rng.uniform()); rng.uniform(); } // applyPatch와 같은 순서(u_cov, u_fail, u_plan)
  const key = new Map(ids.map((hid) => [hid, preOutageKeyS(rankView.get(hid) ?? view.get(hid)!)] as const));
  const ranked = [...ids].sort((a, b) => key.get(a)! - key.get(b)! || (a < b ? -1 : a > b ? 1 : 0));
  const k = Math.round((p.coverage ?? 0) * ax.covMult * ids.length);
  for (const hid of ranked.slice(0, k)) {
    if (fail.get(hid)! < ax.failProb) continue;
    const h = { ...m.truth.hh[hid] };
    const cls = m.labels[hid] as GenClass;
    const extraS = Math.floor((3600 * (p.energyWh ?? 0) * PATCH_GLOBAL.inverterEff.value) / classDrawHiW(cls));
    const oldEnd = qT(view.get(hid)!.tReport) + h.LTrueS;
    h.LTrueS += extraS;
    if (h.kr07CallS === oldEnd) h.kr07CallS = oldEnd + extraS;
    out.truth.hh[hid] = h;
  }
  return out;
}

type ClassCounts = Partial<Record<GenClass, number[]>>;

export function runE6(d: number, theta: Theta, seedLo: number): E3Row {
  const def = (rate: number) => e3Def(d, E5_CAUSE, { ...theta, unknownModelRate: rate }, seedLo, "E6");
  const mAI = materialize(def(E5_ARMS.AI)).scenario;
  const mPERF = materialize(def(E5_ARMS.PERF)).scenario;
  const ax = patchAxes(mAI.seed);
  const cls: ClassCounts = {};
  const regIds = new Set(mAI.planner.households.map((h) => h.id));
  for (const id of regIds) {
    const c = mAI.labels[id] as GenClass;
    if (!GEN_CLASSES.includes(c)) continue;
    cls[c] ??= [0, ...E6_VARIANTS.map(() => 0)];
    cls[c]![0]++;
  }
  const m1: number[] = [], m2S: number[] = [];
  E6_VARIANTS.forEach((v, j) => {
    const patch = v.split("+")[1];
    const m = patch === "P7" ? applyPatch(mAI, "P7", ax) : patch === "P7P" ? applyPreOutageP7(mAI, ax, mPERF) : patch === "P7T" ? applyTargetedP7(mAI, ax, mPERF) : mAI;
    const r = runScenario(m, "RULE");
    m1.push(r.outcome.metrics.M1); m2S.push(r.outcome.metrics.M2S);
    for (const row of r.outcome.rows) {
      if (!row.registered || !regIds.has(row.householdId) || row.gapS <= 0) continue;
      const c = mAI.labels[row.householdId] as GenClass;
      if (cls[c]) cls[c]![1 + j]++;
    }
  });
  return { d, seed: Number(mAI.seed), cause: E5_CAUSE, rTrueH: sToH(mAI.truth.restorationS), ax, m1, m2S, cls };
}
