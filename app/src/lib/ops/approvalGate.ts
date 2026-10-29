// 결정 저장 관문(런타임 승인 토큰). 결정은 담당자가 그 가구 승인 서랍에서 실제로 누른 조작 1번마다 1건만 나온다(I6).
// 정적 검사(ESLint·AST 시험·E2E 행동 시험)가 못 보는 길 — 효과(useEffect)·타이머·한 번 클릭으로 여러 가구 반복·스크립트가 만든 이벤트·
// 저장해 둔 이벤트·표 재사용 — 으로 commitDecision을 부르면 실행 중에 거부하거나(발급·내용) 아무것도 바꾸지 않는다(이미 적용한 표).
// (레드팀 10/24 R2 '런타임 토큰' 미결 사항, 10/30 구현, 같은 날 Codex 리뷰 1라운드 중대 2·경미 3, 2라운드 중대 1·경미 3 반영)
// 한계: 같은 서랍 안 다른 요소에 표지(data-gate)를 붙여 그 요소를 누를 때 결정이 나게 바꾸는 코드는 막지 못한다(조작 1번 = 결정 1건만 보장).
// 승인 값("APPROVED"·"APPROVE")은 여기서 만들지 않고 비교만 한다(ESLint 승인 값 규칙).
import type { AuditEntry } from "../domain/types";

/** 서랍 버튼의 표지(data-gate). gate-approve = 승인, gate-approve-alt = 재검토 대안 승인(MODIFY), gate-modify = 수정 저장(MODIFY) */
export type Gate = "gate-approve" | "gate-approve-alt" | "gate-modify";
// 모두 클릭으로만 판정한다. submit 이벤트는 스크립트의 requestSubmit()·button.click()으로도 isTrusted로 나오므로 쓰지 않는다
const GATES: readonly string[] = ["gate-approve", "gate-approve-alt", "gate-modify"];

/** sessionId: 발급할 때 화면의 세션. 세션을 새로 시작하면 지난 세션의 표는 쓸 수 없다 */
export interface ApprovalTicket { readonly id: string; readonly sessionId: string; readonly householdId: string; readonly gate: Gate }

// 발급한 표 → 처음 쓸 때의 결정·감사 내용(JSON). 같은 내용으로 다시 불리는 것(React 상태 갱신 재실행)만 통과
const issued = new WeakMap<ApprovalTicket, { key: string | null }>();
const usedEvents = new WeakSet<Event>();

function deny(why: string): never {
  throw new Error(`결정 관문: ${why}`);
}

function isGate(v: string): v is Gate {
  return GATES.includes(v);
}

/** 표·세션 id. 모듈을 다시 읽어도(개발 중 새로 고침 등) 겹치지 않게 무작위 */
export function newGateId(): string {
  // randomUUID는 보안 컨텍스트(https·localhost)에서만 있다. LAN IP의 http 개발 서버(휴대폰 확인)에서도 /ops가 멈추지 않게 getRandomValues로 대신한다
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

function newTicket(sessionId: string, householdId: string, gate: Gate): ApprovalTicket {
  const t: ApprovalTicket = Object.freeze({ id: newGateId(), sessionId, householdId, gate });
  issued.set(t, { key: null });
  return t;
}

/** 승인 서랍 버튼의 실제 클릭(키보드로 누른 경우 포함)을 처리하는 중에 표 1장을 발급한다. 이벤트 1개로는 1장만 */
export function issueApproval(ev: Event, sessionId: string, householdId: string): ApprovalTicket {
  if (typeof Event === "undefined" || !(ev instanceof Event)) deny("이벤트가 아닙니다");
  if (!ev.isTrusted) deny("담당자의 실제 조작이 아닙니다(스크립트가 만든 이벤트)");
  // isTrusted는 저장해 둔 이벤트에도 남는다: 전달 중(핸들러 실행 중)인 이벤트만 받는다
  if (ev.eventPhase === Event.NONE) deny("조작을 처리하는 중이 아닙니다(지난 이벤트)");
  if (ev.type !== "click") deny("버튼 클릭이 아닙니다");
  if (usedEvents.has(ev)) deny("조작 한 번으로는 결정 한 건만 저장합니다");
  const target = ev.target instanceof Element ? ev.target : null;
  const gateEl = target?.closest("[data-gate]");
  const gate = gateEl?.getAttribute("data-gate") ?? "";
  if (!isGate(gate)) deny("승인·대안 승인·수정 저장 조작이 아닙니다");
  const drawer = gateEl!.closest("[data-household]");
  if (drawer?.getAttribute("data-household") !== householdId) deny("이 가구의 승인 서랍에서 한 조작이 아닙니다");
  usedEvents.add(ev);
  return newTicket(sessionId, householdId, gate);
}

/** commitDecision이 부른다. 표·결정·감사 행이 같은 가구·같은 동작이고, 표가 다른 내용에 쓰인 적이 없어야 통과. 표 id를 돌려준다 */
export function consumeApproval(t: ApprovalTicket, sessionId: string, decision: { householdId: string; status: string }, audit: AuditEntry): string {
  const slot = t ? issued.get(t) : undefined;
  if (!slot) deny("발급하지 않은 표입니다");
  if (t.sessionId !== sessionId) deny("다른(지난) 세션에서 발급한 표입니다");
  if (decision.householdId !== t.householdId || audit.householdId !== t.householdId) deny("표와 결정의 가구가 다릅니다");
  const approveGate = t.gate === "gate-approve";
  const actionOk = approveGate ? audit.action === "APPROVE" : audit.action === "MODIFY";
  if (!actionOk) deny("표와 감사 동작이 다릅니다");
  const statusOk = approveGate ? decision.status === "APPROVED" : decision.status === "MODIFIED";
  if (!statusOk) deny("표와 결정 상태가 다릅니다");
  const key = JSON.stringify([decision, audit]);
  if (slot.key !== null && slot.key !== key) deny("표 한 장으로 결정 여러 건을 저장할 수 없습니다(내용이 다름)");
  slot.key = key;
  return t.id;
}

/** 단위 시험 전용(vitest는 NODE_ENV=test). 빌드된 앱(production)·개발 서버(development)에서는 던진다 */
export function ticketForTest(sessionId: string, householdId: string, gate: Gate): ApprovalTicket {
  if (process.env.NODE_ENV !== "test") deny("시험 밖에서는 표를 만들 수 없습니다");
  return newTicket(sessionId, householdId, gate);
}
