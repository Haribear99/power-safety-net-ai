// 결정 감시(guardTransition) 시험: 결정은 commitDecision으로만 바뀐다(레드팀 10/30 R5A5: 상태 갱신 함수로 decisions 직접 덮어쓰기).
// 그리고 화면의 상태 갱신(OpsProvider)이 모두 감시를 거치는지 구문 트리로 고정한다.
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import suwon from "@/data/presets/suwon.json";
import type { AuditEntry } from "../domain/types";
import { ticketForTest } from "./approvalGate";
import { commitDecision, decisionFromRow, guardTransition, transitionViolation, newSession, purge119, recompute, reReport, start, type Decision, type Session, type UiPreset } from "./session";

const preset = suwon as unknown as UiPreset;
const s0 = start(newSession(preset));
const row = s0.result!.rows.find((r) => r.rec.lane === "FALLBACK_119")!;
const id = row.rec.householdId;
const approve = (s: Session, r = row): Session => {
  const d: Decision = { ...decisionFromRow(r), status: "APPROVED", decidedAtS: s.nowS };
  const a: AuditEntry = { at: "t", actor: "demo-operator", householdId: r.rec.householdId, action: "APPROVE", from: { lane: r.rec.lane }, to: { lane: r.rec.lane } };
  return commitDecision(s, d, a, ticketForTest(s.sessionId, r.rec.householdId, "gate-approve"));
};

describe("결정 감시", () => {
  it("정상 경로는 통과: 정전 시작, commitDecision, 재계산·재신고·119 파기", () => {
    const fresh = newSession(preset);
    expect(guardTransition(fresh, start(fresh))).toBeTruthy();
    const s1 = approve(s0);
    expect(guardTransition(s0, s1)).toBe(s1);
    expect(transitionViolation(s1, recompute(s1, s1.nowS + 1800))).toBeNull();
    expect(transitionViolation(s1, reReport(s1, id, 50))).toBeNull();
    expect(transitionViolation(s1, purge119(s1))).toBeNull();
  });
  it("상태 갱신 함수로 decisions를 직접 덮어쓰면 거부(가짜 표 id를 붙여도)", () => {
    const forged: Decision = { ...decisionFromRow(row), status: "MODIFIED", decidedAtS: s0.nowS };
    expect(transitionViolation(s0, { ...s0, decisions: { ...s0.decisions, [id]: forged } })).toMatch(/commitDecision으로만/);
    expect(transitionViolation(s0, { ...s0, decisions: { [id]: forged }, appliedTickets: ["fake"] })).toMatch(/commitDecision으로만/);
  });
  it("commitDecision 결과를 펼쳐 결정만 바꿔 끼우거나, 지난 결정 상태로 되돌리면 거부", () => {
    const s1 = approve(s0);
    // 승인할 배정이 있는 레인의 다른 가구(수동검토·대기·미배정은 승인 자체가 거부됨)
    const other = s0.result!.rows.find((r) => r.rec.householdId !== id && !["MANUAL_REVIEW", "HOLD", "UNSERVED_VISIBLE"].includes(r.rec.lane))!;
    const s2 = approve(s1, other);
    const forged: Decision = { ...decisionFromRow(other), status: "MODIFIED", decidedAtS: s0.nowS };
    expect(transitionViolation(s1, { ...s2, decisions: { ...s2.decisions, [id]: forged } })).toMatch(/commitDecision으로만/);
    expect(transitionViolation(s2, s1)).toMatch(/commitDecision으로만/);
  });
  it("세션 id를 바꿔 결정을 넣으면 거부(새 빈 세션만 허용)", () => {
    const s1 = approve(s0);
    expect(transitionViolation(s0, { ...s1, sessionId: "other" })).toMatch(/세션을 바꿔/);
    const fresh = newSession(preset);
    expect(guardTransition(s1, fresh)).toBe(fresh);
  });
  it("규칙을 어긴 변화는 버리고 이전 상태를 그대로 둔다(화면이 멈추지 않게 던지지 않음), 오류는 기록", () => {
    const forged: Decision = { ...decisionFromRow(row), status: "MODIFIED", decidedAtS: s0.nowS };
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => { errors.push(a.join(" ")); };
    try {
      expect(guardTransition(s0, { ...s0, decisions: { [id]: forged } })).toBe(s0);
    } finally {
      console.error = orig;
    }
    expect(String(errors[0])).toMatch(/결정 관문: 결정은 승인 서랍의 commitDecision으로만/);
  });
  it("결정 객체는 동결되어 제자리 수정이 안 된다", () => {
    const s1 = approve(s0);
    expect(Object.isFrozen(s1.decisions)).toBe(true);
    expect(Object.isFrozen(s1.decisions[id])).toBe(true);
    expect(() => { (s1.decisions as Record<string, Decision>)["x"] = s1.decisions[id]; }).toThrow();
    expect(Object.isFrozen(s0.decisions)).toBe(true);
  });
});

describe("OpsProvider의 상태 갱신은 모두 결정 감시를 거친다", () => {
  const FILE = path.resolve(__dirname, "..", "..", "components", "ops", "OpsProvider.tsx");
  const sf = ts.createSourceFile(FILE, readFileSync(FILE, "utf-8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  it("setSession 호출은 새 세션 만들기 아니면 guardTransition을 거치는 갱신 함수뿐", () => {
    const calls: string[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && n.expression.getText(sf) === "setSession") {
        const arg = n.arguments[0];
        const t = arg?.getText(sf) ?? "";
        calls.push(/^newSession\(/.test(t) ? "new" : /guardTransition\(/.test(t) ? "guarded" : `UNGUARDED: ${t.slice(0, 60)}`);
      }
      // setSession을 다른 이름으로 넘기거나 꺼내 쓰는 길도 막는다
      if (ts.isIdentifier(n) && n.text === "setSession" && !ts.isCallExpression(n.parent) && !ts.isArrayBindingPattern(n.parent.parent ?? n)) {
        if (!(ts.isBindingElement(n.parent))) calls.push(`REF: ${n.parent.getText(sf).slice(0, 60)}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(calls.filter((c) => c !== "new" && c !== "guarded")).toEqual([]);
    expect(calls.filter((c) => c === "guarded").length).toBeGreaterThanOrEqual(3);
  });
});
