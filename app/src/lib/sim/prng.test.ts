import { describe, expect, it } from "vitest";
import { fnv1a32, Rng, rngFor, splitmix32, STREAMS, streamHash, xoshiro128ssFromState } from "./prng";
import { AXES, axisBounds, lhsSample, standardTheta, thetaInRange } from "./lhs";

describe("PRNG (5.1절)", () => {
  it("xoshiro128** 참조 벡터: 상태 (1,2,3,4)의 첫 출력", () => {
    const g = xoshiro128ssFromState(1, 2, 3, 4);
    expect([g(), g(), g(), g()]).toEqual([11520, 0, 5927040, 70819200]);
  });
  it("FNV-1a 32 참조 벡터", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });
  it("splitmix32는 32비트 부호 없는 정수를 낸다", () => {
    const s = splitmix32(42);
    for (let i = 0; i < 1000; i++) {
      const x = s();
      expect(Number.isInteger(x) && x >= 0 && x < 2 ** 32).toBe(true);
    }
  });
  it("같은 (master, scenarioId, stream) → 같은 수열, 스트림이 다르면 다른 수열", () => {
    const a = rngFor("7", "S", "HH"), b = rngFor("7", "S", "HH"), c = rngFor("7", "S", "RES"), d = rngFor("8", "S", "HH");
    const xa = Array.from({ length: 50 }, () => a.u32());
    expect(Array.from({ length: 50 }, () => b.u32())).toEqual(xa);
    expect(Array.from({ length: 50 }, () => c.u32())).not.toEqual(xa);
    expect(Array.from({ length: 50 }, () => d.u32())).not.toEqual(xa);
    expect(new Set(Object.values(STREAMS)).size).toBe(11); // CYL(E7, 10/30) 추가
    expect(streamHash("7", "S", "HH")).not.toBe(streamHash("7", "S", "RES"));
  });
  it("균등값은 (x>>>8)/2^24 ∈ [0,1), 정규값은 평균 0·분산 1 근처", () => {
    const r = new Rng(123);
    let s = 0, s2 = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const u = r.uniform();
      expect(u >= 0 && u < 1).toBe(true);
      expect(Number.isInteger(u * 2 ** 24)).toBe(true);
    }
    for (let i = 0; i < n; i++) {
      const z = r.normal();
      s += z; s2 += z * z;
    }
    expect(Math.abs(s / n)).toBeLessThan(0.03);
    expect(Math.abs(s2 / n - 1)).toBeLessThan(0.05);
  });
  it("int·weighted·shuffle은 범위 안", () => {
    const r = new Rng(9);
    for (let i = 0; i < 2000; i++) {
      const k = r.int(1, 5);
      expect(k >= 1 && k <= 5).toBe(true);
    }
    expect(r.shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(["a", "b"]).toContain(r.weighted([["a", 1], ["b", 3]] as const));
  });
});

describe("스윕 축 θ와 LHS (5.3절)", () => {
  it("표준 θ는 모든 축 범위 안", () => {
    expect(thetaInRange(standardTheta())).toEqual([]);
  });
  it("LHS: 같은 입력이면 같은 추첨, 연속 축은 층마다 정확히 1개", () => {
    const n = 40;
    const a = lhsSample(n, "m", "sweep-A");
    expect(lhsSample(n, "m", "sweep-A")).toEqual(a);
    expect(lhsSample(n, "m", "sweep-B")).not.toEqual(a);
    for (const t of a) expect(thetaInRange(t)).toEqual([]);
    for (const [k, axis] of AXES) {
      if (axis.kind !== "uniform") continue;
      const b = axisBounds(axis) as { lo: number; hi: number };
      const strata = a.map((t) => Math.min(n - 1, Math.floor((((t[k] as number) - b.lo) / (b.hi - b.lo)) * n)));
      expect(new Set(strata).size).toBe(n);
    }
  });
  it("LHS fixed는 축을 고정한다(E2 칸)", () => {
    for (const t of lhsSample(9, "m", "e2", { hhPerResource: 3, travelProfile: "slow", sigmaE: 0.5 })) {
      expect([t.hhPerResource, t.travelProfile, t.sigmaE]).toEqual([3, "slow", 0.5]);
    }
  });
});
