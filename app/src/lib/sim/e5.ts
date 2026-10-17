// E5: AI 라벨 판독의 기여와 기록 기반 표적 사전 배치 (레드팀 10/18 대응, 사전등록 prereg/predictions_e5.md, S7). 비AI, 결정적.
// 정전 길이는 E4와 같은 실측 분포(APT_EMP). 시나리오 하나에서 '미확인 기종 비율'만 바꾼 세 갈래를 공통 난수로 비교한다.
// - AI   : 봉인 시험셋에서 DB 등록 기종을 자동 확정하지 못한 비율(24/90)만큼 미확인 → 수동검토
// - NOAI : 라벨 판독 없음 → 모든 기종 미확인(수동검토)
// - PERF : 판독이 늘 맞음 → 미확인 0(상한)
// 생성기의 미확인 판정은 u < rate라서 같은 시드에서 AI의 미확인 가구는 NOAI의 부분집합이다(짝 비교가 깨끗하다).
// 표적 사전 배치(P7T)는 P7과 같은 보급량(round(coverage × covMult × 등록 가구 수))을 무작위가 아니라
// 배터리 하한 끝이 이른 등록 가구부터 준다. 사전 배치는 정전 전 평시 일이라 수동검토가 끝난 화면(PERF 갈래)으로 순위를 매긴다
// (그래도 하한을 모르면 맨 앞). 고장 난수는 P7과 같은 PATCH 스트림이다.
import ev from "../../data/evidence.json";
import type { Cause } from "../domain/types";
import { computeLowerBoundDetail, DEFAULT_DB } from "../engine/lowerBound";
import { qT, sToH } from "../engine/quantize";
import { GEN_CLASSES, type GenClass } from "./labels";
import type { Theta } from "./lhs";
import { materialize, type MaterializedScenario } from "./materialize";
import { applyPatch, classDrawHiW, PATCH_GLOBAL, PATCHES, patchAxes, type PatchAxes } from "./patches";
import { rngFor } from "./prng";
import { runScenario, type SimPolicy } from "./run";
import { e3Def, e4Thetas, E4_CAUSE, type E3Row } from "./sweep";

export const E5_LHS_MASTER = "E5";
export const E5_CAUSE: Cause = E4_CAUSE;

/** 봉인 C1(S3)의 DB 등록 기종 자동 확정 실패율 = 1 − k/n (evidence.json c1.sonnet.dbMatchRate, 원본 out/sealed/c1/summary.json) */
export function measuredUnknownRate(): number {
  const r = (ev as unknown as { c1: { sonnet: { dbMatchRate: { k: number; n: number } } } }).c1.sonnet.dbMatchRate;
  return Math.round((1 - r.k / r.n) * 1e6) / 1e6;
}

export const E5_ARMS = { AI: measuredUnknownRate(), NOAI: 1, PERF: 0 } as const;
export type E5Arm = keyof typeof E5_ARMS;
/** 변형 = 갈래@정책(+보완안). 순서가 행의 m1·m2S·cls 열 순서다 */
export const E5_VARIANTS: readonly string[] = ["AI@KR_BASELINE", "AI@RULE", "NOAI@RULE", "PERF@RULE", "AI@RULE+P7", "AI@RULE+P7T"];

/** E4와 같은 18축 추첨(척도 배수 1), 마스터만 E5 */
export function e5Thetas(draws: number, master: string = E5_LHS_MASTER): Theta[] {
  return e4Thetas(draws, master);
}

/** P7과 같은 양을 하한 끝이 이른 등록 가구부터 준다. 진실만 바꾼다(계획자 화면은 그대로) */
export function applyTargetedP7(m: MaterializedScenario, ax: PatchAxes, rankBy: MaterializedScenario = m): MaterializedScenario {
  const p = PATCHES.get("P7")!;
  const out: MaterializedScenario = { ...m, truth: { ...m.truth, hh: { ...m.truth.hh } } };
  const rng = rngFor(m.seed, m.scenarioId, "PATCH");
  const ids = m.planner.households.map((h) => h.id).sort();
  const view = new Map(m.planner.households.map((h) => [h.id, h] as const));
  const fail = new Map<string, number>();
  for (const hid of ids) { rng.uniform(); fail.set(hid, rng.uniform()); rng.uniform(); } // applyPatch와 같은 순서(u_cov, u_fail, u_plan)
  const rankView = new Map(rankBy.planner.households.map((h) => [h.id, h] as const));
  const key = (hid: string) => {
    const v = rankView.get(hid) ?? view.get(hid)!;
    const end = computeLowerBoundDetail(v, DEFAULT_DB).endS;
    return end == null ? -Infinity : end;
  };
  const ranked = [...ids].sort((a, b) => key(a) - key(b) || (a < b ? -1 : a > b ? 1 : 0));
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

export function runE5(d: number, theta: Theta, seedLo: number): E3Row {
  const ms = Object.fromEntries((Object.keys(E5_ARMS) as E5Arm[]).map((arm) => {
    const def = e3Def(d, E5_CAUSE, { ...theta, unknownModelRate: E5_ARMS[arm] }, seedLo, "E5"); // 갈래끼리 시드·시나리오 id가 같다(공통 난수)
    return [arm, materialize(def).scenario];
  })) as Record<E5Arm, MaterializedScenario>;
  const m0 = ms.AI;
  const seed = m0.seed;
  const ax = patchAxes(seed);
  const cls: ClassCounts = {};
  const regIds = new Set(m0.planner.households.map((h) => h.id));
  for (const id of regIds) {
    const c = m0.labels[id] as GenClass;
    if (!GEN_CLASSES.includes(c)) continue;
    cls[c] ??= [0, ...E5_VARIANTS.map(() => 0)];
    cls[c]![0]++;
  }
  const m1: number[] = [], m2S: number[] = [];
  E5_VARIANTS.forEach((v, j) => {
    const [arm, rest] = v.split("@") as [E5Arm, string];
    const [base, patch] = rest.split("+") as [SimPolicy, string | undefined];
    const mArm = ms[arm];
    const m = patch === "P7" ? applyPatch(mArm, "P7", ax) : patch === "P7T" ? applyTargetedP7(mArm, ax, ms.PERF) : mArm;
    const r = runScenario(m, base);
    m1.push(r.outcome.metrics.M1); m2S.push(r.outcome.metrics.M2S);
    for (const row of r.outcome.rows) {
      if (!row.registered || !regIds.has(row.householdId) || row.gapS <= 0) continue;
      const c = m0.labels[row.householdId] as GenClass;
      if (cls[c]) cls[c]![1 + j]++;
    }
  });
  return { d, seed: Number(seed), cause: E5_CAUSE, rTrueH: sToH(m0.truth.restorationS), ax, m1, m2S, cls };
}
