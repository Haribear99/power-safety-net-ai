// 119 화면 투영(1.5절, I7)과 근거 문장 템플릿(4.1절 7단계) 시험.
import { describe, expect, it } from "vitest";
import { View119 } from "../domain/types";
import { makeHH } from "../engine/test-fixtures";
import { mockIso, project119 } from "./project119";
import { fmtH, placeholders, renderReason, TEMPLATES, type TemplateId } from "./reasons";

const base = "2026-10-17T22:00:00+09:00";

describe("project119 (I7)", () => {
  const hh = [makeHH({ id: "H-1", cell: { x: 3, y: 7 } }), makeHH({ id: "H-2" })];
  it("APPROVED ∧ FALLBACK_119 행만, 정확히 3키", () => {
    const out = project119([
      { householdId: "H-1", lane: "FALLBACK_119", status: "APPROVED", lEndH: 1.6 },
      { householdId: "H-2", lane: "PROPOSE_ASSIGN", status: "APPROVED", lEndH: 2 },
      { householdId: "H-2", lane: "FALLBACK_119", status: "PROPOSED", lEndH: 2 },
    ], hh, base);
    expect(out).toHaveLength(1);
    expect(Object.keys(out[0]).sort()).toEqual(["device", "expectedSafeUntil", "location"]);
    expect(out[0]).toEqual({ location: "격자 (3, 7) km", device: "인공호흡기(내장 약 3시간급)", expectedSafeUntil: "2026-10-17T23:36:00+09:00" });
    expect(View119.safeParse({ ...out[0], pseudonym: "H-1" }).success).toBe(false);
  });
  it("승인 전에는 빈 값", () => {
    expect(project119([{ householdId: "H-1", lane: "FALLBACK_119", status: "PROPOSED", lEndH: 1 }], hh, base)).toEqual([]);
  });
  it("ISO 달력 연산: 날짜·월·윤년 넘김", () => {
    expect(mockIso(base, 3 * 3600)).toBe("2026-10-18T01:00:00+09:00");
    expect(mockIso("2028-02-28T23:30:00+09:00", 3600)).toBe("2028-02-29T00:30:00+09:00");
    expect(mockIso("2026-12-31T23:59:59Z", 1)).toBe("2027-01-01T00:00:00Z");
    expect(mockIso(base, -23 * 3600)).toBe("2026-10-16T23:00:00+09:00");
    expect(() => mockIso("2026-10-17 22:00", 0)).toThrow();
  });
});

describe("근거 문장 템플릿", () => {
  it("fmtH: 정수 초 → 소수 둘째 자리(half-up), 음수·감시값", () => {
    expect(fmtH(3600)).toBe("1.00");
    expect(fmtH(5558)).toBe("1.54");
    expect(fmtH(18)).toBe("0.01");
    expect(fmtH(17)).toBe("0.00");
    expect(fmtH(-1800)).toBe("-0.50");
    expect(fmtH(-17)).toBe("0.00");
    expect(fmtH(-2147483647)).toBe("−∞");
    expect(fmtH(2147483647)).toBe("∞");
  });
  it("템플릿은 약 12개(15개), 매개변수 누락·초과는 예외", () => {
    const ids = Object.keys(TEMPLATES) as TemplateId[];
    expect(ids.length).toBeGreaterThanOrEqual(12);
    expect(ids.length).toBeLessThanOrEqual(16);
    expect(() => renderReason({ templateId: "R-EXT0", params: {} })).toThrow();
    expect(() => renderReason({ templateId: "R-EXT0", params: { n: 1, x: 2 } })).toThrow();
    for (const id of ids) {
      const params = Object.fromEntries(placeholders(id).map((k) => [k, `<${k}>`]));
      const t = renderReason({ templateId: id, params });
      expect(t).not.toMatch(/\{\w+\}/);
    }
  });
  it("금지 표현 없음(9절), HOLD 표기는 「대기(재확인)」", () => {
    const banned = ["생명을 구", "생명을 지킵", "안전을 보장", "안전 보장", "사망을 막", "사망 예방", "인명 구조", "구조합니다", "끊겼", "살렸",
      "골든타임", "막았", "예측합니다", "정확히 예측", "검증됨", "검증된 안전", "모니터링", "KPI 달성", "실측"];
    for (const t of Object.values(TEMPLATES)) for (const b of banned) expect(t).not.toContain(b);
    expect(TEMPLATES["R-HOLD"]).toContain("대기(재확인)");
  });
});
