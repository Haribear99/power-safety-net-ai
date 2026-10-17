// /ops 세션 시험 (spec.md 1.4·1.5절, 9절 E2E 항목 중 순수 로직으로 확인 가능한 것)
import { describe, expect, it } from "vitest";
import suwon from "@/data/presets/suwon.json";
import { project119 } from "../alloc/project119";
import { qT } from "../engine/quantize";
import type { AuditEntry } from "../domain/types";
import {
  applyVerify, commitDecision, decisionFromRow, lEndH, modifyOptions, newSession, purge119, recompute, reReport, setNotice, start, visible119Ids,
  type Decision, type Session, type UiPreset,
} from "./session";

const preset = suwon as unknown as UiPreset;

function approve(s: Session, id: string): Session {
  const row = s.result!.rows.find((r) => r.rec.householdId === id)!;
  const d: Decision = { ...decisionFromRow(row), status: "APPROVED", decidedAtS: s.nowS };
  const a: AuditEntry = { at: "t", actor: "demo-operator", householdId: id, action: "APPROVE", from: { lane: row.rec.lane }, to: { lane: row.rec.lane, resourceId: row.rec.resourceId } };
  return commitDecision(s, d, a);
}
function rows119(s: Session) {
  return project119(Object.values(s.decisions).map((d) => ({ householdId: d.householdId, lane: d.lane, status: d.status, lEndH: lEndH(s.households.find((h) => h.id === d.householdId)!) })), s.households, preset.meta.baseIso);
}

