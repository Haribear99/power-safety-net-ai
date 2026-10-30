// 시드 난수 (spec.md 5.1절). 비AI, 결정적. Math.random·Date 금지(3장).
// - PRNG는 xoshiro128** 하나. 시드 = splitmix32(hash(master, scenarioId, stream)), 균등값 = (x>>>8)/2^24.
// - 스트림 분리: HH=1, RES=2, TRUTH_R=3, EST=4, ARRIVAL=5, BEHAVIOR=6, LANE=7, LHS=8, PATCH=9, BOOT=10(랩 부트스트랩, 라운드 5), CYL=11(E7 산소통 고장, 10/30).
//   모든 정책이 같은 materialize 결과를 읽으므로 공통 난수(짝 비교)가 성립한다.
// - 정규 난수는 materialize 단계에서만 Box–Muller(Math.log·cos·sqrt)로 만든다. 결과는 호출자가 qT·qE 정수로 저장한다(3절).

export const STREAMS = { HH: 1, RES: 2, TRUTH_R: 3, EST: 4, ARRIVAL: 5, BEHAVIOR: 6, LANE: 7, LHS: 8, PATCH: 9, BOOT: 10, CYL: 11 } as const;
export type StreamName = keyof typeof STREAMS;

const TWO_POW_24 = 16777216;

/** FNV-1a 32비트 (UTF-8 바이트). hash(master, scenarioId, stream)의 정의 */
export function fnv1a32(s: string): number {
  const bytes = new TextEncoder().encode(s);
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** splitmix32: 32비트 출력 생성기(시드 확산용) */
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

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** xoshiro128** — 상태 4워드를 splitmix32(seed)로 채운다. 32비트 정수 출력 */
export function xoshiro128ss(seed: number): () => number {
  const sm = splitmix32(seed);
  return xoshiro128ssFromState(sm(), sm(), sm(), sm());
}

/** 상태 4워드를 직접 준 xoshiro128** (참조 벡터 시험용) */
export function xoshiro128ssFromState(s0: number, s1: number, s2: number, s3: number): () => number {
  let a = s0 >>> 0, b = s1 >>> 0, c = s2 >>> 0, d = s3 >>> 0;
  if ((a | b | c | d) === 0) a = 1; // 전부 0이면 생성기가 멈춘다(사실상 도달 불가)
  return () => {
    const r = Math.imul(rotl(Math.imul(b, 5) >>> 0, 7), 9) >>> 0;
    const t = (b << 9) >>> 0;
    c = (c ^ a) >>> 0;
    d = (d ^ b) >>> 0;
    b = (b ^ c) >>> 0;
    a = (a ^ d) >>> 0;
    c = (c ^ t) >>> 0;
    d = rotl(d, 11);
    return r;
  };
}

/** hash(master, scenarioId, stream): 구분자 U+0000으로 이어 붙인 문자열의 FNV-1a */
export function streamHash(master: string, scenarioId: string, stream: StreamName): number {
  return fnv1a32(`${master}\u0000${scenarioId}\u0000${STREAMS[stream]}`);
}

export class Rng {
  private readonly nextU32: () => number;
  /** 이 생성기에서 꺼낸 32비트 값 수(시험·디버깅용) */
  draws = 0;
  constructor(seed32: number) {
    this.nextU32 = xoshiro128ss(seed32);
  }
  u32(): number {
    this.draws++;
    return this.nextU32();
  }
  /** [0, 1) 균등값 = (x>>>8)/2^24 */
  uniform(): number {
    return (this.u32() >>> 8) / TWO_POW_24;
  }
  /** [lo, hi) 균등 */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.uniform();
  }
  /** 정수 U{lo..hi} (양끝 포함) */
  int(lo: number, hi: number): number {
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi < lo) throw new Error(`Rng.int 범위 오류 ${lo}..${hi}`);
    return lo + Math.floor(this.uniform() * (hi - lo + 1));
  }
  bernoulli(p: number): boolean {
    return this.uniform() < p;
  }
  /** 가중 선택. 항목 순서가 결정성의 일부다 */
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    let total = 0;
    for (const [, w] of entries) {
      if (!(w >= 0)) throw new Error("가중치는 0 이상");
      total += w;
    }
    if (!(total > 0)) throw new Error("가중치 합이 0");
    const x = this.uniform() * total;
    let acc = 0;
    for (const [v, w] of entries) {
      acc += w;
      if (x < acc) return v;
    }
    return entries[entries.length - 1][0];
  }
  /** Fisher–Yates (새 배열) */
  shuffle<T>(xs: readonly T[]): T[] {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.uniform() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  /** 표준정규 N(0,1), Box–Muller 코사인 가지 하나(균등 2개 소비). materialize 전용 */
  normal(): number {
    const u1 = 1 - this.uniform(); // (0, 1]
    const u2 = this.uniform();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}

/** 시나리오·스트림별 생성기: xoshiro128** 상태 4워드 = splitmix32(hash(master, scenarioId, stream))의 첫 4출력 */
export function rngFor(master: string, scenarioId: string, stream: StreamName): Rng {
  return new Rng(streamHash(master, scenarioId, stream));
}
