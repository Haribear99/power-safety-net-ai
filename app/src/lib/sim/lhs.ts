// 스윕 축 θ와 라틴 하이퍼큐브 추출 (spec.md 5.3절), 실험 인터페이스(5.4절, 실행기는 아직 없음).
// materialize 단계라 Math.exp·log를 쓴다. θ 값은 1e-6에서 반올림해 쓰고 저장한다(5.1절 출력 규칙과 같은 값).
// 축 범위는 모두 spec/params.json 키에서 읽는다.
import type { TravelProfileName } from "../engine/arrival";
import { pRange, pValue } from "../engine/params";
import type { PolicyId } from "../alloc/rule";
import { Rng, rngFor } from "./prng";

export interface Theta {
  /** 복구 배율(로그균등 0.5~2.0) */
  scaleMult: number;
  /** 설정 소모 진실 계수 U[0.5, 1.0] */
  kSetTrue: number;
  /** 노후 진실 계수 U[0.5, 1.0], 5%는 [0.3, 0.5] */
  kAgeTrue: number;
  /** σ_e ∈ {0, 0.5, 1.0} */
  sigmaE: number;
  /** CONFIRMED 확률 [0, 0.8] */
  pConfirm: number;
  /** 가구/자원 비(로그균등 1.5~6) */
  hhPerResource: number;
  travelProfile: TravelProfileName;
  /** 119 시간당 용량 k 1~6 */
  k119PerH: number;
  /** 119 지연 배수 1~4 */
  stress119: number;
  shelterRefuseRate: number;
  backupFailProb: number;
  unregisteredRate: number;
  extOwnRate: number;
  extVerifyRate: number;
  unknownModelRate: number;
  overInputProb: number;
  /** KR-07 조기 119 호출 확률 */
  pEarly: number;
  ageUnknownRate: number;
  screenChargeRate: number;
}

export type ThetaKey = keyof Theta;

export type AxisKind =
  | { kind: "uniform"; paramKey: string }
  | { kind: "logUniform"; paramKey: string }
  | { kind: "discrete"; values: readonly number[]; paramKey: string }
  | { kind: "categorical"; values: readonly TravelProfileName[] }
  | { kind: "kAgeMixture"; paramKey: string };

/** 5.3절 표의 축 → params 키. 순서가 LHS 열 순서(결정성의 일부)다 */
export const AXES: readonly (readonly [ThetaKey, AxisKind])[] = [
  ["scaleMult", { kind: "logUniform", paramKey: "restoration.scaleMult" }],
  ["kSetTrue", { kind: "uniform", paramKey: "sweep.kSetTrue" }],
  ["kAgeTrue", { kind: "kAgeMixture", paramKey: "sweep.kAgeTrue" }],
  ["sigmaE", { kind: "discrete", values: [0, 0.5, 1.0], paramKey: "restoration.sigmaE.sweep" }],
  ["pConfirm", { kind: "uniform", paramKey: "restoration.pConfirm" }],
  ["hhPerResource", { kind: "logUniform", paramKey: "sweep.hhPerResource" }],
  ["travelProfile", { kind: "categorical", values: ["fast", "standard", "slow"] }],
  ["k119PerH", { kind: "uniform", paramKey: "lane119.kPerH" }],
  ["stress119", { kind: "uniform", paramKey: "lane119.stress" }],
  ["shelterRefuseRate", { kind: "uniform", paramKey: "shelter.refuseRate" }],
  ["backupFailProb", { kind: "uniform", paramKey: "sweep.backupFailProb" }],
  ["unregisteredRate", { kind: "uniform", paramKey: "gen.unregisteredRate" }],
  ["extOwnRate", { kind: "uniform", paramKey: "gen.extOwnRate" }],
  ["extVerifyRate", { kind: "uniform", paramKey: "gen.extVerifyRate" }],
  ["unknownModelRate", { kind: "uniform", paramKey: "gen.unknownModelRate" }],
  ["overInputProb", { kind: "uniform", paramKey: "sweep.overInputProb" }],
  ["pEarly", { kind: "uniform", paramKey: "sweep.pEarly" }],
  ["ageUnknownRate", { kind: "uniform", paramKey: "gen.ageUnknownRate" }],
  ["screenChargeRate", { kind: "uniform", paramKey: "gen.screenChargeRate" }],
];

/** θ 값 저장 규칙: 1e-6에서 반올림(5.1절 출력 규칙과 같게 해 저장값 = 사용값) */
export function round6(x: number): number {
  if (!Number.isFinite(x)) throw new Error(`유한하지 않은 θ 값 ${x}`);
  const r = Math.round(x * 1e6) / 1e6;
  return r === 0 ? 0 : r;
}

/** 축 범위 끝값(축별 1차원 반증, 5.4절 E1용) */
export function axisBounds(axis: AxisKind): { lo: number | string; hi: number | string } {
  switch (axis.kind) {
    case "uniform":
    case "logUniform":
      return pRange(axis.paramKey);
    case "discrete":
      return { lo: axis.values[0], hi: axis.values[axis.values.length - 1] };
    case "categorical":
      return { lo: axis.values[0], hi: axis.values[axis.values.length - 1] };
    case "kAgeMixture": {
      const tail = pValue<{ tailLo: number }>(axis.paramKey);
      return { lo: tail.tailLo, hi: pRange(axis.paramKey).hi };
    }
  }
}

