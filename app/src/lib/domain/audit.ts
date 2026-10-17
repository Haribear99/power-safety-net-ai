// 운영자 확인 조작의 저장 규칙 (spec.md 1.4절, 2장, 9절 I2·I3). 넘으면 저장 불가(zod).
import { z } from "zod";
import type { HouseholdView } from "./types";

/** VERIFY_CYL hoursLo 상한의 단위값(CYL_LARGE 하한 10h). params lb.cyl.hoursLoPerUnitH와 같은 값을 호출자가 넘긴다 */
export interface VerifyContext {
  cylHoursLoPerUnitH: number;
  /** ext_db: extSpecId → forSpecIds */
  extForSpecIds: ReadonlyMap<string, readonly string[]>;
}

/** 「외장 확인」: extSpecId 정확 일치 ∧ forSpecIds ∋ specId ∧ count ≤ declaredCount */
export function verifyExtPayloadSchema(hh: HouseholdView, extIndex: number, ctx: VerifyContext) {
  const decl = hh.ext[extIndex];
  return z
    .object({
      extSpecId: z.string(),
      count: z.number().int().min(1),
      chargeConfirmed: z.literal("device_screen").optional(),
      extAgeY: z.number().nonnegative().optional(),
      basis: z.string().optional(),
    })
    .strict()
    .refine(() => decl !== undefined, { message: "신고된 외장이 없음" })
    .refine((p) => decl?.extSpecId === p.extSpecId, { message: "신고 모델과 extSpecId 정확 일치 필요" })
    .refine((p) => hh.device.specId != null && (ctx.extForSpecIds.get(p.extSpecId) ?? []).includes(hh.device.specId), {
      message: "ext_db forSpecIds에 기기 specId가 없음",
    })
    .refine((p) => decl !== undefined && p.count <= decl.declaredCount, { message: "count ≤ declaredCount" })
    .refine((p) => p.extAgeY === undefined || (p.basis ?? "").trim().length > 0, { message: "외장 연식은 근거 텍스트 필수" });
}

/** 「실린더 확인」: declared === true ∧ hoursLo ≤ 10h × count */
export function verifyCylPayloadSchema(hh: HouseholdView, ctx: VerifyContext) {
  return z
    .object({ count: z.number().int().min(1), hoursLo: z.number().finite().nonnegative() })
    .strict()
    .refine(() => hh.cylinder?.declared === true, { message: "실린더를 신고한 가구만" })
    .refine((p) => p.hoursLo <= ctx.cylHoursLoPerUnitH * p.count, { message: "hoursLo ≤ 10h × count" });
}

/** 「연식 확인」: 근거 텍스트 필수 */
export const verifyAgePayloadSchema = z
  .object({ batteryAgeY: z.number().finite().min(0).max(30), basis: z.string().trim().min(1) })
  .strict();

const REASON_REQUIRED = new Set(["MODIFY", "VERIFY_EXT", "VERIFY_CYL", "VERIFY_AGE", "VERIFY_MODEL", "MANUAL_REVIEW_DONE"]);

/** AuditEntry 공통 규칙: MODIFY·VERIFY_*·MANUAL_REVIEW_DONE은 사유 필수(MODIFY 자유문 5자 이상), system은 HOLD_EXPIRED·RECHECK_FLAG만 */
export const auditEntryRuleSchema = z
  .object({
    actor: z.enum(["demo-operator", "system"]),
    action: z.string(),
    reasonCode: z.string().optional(),
    reasonText: z.string().optional(),
  })
  .passthrough()
  .refine((e) => e.actor !== "system" || e.action === "HOLD_EXPIRED" || e.action === "RECHECK_FLAG", {
    message: "system은 HOLD_EXPIRED·RECHECK_FLAG만",
  })
  .refine((e) => !REASON_REQUIRED.has(e.action) || (e.reasonText ?? "").trim().length > 0, { message: "사유 필수" })
  .refine((e) => e.action !== "MODIFY" || ((e.reasonCode ?? "").length > 0 && (e.reasonText ?? "").trim().length >= 5), {
    message: "수정은 사유 코드와 자유문 5자 이상",
  });
