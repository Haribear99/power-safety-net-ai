// E5 시험: 갈래끼리 공통 난수(미확인 가구의 포함 관계), 측정 미확인률, 표적 배치의 양·순서
import { describe, expect, it } from "vitest";
import { computeLowerBoundDetail, DEFAULT_DB } from "../engine/lowerBound";
import { materialize } from "./materialize";
import { applyPatch, PATCHES, patchAxes } from "./patches";
import { applyTargetedP7, E5_ARMS, E5_CAUSE, e5Thetas, E5_VARIANTS, measuredUnknownRate, runE5 } from "./e5";
import { e3Def } from "./sweep";

const SEED_LO = 990_001; // 시험 전용(봉인 범위 밖)

describe("E5", () => {
  it("측정 미확인률 = 1 − 66/90", () => {
    expect(measuredUnknownRate()).toBeCloseTo(24 / 90, 6);
    expect(E5_ARMS).toEqual({ AI: measuredUnknownRate(), NOAI: 1, PERF: 0 });
  });

  it("갈래끼리 진실·가구는 같고 미확인 가구만 PERF ⊆ AI ⊆ NOAI", () => {
    const th = e5Thetas(3, "E5-test")[1];
    const unk = (rate: number) => {
      const m = materialize(e3Def(1, E5_CAUSE, { ...th, unknownModelRate: rate }, SEED_LO, "E5")).scenario;
      return { m, ids: new Set(m.planner.households.filter((h) => h.device.specId == null).map((h) => h.id)) };
    };
    const a = unk(E5_ARMS.AI), n = unk(E5_ARMS.NOAI), p = unk(E5_ARMS.PERF);
    expect(a.m.truth).toEqual(n.m.truth);
    expect(p.ids.size).toBe(0);
    for (const id of a.ids) expect(n.ids.has(id)).toBe(true);
    expect(n.ids.size).toBe(n.m.planner.households.length);
  });

  it("표적 배치는 P7과 같은 보급량을 하한 끝이 이른 가구부터 준다", () => {
    const th = e5Thetas(3, "E5-test")[2];
    const m = materialize(e3Def(2, E5_CAUSE, { ...th, unknownModelRate: 0 }, SEED_LO, "E5")).scenario;
    const ax = { ...patchAxes(m.seed), failProb: 0 };
    const t = applyTargetedP7(m, ax);
    const changed = Object.keys(m.truth.hh).filter((id) => t.truth.hh[id].LTrueS !== m.truth.hh[id].LTrueS);
    const k = Math.round((PATCHES.get("P7")!.coverage ?? 0) * ax.covMult * m.planner.households.length);
    expect(changed.length).toBe(k);
    const end = (id: string) => computeLowerBoundDetail(m.planner.households.find((h) => h.id === id)!, DEFAULT_DB).endS ?? -Infinity;
    const notChanged = m.planner.households.map((h) => h.id).filter((id) => !changed.includes(id));
    const maxIn = Math.max(...changed.map(end)), minOut = Math.min(...notChanged.map(end));
    expect(maxIn).toBeLessThanOrEqual(minOut);
    // 계획자 화면은 바꾸지 않는다
    expect(t.planner).toBe(m.planner);
    void applyPatch;
  });

  it("행은 변형 수만큼 열을 갖고 결정적이다", () => {
    const th = e5Thetas(2, "E5-test")[0];
    const r1 = runE5(0, th, SEED_LO), r2 = runE5(0, th, SEED_LO);
    expect(r1).toEqual(r2);
    expect(r1.m2S).toHaveLength(E5_VARIANTS.length);
    // 판독이 늘 맞는 갈래(PERF)의 공백은 판독이 없는 갈래(NOAI)보다 크지 않은 경우가 대부분이지만, 시나리오 하나로 단정하지 않는다
    expect(r1.m2S.every((x) => x >= 0)).toBe(true);
  });
});
