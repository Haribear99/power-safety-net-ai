import { describe, expect, it } from "vitest";
import type { WorldTruth } from "../domain/types";
import { INF_S, qT } from "../engine/quantize";
import { judgeGap, judgeScenario, resourceRunS } from "./outcome";

const H = 3600;

describe("공백 판정 (3.8절)", () => {
  it("도움 없음: T_serve = R_true, G = max(0, R − L)", () => {
    expect(judgeGap({ lTrueEndS: 2 * H, rTrueS: 5 * H })).toEqual({ tServeS: 5 * H, servedBy: "RESTORE", gapS: 3 * H });
    expect(judgeGap({ lTrueEndS: 6 * H, rTrueS: 5 * H }).gapS).toBe(0);
  });
  it("자원이 L_true 뒤 도착: G = (T − L) + max(0, R − (T + run)) — 3.8절 식 그대로", () => {
    const r = judgeGap({ lTrueEndS: 2 * H, rTrueS: 10 * H, resourceArrivalS: 3 * H, resourceRunS: 4 * H });
    expect(r).toEqual({ tServeS: 3 * H, servedBy: "RESOURCE", gapS: 1 * H + 3 * H });
  });
  it("자원이 L_true 전 도착: 그동안 배터리 보존(DEVLOG 결정). 고위험이 아니면 공백 0", () => {
    // L=10h, R=5h, 자원 1h 도착·1h 지속 → 3.8절 식을 문자 그대로 쓰면 3h 공백이 생기지만 실제로는 공백 없음
    expect(judgeGap({ lTrueEndS: 10 * H, rTrueS: 5 * H, resourceArrivalS: 1 * H, resourceRunS: 1 * H }).gapS).toBe(0);
    // L=3h, R=10h, 자원 1h 도착·2h 지속 → 꺼짐 = 1 + 2 + (3 − 1) = 5h → 공백 5h
    expect(judgeGap({ lTrueEndS: 3 * H, rTrueS: 10 * H, resourceArrivalS: 1 * H, resourceRunS: 2 * H }).gapS).toBe(5 * H);
    // 고장(run 0): 배터리 끝(3h)부터 복구까지
    expect(judgeGap({ lTrueEndS: 3 * H, rTrueS: 10 * H, resourceArrivalS: 1 * H, resourceRunS: 0 }).gapS).toBe(7 * H);
  });
  it("119·쉼터 공급 뒤에는 추가 공백 없음, 동점은 RESTORE 우선", () => {
    expect(judgeGap({ lTrueEndS: 1 * H, rTrueS: 10 * H, lane119DoneS: 2 * H })).toEqual({ tServeS: 2 * H, servedBy: "LANE_119", gapS: H });
    expect(judgeGap({ lTrueEndS: 1 * H, rTrueS: 10 * H, shelterArrivalS: null }).servedBy).toBe("RESTORE");
    expect(judgeGap({ lTrueEndS: 1 * H, rTrueS: 2 * H, resourceArrivalS: 2 * H, resourceRunS: 0 }).servedBy).toBe("RESTORE");
  });
  it("자원 지속 run = energyWh × 0.85 / drawW.hi (정수 초)", () => {
    expect(resourceRunS("ESS_S", 500, 60, false)).toBe(25500); // 7.0833h
    expect(resourceRunS("ESS_S", 500, 60, true)).toBe(0);
    expect(resourceRunS("O2_CYL_DELIVERY", 0, 0, false)).toBe(36000);
    expect(resourceRunS("ESS_L", 2000, 0, false)).toBe(INF_S);
    expect(resourceRunS("MOBILE_GEN", 60000, 280, false)).toBe(Math.floor((60000000 * 3600 * 17) / (20 * 280000)));
  });
});

