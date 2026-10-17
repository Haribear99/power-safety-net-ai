// E6 시험: 평시 순위는 정전 시점 정보(신고 시각·충전량)에 의존하지 않는다, 보급량은 P7과 같다
import { describe, expect, it } from "vitest";
import { materialize } from "./materialize";
import { PATCHES, patchAxes } from "./patches";
import { E5_ARMS, E5_CAUSE } from "./e5";
import { applyPreOutageP7, e6Thetas, E6_VARIANTS, preOutageKeyS, runE6 } from "./e6";
import { e3Def } from "./sweep";

const SEED_LO = 991_001; // 시험 전용(봉인 범위 밖)

describe("E6", () => {
  it("평시 키는 신고 시각·충전량을 바꿔도 같다", () => {
    const th = e6Thetas(2, "E6-test")[0];
    const m = materialize(e3Def(0, E5_CAUSE, { ...th, unknownModelRate: 0 }, SEED_LO, "E6")).scenario;
    for (const h of m.planner.households) {
      const moved = { ...h, tReport: h.tReport + 5, device: { ...h.device, charge: { value: 3, source: "device_screen" as const } } };
      expect(preOutageKeyS(moved)).toBe(preOutageKeyS(h));
    }
  });

  it("보급량은 P7과 같은 round(coverage × covMult × N)", () => {
    const th = e6Thetas(2, "E6-test")[1];
    const m = materialize(e3Def(1, E5_CAUSE, { ...th, unknownModelRate: E5_ARMS.PERF }, SEED_LO, "E6")).scenario;
    const ax = { ...patchAxes(m.seed), failProb: 0 };
    const t = applyPreOutageP7(m, ax);
    const changed = Object.keys(m.truth.hh).filter((id) => t.truth.hh[id].LTrueS !== m.truth.hh[id].LTrueS);
    expect(changed.length).toBe(Math.round((PATCHES.get("P7")!.coverage ?? 0) * ax.covMult * m.planner.households.length));
  });

  it("행은 결정적이고 변형 수만큼 열을 갖는다", () => {
    const th = e6Thetas(2, "E6-test")[0];
    const r1 = runE6(0, th, SEED_LO), r2 = runE6(0, th, SEED_LO);
    expect(r1).toEqual(r2);
    expect(r1.m2S).toHaveLength(E6_VARIANTS.length);
  });
});
