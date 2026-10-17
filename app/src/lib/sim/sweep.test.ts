import { describe, expect, it } from "vitest";
import { GEN_CLASSES } from "./labels";
import { materialize } from "./materialize";
import { SEED_RANGES } from "./lhs";
import { e1Def, e1Thetas, E1_STRAT, e2Cells, e2Def, E2_SEEDS_PER_CELL, falsifyVariants, runE1, runE2, withAxis } from "./sweep";

describe("E2 칸과 시드", () => {
  it("27칸, σ_e = 0.5 칸이 앞 9칸이고 봉인 시드 범위를 정확히 채운다", () => {
    const cells = e2Cells(27);
    expect(cells).toHaveLength(27);
    expect(cells.slice(0, 9).every((c) => c.sigmaE === 0.5)).toBe(true);
    expect(e2Cells(9).map((c) => c.id)).toEqual(cells.slice(0, 9).map((c) => c.id));
    const lo = SEED_RANGES.e2.lo;
    expect(Number(e2Def(cells[0], 0, lo).seed)).toBe(lo);
    expect(Number(e2Def(cells[26], E2_SEEDS_PER_CELL - 1, lo).seed)).toBe(SEED_RANGES.e2.hi);
  });
  it("원인은 ROTATING이 아니고 같은 시드면 같다", () => {
    const c = e2Cells(9)[4];
    for (let k = 0; k < 20; k++) expect(e2Def(c, k, 100).cause).not.toBe("ROTATING");
    expect(e2Def(c, 3, 100)).toEqual(e2Def(c, 3, 100));
  });
  it("runE2는 결정적이고 모든 정책 점수를 낸다", () => {
    const c = e2Cells(9)[4];
    const a = runE2(c, 0, 100, ["RULE", "KR_BASELINE"]);
    expect(a).toEqual(runE2(c, 0, 100, ["RULE", "KR_BASELINE"]));
    expect(Object.keys(a.pol).sort()).toEqual(["KR_BASELINE", "RULE"]);
    expect(a.seed).toBe(100 + 4 * E2_SEEDS_PER_CELL);
  });
});

describe("E1 층화(5.4절)", () => {
  it("7등급 각 5가구 이상, 등록 60가구", () => {
    const th = e1Thetas(3, "E1-test");
    for (const cause of ["APT_PARTS", "KEPCO_DIST"] as const) {
      const m = materialize(e1Def(1, cause, th[1], 100)).scenario;
      expect(m.planner.households).toHaveLength(60);
      const counts = new Map<string, number>();
      for (const h of m.planner.households) counts.set(m.labels[h.id], (counts.get(m.labels[h.id]) ?? 0) + 1);
      for (const c of GEN_CLASSES) expect(counts.get(c) ?? 0).toBeGreaterThanOrEqual(E1_STRAT);
    }
  });
  it("축 고정 변형은 같은 시나리오 id·시드를 쓴다(공통 난수)", () => {
    const th = e1Thetas(2, "E1-test")[0];
    const v = falsifyVariants().find((x) => x.axis === "scaleMult" && x.end === "lo")!;
    const a = e1Def(0, "APT_FIRE", th, 100), b = e1Def(0, "APT_FIRE", withAxis(th, v), 100);
    expect(b.scenarioId).toBe(a.scenarioId);
    expect(b.seed).toBe(a.seed);
    expect(b.theta.scaleMult).toBe(0.5);
    expect(falsifyVariants()).toHaveLength(38);
  });
  it("runE1 등급 집계: 공백 가구 수 ≤ 등급 가구 수", () => {
    const th = e1Thetas(1, "E1-test")[0];
    const r = runE1(0, "APT_NIGHT_XFMR", th, 100);
    for (const v of Object.values(r.cls)) for (const g of v!.slice(1)) expect(g).toBeLessThanOrEqual(v![0]);
    expect(r.cls.O2_STAT![1]).toBe(r.cls.O2_STAT![0]); // 배터리 없는 거치형 산소는 복구 전 전부 공백(KR)
  });
});
