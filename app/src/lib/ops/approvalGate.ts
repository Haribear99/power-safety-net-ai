// 결정 저장 관문(런타임 승인 토큰). 결정은 담당자가 그 가구 승인 서랍에서 실제로 누른 조작 1번마다 1건만 나온다(I6).
// 정적 검사(ESLint·AST 시험·E2E 행동 시험)가 못 보는 길 — 효과(useEffect)·타이머·한 번 클릭으로 여러 가구 반복·스크립트가 만든 이벤트 —
// 으로 commitDecision을 부르면 실행 중에 거부한다(레드팀 10/24 R2 '런타임 토큰' 미결 사항, 10/30 구현).
// 한계: 같은 서랍 안 다른 요소에 표지(data-gate)를 붙여 그 요소를 누를 때 결정이 나게 바꾸는 코드는 막지 못한다(조작 1번 = 결정 1건만 보장).
// 승인 값("APPROVED"·"APPROVE")은 여기서 만들지 않고 비교만 한다(ESLint 승인 값 규칙).
import type { AuditEntry } from "../domain/types";

/** 서랍 버튼·양식의 표지(data-gate). gate-approve = 승인, gate-approve-alt = 재검토 대안 승인(MODIFY), gate-modify = 수정 저장(MODIFY) */
export type Gate = "gate-approve" | "gate-approve-alt" | "gate-modify";
// 모두 클릭으로만 판정한다. submit 이벤트는 스크립트의 requestSubmit()·button.click()으로도 isTrusted로 나오므로 쓰지 않는다
const GATE_EVENT: Record<Gate, string> = { "gate-approve": "click", "gate-approve-alt": "click", "gate-modify": "click" };

export interface ApprovalTicket { readonly householdId: string; readonly gate: Gate }

// 발급한 표 → 묶인 결정(처음 쓸 때 묶음). React가 상태 갱신 함수를 다시 부를 때(같은 결정 객체)는 통과, 다른 결정이면 거부
const issued = new WeakMap<ApprovalTicket, { decision: object | null }>();
const usedEvents = new WeakSet<Event>();

function deny(why: string): never {
  throw new Error(`결정 관문: ${why}`);
}

function isGate(v: string): v is Gate {
  return Object.prototype.hasOwnProperty.call(GATE_EVENT, v);
}

/** 승인 서랍 버튼의 실제 클릭(키보드로 누른 경우 포함) 이벤트로 표 1장을 발급한다. 이벤트 1개로는 1장만 */
export function issueApproval(ev: Event, householdId: string): ApprovalTicket {
  if (typeof Event === "undefined" || !(ev instanceof Event)) deny("이벤트가 아닙니다");
  if (!ev.isTrusted) deny("담당자의 실제 조작이 아닙니다(스크립트가 만든 이벤트)");
  if (usedEvents.has(ev)) deny("조작 한 번으로는 결정 한 건만 저장합니다");
  const target = ev.target instanceof Element ? ev.target : null;
  const gateEl = target?.closest("[data-gate]");
  const gate = gateEl?.getAttribute("data-gate") ?? "";
  if (!isGate(gate) || GATE_EVENT[gate] !== ev.type) deny("승인·대안 승인·수정 저장 조작이 아닙니다");
  const drawer = gateEl!.closest("[data-household]");
  if (drawer?.getAttribute("data-household") !== householdId) deny("이 가구의 승인 서랍에서 한 조작이 아닙니다");
  usedEvents.add(ev);
  const t: ApprovalTicket = Object.freeze({ householdId, gate });
  issued.set(t, { decision: null });
  return t;
}

/** commitDecision이 부른다. 표·결정·감사 행이 같은 가구·같은 동작이고, 표가 다른 결정에 쓰인 적이 없어야 통과 */
export function consumeApproval(t: ApprovalTicket, decision: { householdId: string; status: string }, audit: AuditEntry): void {
  const slot = t ? issued.get(t) : undefined;
  if (!slot) deny("발급하지 않은 표입니다");
  if (slot.decision !== null && slot.decision !== decision) deny("표 한 장으로 결정 여러 건을 저장할 수 없습니다");
  if (decision.householdId !== t.householdId || audit.householdId !== t.householdId) deny("표와 결정의 가구가 다릅니다");
  const approveGate = t.gate === "gate-approve";
  if ((audit.action === "APPROVE") !== approveGate || (!approveGate && audit.action !== "MODIFY")) deny("표와 감사 동작이 다릅니다");
  if ((decision.status === "APPROVED") !== approveGate) deny("표와 결정 상태가 다릅니다");
  slot.decision = decision;
}

/** 단위 시험 전용(vitest는 NODE_ENV=test). 빌드된 앱(production)·개발 서버(development)에서는 던진다 */
export function ticketForTest(householdId: string, gate: Gate): ApprovalTicket {
  if (process.env.NODE_ENV !== "test") deny("시험 밖에서는 표를 만들 수 없습니다");
  const t: ApprovalTicket = Object.freeze({ householdId, gate });
  issued.set(t, { decision: null });
  return t;
}
