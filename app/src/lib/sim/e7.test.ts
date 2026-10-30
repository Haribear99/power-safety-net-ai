// E7(평시 산소통 보급, S10) 단위 시험
import { describe, expect, it } from "vitest";
import { materialize } from "./materialize";
import { PATCHES, patchAxes } from "./patches";
import { E5_CAUSE } from "./e5";
import { applyCylinders, applyVentBatteries, E7_ARMS, e7Thetas, E7_VARIANTS, runE7 } from "./e7";
import { e3Def } from "./sweep";

const SEED_LO = 992_001; // 시험 전용(봉인 범위 밖)
const O2 = new Set(["O2_STAT", "O2_STAT_CYL", "O2_PORT"]);

describe("E7", () => {
  const th = e7Thetas(2, "E7-test")[0];
  const m = materialize(e3Def(0, E5_CAUSE, { ...th, unknownModelRate: E7_ARMS.PERF }, SEED_LO, "E7")).scenario;

  it("산소통(자기신고)은 산소 기기 등록 가구에만, 정확히 h시간을 더한다", () => {
    const ax = { ...patchAxes(m.seed), failProb: 0 };
    const t = applyCylinders(m, ax, 10, "S", m);
    for (const h of m.planner.households) {
      const d = t.truth.hh[h.id].LTrueS - m.truth.hh[h.id].LTrueS;
      expect(d).toBe(O2.has(m.labels[h.id]) ? 36000 : 0);
    }
  });

  it("보급률 제한(C)은 산소 기기 가구 중 일부만, 제한 없는 경우의 부분집합", () => {
    const ax = { ...patchAxes(m.seed), failProb: 0, covMult: 0.5 };
    const all = applyCylinders(m, ax, 10, "S", m);
    const lim = applyCylinders(m, ax, 10, "S", m, true);
    const got = (x: typeof m) => Object.keys(m.truth.hh).filter((id) => x.truth.hh[id].LTrueS !== m.truth.hh[id].LTrueS);
    expect(got(lim).every((id) => got(all).includes(id))).toBe(true);
    expect(got(lim).length).toBeLessThan(got(all).length);
  });

  it("P7V는 산소 기기 가구를 빼고 P7과 같은 양 이하를 인공호흡기 쪽에 준다", () => {
    const ax = { ...patchAxes(m.seed), failProb: 0 };
    const t = applyVentBatteries(m, ax, m);
    const changed = Object.keys(m.truth.hh).filter((id) => t.truth.hh[id].LTrueS !== m.truth.hh[id].LTrueS);
    expect(changed.every((id) => !O2.has(m.labels[id]))).toBe(true);
    expect(changed.length).toBeLessThanOrEqual(Math.round((PATCHES.get("P7")!.coverage ?? 0) * ax.covMult * m.planner.households.length));
  });

  it("행은 결정적이고 변형 수만큼 열을 갖는다", () => {
    const r1 = runE7(0, th, SEED_LO), r2 = runE7(0, th, SEED_LO);
    expect(r1).toEqual(r2);
    expect(r1.m2S).toHaveLength(E7_VARIANTS.length);
  });
});
