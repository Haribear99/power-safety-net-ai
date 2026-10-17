// 리허설 랩 실험의 시나리오 단위 실행 (spec.md 5.4절 E1·E1b·E2). 비AI, 결정적 — Math.random·Date 없음.
// 여기에는 '시나리오 정의 → 실행 → 작은 결과 행'만 둔다. 병렬 실행·파일 쓰기는 scripts/sweep.ts, 집계·판정은 analyze.ts.
// 시드는 출력 행의 seed 키로 남긴다(check-seal-order가 E1·E2 전용 범위 시드를 S4 이전 출력에서 찾는다).
import type { Cause } from "../domain/types";
import { CAUSES } from "../domain/types";
import type { TravelProfileName } from "../engine/arrival";
import { sToH } from "../engine/quantize";
import { GEN_CLASSES, type GenClass } from "./labels";
import { axisBounds, AXES, lhsSample, standardTheta, type Theta, type ThetaKey } from "./lhs";
import { materialize, type ScenarioDef } from "./materialize";
import { rngFor } from "./prng";
import { runScenario, type SimPolicy } from "./run";
import type { QuantileFamily } from "../engine/restoration";

const CAUSES7: readonly Cause[] = CAUSES.filter((c) => c !== "ROTATING");

// ---------- E2 (배정 비교) ----------
export const E2_RATIOS = [1.5, 3, 6] as const;
export const E2_TRAVEL: readonly TravelProfileName[] = ["fast", "standard", "slow"];
/** σ_e. 11.3절 2단 절단은 0.5 고정(9칸)이었고, 라운드 5에서 계산 시간 실측(시나리오당 약 50ms)만 보고 27칸으로 되돌렸다. 0.5 칸이 앞 9칸이다 */
export const E2_SIGMAS = [0.5, 0, 1.0] as const;
export const E2_N = 30;
export const E2_SEEDS_PER_CELL = 200;
/** 헤드라인 비교는 RULE 대 KR_BASELINE(라운드 5), 지배율은 RULE 대 B1·B2, 나머지는 절제·상한·참조 */
export const E2_POLICIES: readonly SimPolicy[] = [
  "RULE", "KR_BASELINE", "B1_SHORTEST", "B2_NEAREST", "ORACLE_INFO", "NONE", "R_L", "RULE_NO_R", "RULE_FEASIBLE_FIRST", "RULE_NO_RESERVE",
];

export interface E2CellDef { idx: number; id: string; hhPerResource: number; travelProfile: TravelProfileName; sigmaE: number }

/** σ_e 바깥, 비율, 이동 안쪽 순서(칸 번호가 시드 블록을 정한다). nCells 9면 σ_e = 0.5 칸만 */
export function e2Cells(nCells: 9 | 27 = 27): E2CellDef[] {
  const out: E2CellDef[] = [];
  for (const sg of E2_SIGMAS.slice(0, nCells / 9)) for (const r of E2_RATIOS) for (const t of E2_TRAVEL) {
    out.push({ idx: out.length, id: `s${sg}-r${r}-${t}`, hhPerResource: r, travelProfile: t, sigmaE: sg });
  }
  return out;
}

/** 칸의 k번째 짝 시드. 시드 = seedLo + 칸 번호 × 200 + k. 원인은 그 시드로 7종(ROTATING 제외)에서 균등 추출 */
export function e2Def(cell: E2CellDef, k: number, seedLo: number): ScenarioDef {
  if (!(Number.isInteger(k) && k >= 0 && k < E2_SEEDS_PER_CELL)) throw new Error(`E2 k 범위 밖 ${k}`);
  const seed = seedLo + cell.idx * E2_SEEDS_PER_CELL + k;
  const cause = CAUSES7[Math.floor(rngFor(String(seed), "E2-cause", "LHS").uniform() * CAUSES7.length)];
  const theta: Theta = { ...standardTheta(), hhPerResource: cell.hhPerResource, travelProfile: cell.travelProfile, sigmaE: cell.sigmaE };
  return {
    scenarioId: `E2-${cell.id}-${seed}`, seed: String(seed), cause, theta,
    nRegistered: E2_N, nResources: Math.max(1, Math.round(E2_N / cell.hhPerResource)), table: "gamma",
  };
}

export interface PolicyScore { M1: number; M2S: number }
export interface E2Row { cell: string; k: number; seed: number; cause: Cause; highRisk: number; pol: Record<string, PolicyScore> }

