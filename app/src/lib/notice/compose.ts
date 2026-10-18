// 보호자 알림 조립: AI 본문이 1차 검사(글자 규칙)와 2차 검사(다른 모델의 역추출 ↔ 사실 대조)를 모두 통과하면 그대로, 아니면 고정 문안.
// 119·123 문장과 꼬리말(AI 생성 표시)은 늘 코드가 붙인다.
import { compareClaims, type ClaimsT } from "./check";
import type { NoticeFacts } from "./facts";
import { splitSentences, tailSentences, templateSentences, verify, type Violation } from "./rules";

/** 2차 검사 결과: 뽑은 주장, 또는 검사 실패(실패 시 닫힘) */
export type Check2 = { claims: ClaimsT } | { error: string };

export interface Composed {
  /** 보낼 글 전체(본문 + 119·123 문장) */
  sentences: string[];
  source: "ai" | "template";
  /** AI 문장을 버린 경우 그 이유와 단계 */
  violations: Violation[];
  rejectedAt: "gate1" | "gate2" | null;
  footer: string;
}

const BATTERY_BASIS: Record<NonNullable<NoticeFacts["batteryBasis"]> | "none", string> = {
  charge: "배터리 시각은 기기 사양과 알려 주신 충전량으로 낮춰 잡아 계산했고",
  chargeUnknown: "배터리 시각은 충전량을 몰라 기기 사양에서 낮춰 잡아 계산했고",
  screen: "배터리 시각은 기기 화면의 남은 시간으로 계산했고",
  operator: "배터리 시각은 담당자가 확인한 값으로 계산했고",
  none: "배터리 시각은 기기 사양으로 계산했고",
};
/** 꼬리말: 실제로 글에 있는 시각의 근거만 적는다(통합 레드팀 3·4·5라운드) */
function footerFor(f: NoticeFacts, ai: boolean): string {
  const head = ai ? "※ AI가 쓴 글입니다. " : "※ ";
  if (f.kind === "PREP") {
    const timed = f.battery.state === "HOURS" || f.battery.state === "UNDER30" || f.cylinder;
    return `${head}${timed ? "시간은 기기 사양과 확인된 값으로 계산했습니다. " : ""}시연용 안내입니다.`;
  }
  const parts: string[] = [];
  if (f.battery.state === "UNTIL") parts.push(BATTERY_BASIS[f.batteryBasis ?? "none"]);
  if (f.cylinder?.state === "UNTIL") parts.push("산소통 시각은 담당자가 확인한 값으로 계산했고");
  // '과 시각'은 글에 도움 시각이 있을 때만(통합 레드팀 5라운드)
  const p = f.plan;
  const timed = p != null && ((p.type === "CALL119" && p.doneBy != null) || ((p.type === "ASSIGN" || p.type === "GAP") && p.arriveBy != null));
  return `${head}${parts.length ? `${parts.join(", ")}, ` : ""}도움 수단${timed ? "과 시각" : ""}은 담당자가 승인했습니다. 시연용 안내입니다.`;
}
const done = (f: NoticeFacts, body: string[], rest: Omit<Composed, "sentences" | "footer">): Composed => ({
  ...rest,
  footer: footerFor(f, rest.source === "ai"),
  sentences: [...body, ...tailSentences(f)],
});

/** ai = AI 본문과 2차 검사 결과(없으면 고정 문안). 2차 검사 없이 AI 본문을 내보내는 경로는 없다 */
export function compose(f: NoticeFacts, ai: { sentences: readonly string[]; check: Check2 | null } | null): Composed {
  const tpl = splitSentences(templateSentences(f));
  if (!ai) return done(f, tpl, { source: "template", violations: [], rejectedAt: null });
  const r1 = verify(f, ai.sentences);
  if (!r1.ok) return done(f, tpl, { source: "template", violations: r1.violations, rejectedAt: "gate1" });
  const v2: Violation[] = !ai.check ? [{ code: "CHECK_FAILED", detail: "2차 검사를 하지 않음" }]
    : "error" in ai.check ? [{ code: "CHECK_FAILED", detail: `2차 검사 실패: ${ai.check.error}` }]
    : compareClaims(f, ai.check.claims);
  if (v2.length) return done(f, tpl, { source: "template", violations: v2, rejectedAt: "gate2" });
  return done(f, r1.sentences, { source: "ai", violations: [], rejectedAt: null });
}

/** 음성 낭독용: AI 글이면 먼저 그 사실을 말하고, 전화번호는 한 자리씩(「백십구」가 아니라 「일일구」) */
export function speechText(sentences: readonly string[], source: "ai" | "template" = "template"): string {
  const body = sentences.join(" ").replace(/119/g, "일일구").replace(/123/g, "일이삼");
  return source === "ai" ? `AI가 쓴 안내입니다. ${body}` : body;
}