describe("시나리오 채점과 지표 M1~M5", () => {
  const truth: WorldTruth = {
    seed: "t", restorationH: 10,
    hh: {
      A: { LTrueH: 2, extWorks: [], backupFails: false, shelterRefuses: false, mrDelayH: 0.5 }, // 고위험, 자원으로 일부 공백
      B: { LTrueH: 12, extWorks: [], backupFails: false, shelterRefuses: false, mrDelayH: 0.5 }, // 고위험 아님
      C: { LTrueH: 3, extWorks: [], backupFails: true, shelterRefuses: true, mrDelayH: 0.5 }, // HOLD였고 공백
      D: { LTrueH: 1, extWorks: [], backupFails: false, shelterRefuses: false, mrDelayH: 0.5 }, // 119
    },
    unregistered: [{ id: "U1", LTrueH: 4, cell: { x: 0, y: 0 } }, { id: "U2", LTrueH: 20, cell: { x: 0, y: 0 } }],
    arrivalTrueH: { "A|R1": 1.5, "C|R2": 0.5 },
    a119TrueH: { D: 0.5, U1: 0.5 }, shelterTrueH: { C: 1 },
  };
  const report = { A: 0.5, B: 0.5, C: 0.25, D: 0 };
  it("가구별 공백과 M1·M2(정수 초 합)·M3·M4·M5", () => {
    const { rows, metrics } = judgeScenario(truth, 0, [
      { householdId: "A", resource: { resourceId: "R1", dispatchH: 0.5, kind: "ESS_S", energyWh: 500, deviceDrawWHi: 60 }, displayedLH: 1.05 },
      { householdId: "B", displayedLH: 13 },
      { householdId: "C", everHold: true, resource: { resourceId: "R2", dispatchH: 3, kind: "ESS_S", energyWh: 500, deviceDrawWHi: 60 }, shelter: { dispatchH: 3 } },
      { householdId: "D", lane119: { slotStartH: 0.25 } },
      { householdId: "U1", lane119: { slotStartH: 1 } },
    ], report);
    const by = Object.fromEntries(rows.map((r) => [r.householdId, r]));
    // A: L_end 2.5h, 자원 도착 2.0h(L 전) → 꺼짐 = 2.0 + 7.0833 + 0.5 = 9.5833h → 공백 = 10 − 9.5833
    expect(by.A.servedBy).toBe("RESOURCE");
    expect(by.A.gapS).toBe(qT(10) - (qT(2) + 25500 + qT(0.5)));
    expect(by.B.highRisk).toBe(false);
    expect(by.B.gapS).toBe(0);
    // C: L_end 3.25h, 자원 3.5h 도착하나 고장(run 0), 쉼터 거부 → 공백 = (3.5 − 3.25) + (10 − 3.5)
    expect(by.C.gapS).toBe(qT(0.25) + qT(6.5));
    // D: L_end 1h, 119 도착 0.75h + 0.33h = 1.08h → 공백 0.08h
    expect(by.D.gapS).toBe(qT(0.25) + qT(0.5) + 1188 - qT(1));
    // U1: L_end 4h(정전 기준), 119 1.5h + 0.33 → 공백 0. U2: 도움 없음, L 20h ≥ R → 공백 0
    expect(by.U1.gapS).toBe(0);
    expect(by.U2.gapS).toBe(0);
    expect(metrics.M1).toBe(3); // A, C, D
    expect(metrics.highRiskCount).toBe(4); // A, C, D, U1
    expect(metrics.M2S).toBe(by.A.gapS + by.C.gapS + by.D.gapS);
    expect(metrics.M3).toEqual({ num: 1, den: 1, value: 1 });
    expect(metrics.M4).toBe(1); // B: 표시 13h > 진실 12h
    expect(metrics.M5).toEqual({ num: 0, den: 2, value: 0 });
  });
  it("HOLD 가구가 없으면 M3 분모 0 → 「해당 없음」(value null)", () => {
    const { metrics } = judgeScenario({ ...truth, unregistered: [] }, 0, [], report);
    expect(metrics.M3).toEqual({ num: 0, den: 0, value: null });
    expect(metrics.M5.value).toBeNull();
  });
  it("진실 키가 없으면 조용히 넘어가지 않고 오류", () => {
    expect(() => judgeScenario(truth, 0, [{ householdId: "A", lane119: { slotStartH: 0 } }], report)).toThrow();
    expect(() => judgeScenario(truth, 0, [], { A: 0 })).toThrow();
  });
});
