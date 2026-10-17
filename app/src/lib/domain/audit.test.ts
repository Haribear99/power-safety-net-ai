import { describe, expect, it } from "vitest";
import { makeHH } from "../engine/test-fixtures";
import { auditEntryRuleSchema, verifyAgePayloadSchema, verifyCylPayloadSchema, verifyExtPayloadSchema, type VerifyContext } from "./audit";
import { View119 } from "./types";

const ctx: VerifyContext = { cylHoursLoPerUnitH: 10, extForSpecIds: new Map([["TRILOGY100_DETACH", ["TRILOGY100"]], ["ASTRAL_EXT", ["ASTRAL150"]]]) };
const hh = makeHH({
  ext: [{ extSpecId: "TRILOGY100_DETACH", declaredCount: 2, opVerified: null }],
  cylinder: { declared: true, opVerified: null },
});

describe("운영자 확인 저장 규칙 (1.4절, I2·I3)", () => {
  it("VERIFY_EXT: count ≤ declaredCount, 정확 일치, forSpecIds", () => {
    expect(verifyExtPayloadSchema(hh, 0, ctx).safeParse({ extSpecId: "TRILOGY100_DETACH", count: 2 }).success).toBe(true);
    expect(verifyExtPayloadSchema(hh, 0, ctx).safeParse({ extSpecId: "TRILOGY100_DETACH", count: 3 }).success).toBe(false);
    expect(verifyExtPayloadSchema(hh, 0, ctx).safeParse({ extSpecId: "ASTRAL_EXT", count: 1 }).success).toBe(false);
    expect(verifyExtPayloadSchema(hh, 1, ctx).safeParse({ extSpecId: "TRILOGY100_DETACH", count: 1 }).success).toBe(false);
    expect(verifyExtPayloadSchema(hh, 0, ctx).safeParse({ extSpecId: "TRILOGY100_DETACH", count: 1, extAgeY: 1 }).success).toBe(false);
    expect(verifyExtPayloadSchema(hh, 0, ctx).safeParse({ extSpecId: "TRILOGY100_DETACH", count: 1, extAgeY: 1, basis: "대여 기록" }).success).toBe(true);
  });
  it("VERIFY_CYL: 신고 가구만, hoursLo ≤ 10h × count", () => {
    expect(verifyCylPayloadSchema(hh, ctx).safeParse({ count: 2, hoursLo: 20 }).success).toBe(true);
    expect(verifyCylPayloadSchema(hh, ctx).safeParse({ count: 2, hoursLo: 20.01 }).success).toBe(false);
    expect(verifyCylPayloadSchema(makeHH(), ctx).safeParse({ count: 1, hoursLo: 5 }).success).toBe(false);
  });
  it("VERIFY_AGE: 근거 텍스트 필수", () => {
    expect(verifyAgePayloadSchema.safeParse({ batteryAgeY: 1 }).success).toBe(false);
    expect(verifyAgePayloadSchema.safeParse({ batteryAgeY: 1, basis: "구입 기록" }).success).toBe(true);
    expect(verifyAgePayloadSchema.safeParse({ batteryAgeY: Number.NaN, basis: "구입 기록" }).success).toBe(false);
    expect(verifyAgePayloadSchema.safeParse({ batteryAgeY: 99, basis: "구입 기록" }).success).toBe(false);
  });
  it("AuditEntry: 수정은 사유 필수, system은 HOLD_EXPIRED·RECHECK_FLAG만", () => {
    expect(auditEntryRuleSchema.safeParse({ actor: "demo-operator", action: "MODIFY", reasonCode: "X", reasonText: "짧음" }).success).toBe(false);
    expect(auditEntryRuleSchema.safeParse({ actor: "demo-operator", action: "MODIFY", reasonCode: "X", reasonText: "도착 지연 확인됨" }).success).toBe(true);
    expect(auditEntryRuleSchema.safeParse({ actor: "system", action: "APPROVE" }).success).toBe(false);
    expect(auditEntryRuleSchema.safeParse({ actor: "system", action: "HOLD_EXPIRED" }).success).toBe(true);
    expect(auditEntryRuleSchema.safeParse({ actor: "demo-operator", action: "VERIFY_EXT" }).success).toBe(false);
  });
});

describe("I7: View119는 strict 3키", () => {
  it("다른 키는 거부", () => {
    expect(View119.safeParse({ location: "가상동 12-3", device: "VENT_3H", expectedSafeUntil: "2026-10-17T14:20:00+09:00" }).success).toBe(true);
    expect(View119.safeParse({ location: "a", device: "b", expectedSafeUntil: "c", pseudonym: "H-1" }).success).toBe(false);
  });
});