describe("ops 세션", () => {
  const s0 = start(newSession(preset));

  it("정전 발생 전에는 결과 없음, 발생 뒤 모든 가구가 PROPOSED 한 행씩", () => {
    expect(newSession(preset).result).toBeNull();
    expect(s0.result!.rows).toHaveLength(preset.planner.households.length);
    expect(new Set(s0.result!.rows.map((r) => r.status))).toEqual(new Set(["PROPOSED"]));
    expect(Object.keys(s0.decisions)).toHaveLength(0);
  });

  it("119 파기는 그 시점 표시분만 지우고 감사 행을 남기며, 파기 뒤 새 119 결정은 다시 보인다", () => {
    const rows = s0.result!.rows;
    const first = rows.find((r) => r.rec.lane === "FALLBACK_119")!;
    const s1 = purge119(approve(s0, first.rec.householdId));
    expect(visible119Ids(s1)).toEqual([]);
    expect(s1.audit.filter((a) => a.action === "PURGE_119").map((a) => a.householdId)).toEqual([first.rec.householdId]);
    const other = rows.find((r) => r.rec.householdId !== first.rec.householdId)!;
    const d: Decision = { ...decisionFromRow(other), lane: "FALLBACK_119", status: "MODIFIED", decidedAtS: s1.nowS };
    const a: AuditEntry = { at: "t", actor: "demo-operator", householdId: other.rec.householdId, action: "MODIFY", from: { lane: other.rec.lane }, to: { lane: "FALLBACK_119" }, reasonCode: "OTHER", reasonText: "현장 요청으로 119" };
    const s2 = commitDecision(s1, d, a);
    expect(visible119Ids(s2)).toEqual([other.rec.householdId]);
    expect(purge119(s1)).toBe(s1);
  });

  it("승인 전 119 화면은 비고, 119 레인 승인 뒤 정확히 3필드 1행", () => {
    expect(rows119(s0)).toEqual([]);
    const id = s0.result!.rows.find((r) => r.rec.lane === "FALLBACK_119")!.rec.householdId;
    const s1 = approve(s0, id);
    const v = rows119(s1);
    expect(v).toHaveLength(1);
    expect(Object.keys(v[0]).sort()).toEqual(["device", "expectedSafeUntil", "location"]);
    expect(s1.audit.at(-1)?.action).toBe("APPROVE");
  });

  it("PROPOSE_ASSIGN·GAP_REDUCE 승인 행은 119 화면에 없다", () => {
    const row = s0.result!.rows.find((r) => r.rec.lane === "PROPOSE_ASSIGN" || r.rec.lane === "GAP_REDUCE")!;
    const s1 = approve(s0, row.rec.householdId);
    expect(rows119(s1)).toEqual([]);
    // 승인 자원은 다른 가구 추천에서 빠진다
    expect(s1.result!.rows.some((r) => r.rec.resourceId === row.rec.resourceId)).toBe(false);
  });

  it("수동검토 완료 전에는 수정 목록에 PROPOSE_ASSIGN이 없다", () => {
    const mr = s0.result!.rows.find((r) => r.rec.lane === "MANUAL_REVIEW")!;
    const opts = modifyOptions(s0, mr.rec.householdId);
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.some((o) => o.lane === "PROPOSE_ASSIGN")).toBe(false);
  });

  it("수정은 사유 코드와 자유문 5자 이상이 없으면 저장 불가", () => {
    const row = s0.result!.rows[0];
    const d: Decision = { ...decisionFromRow(row), lane: "FALLBACK_119", status: "MODIFIED", decidedAtS: s0.nowS };
    const bad: AuditEntry = { at: "t", actor: "demo-operator", householdId: row.rec.householdId, action: "MODIFY", from: { lane: row.rec.lane }, to: { lane: "FALLBACK_119" }, reasonCode: "OTHER", reasonText: "짧음" };
    expect(() => commitDecision(s0, d, bad)).toThrow();
    const ok = commitDecision(s0, d, { ...bad, reasonText: "현장 연락 결과 이송 희망" });
    expect(rows119(ok)).toHaveLength(1);
  });

  it("수동검토 완료(DB 기종 선택) 뒤 자동 계산 레인으로 나온다", () => {
    const mr = s0.result!.rows.find((r) => r.rec.lane === "MANUAL_REVIEW")!;
    const out = applyVerify(s0, { action: "MANUAL_REVIEW_DONE", householdId: mr.rec.householdId, specId: "TRILOGY100", reasonText: "라벨 사진 대조" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.session.result!.rows.find((r) => r.rec.householdId === mr.rec.householdId)!.rec.lane).not.toBe("MANUAL_REVIEW");
    expect(out.session.audit.at(-1)?.action).toBe("MANUAL_REVIEW_DONE");
  });

  it("사유 없는 확인 조작은 저장 불가", () => {
    const id = s0.households[0].id;
    expect(applyVerify(s0, { action: "VERIFY_AGE", householdId: id, batteryAgeY: 1, reasonText: " " }).ok).toBe(false);
  });

  it("승인 뒤 재신고로 하한이 줄면 재검토 배지 + RECHECK_FLAG + 대안 PROPOSED", () => {
    const row = s0.result!.rows.find((r) => r.rec.lane === "FALLBACK_119" && !s0.households.find((h) => h.id === r.rec.householdId)!.cylinder)!;
    const id = row.rec.householdId;
    const s1 = approve(s0, id);
    const s2 = reReport(s1, id, 0);
    expect(lEndH(s2.households.find((h) => h.id === id)!)!).toBeLessThanOrEqual(lEndH(s1.households.find((h) => h.id === id)!)!);
    expect(s2.flagged[id]).toBeTruthy();
    expect(s2.audit.filter((a) => a.action === "RECHECK_FLAG" && a.householdId === id)).toHaveLength(1);
    expect(s2.alternatives[id]?.status).toBe("PROPOSED");
    expect(s2.decisions[id].status).toBe("APPROVED"); // 자동으로 바꾸지 않는다
    // 같은 위반으로 다시 재계산해도 감사 행은 한 번만
    expect(recompute(s2).audit.filter((a) => a.action === "RECHECK_FLAG")).toHaveLength(1);
  });

  it("복구 예정 통보가 있어야만 HOLD가 생기고, 재확인 시한이 지나면 HOLD_EXPIRED", () => {
    expect(s0.result!.rows.some((r) => r.rec.lane === "HOLD")).toBe(false);
    const s1 = setNotice(s0, { confirmedEndH: preset.planner.now + 0.25, sigmaE: 0.1 });
    const hold = s1.result!.rows.find((r) => r.rec.lane === "HOLD");
    expect(hold).toBeTruthy();
    const by = qT(hold!.rec.holdRecheckBy!);
    const s2 = recompute(s1, by);
    expect(s2.audit.some((a) => a.action === "HOLD_EXPIRED" && a.householdId === hold!.rec.householdId && a.actor === "system")).toBe(true);
    expect(s2.result!.rows.find((r) => r.rec.householdId === hold!.rec.householdId)!.rec.lane).not.toBe("HOLD");
  });
});
