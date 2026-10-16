import { describe, expect, it } from "vitest";
import { computeLowerBound, computeLowerBoundDetail, DEFAULT_DB, editDistance, neighborSpecs, normalizeKey, reportLEndS } from "./lowerBound";
import { qT } from "./quantize";
import { makeHH } from "./test-fixtures";

const verifiedExt = (extSpecId: string, declaredCount: number, count: number,
  chargeConfirmed: "device_screen" | null = null, extAgeY: number | null = null) => ({
  extSpecId, declaredCount, opVerified: { count, chargeConfirmed, extAgeY, auditId: "A-1" },
});

describe("하한 L — 명세 예시 (3.2절)", () => {
  it("Trilogy 100, 연식·충전 모름: 3 × 0.7 × 0.5 = 1.05h, 도착 상한 0.84h", () => {
    const d = computeLowerBoundDetail(makeHH());
    expect(d.Ls).toBe(3780);
    expect(d.lb.hours).toBeCloseTo(1.05, 10);
    expect(d.lb.status).toBe("AUTO");
    expect(d.lb.flags).toEqual(expect.arrayContaining(["AGE_UNKNOWN", "CHARGE_UNKNOWN"]));
    expect(Math.floor((d.Ls! * 4) / 5)).toBe(qT(0.84));
    expect(d.capS).toBe(9720); // 3h × 0.9
  });

  it("같은 기기, 기기 화면 충전 90%: 3 × 0.7 × 0.9 × 0.9 = 1.701h (정수 초 floor)", () => {
    const d = computeLowerBoundDetail(makeHH({ device: { charge: { value: 90, source: "device_screen" } } }));
    expect(d.Ls).toBe(6123); // floor(6123.6)
    expect(d.lb.hours!).toBeCloseTo(1.701, 3);
    expect(d.lb.flags).toContain("USER_INPUT_DISCOUNTED");
  });

  it("INOGEN G5, 이용자 '설정 1': min(6.5, 3.75) = 3.75h를 쓴다", () => {
    const d = computeLowerBoundDetail(makeHH({ device: { specId: "INOGEN_G5", setting: 1, settingSource: "user" } }));
    expect(d.lb.flags).toContain("SETTING_USER_MIN");
    expect(d.Ls).toBe(Math.floor((qT(3.75) * 7) / 20)); // × 0.7 × 0.5
    expect(d.capS).toBe(Math.floor((qT(6.5) * 9) / 10));
  });

  it("INOGEN G5, 운영자 확인 설정 3: 선형 보간 5.125h, 표 밖(6)은 min", () => {
    const op3 = computeLowerBoundDetail(makeHH({ device: { specId: "INOGEN_G5", setting: 3, settingSource: "operator", batteryAgeY: 0.5, charge: { value: 100, source: "device_screen" } } }));
    expect(op3.Ls).toBe(Math.floor((18450 * 9 * 900) / 10000)); // T=5.125h
    expect(op3.lb.flags).not.toContain("SETTING_USER_MIN");
    const op6 = computeLowerBoundDetail(makeHH({ device: { specId: "INOGEN_G5", setting: 6, settingSource: "operator", batteryAgeY: 0.5, charge: { value: 100, source: "device_screen" } } }));
    expect(op6.Ls).toBe(Math.floor((13500 * 9 * 900) / 10000));
  });

  it("노후 구간: <1 → 9/10, <2 → 8/10, ≥2 → 7/10", () => {
    const L = (age: number) => computeLowerBoundDetail(makeHH({ device: { batteryAgeY: age } })).Ls;
    expect(L(0.99)).toBe(Math.floor((10800 * 9) / 20));
    expect(L(1)).toBe(Math.floor((10800 * 8) / 20));
    expect(L(1.99)).toBe(Math.floor((10800 * 8) / 20));
    expect(L(2)).toBe(Math.floor((10800 * 7) / 20));
  });

  it("충전량은 정수 퍼센트, 100 초과는 100으로", () => {
    const a = computeLowerBoundDetail(makeHH({ device: { charge: { value: 150, source: "user" } } })).Ls;
    const b = computeLowerBoundDetail(makeHH({ device: { charge: { value: 100, source: "user" } } })).Ls;
    expect(a).toBe(b);
    expect(b).toBe(Math.floor((10800 * 7 * 900) / 10000));
  });

  it("기기 화면 남은 시간이 더 짧으면 그 값으로 제한(SCREEN_CAPPED)", () => {
    const d = computeLowerBoundDetail(makeHH({ device: { charge: { value: 100, source: "device_screen" }, screenRemainingH: 1 } }));
    expect(d.Ls).toBe(3600);
    expect(d.lb.flags).toContain("SCREEN_CAPPED");
    const e = computeLowerBoundDetail(makeHH({ device: { screenRemainingH: 5 } }));
    expect(e.lb.flags).not.toContain("SCREEN_CAPPED");
  });

  it("배터리 없는 산소발생기(PERFECTO2)는 L = 0, 자동", () => {
    const d = computeLowerBoundDetail(makeHH({ device: { specId: "PERFECTO2" } }));
    expect(d.Ls).toBe(0);
    expect(d.lb.status).toBe("AUTO");
  });
});

