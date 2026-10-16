// 원인별 복구 표본기와 운영자가 보는 복구 추정 (spec.md 3.4·3.5·3.9절).
// 분위 표는 spec/restoration_quantiles.json(정수 초, tools/build_quantiles.py 생성, S1 봉인 대상)이다.
// 결정 경로(조건부 분위 R_q_end)는 BigInt 정수 유리수로 정확히 계산한다(3.1절 규칙 2·5).
// 예외: CONFIRMED 범위 exp(±1.2816σ_e)·exp(0.8416σ_e)는 Math.exp 직후 qT로 바꾼다(3절 초월함수 규칙).
// 표본 추출(sampleRestorationS)은 materialize 용도이며 결과를 qT 정수로 돌려준다.
import { z } from "zod";
import raw from "../../../../spec/restoration_quantiles.json";
import { CAUSES, RESTORATION_LABEL, type Cause, type EstimateStatus, type RestorationView } from "../domain/types";
import { pNum, pRange, pRatio } from "./params";
import { qT, sToH } from "./quantize";

export type QuantileFamily = "gamma" | "lognormal";

const TableSchema = z.object({ qS: z.array(z.number().int().nonnegative()) }).passthrough();
const FileSchema = z.object({
  meta: z.object({ grid: z.number().int() }).passthrough(),
  tables: z.object({
    gamma: z.record(z.string(), TableSchema),
    lognormal: z.record(z.string(), TableSchema),
  }),
});

const parsed = FileSchema.parse(raw);
const GRID = pNum("restoration.gridPoints");
const STEPS = GRID - 1; // 1000
if (parsed.meta.grid !== GRID) throw new Error("restoration_quantiles.json grid ≠ params restoration.gridPoints");

const TABLES: Record<QuantileFamily, Record<Cause, readonly number[]>> = { gamma: {} as never, lognormal: {} as never };
for (const fam of ["gamma", "lognormal"] as const) {
  for (const c of CAUSES) {
    const t = parsed.tables[fam][c];
    if (!t) throw new Error(`분위 표 없음: ${fam}.${c}`);
    if (t.qS.length !== GRID) throw new Error(`분위 표 길이 ≠ ${GRID}: ${fam}.${c}`);
    for (let i = 0; i + 1 < GRID; i++) if (t.qS[i] > t.qS[i + 1]) throw new Error(`분위 표 단조 위반 ${fam}.${c}@${i}`);
    TABLES[fam][c] = t.qS;
  }
}

export function quantileTable(cause: Cause, family: QuantileFamily = "gamma"): readonly number[] {
  return TABLES[family][cause];
}

// ---------- 표본 추출 (materialize용, 부동소수 허용 후 qT) ----------
/** u ∈ [0,1] → 표 선형보간 Q(u)(초, 부동소수) */
export function quantileFloatS(table: readonly number[], u: number): number {
  if (!(u >= 0 && u <= 1)) throw new Error(`u 범위 밖 ${u}`);
  const x = u * STEPS;
  const j = Math.min(Math.floor(x), STEPS - 1);
  const f = x - j;
  return table[j] + (table[j + 1] - table[j]) * f;
}

/**
 * 복구 시간 표본(정전 시작 기준 경과, 정수 초). u는 호출자의 시드 PRNG(TRUTH_R 스트림)가 준다.
 * scaleMult는 5.3절 공통 척도 배수(로그균등 0.5~2.0).
 */
export function sampleRestorationS(cause: Cause, u: number, opts: { scaleMult?: number; family?: QuantileFamily } = {}): number {
  const s = quantileFloatS(quantileTable(cause, opts.family ?? "gamma"), u) * (opts.scaleMult ?? 1);
  return Math.floor(s + 0.5);
}

/** 시드 표본기: rng()는 [0,1) 균등값 */
export function makeRestorationSampler(rng: () => number, family: QuantileFamily = "gamma") {
  return (cause: Cause, scaleMult = 1) => sampleRestorationS(cause, rng(), { scaleMult, family });
}

// ---------- 정확 정수 역분위 (결정 경로) ----------
const B0 = BigInt(0);
const B1 = BigInt(1);

/** 유리수 u = num/den (BigInt) */
export interface URational { num: bigint; den: bigint }

/** F(e) = max{u : Q(u) ≤ e} (3.1절 규칙 5). e < Q(0)이면 0. 표 마지막 값 ≤ e이면 1 */
export function cdfExact(table: readonly number[], eS: number): URational {
  if (eS < table[0]) return { num: B0, den: B1 };
  if (eS >= table[STEPS]) return { num: B1, den: B1 };
  // 가장 큰 i (i < STEPS) with table[i] ≤ e. 이때 table[i+1] > e
  let lo = 0, hi = STEPS - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (table[mid] <= eS) lo = mid; else hi = mid - 1;
  }
  const i = lo;
  const d = BigInt(table[i + 1] - table[i]); // > 0
  // u = (i + (e − t_i)/d) / STEPS = (i·d + e − t_i) / (STEPS·d)
  return { num: BigInt(i) * d + BigInt(eS - table[i]), den: BigInt(STEPS) * d };
}

