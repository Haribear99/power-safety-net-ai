// 보호자 알림 조립: AI 본문이 1차 검사(글자 규칙)와 2차 검사(다른 모델의 역추출 ↔ 사실 대조)를 모두 통과하면 그대로, 아니면 고정 문안.
// 119·123 문장과 꼬리말(AI 생성 표시)은 늘 코드가 붙인다.
import { compareClaims, type ClaimsT } from "./check";
import type { NoticeFacts } from "./facts";
import { splitSentences, tailSentences, templateSentences, verify, type Violation } from "./rules";

export const FOOTER = {
  ai: "※ AI가 쓴 문장을 규칙 검사와 별도 AI 역추출 검사로 사실(시각·수단·할 일)과 대조해 통과시켰습니다 · 119·123 문장은 고정 · 결정은 담당자 · 시연용 모의 안내",
  fallback: "※ AI 문장이 검사를 통과하지 못해 고정 문안을 보냅니다 · 결정은 담당자 · 시연용 모의 안내",
  template: "※ 고정 문안 · 결정은 담당자 · 시연용 모의 안내",
} as const;

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

const done = (f: NoticeFacts, body: string[], rest: Omit<Composed, "sentences">): Composed => ({ ...rest, sentences: [...body, ...tailSentences(f)] });

/** ai = AI 본문과 2차 검사 결과(없으면 고정 문안). 2차 검사 없이 AI 본문을 내보내는 경로는 없다 */
export function compose(f: NoticeFacts, ai: { sentences: readonly string[]; check: Check2 | null } | null): Composed {
  const tpl = splitSentences(templateSentences(f));
  if (!ai) return done(f, tpl, { source: "template", violations: [], rejectedAt: null, footer: FOOTER.template });
  const r1 = verify(f, ai.sentences);
  if (!r1.ok) return done(f, tpl, { source: "template", violations: r1.violations, rejectedAt: "gate1", footer: FOOTER.fallback });
  const v2: Violation[] = !ai.check ? [{ code: "CHECK_FAILED", detail: "2차 검사를 하지 않음" }]
    : "error" in ai.check ? [{ code: "CHECK_FAILED", detail: `2차 검사 실패: ${ai.check.error}` }]
    : compareClaims(f, ai.check.claims);
  if (v2.length) return done(f, tpl, { source: "template", violations: v2, rejectedAt: "gate2", footer: FOOTER.fallback });
  return done(f, r1.sentences, { source: "ai", violations: [], rejectedAt: null, footer: FOOTER.ai });
}

/** 음성 낭독용: AI 글이면 먼저 그 사실을 말하고, 전화번호는 한 자리씩(「백십구」가 아니라 「일일구」) */
export function speechText(sentences: readonly string[], source: "ai" | "template" = "template"): string {
  const body = sentences.join(" ").replace(/119/g, "일일구").replace(/123/g, "일이삼");
  return source === "ai" ? `AI가 쓴 안내입니다. ${body}` : body;
}
