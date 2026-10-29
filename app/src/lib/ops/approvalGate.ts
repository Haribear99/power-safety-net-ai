// 결정 저장 관문(런타임 승인 토큰). 결정은 담당자가 그 가구 승인 서랍에서 실제로 누른 조작 1번마다 1건만 나온다(I6).
// 정적 검사(ESLint·AST 시험·E2E 행동 시험)가 못 보는 실수·단순한 우회 — 효과(useEffect)·타이머·키보드 단축키·URL 파라미터·
// 한 번 클릭으로 여러 가구 반복·스크립트가 만든 이벤트·저장해 둔 이벤트·이벤트를 감싼 객체(Proxy)·표 재사용·세션 경계·비활성 버튼 —
// 을 실행 중에 거부하거나(발급·내용) 아무것도 바꾸지 않는다(이미 적용한 표).
// (레드팀 10/24 R2 '런타임 토큰' 미결 사항, 10/30 구현. Codex 1·2라운드, Claude 3라운드 리뷰 반영)
// 한계: 같은 페이지 안에서 도는 코드는 이 모듈 자체(전역 Event·addEventListener)를 먼저 바꿔치기할 수 있다. 관문은 그런 의도적 변조까지
// 막지 못하며, 그 몫은 정적 검사·guard(ApproveDrawer·OpsProvider·lib 변경은 의뢰인 확인)·코드 리뷰가 맡는다.
// 같은 서랍 안 다른 버튼에 표지(data-gate)를 붙이는 변경도 막지 못한다(조작 1번 = 결정 1건만 보장).
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

// ---- 지금 전달 중인 실제 클릭(Claude 3라운드 치명: Proxy로 감싼 이벤트는 instanceof·isTrusted·eventPhase를 모두 속였다) ----
// 문서 맨 바깥(window) 붙잡기 단계에서 진짜 이벤트 객체를 기록하고, 맨 바깥 거품 단계와 다음 작업에서 지운다.
// 발급은 받은 객체가 이 기록과 '같은 객체'일 때만 한다. 속성은 그 진짜 객체에서 읽으므로 감싼 객체로 속일 수 없다.
let live: Event | null = null;
// 키를 누르고 있는 동안(자동 반복) 생긴 키보드 클릭은 받지 않는다(3라운드 중대: 행 열기 Enter를 누르고 있으면 열기와 승인이 함께 일어남)
let keyRepeating = false;
if (typeof window !== "undefined") {
  window.addEventListener("click", (e) => { live = e; setTimeout(() => { if (live === e) live = null; }, 0); }, true);
  window.addEventListener("click", (e) => { if (live === e) live = null; }, false);
  window.addEventListener("keydown", (e) => { if (e.repeat) keyRepeating = true; }, true);
  window.addEventListener("keyup", () => { keyRepeating = false; }, true);
  window.addEventListener("blur", () => { keyRepeating = false; });
}

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
  // 진짜로 지금 전달 중인 클릭 객체인가(감싼 객체·저장해 둔 이벤트·스크립트가 만든 이벤트를 한 번에 거른다)
  if (ev == null || ev !== live) deny("지금 처리 중인 실제 클릭이 아닙니다");
  const real = live;
  if (!real.isTrusted) deny("담당자의 실제 조작이 아닙니다(스크립트가 만든 이벤트)");
  if (real.type !== "click") deny("버튼 클릭이 아닙니다");
  if (keyRepeating && (real as MouseEvent).detail === 0) deny("키를 누르고 있는 동안 생긴 클릭은 받지 않습니다");
  if (usedEvents.has(real)) deny("조작 한 번으로는 결정 한 건만 저장합니다");
  const target = real.target instanceof Element ? real.target : null;
  const gateEl = target?.closest("[data-gate]");
  const gate = gateEl?.getAttribute("data-gate") ?? "";
  if (!gateEl || !isGate(gate)) deny("승인·대안 승인·수정 저장 조작이 아닙니다");
  if (!gateEl.isConnected || gateEl.matches(":disabled")) deny("화면에 없는 버튼이거나 비활성 버튼입니다");
  const drawer = gateEl.closest("[data-household]");
  if (drawer?.getAttribute("data-household") !== householdId) deny("이 가구의 승인 서랍에서 한 조작이 아닙니다");
  usedEvents.add(real);
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