/** Q(u) 정확 계산, floor (3.1절: 나눗셈은 floor) */
export function quantileExactS(table: readonly number[], u: URational): number {
  if (u.num <= B0) return table[0];
  if (u.num >= u.den) return table[STEPS];
  const x = BigInt(STEPS) * u.num; // x/den = 위치
  const j = x / u.den; // floor (양수)
  const jn = Number(j);
  const fracNum = x - j * u.den; // [0, den)
  const a = BigInt(table[jn]), b = BigInt(table[jn + 1]);
  const v = a * u.den + (b - a) * fracNum; // ≥ 0
  return Number(v / u.den);
}

/** u' = F + q·(1 − F), q = qn/qd */
function rescale(F: URational, qn: number, qd: number): URational {
  const QN = BigInt(qn), QD = BigInt(qd);
  return { num: F.num * QD + QN * (F.den - F.num), den: F.den * QD };
}

export interface CondQuantile { endS: number; beyond: boolean }

/**
 * 조건부 분위의 절대 모의 시각(3.9절): R_q_end = tOutage + Q(F(e) + q·(1 − F(e))), e = now − tOutage.
 * F(e) = 1이면 '모형상 이미 복구' → now, beyond = true(「가정 범위 초과 경과」).
 */
export function conditionalQuantileEndS(
  cause: Cause, tOutageS: number, nowS: number, q: readonly [number, number], family: QuantileFamily = "gamma",
): CondQuantile {
  const table = quantileTable(cause, family);
  const eS = nowS - tOutageS;
  const F = cdfExact(table, Math.max(0, eS));
  if (F.num >= F.den) return { endS: nowS, beyond: true };
  return { endS: tOutageS + quantileExactS(table, rescale(F, q[0], q[1])), beyond: false };
}

// ---------- 운영자가 보는 복구 추정 (3.5절) ----------
export function defaultStatus(cause: Cause): EstimateStatus {
  return cause === "ROTATING" ? "NEAR_CERTAIN" : "ASSUMED_RANGE";
}

export interface RestorationInput {
  cause: Cause;
  tOutageH: number;
  nowH: number;
  status?: EstimateStatus;
  /** CONFIRMED: 운영자 입력 복구 예정 시각(절대 모의 시각 h) */
  confirmedEndH?: number;
  /** CONFIRMED: 불확실성 σ_e. UI 기본 0.3 (params restoration.sigmaE.uiDefault) */
  sigmaE?: number | null;
  family?: QuantileFamily;
}

export interface RestorationDetail {
  view: RestorationView;
  /** 절대 모의 시각 정수 초 */
  p10S: number; p50S: number; p80S: number; p90S: number;
  /** 경과가 모형 상한을 넘어 R_q_end = now로 둔 경우(근거 문장에 「가정 범위 초과 경과」) */
  beyondAssumedRange: boolean;
}

export function computeRestoration(inp: RestorationInput): RestorationDetail {
  const status = inp.status ?? defaultStatus(inp.cause);
  const tOutageS = qT(inp.tOutageH);
  const nowS = qT(inp.nowH);
  let p10S: number, p50S: number, p80S: number, p90S: number, beyond = false;
  let sigmaE: number | null = null;

  if (status === "NEAR_CERTAIN") {
    const r = pRange("restoration.nearCertainRangeH");
    p10S = tOutageS + qT(r.lo);
    p90S = tOutageS + qT(r.hi);
    p50S = p80S = tOutageS + qT(pNum("restoration.nearCertainR80H"));
  } else if (status === "CONFIRMED") {
    if (inp.confirmedEndH == null) throw new Error("CONFIRMED에는 confirmedEndH(복구 예정 시각)가 필요");
    sigmaE = inp.sigmaE ?? pNum("restoration.sigmaE.uiDefault");
    if (!(sigmaE >= 0)) throw new Error(`σ_e는 0 이상 (${sigmaE})`);
    const estS = qT(inp.confirmedEndH);
    const remH = sToH(Math.max(0, estS - nowS));
    const z90 = pNum("restoration.confirmed.z90"), z80 = pNum("restoration.confirmed.z80");
    // Math.exp 직후 qT (3절 예외 규칙)
    p10S = nowS + qT(remH * Math.exp(-z90 * sigmaE));
    p90S = nowS + qT(remH * Math.exp(z90 * sigmaE));
    p80S = nowS + qT(remH * Math.exp(z80 * sigmaE));
    p50S = Math.max(nowS, estS);
  } else {
    const fam = inp.family ?? "gamma";
    const a = conditionalQuantileEndS(inp.cause, tOutageS, nowS, pRatio("restoration.q.p10"), fam);
    const b = conditionalQuantileEndS(inp.cause, tOutageS, nowS, pRatio("restoration.q.p50"), fam);
    const c = conditionalQuantileEndS(inp.cause, tOutageS, nowS, pRatio("restoration.q.p80"), fam);
    const d = conditionalQuantileEndS(inp.cause, tOutageS, nowS, pRatio("restoration.q.p90"), fam);
    p10S = a.endS; p50S = b.endS; p80S = c.endS; p90S = d.endS;
    beyond = a.beyond;
  }
  return {
    view: {
      cause: inp.cause, tOutage: inp.tOutageH,
      p10: sToH(p10S), p50: sToH(p50S), p80: sToH(p80S), p90: sToH(p90S),
      status, sigmaE, label: RESTORATION_LABEL,
    },
    p10S, p50S, p80S, p90S, beyondAssumedRange: beyond,
  };
}

export function computeRestorationView(inp: RestorationInput): RestorationView {
  return computeRestoration(inp).view;
}
