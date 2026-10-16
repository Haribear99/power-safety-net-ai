// 여유(표시용)와 시간 기준점 파생값 (spec.md 3.7·3.9절). 결정 경로 파일 — 정수 초·정수 유리수만, 초월함수 금지.
// 모든 입력은 절대 모의 시각(정전 시작 0 기준)의 정수 초다. A는 '지금' 기준 길이(정수 초).
import type { Range } from "../domain/types";
import { pRatio } from "./params";
import { INF_S, NEG_INF_S, mulDivFloor, sToH } from "./quantize";

/** 경과시간 e = now − tOutage */
export function elapsedS(nowS: number, tOutageS: number): number {
  return nowS - tOutageS;
}

/** 남은 시간 X_rem = X_end − now (L_rem, R80_rem) */
export function remainingS(endS: number, nowS: number): number {
  return endS - nowS;
}

/** A_end = now + A */
export function arrivalEndS(nowS: number, aS: number): number {
  return nowS + aS;
}

/** 0.8·L_rem (floor) */
export function arrivalLimitS(lEndS: number, nowS: number): number {
  const [n, d] = pRatio("alloc.arrivalFactor");
  return mulDivFloor(lEndS - nowS, [n], [d]);
}

/**
 * slack = 0.8·L_rem − (A_end − now) = floor(L_rem × 4/5) − A (3.9·4.1절).
 * 물리 필터 통과 자원이 없으면(aMinS == null) −∞ 감시값.
 */
export function slackS(lEndS: number, nowS: number, aMinS: number | null): number {
  if (aMinS == null) return NEG_INF_S;
  return arrivalLimitS(lEndS, nowS) - aMinS;
}

/** tier = qT(L_end) < qT(R90_end) ? 0 : 1 */
export function tierOf(lEndS: number, r90EndS: number): 0 | 1 {
  return lEndS < r90EndS ? 0 : 1;
}

/** HOLD 재확인 시한 holdRecheckBy = L_end − 1.25·A_min (절대 시각, 정수 초) */
export function holdRecheckByS(lEndS: number, aMinS: number): number {
  const [n, d] = pRatio("alloc.holdRecheckFactor");
  return lEndS - mulDivFloor(aMinS, [n], [d]);
}

/** now ≥ holdRecheckBy이면 HOLD를 '필요'로 되돌린다(HOLD_EXPIRED) */
export function holdExpired(nowS: number, recheckByS: number): boolean {
  return nowS >= recheckByS;
}

export interface MarginS { lo: number; hi: number }

/**
 * marginH = [L_end − min(R90_end, A*_end), L_end − min(R10_end, A*_end)] (3.7절).
 * A*_end: 배정 자원의 A_end → 없으면 가능한 자원 중 최소 A_end → 그것도 없으면 ∞(null).
 * 범위로만 표시한다(I8). 단일값 표시 금지.
 */
export function marginS(lEndS: number, r10EndS: number, r90EndS: number, aStarEndS: number | null): MarginS {
  const a = aStarEndS ?? INF_S;
  return { lo: lEndS - Math.min(r90EndS, a), hi: lEndS - Math.min(r10EndS, a) };
}

export function marginH(lEndS: number, r10EndS: number, r90EndS: number, aStarEndS: number | null): Range {
  const m = marginS(lEndS, r10EndS, r90EndS, aStarEndS);
  return { lo: sToH(m.lo), hi: sToH(m.hi) };
}

/** A*_end 선택 규칙(3.7절) */
export function aStarEndS(nowS: number, assignedAS: number | null, feasibleAS: readonly number[]): number | null {
  if (assignedAS != null) return nowS + assignedAS;
  if (feasibleAS.length > 0) return nowS + Math.min(...feasibleAS);
  return null;
}
