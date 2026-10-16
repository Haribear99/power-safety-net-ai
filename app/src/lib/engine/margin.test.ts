import { describe, expect, it } from "vitest";
import { aStarEndS, arrivalLimitS, holdExpired, holdRecheckByS, marginH, marginS, remainingS, slackS, tierOf } from "./margin";
import { INF_S, NEG_INF_S, sToH } from "./quantize";
import { Gen, PROPERTY_RUNS } from "./test-rng";

describe("시간 기준점 파생값 (3.9절)", () => {
  it("slack = floor(0.8·L_rem) − A, 자원 없으면 −∞ 감시값", () => {
    expect(slackS(10000, 2000, 3000)).toBe(6400 - 3000);
    expect(slackS(10000, 2000, null)).toBe(NEG_INF_S);
    expect(slackS(1000, 2000, 0)).toBe(-800); // 이미 소진: 음수 floor
    expect(slackS(1000, 2001, 0)).toBe(-801); // floor(-1001 × 4/5) = floor(-800.8)
  });
  it("A = 0.8L 정확히: 도착 상한과 같으면 slack 0", () => {
    expect(arrivalLimitS(5000, 0)).toBe(4000);
    expect(slackS(5000, 0, 4000)).toBe(0);
  });
  it("tier = L_end < R90_end ? 0 : 1 (동점은 1)", () => {
    expect(tierOf(100, 101)).toBe(0);
    expect(tierOf(101, 101)).toBe(1);
  });
  it("holdRecheckBy = L_end − floor(1.25·A_min), now = 시한 정확히면 만료", () => {
    expect(holdRecheckByS(10000, 3000)).toBe(6250);
    expect(holdRecheckByS(10000, 3001)).toBe(10000 - 3751);
    expect(holdExpired(6250, 6250)).toBe(true);
    expect(holdExpired(6249, 6250)).toBe(false);
  });
  it("A* 선택: 배정 자원 → 가능 자원 최소 → 없음", () => {
    expect(aStarEndS(100, 50, [10])).toBe(150);
    expect(aStarEndS(100, null, [30, 10])).toBe(110);
    expect(aStarEndS(100, null, [])).toBeNull();
  });
});

describe("여유 (3.7절, I8)", () => {
  it("margin = [L_end − min(R90, A*), L_end − min(R10, A*)], 범위로만", () => {
    expect(marginS(10000, 3000, 9000, null)).toEqual({ lo: 1000, hi: 7000 });
    expect(marginS(10000, 3000, 9000, 5000)).toEqual({ lo: 5000, hi: 7000 });
    expect(marginS(10000, 3000, 9000, 1000)).toEqual({ lo: 9000, hi: 9000 });
    const r = marginH(10000, 3000, 9000, null);
    expect(r).toEqual({ lo: sToH(1000), hi: sToH(7000) });
    expect(Object.keys(r).sort()).toEqual(["hi", "lo"]);
  });
  it("속성: 경과시간이 늘면 L_rem·slack 비증가, R10 ≤ R90이면 margin.lo ≤ margin.hi", () => {
    const g = new Gen(31);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const lEnd = g.int(0, 200000);
      const now1 = g.int(0, 200000);
      const now2 = now1 + g.int(0, 50000);
      const a = g.bool(0.1) ? null : g.int(0, 30000);
      expect(remainingS(lEnd, now2)).toBeLessThanOrEqual(remainingS(lEnd, now1));
      expect(slackS(lEnd, now2, a)).toBeLessThanOrEqual(slackS(lEnd, now1, a));
      const r10 = g.int(0, 300000), r90 = r10 + g.int(0, 300000);
      const ast = g.bool(0.3) ? null : g.int(0, 400000);
      const m = marginS(lEnd, r10, r90, ast);
      expect(m.lo).toBeLessThanOrEqual(m.hi);
      expect(Math.min(r90, ast ?? INF_S)).toBe(lEnd - m.lo);
    }
  });
});