/** 균등 u ∈ [0,1) → 축 값(역누적분포) */
export function axisValue(axis: AxisKind, u: number): number | TravelProfileName {
  if (!(u >= 0 && u < 1)) throw new Error(`u 범위 밖 ${u}`);
  switch (axis.kind) {
    case "uniform": {
      const r = pRange(axis.paramKey);
      return round6(r.lo + (r.hi - r.lo) * u);
    }
    case "logUniform": {
      const r = pRange(axis.paramKey);
      return round6(Math.exp(Math.log(r.lo) + (Math.log(r.hi) - Math.log(r.lo)) * u));
    }
    case "discrete": {
      const vs = pValue<number[]>(axis.paramKey);
      if (JSON.stringify(vs) !== JSON.stringify(axis.values)) throw new Error(`${axis.paramKey} 값이 축 정의와 다름`);
      return vs[Math.floor(u * vs.length)];
    }
    case "categorical":
      return axis.values[Math.floor(u * axis.values.length)];
    case "kAgeMixture": {
      const r = pRange(axis.paramKey);
      const t = pValue<{ tailShare: number; tailLo: number; tailHi: number }>(axis.paramKey);
      if (u < t.tailShare) return round6(t.tailLo + (t.tailHi - t.tailLo) * (u / t.tailShare));
      return round6(r.lo + (r.hi - r.lo) * ((u - t.tailShare) / (1 - t.tailShare)));
    }
  }
}

/** 표준 θ (9절 K-DEG): params standardTheta. 값은 1e-6 반올림 */
export function standardTheta(): Theta {
  const v = pValue<Theta>("standardTheta");
  const out = { ...v };
  for (const [k] of AXES) {
    const x = out[k];
    if (x === undefined) throw new Error(`standardTheta에 ${k} 없음`);
    if (typeof x === "number") (out as Record<string, unknown>)[k] = round6(x);
  }
  return out;
}

/** θ가 축 범위 안인가(검증용) */
export function thetaInRange(t: Theta): string[] {
  const bad: string[] = [];
  for (const [k, axis] of AXES) {
    const x = t[k];
    if (axis.kind === "categorical") {
      if (!axis.values.includes(x as TravelProfileName)) bad.push(k);
    } else if (axis.kind === "discrete") {
      if (!axis.values.includes(x as number)) bad.push(k);
    } else {
      const b = axisBounds(axis) as { lo: number; hi: number };
      if (typeof x !== "number" || x < b.lo || x > b.hi) bad.push(k);
    }
  }
  return bad;
}

/**
 * 라틴 하이퍼큐브 n추첨(LHS 스트림). 축마다 층 순열 하나 + 층 안 균등 지터.
 * 같은 (master, sweepId, n)이면 같은 결과다.
 */
export function lhsSample(n: number, master: string, sweepId: string, fixed: Partial<Theta> = {}): Theta[] {
  if (!Number.isInteger(n) || n <= 0) throw new Error("LHS n은 양의 정수");
  const rng: Rng = rngFor(master, sweepId, "LHS");
  const rows: Partial<Theta>[] = Array.from({ length: n }, () => ({}));
  for (const [k, axis] of AXES) {
    const perm = rng.shuffle(Array.from({ length: n }, (_, i) => i));
    for (let i = 0; i < n; i++) {
      const u = (perm[i] + rng.uniform()) / n;
      (rows[i] as Record<string, unknown>)[k] = axisValue(axis, Math.min(u, 1 - 2 ** -30));
    }
  }
  return rows.map((r) => ({ ...(r as Theta), ...fixed }));
}

// ---------- 실험 인터페이스 (5.4절. 실행기는 이후 작업) ----------
export type ExperimentId = "E1" | "E1b" | "E1c" | "E2" | "E3" | "E4";

/** 5.4절 시드 범위. prereg/sweep.json에 같은 값을 적어 S4에 봉인한다 */
export const SEED_RANGES = {
  dev: { lo: 1, hi: 10_000 },
  holdout: { lo: 1_000_001, hi: 1_001_000 },
  e1: { lo: 2_000_001, hi: 2_004_000 },
  e2: { lo: 3_000_001, hi: 3_005_400 },
} as const;

export interface SweepConfig {
  experiment: ExperimentId;
  /** LHS 스트림 master */
  master: string;
  draws: number;
  seedRange: { lo: number; hi: number };
  policies: readonly (PolicyId | "KR_BASELINE")[];
  /** 복구 분위 표 계열(E1 안정성 시험은 lognormal) */
  table: "gamma" | "lognormal";
  /** 축 고정값(E2 칸 정의 등) */
  fixed?: Partial<Theta>;
}

export interface E2Cell {
  hhPerResource: 1.5 | 3 | 6;
  travelProfile: TravelProfileName;
  sigmaE: 0 | 0.5 | 1.0;
}
