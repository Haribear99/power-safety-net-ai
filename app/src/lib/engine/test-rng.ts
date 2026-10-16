// 시험 전용 시드 난수(spec.md 5.1절과 같은 xoshiro128** + splitmix32). 엔진·시뮬레이션 본 코드는 쓰지 않는다.
// 속성 시험의 반례 재현을 위해 시드를 고정한다(fast-check 미설치 — DEVLOG 미해결 참조).
export function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function xoshiro128ss(seed: number): () => number {
  const sm = splitmix32(seed);
  let a = sm(), b = sm(), c = sm(), d = sm();
  return () => {
    const r = Math.imul(rotl(Math.imul(b, 5) >>> 0, 7), 9) >>> 0;
    const t = (b << 9) >>> 0;
    c ^= a; d ^= b; b ^= c; a ^= d; c ^= t;
    d = rotl(d, 11);
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    return (r >>> 8) / 16777216; // (x>>>8)/2^24
  };
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export class Gen {
  readonly next: () => number;
  constructor(seed: number) { this.next = xoshiro128ss(seed); }
  int(lo: number, hi: number): number { return lo + Math.floor(this.next() * (hi - lo + 1)); }
  float(lo: number, hi: number): number { return lo + this.next() * (hi - lo); }
  bool(p = 0.5): boolean { return this.next() < p; }
  pick<T>(xs: readonly T[]): T { return xs[Math.floor(this.next() * xs.length)]; }
  maybe<T>(p: number, f: () => T): T | null { return this.bool(p) ? f() : null; }
}

/** 속성 시험 반복 횟수(9절: 불변식마다 10,000회) */
export const PROPERTY_RUNS = 10_000;
