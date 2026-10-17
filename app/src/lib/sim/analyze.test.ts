import { describe, expect, it } from "vitest";
import { analyzeE1, compareCell, conditionalBoundaryH, e1Label, majorityGap, stabilityCheck, wilson } from "./analyze";
import type { E1Row, E2Row } from "./sweep";

describe("Wilson CI", () => {
  it("교과서 값과 맞는다(k=8, n=10 → [0.490, 0.943])", () => {
    const ci = wilson(8, 10);
    expect(ci.lo).toBeCloseTo(0.4902, 3);
    expect(ci.hi).toBeCloseTo(0.9433, 3);
  });
  it("p=1, n=100이면 하한 0.963", () => {
    expect(wilson(100, 100).lo).toBeCloseTo(0.963, 3);
  });
});

describe("E1 표지 컷(5.4절)", () => {
  it("하한 ≥0.9 ROBUST, 상한 <0.3 FRAGILE, [0.3,0.9] 안 CONDITIONAL, 나머지 BORDERLINE", () => {
    expect(e1Label({ lo: 0.9, hi: 1 })).toBe("ROBUST");
    expect(e1Label({ lo: 0, hi: 0.29 })).toBe("FRAGILE");
    expect(e1Label({ lo: 0.3, hi: 0.9 })).toBe("CONDITIONAL");
    expect(e1Label({ lo: 0.85, hi: 0.95 })).toBe("BORDERLINE");
    expect(e1Label({ lo: 0.25, hi: 0.4 })).toBe("BORDERLINE");
  });
  it("과반은 n/2 초과(5가구 중 3가구부터)", () => {
    expect(majorityGap([5, 3, 2], 0)).toBe(true);
    expect(majorityGap([5, 3, 2], 1)).toBe(false);
    expect(majorityGap([4, 2, 0], 0)).toBe(false);
    expect(majorityGap(undefined, 0)).toBeNull();
  });
});

const row = (d: number, rTrueH: number, kr: number, rule: number): E1Row => ({
  d, seed: 9000 + d, cause: "APT_PARTS", rTrueH, cls: { VENT_3H: [5, kr, rule], O2_STAT: [5, 5, 5] },
});

describe("analyzeE1", () => {
  it("ROBUST 칸에 축 반증과 p_early 강등을 적용하고, 무배터리 산소는 physicalZero로 표시한다", () => {
    const main = Array.from({ length: 200 }, (_, d) => row(d, 10, 5, 5));
    const ok = Array.from({ length: 100 }, (_, d) => row(d, 10, 5, 5));
    const bad = Array.from({ length: 100 }, (_, d) => row(d, 10, d < 50 ? 0 : 5, 5));
    const cells = analyzeE1(main, [
      { variant: { axis: "scaleMult", end: "lo", value: 0.5 }, rows: bad },
      { variant: { axis: "pEarly", end: "hi", value: 0.8 }, rows: ok },
    ], ["APT_PARTS"]);
    const v = cells.find((c) => c.cls === "VENT_3H" && c.policy === "KR_BASELINE")!;
    expect(v.label).toBe("ROBUST");
    expect(v.flips).toEqual([{ axis: "scaleMult", end: "lo", value: 0.5, p: 0.5, n: 100 }]);
    expect(cells.find((c) => c.cls === "O2_STAT")!.physicalZero).toBe(true);

    const demoted = analyzeE1(main, [{ variant: { axis: "pEarly", end: "hi", value: 0.8 }, rows: bad }], ["APT_PARTS"]);
    const d = demoted.find((c) => c.cls === "VENT_3H" && c.policy === "KR_BASELINE")!;
    expect(d.label).toBe("CONDITIONAL");
    expect(d.demotedByPEarly).toBe(true);
  });

  it("경계 정전시간: 조건부 p가 0.5를 지나는 분위 경계", () => {
    const s = Array.from({ length: 100 }, (_, i) => ({ r: i, g: i >= 60 }));
    expect(conditionalBoundaryH(s)).toBe(59);
    expect(conditionalBoundaryH(s.map((x) => ({ ...x, g: true })))).toBeNull();
  });

  it("안정성: 원래 ROBUST가 전부 뒤집히면 실패", () => {
    const g = analyzeE1(Array.from({ length: 200 }, (_, d) => row(d, 10, 5, 5)), [], ["APT_PARTS"]);
    const l = analyzeE1(Array.from({ length: 200 }, (_, d) => row(d, 10, 0, 0)), [], ["APT_PARTS"]);
    expect(stabilityCheck(g, g).pass).toBe(true);
    const st = stabilityCheck(g, l);
    expect(st.pass).toBe(false);
    expect(st.robustTotal).toBe(1);
  });
});

const e2 = (k: number, rule: [number, number], vs: [number, number]): E2Row => ({
  cell: "c", k, seed: 4000 + k, cause: "APT_PARTS", highRisk: 10,
  pol: { RULE: { M1: rule[0], M2S: rule[1] * 3600 }, KR_BASELINE: { M1: vs[0], M2S: vs[1] * 3600 } },
});

describe("E2 칸 판정", () => {
  it("승 > 패이고 M2 차이 CI 상한 < 0이면 우세, 감소율은 1 − ΣRULE/Σ비교", () => {
    const rows = Array.from({ length: 50 }, (_, k) => e2(k, [k % 2 ? 3 : 4, 8], [4, 10]));
    const c = compareCell(rows, "KR_BASELINE", "t");
    expect(c.win).toBe(25); expect(c.tie).toBe(25); expect(c.loss).toBe(0);
    expect(c.meanDiffH).toBeCloseTo(-2);
    expect(c.relReduction).toBeCloseTo(0.2);
    expect(c.verdict).toBe("SUPERIOR");
  });
  it("차이가 없으면 패배율 ≤5%일 때 비열등", () => {
    const rows = Array.from({ length: 40 }, (_, k) => e2(k, [4, 10], [4, 10]));
    expect(compareCell(rows, "KR_BASELINE", "t").verdict).toBe("NON_INFERIOR");
  });
  it("같은 입력이면 부트스트랩 CI가 같다(결정성)", () => {
    const rows = Array.from({ length: 30 }, (_, k) => e2(k, [4, 8 + (k % 5)], [4, 10]));
    expect(compareCell(rows, "KR_BASELINE", "t").ci).toEqual(compareCell(rows, "KR_BASELINE", "t").ci);
  });
});
