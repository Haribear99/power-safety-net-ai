// 결정 저장 관문(런타임 승인 토큰) 시험. 신뢰된 이벤트(실제 클릭)는 노드에서 만들 수 없어 E2E(ops.spec.ts)가 맡고,
// 여기서는 거부 쪽과 표·결정 묶음 규칙을 본다(Codex 리뷰 10/30 반례: 표 재사용·이전 결정으로 되돌리기·내용 바꾸기·상태 값).
import { describe, expect, it } from "vitest";
import suwon from "@/data/presets/suwon.json";
import type { AuditEntry } from "../domain/types";
import { consumeApproval, issueApproval, ticketForTest, type ApprovalTicket } from "./approvalGate";
import { commitDecision, decisionFromRow, newSession, start, type Decision, type UiPreset } from "./session";

const s0 = start(newSession(suwon as unknown as UiPreset));
const row = s0.result!.rows.find((r) => r.rec.lane === "FALLBACK_119")!;
const id = row.rec.householdId;
const other = s0.result!.rows.find((r) => r.rec.householdId !== id)!;
const approveOf = (r: typeof row): [Decision, AuditEntry] => [
  { ...decisionFromRow(r), status: "APPROVED", decidedAtS: s0.nowS },
  { at: "t", actor: "demo-operator", householdId: r.rec.householdId, action: "APPROVE", from: { lane: r.rec.lane }, to: { lane: r.rec.lane } },
];
const modifyOf = (r: typeof row, lane: Decision["lane"]): [Decision, AuditEntry] => [
  { ...decisionFromRow(r), lane, resourceId: undefined, status: "MODIFIED", decidedAtS: s0.nowS },
  { at: "t", actor: "demo-operator", householdId: r.rec.householdId, action: "MODIFY", from: { lane: r.rec.lane }, to: { lane }, reasonCode: "OTHER", reasonText: "현장 요청 반영" },
];
const approvals = (s: typeof s0) => s.audit.filter((a) => a.action === "APPROVE").length;

describe("결정 관문", () => {
  it("스크립트가 만든 이벤트·이벤트 아닌 값으로는 표를 발급하지 않는다", () => {
    expect(() => issueApproval(new Event("click"), id)).toThrow(/실제 조작이 아닙니다/);
    expect(() => issueApproval({ isTrusted: true, type: "click" } as unknown as Event, id)).toThrow(/이벤트가 아닙니다/);
  });
  it("표 없이·발급하지 않은 표로는 저장하지 않는다", () => {
    const [d, a] = approveOf(row);
    expect(() => commitDecision(s0, d, a, undefined as unknown as ApprovalTicket)).toThrow(/발급하지 않은 표/);
    expect(() => commitDecision(s0, d, a, Object.freeze({ id: "ticket-1", householdId: id, gate: "gate-approve" as const }))).toThrow(/발급하지 않은 표/);
  });
  it("React 재실행(적용 전 상태로 같은 내용 다시 부르기)은 같은 결과, 적용된 상태에 다시 쓰면 아무것도 바꾸지 않는다", () => {
    const [d, a] = approveOf(row);
    const t = ticketForTest(id, "gate-approve");
    const s1 = commitDecision(s0, d, a, t);
    const s1b = commitDecision(s0, d, a, t);
    expect(approvals(s1)).toBe(1);
    expect(approvals(s1b)).toBe(1);
    expect(s1b.decisions[id]).toEqual(s1.decisions[id]);
    expect(commitDecision(s1, d, a, t)).toBe(s1);
  });
  it("다른 결정 뒤에 지난 표를 다시 써도 이전 결정으로 되돌아가지 않는다", () => {
    const [d, a] = approveOf(row);
    const t = ticketForTest(id, "gate-approve");
    const s1 = commitDecision(s0, d, a, t);
    const [dm, am] = modifyOf(row, "FALLBACK_SHELTER");
    const s2 = commitDecision(s1, dm, am, ticketForTest(id, "gate-modify"));
    expect(s2.decisions[id].lane).toBe("FALLBACK_SHELTER");
    const s3 = commitDecision(s2, d, a, t);
    expect(s3).toBe(s2);
    expect(s3.decisions[id].lane).toBe("FALLBACK_SHELTER");
  });
  it("표 한 장으로 다른 내용(다른 객체·같은 객체를 고친 것 모두)은 저장하지 않는다", () => {
    const [d, a] = approveOf(row);
    const t = ticketForTest(id, "gate-approve");
    commitDecision(s0, d, a, t);
    expect(() => commitDecision(s0, { ...d, etaH: (d.etaH ?? 0) + 1 }, a, t)).toThrow(/여러 건/);
    d.decidedAtS += 1;
    expect(() => commitDecision(s0, d, a, t)).toThrow(/여러 건/);
  });
  it("표와 다른 가구·다른 동작·다른 상태는 거부(수정 표는 정확히 MODIFIED만)", () => {
    const [d, a] = approveOf(row);
    const [d2, a2] = approveOf(other);
    expect(() => commitDecision(s0, d2, a2, ticketForTest(id, "gate-approve"))).toThrow(/가구가 다릅니다/);
    expect(() => commitDecision(s0, d, a, ticketForTest(id, "gate-modify"))).toThrow(/감사 동작이 다릅니다/);
    expect(() => commitDecision(s0, { ...d, status: "MODIFIED" }, a, ticketForTest(id, "gate-approve"))).toThrow(/결정 상태가 다릅니다/);
    const [dm, am] = modifyOf(row, "FALLBACK_SHELTER");
    for (const g of ["gate-modify", "gate-approve-alt"] as const) {
      expect(() => consumeApproval(ticketForTest(id, g), { ...dm, status: "INVALID" }, am)).toThrow(/결정 상태가 다릅니다/);
    }
  });
  it("시험용 표는 시험 밖(빌드된 앱·개발 서버)에서 만들 수 없다", () => {
    const env = process.env.NODE_ENV;
    try {
      for (const v of ["production", "development"]) {
        (process.env as Record<string, string>).NODE_ENV = v;
        expect(() => ticketForTest(id, "gate-approve")).toThrow(/시험 밖/);
      }
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = env;
    }
  });
});
