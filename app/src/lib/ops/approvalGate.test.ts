// 결정 저장 관문(런타임 승인 토큰) 시험. 신뢰된 이벤트(실제 클릭)는 노드에서 만들 수 없어 E2E(ops.spec.ts)가 맡고,
// 여기서는 거부 쪽과 표·결정 묶음 규칙을 본다.
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

describe("결정 관문", () => {
  it("스크립트가 만든 이벤트·이벤트 아닌 값으로는 표를 발급하지 않는다", () => {
    expect(() => issueApproval(new Event("click"), id)).toThrow(/실제 조작이 아닙니다/);
    expect(() => issueApproval({ isTrusted: true, type: "click" } as unknown as Event, id)).toThrow(/이벤트가 아닙니다/);
  });
  it("표 없이·발급하지 않은 표로는 저장하지 않는다", () => {
    const [d, a] = approveOf(row);
    expect(() => commitDecision(s0, d, a, undefined as unknown as ApprovalTicket)).toThrow(/발급하지 않은 표/);
    expect(() => commitDecision(s0, d, a, Object.freeze({ householdId: id, gate: "gate-approve" as const }))).toThrow(/발급하지 않은 표/);
  });
  it("표 한 장 = 결정 한 건(같은 결정 객체로 다시 불리는 것만 허용: React 상태 갱신 재실행)", () => {
    const [d, a] = approveOf(row);
    const t = ticketForTest(id, "gate-approve");
    const s1 = commitDecision(s0, d, a, t);
    expect(s1.decisions[id]?.status).toBe("APPROVED");
    expect(() => consumeApproval(t, d, a)).not.toThrow();
    expect(() => consumeApproval(t, { ...d }, a)).toThrow(/여러 건/);
  });
  it("표와 다른 가구·다른 동작·다른 상태는 거부", () => {
    const [d, a] = approveOf(row);
    const [d2, a2] = approveOf(other);
    expect(() => commitDecision(s0, d2, a2, ticketForTest(id, "gate-approve"))).toThrow(/가구가 다릅니다/);
    expect(() => commitDecision(s0, d, a, ticketForTest(id, "gate-modify"))).toThrow(/감사 동작이 다릅니다/);
    expect(() => commitDecision(s0, { ...d, status: "MODIFIED" }, a, ticketForTest(id, "gate-approve"))).toThrow(/결정 상태가 다릅니다/);
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