describe("외장·실린더 (3.2절, I3)", () => {
  it("운영자 확인 외장 + 충전 확인: count × runtime × 7/10 × 9/10", () => {
    const d = computeLowerBoundDetail(makeHH({ ext: [verifiedExt("TRILOGY100_DETACH", 1, 1, "device_screen")] }));
    expect(d.Ls).toBe(3780 + 6804);
    expect(d.capS).toBe(9720 + 8748);
    expect(d.lb.flags).not.toContain("EXT_CHARGE_UNKNOWN");
  });
  it("충전 미확인 외장은 c_ext = 1/2, 외장 연식 미확인은 본체 연식과 무관하게 7/10", () => {
    const young = computeLowerBoundDetail(makeHH({ device: { batteryAgeY: 0.1 }, ext: [verifiedExt("TRILOGY100_DETACH", 2, 2)] }));
    expect(young.Ls).toBe(Math.floor((10800 * 9) / 20) + Math.floor((2 * 10800 * 7) / 20));
    expect(young.lb.flags).toContain("EXT_CHARGE_UNKNOWN");
    const withAge = computeLowerBoundDetail(makeHH({ ext: [verifiedExt("TRILOGY100_DETACH", 1, 1, null, 0.5)] }));
    expect(withAge.Ls).toBe(3780 + Math.floor((10800 * 9) / 20));
  });
  it("신고만 된 외장, forSpecIds 불일치, count > declaredCount는 0시간", () => {
    for (const ext of [
      [{ extSpecId: "TRILOGY100_DETACH", declaredCount: 3, opVerified: null }],
      [verifiedExt("ASTRAL_EXT", 1, 1, "device_screen")],
      [verifiedExt("TRILOGY100_DETACH", 1, 2, "device_screen")],
      [verifiedExt("NOPE", 1, 1, "device_screen")],
    ]) {
      const d = computeLowerBoundDetail(makeHH({ ext }));
      expect(d.Ls).toBe(3780);
      expect(d.lb.flags).toContain("EXT_UNVERIFIED_ZERO");
    }
  });
  it("실린더는 운영자 확인 hoursLo만, hoursLo ≤ 10h × count", () => {
    const ok = computeLowerBoundDetail(makeHH({ device: { specId: "PERFECTO2" }, cylinder: { declared: true, opVerified: { count: 2, hoursLo: 20, auditId: "A" } } }));
    expect(ok.Ls).toBe(72000);
    expect(ok.capS).toBe(72000);
    const over = computeLowerBoundDetail(makeHH({ device: { specId: "PERFECTO2" }, cylinder: { declared: true, opVerified: { count: 2, hoursLo: 21, auditId: "A" } } }));
    expect(over.Ls).toBe(0);
    const declOnly = computeLowerBoundDetail(makeHH({ device: { specId: "PERFECTO2" }, cylinder: { declared: true, opVerified: null } }));
    expect(declOnly.Ls).toBe(0);
  });
});

describe("수동검토 (I4)", () => {
  it("DB 밖 기종(석션기)·미등록 specId·비연속 기기는 MANUAL_REVIEW, L = null", () => {
    for (const specId of [null, "SUCTION_X", "COUGH_E70"]) {
      const lb = computeLowerBound(makeHH({ device: { specId, charge: { value: 100, source: "device_screen" } }, ext: [verifiedExt("TRILOGY100_DETACH", 1, 1)] }));
      expect(lb.status).toBe("MANUAL_REVIEW");
      expect(lb.hours).toBeNull();
      expect(lb.endT).toBeNull();
      expect(lb.capH).toBeNull();
    }
  });
  it("수동검토 완료 operatorLowerH가 있으면 그 값(OPERATOR_LOWER)", () => {
    const d = computeLowerBoundDetail(makeHH({ tReport: 0.25, device: { specId: "COUGH_E70", operatorLowerH: { hours: 2, basis: "다음 사용까지", auditId: "A" } } }));
    expect(d.Ls).toBe(7200);
    expect(d.lb.flags).toContain("OPERATOR_LOWER");
    expect(d.endS).toBe(900 + 7200);
  });
});

describe("AI 판독 기종 미확인 (3.2절)", () => {
  it("실제 DB에서는 이웃이 자기 자신뿐이라 값은 같고 표지만 붙는다", () => {
    const a = computeLowerBoundDetail(makeHH({ device: { specBy: "ai_label_user_confirmed" } }));
    expect(a.Ls).toBe(3780);
    expect(a.lb.flags).toContain("MODEL_AI_UNCONFIRMED");
    expect(neighborSpecs(DEFAULT_DB.devices.get("TRILOGY100")!, DEFAULT_DB).map((d) => d.specId)).toEqual(["TRILOGY100"]);
  });
  it("정규화·편집거리", () => {
    expect(normalizeKey("Trilogy-100 ")).toBe("TRILOGY100");
    expect(editDistance("LTV1105", "LTV1150")).toBe(2);
    expect(editDistance("ASTRAL100", "ASTRAL150")).toBe(1);
    expect(editDistance("TRILOGY100", "TRILOGYEVO")).toBe(3);
  });
});

describe("L_end와 재신고 (3.9절)", () => {
  it("L_end = tReport + L, 재신고는 min(lEndPrev, 새 값)", () => {
    const first = computeLowerBoundDetail(makeHH({ tReport: 0.5, device: { charge: { value: 20, source: "user" } } }));
    expect(first.endS).toBe(1800 + first.Ls!);
    const again = computeLowerBoundDetail(makeHH({ tReport: 1, lEndPrev: first.lb.endT, device: { charge: { value: 100, source: "user" } } }));
    expect(again.endS).toBe(first.endS);
  });
  it("POWER_SUPPLIED 뒤 첫 신고는 min 없이 새로 계산", () => {
    expect(reportLEndS(5000, 4000, 3000, false)).toBe(5000);
    expect(reportLEndS(5000, 4000, 3000, true)).toBe(7000);
    expect(reportLEndS(null, 4000, 3000, false)).toBe(7000);
  });
});
