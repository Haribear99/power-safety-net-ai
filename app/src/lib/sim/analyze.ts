// 리허설 랩 집계·판정 (spec.md 5.4절, 라운드 5). 비AI, 결정적. 입력은 sweep.ts의 결과 행뿐이다.
// - E1: (등급, 원인) 칸마다 '그 등급 등록 가구의 과반이 G>0'인 추첨 비율 p와 Wilson 95% CI → 표지
// - E2: 칸마다 RULE 대 비교 정책의 M1 승/무/패, M2 짝 차이(시간)의 평균·중앙값과 짝 부트스트랩 95% CI
// CI는 추첨(몬테카를로) 오차만 반영한다. 가정 범위 자체의 불확실성이 아니다(5.4절 'CI의 뜻').
import type { Cause } from "../domain/types";
import { GEN_CLASSES, type GenClass } from "./labels";
import { rngFor } from "./prng";
import { E1_POLICIES, type E1Row, type E2Row, type FalsifyVariant } from "./sweep";

export const Z95 = 1.959964;

export function wilson(k: number, n: number, z = Z95): { lo: number; hi: number } {
  if (n === 0) return { lo: 0, hi: 1 };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return { lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
}

export type E1Label = "ROBUST" | "CONDITIONAL" | "FRAGILE" | "BORDERLINE";

/** 5.4절 표지 컷: ROBUST CI 하한 ≥ 0.9, FRAGILE CI 상한 < 0.3, CONDITIONAL CI ⊂ [0.3, 0.9], 나머지 BORDERLINE */
export function e1Label(ci: { lo: number; hi: number }): E1Label {
  if (ci.lo >= 0.9) return "ROBUST";
  if (ci.hi < 0.3) return "FRAGILE";
  if (ci.lo >= 0.3 && ci.hi <= 0.9) return "CONDITIONAL";
  return "BORDERLINE";
}

/** 추첨 하나의 지표: 그 등급 등록 가구의 과반(> n/2)이 G>0 */
export function majorityGap(counts: number[] | undefined, policyIdx: number): boolean | null {
  if (!counts || counts[0] === 0) return null;
  return counts[1 + policyIdx] * 2 > counts[0];
}

export interface E1Cell {
  cls: GenClass; cause: Cause; policy: string;
  n: number; k: number; p: number; ci: { lo: number; hi: number }; label: E1Label;
  /** CI 컷만으로 정한 표지(p_early 강등 전). 안정성 시험은 이 값끼리 비교한다 */
  rawLabel: E1Label;
  /** 사양상 0시간 등급(배터리 없는 거치형 산소)은 헤드라인·표지 집계에서 뺀다 */
  physicalZero: boolean;
  /** ROBUST였으나 p_early 끝값(0.8)에서 CI 하한 < 0.9라 내린 경우 */
  demotedByPEarly?: boolean;
  /** ROBUST 칸의 축별 1차원 반증: 끝값 고정에서 p < 0.9가 된 축 */
  flips?: { axis: string; end: string; value: number | string; p: number; n: number }[];
  /** CONDITIONAL 칸의 경계 정전시간(R_true 10분위에서 조건부 p가 0.5를 지나는 곳) */
  boundaryH?: number | null;
}

export const PHYSICAL_ZERO: readonly GenClass[] = ["O2_STAT"];

function cellStats(rows: readonly E1Row[], cls: GenClass, cause: Cause, j: number): { n: number; k: number; series: { r: number; g: boolean }[] } {
  let n = 0, k = 0;
  const series: { r: number; g: boolean }[] = [];
  for (const row of rows) {
    if (row.cause !== cause) continue;
    const g = majorityGap(row.cls[cls], j);
    if (g == null) continue;
    n++; if (g) k++;
    series.push({ r: row.rTrueH, g });
  }
  return { n, k, series };
}

/** R_true 10분위별 조건부 p. 0.5를 처음 지나는 이웃 분위 경계(앞 분위의 R 최댓값)를 돌려준다. 지나지 않으면 null */
export function conditionalBoundaryH(series: readonly { r: number; g: boolean }[]): number | null {
  if (series.length < 20) return null;
  const s = [...series].sort((a, b) => a.r - b.r);
  const dec: { p: number; rMax: number }[] = [];
  for (let q = 0; q < 10; q++) {
    const part = s.slice(Math.floor((q * s.length) / 10), Math.floor(((q + 1) * s.length) / 10));
    if (part.length === 0) continue;
    dec.push({ p: part.filter((x) => x.g).length / part.length, rMax: part[part.length - 1].r });
  }
  for (let i = 1; i < dec.length; i++) {
    if ((dec[i - 1].p - 0.5) * (dec[i].p - 0.5) < 0) return Math.round(dec[i - 1].rMax * 10) / 10;
  }
  return null;
}

export interface E1Variant { variant: FalsifyVariant; rows: readonly E1Row[] }

export function analyzeE1(main: readonly E1Row[], variants: readonly E1Variant[], causes: readonly Cause[]): E1Cell[] {
  const out: E1Cell[] = [];
  E1_POLICIES.forEach((policy, j) => {
    for (const cls of GEN_CLASSES) for (const cause of causes) {
      const st = cellStats(main, cls, cause, j);
      if (st.n === 0) continue;
      const ci = wilson(st.k, st.n);
      const raw = e1Label(ci);
      const cell: E1Cell = { cls, cause, policy, n: st.n, k: st.k, p: st.k / st.n, ci, label: raw, rawLabel: raw, physicalZero: PHYSICAL_ZERO.includes(cls) };
      if (cell.label === "ROBUST") {
        const flips: NonNullable<E1Cell["flips"]> = [];
        for (const v of variants) {
          const vs = cellStats(v.rows, cls, cause, j);
          if (vs.n === 0) continue;
          const p = vs.k / vs.n;
          if (p < 0.9) flips.push({ axis: v.variant.axis, end: v.variant.end, value: v.variant.value, p, n: vs.n });
          if (v.variant.axis === "pEarly" && v.variant.end === "hi" && wilson(vs.k, vs.n).lo < 0.9) cell.demotedByPEarly = true;
        }
        cell.flips = flips;
        if (cell.demotedByPEarly) cell.label = "CONDITIONAL";
      }
      if (cell.label === "CONDITIONAL" && cause !== "ROTATING") cell.boundaryH = conditionalBoundaryH(st.series);
      out.push(cell);
    }
  });
  return out;
}

/**
 * 안정성 시험(5.4절): 로그정규 표에서 표지가 바뀐 칸. 원래 ROBUST(무배터리 산소 제외)가 전부 뒤집히면 실패.
 * 축 반증 변형은 감마 표에서만 돌리므로, 비교는 강등 전 표지(rawLabel)끼리 한다.
 */
export function stabilityCheck(gamma: readonly E1Cell[], lognormal: readonly E1Cell[]): {
  flipped: { cls: string; cause: string; policy: string; from: E1Label; to: E1Label }[]; robustKept: number; robustTotal: number; pass: boolean;
} {
  const key = (c: E1Cell) => `${c.policy}|${c.cls}|${c.cause}`;
  const ln = new Map(lognormal.map((c) => [key(c), c] as const));
  const flipped: { cls: string; cause: string; policy: string; from: E1Label; to: E1Label }[] = [];
  let robustTotal = 0, robustKept = 0;
  for (const c of gamma) {
    const o = ln.get(key(c));
    if (!o) continue;
    if (o.rawLabel !== c.rawLabel) flipped.push({ cls: c.cls, cause: c.cause, policy: c.policy, from: c.rawLabel, to: o.rawLabel });
    if (c.policy === "KR_BASELINE" && c.rawLabel === "ROBUST" && !c.physicalZero) {
      robustTotal++;
      if (o.rawLabel === "ROBUST") robustKept++;
    }
  }
  return { flipped, robustKept, robustTotal, pass: robustTotal === 0 || robustKept > 0 };
}

/** E1b: 등급별 정전시간 구간(2h)마다 가구 단위 공백 비율(정책별) */
export function e1bCurves(main: readonly E1Row[], binH = 2, maxH = 48): Record<string, { binLoH: number; n: number; gap: number[] }[]> {
  const out: Record<string, { binLoH: number; n: number; gap: number[] }[]> = {};
  const nb = Math.ceil(maxH / binH) + 1;
  for (const cls of GEN_CLASSES) {
    const bins = Array.from({ length: nb }, (_, i) => ({ binLoH: i * binH, n: 0, gap: E1_POLICIES.map(() => 0) }));
    for (const row of main) {
      const c = row.cls[cls];
      if (!c) continue;
      const b = bins[Math.min(nb - 1, Math.floor(row.rTrueH / binH))];
      b.n += c[0];
      for (let j = 0; j < E1_POLICIES.length; j++) b.gap[j] += c[1 + j];
    }
    out[cls] = bins;
  }
  return out;
}

// ---------- E2 ----------
export type E2Verdict = "SUPERIOR" | "INFERIOR" | "NON_INFERIOR" | "NO_DIFF";

export interface E2Compare {
  vs: string; n: number; win: number; tie: number; loss: number;
  /** M2 짝 차이(RULE − 비교, 시간) */
  meanDiffH: number; medianDiffH: number; ci: { lo: number; hi: number };
  /** 1 − ΣM2(RULE)/ΣM2(비교) 와 부트스트랩 CI. 비교 쪽 합이 0이면 null */
  relReduction: number | null; relCi: { lo: number; hi: number } | null;
  verdict: E2Verdict;
}

export const E2_BOOT = 2000;

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * 5.4절 칸 판정. 우세 = 승률 > 패배율 ∧ M2 짝 차이 평균의 95% CI 상한 < 0. 열등은 대칭.
 * 그 밖에 패배율 ≤ 5%면 비열등, 나머지는 '차이 없음'.
 */
export function compareCell(rows: readonly E2Row[], vs: string, bootKey: string, boot = E2_BOOT): E2Compare {
  const pairs = rows.filter((r) => r.pol.RULE && r.pol[vs]);
  const n = pairs.length;
  let win = 0, tie = 0, loss = 0;
  const d: number[] = [], a: number[] = [], b: number[] = [];
  for (const r of pairs) {
    const x = r.pol.RULE, y = r.pol[vs];
    if (x.M1 < y.M1) win++; else if (x.M1 > y.M1) loss++; else tie++;
    d.push((x.M2S - y.M2S) / 3600); a.push(x.M2S); b.push(y.M2S);
  }
  const mean = d.reduce((s, v) => s + v, 0) / Math.max(1, n);
  const sortedD = [...d].sort((p, q) => p - q);
  const rng = rngFor("E2-BOOT", bootKey, "BOOT");
  const means: number[] = [], rels: number[] = [];
  for (let t = 0; t < boot; t++) {
    let sd = 0, sa = 0, sb = 0;
    for (let i = 0; i < n; i++) {
      const j = Math.floor(rng.uniform() * n);
      sd += d[j]; sa += a[j]; sb += b[j];
    }
    means.push(sd / n);
    if (sb > 0) rels.push(1 - sa / sb);
  }
  means.sort((p, q) => p - q); rels.sort((p, q) => p - q);
  const sumA = a.reduce((s, v) => s + v, 0), sumB = b.reduce((s, v) => s + v, 0);
  const ci = { lo: quantile(means, 0.025), hi: quantile(means, 0.975) };
  let verdict: E2Verdict = "NO_DIFF";
  if (win > loss && ci.hi < 0) verdict = "SUPERIOR";
  else if (loss > win && ci.lo > 0) verdict = "INFERIOR";
  else if (n > 0 && loss / n <= 0.05) verdict = "NON_INFERIOR";
  return {
    vs, n, win, tie, loss, meanDiffH: mean, medianDiffH: quantile(sortedD, 0.5), ci,
    relReduction: sumB > 0 ? 1 - sumA / sumB : null,
    relCi: rels.length === boot ? { lo: quantile(rels, 0.025), hi: quantile(rels, 0.975) } : null,
    verdict,
  };
}

export interface E2CellResult {
  cell: string; n: number;
  compares: Record<string, E2Compare>;
  /** 정책별 합계(M1 가구 수, M2 시간) */
  totals: Record<string, { M1: number; M2H: number }>;
  /** 단순 규칙 둘을 합친 판정(5.4절 [P1]·[P0]·[P2]) */
  pClass: "P1" | "P0" | "P2";
  /** (ΣKR − ΣRULE)/(ΣKR − ΣORACLE_INFO): 정보 상한까지 갈 수 있는 개선 중 RULE이 얻은 몫(M2) */
  oracleCapture: number | null;
}

export function analyzeE2Cell(cell: string, rows: readonly E2Row[], comparators: readonly string[]): E2CellResult {
  const compares: Record<string, E2Compare> = {};
  for (const vs of comparators) compares[vs] = compareCell(rows, vs, `${cell}|${vs}`);
  const totals: Record<string, { M1: number; M2H: number }> = {};
  for (const r of rows) for (const [p, s] of Object.entries(r.pol)) {
    totals[p] ??= { M1: 0, M2H: 0 };
    totals[p].M1 += s.M1; totals[p].M2H += s.M2S / 3600;
  }
  const b1 = compares.B1_SHORTEST?.verdict, b2 = compares.B2_NEAREST?.verdict;
  const pClass = b1 === "SUPERIOR" && b2 === "SUPERIOR" ? "P1" : b1 === "INFERIOR" || b2 === "INFERIOR" ? "P2" : "P0";
  const kr = totals.KR_BASELINE?.M2H, ru = totals.RULE?.M2H, or = totals.ORACLE_INFO?.M2H;
  const oracleCapture = kr != null && ru != null && or != null && kr - or > 0 ? (kr - ru) / (kr - or) : null;
  return { cell, n: rows.length, compares, totals, pClass, oracleCapture };
}

// ---------- E3 (보완안, 라운드 6) ----------
export interface E3Effect {
  variant: string; base: string; patch: string; n: number;
  /** 1 − ΣM2(바탕+보완안)/ΣM2(바탕), 시나리오 재표본 부트스트랩 95% CI */
  rel: number | null; relCi: { lo: number; hi: number } | null;
  /** 공백 고위험 가구 수(M1) 시나리오별 승/무/패(보완안이 적으면 승) */
  win: number; tie: number; loss: number;
  byCause: Record<string, number | null>;
  /** 실효 보급률(보급 × 배수 × (1 − 고장), P3는 × 계획률, P1은 계획률) 10분위별 감소율. lo = 최하위, hi = 최상위 분위 */
  byEff: { deciles: (number | null)[]; lo: number | null; hi: number | null };
}

type E3LikeRow = { cause: string; ax: { covMult: number; failProb: number; planRate: number }; m1: number[]; m2S: number[] };

export function effCoverage(patch: string, ax: E3LikeRow["ax"], def: { coverage?: number; requiresPlan?: boolean; kind: string }): number {
  if (def.kind === "PLAN_EVAC") return ax.planRate;
  return (def.coverage ?? 0) * ax.covMult * (1 - ax.failProb) * (def.requiresPlan ? ax.planRate : 1);
}

function relOf(rows: readonly E3LikeRow[], bi: number, vi: number): number | null {
  let a = 0, b = 0;
  for (const r of rows) { a += r.m2S[vi]; b += r.m2S[bi]; }
  return b > 0 ? 1 - a / b : null;
}

export function e3Effect(
  rows: readonly E3LikeRow[], variants: readonly string[], variant: string,
  def: { coverage?: number; requiresPlan?: boolean; kind: string }, boot = E2_BOOT,
): E3Effect {
  const [base, patch] = variant.split("+");
  const bi = variants.indexOf(base), vi = variants.indexOf(variant);
  if (bi < 0 || vi < 0) throw new Error(`변형 ${variant} 없음`);
  let win = 0, tie = 0, loss = 0;
  for (const r of rows) { if (r.m1[vi] < r.m1[bi]) win++; else if (r.m1[vi] > r.m1[bi]) loss++; else tie++; }
  const n = rows.length;
  const rng = rngFor("E3-BOOT", variant, "BOOT");
  const rels: number[] = [];
  for (let t = 0; t < boot; t++) {
    let a = 0, b = 0;
    for (let i = 0; i < n; i++) { const r = rows[Math.floor(rng.uniform() * n)]; a += r.m2S[vi]; b += r.m2S[bi]; }
    if (b > 0) rels.push(1 - a / b);
  }
  rels.sort((p, q) => p - q);
  const byCause: Record<string, number | null> = {};
  for (const c of [...new Set(rows.map((r) => r.cause))].sort()) byCause[c] = relOf(rows.filter((r) => r.cause === c), bi, vi);
  const sorted = [...rows].sort((p, q) => effCoverage(patch, p.ax, def) - effCoverage(patch, q.ax, def));
  const deciles: (number | null)[] = [];
  for (let q = 0; q < 10; q++) deciles.push(relOf(sorted.slice(Math.floor((q * n) / 10), Math.floor(((q + 1) * n) / 10)), bi, vi));
  return {
    variant, base, patch, n, rel: relOf(rows, bi, vi),
    relCi: rels.length === boot ? { lo: quantile(rels, 0.025), hi: quantile(rels, 0.975) } : null,
    win, tie, loss, byCause, byEff: { deciles, lo: deciles[0], hi: deciles[9] },
  };
}

/** 변형별 (등급, 원인) 표지(축 반증 없이 CI 컷만). rows의 cls 배열은 [n, 변형별 공백 수…] */
export function labelsByVariant(
  rows: readonly { cause: Cause; cls: Partial<Record<GenClass, number[]>> }[], variants: readonly string[], causes: readonly Cause[],
): { variant: string; cls: GenClass; cause: Cause; n: number; p: number; ci: { lo: number; hi: number }; label: E1Label }[] {
  const out: { variant: string; cls: GenClass; cause: Cause; n: number; p: number; ci: { lo: number; hi: number }; label: E1Label }[] = [];
  variants.forEach((variant, j) => {
    for (const cls of GEN_CLASSES) for (const cause of causes) {
      let n = 0, k = 0;
      for (const r of rows) {
        if (r.cause !== cause) continue;
        const g = majorityGap(r.cls[cls], j);
        if (g == null) continue;
        n++; if (g) k++;
      }
      if (n === 0) continue;
      const ci = wilson(k, n);
      out.push({ variant, cls, cause, n, p: k / n, ci, label: e1Label(ci) });
    }
  });
  return out;
}