export function runE2(cell: E2CellDef, k: number, seedLo: number, policies: readonly SimPolicy[] = E2_POLICIES): E2Row {
  const def = e2Def(cell, k, seedLo);
  const m = materialize(def).scenario;
  const pol: Record<string, PolicyScore> = {};
  let highRisk = 0;
  for (const p of policies) {
    const r = runScenario(m, p);
    pol[p] = { M1: r.outcome.metrics.M1, M2S: r.outcome.metrics.M2S };
    highRisk = r.outcome.metrics.highRiskCount;
  }
  return { cell: cell.id, k, seed: Number(def.seed), cause: def.cause, highRisk, pol };
}

// ---------- E1 (빈틈 견고성) ----------
export const E1_N = 60;
export const E1_STRAT = 5;
/** 표지 정책은 KR_BASELINE(5.4절). RULE은 같은 시나리오에서 '도구를 써도 남는 빈틈'을 보이는 보조 표지(라운드 5) */
export const E1_POLICIES: readonly SimPolicy[] = ["KR_BASELINE", "RULE"];
/** 축별 1차원 반증에 쓰는 추첨 수(앞에서부터). 라운드 5 사전등록 값 */
export const E1_FALSIFY_DRAWS = 200;
export const E1_LHS_MASTER = "E1";

/** 봉인 실행은 master "E1", 예비(개발) 실행은 다른 master를 써서 봉인 추첨을 미리 보지 않는다 */
export function e1Thetas(draws: number, master: string = E1_LHS_MASTER): Theta[] {
  return lhsSample(draws, master, "E1-LHS");
}

/**
 * d번째 추첨 × 원인 하나. 시드 = seedLo + d(원인 8개가 같은 시드를 쓰고 scenarioId로 스트림이 갈린다).
 * 축 고정 변형·로그정규 표는 같은 scenarioId·시드를 써서 공통 난수로 비교한다.
 */
export function e1Def(d: number, cause: Cause, theta: Theta, seedLo: number, table: QuantileFamily = "gamma"): ScenarioDef {
  return {
    scenarioId: `E1-${d}-${cause}`, seed: String(seedLo + d), cause, theta,
    nRegistered: E1_N, nResources: Math.max(1, Math.round(E1_N / theta.hhPerResource)), stratPerClass: E1_STRAT, table,
  };
}

/** 등급별 [등록 가구 수, 정책별 G>0 가구 수…](E1_POLICIES 순서) */
export type ClassCounts = Partial<Record<GenClass, number[]>>;
export interface E1Row { d: number; seed: number; cause: Cause; rTrueH: number; cls: ClassCounts }

export function runE1(d: number, cause: Cause, theta: Theta, seedLo: number, table: QuantileFamily = "gamma"): E1Row {
  const def = e1Def(d, cause, theta, seedLo, table);
  const m = materialize(def).scenario;
  const cls: ClassCounts = {};
  const regIds = new Set(m.planner.households.map((h) => h.id));
  for (const id of regIds) {
    const c = m.labels[id] as GenClass;
    if (!GEN_CLASSES.includes(c)) continue;
    cls[c] ??= [0, ...E1_POLICIES.map(() => 0)];
    cls[c]![0]++;
  }
  E1_POLICIES.forEach((p, j) => {
    const r = runScenario(m, p);
    for (const row of r.outcome.rows) {
      if (!row.registered || !regIds.has(row.householdId) || row.gapS <= 0) continue;
      const c = m.labels[row.householdId] as GenClass;
      if (cls[c]) cls[c]![1 + j]++;
    }
  });
  return { d, seed: Number(def.seed), cause, rTrueH: sToH(m.truth.restorationS), cls };
}

/** 축별 1차원 반증 변형: 축 하나를 범위 끝값에 고정 */
export interface FalsifyVariant { axis: ThetaKey; end: "lo" | "hi"; value: number | string }
export function falsifyVariants(): FalsifyVariant[] {
  const out: FalsifyVariant[] = [];
  for (const [k, a] of AXES) {
    const b = axisBounds(a);
    out.push({ axis: k, end: "lo", value: b.lo }, { axis: k, end: "hi", value: b.hi });
  }
  return out;
}
export function withAxis(theta: Theta, v: FalsifyVariant): Theta {
  return { ...theta, [v.axis]: v.value } as Theta;
}
