// 시간·에너지 양자화 (spec.md 3.1절). 결정 경로 파일 — 초월함수 금지(Math.sqrt만 허용).
// 결정에 쓰는 모든 부등호는 이 파일의 정수로 평가한다. Python 오라클은 math.floor·// 만 쓴다.

/** 무한대 감시값 (3.1절 규칙 1): slack −∞, A* = ∞, 쉼터 거부 ∞ */
export const INF_S = 2147483647;
export const NEG_INF_S = -2147483647;

const SAFE = Number.MAX_SAFE_INTEGER; // 2^53 − 1

/** qT(h) = floor(h*3600 + 0.5) — 정수 초 */
export function qT(h: number): number {
  if (!Number.isFinite(h)) throw new Error(`qT: 유한하지 않은 시간 ${h}`);
  return Math.floor(h * 3600 + 0.5);
}

/** qE(wh) = floor(wh*1000 + 0.5) — 정수 mWh */
export function qE(wh: number): number {
  if (!Number.isFinite(wh)) throw new Error(`qE: 유한하지 않은 에너지 ${wh}`);
  return Math.floor(wh * 1000 + 0.5);
}

/** 거리 km → 정수 m (arrival.ts 결정 경로용, DEVLOG 구현 중 결정) */
export function qD(km: number): number {
  if (!Number.isFinite(km)) throw new Error(`qD: 유한하지 않은 거리 ${km}`);
  return Math.floor(km * 1000 + 0.5);
}

/** 정수 초 → 시간(표시·타입 경계용). qT(sToH(s)) === s (|s| < 2^31, 시험으로 확인) */
export function sToH(s: number): number {
  return s / 3600;
}

export function assertInt(x: number, what: string): void {
  if (!Number.isSafeInteger(x)) throw new Error(`${what}: 안전 정수가 아님 (${x})`);
}

/** 3.1절 규칙 2: 분자끼리 먼저 모두 곱하고, floor 나눗셈은 마지막에 한 번. 중간값 < 2^53 단언 */
export function mulDivFloor(x: number, nums: readonly number[], dens: readonly number[]): number {
  assertInt(x, "mulDivFloor x");
  let n = x;
  for (const k of nums) {
    assertInt(k, "mulDivFloor num");
    n *= k;
    if (Math.abs(n) > SAFE) throw new Error("mulDivFloor: 분자 중간값이 2^53 이상");
  }
  let d = 1;
  for (const k of dens) {
    assertInt(k, "mulDivFloor den");
    if (k <= 0) throw new Error("mulDivFloor: 분모는 양의 정수");
    d *= k;
    if (d > SAFE) throw new Error("mulDivFloor: 분모 중간값이 2^53 이상");
  }
  return floorDiv(n, d);
}

/** 정수 floor 나눗셈 (Python //와 같음). |a|, b < 2^53이면 Math.floor(a/b)가 정확하다 */
export function floorDiv(a: number, b: number): number {
  assertInt(a, "floorDiv a");
  assertInt(b, "floorDiv b");
  if (b <= 0) throw new Error("floorDiv: 분모는 양의 정수");
  return Math.floor(a / b);
}

export function minInt(...xs: number[]): number {
  return xs.reduce((m, x) => (x < m ? x : m));
}
export function maxInt(...xs: number[]): number {
  return xs.reduce((m, x) => (x > m ? x : m));
}
export function clampInt(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
