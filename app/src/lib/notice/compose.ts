// 보호자 알림 조립: AI 본문이 1차 검사(글자 규칙)와 2차 검사(다른 모델의 역추출 ↔ 사실 대조)를 모두 통과하면 그대로, 아니면 고정 문안.
// 119·123 문장과 꼬리말(AI 생성 표시)은 늘 코드가 붙인다.
import { compareClaims, type ClaimsT } from "./check";
import type { NoticeFacts } from "./facts";
import { splitSentences, tailSentences, templateSentences, verify, type Violation } from "./rules";

export const FOOTER = {
  // 보호자가 읽는 꼬리말은 짧고 쉽게(검사 설명은 운영자 화면에만)
  // 정전 중: 배터리 시각은 사양 계산, 도움 수단·시각은 담당자 승인(통합 레드팀 3라운드)
  ai: "※ AI가 쓴 글입니다. 배터리 시각은 기기 사양으로 계산했고, 도움 수단과 시각은 담당자가 승인했습니다. 시연용 안내입니다.",
  fallback: "※ 배터리 시각은 기기 사양으로 계산했고, 도움 수단과 시각은 담당자가 승인했습니다. 시연용 안내입니다.",
  template: "※ 배터리 시각은 기기 사양으로 계산했고, 도움 수단과 시각은 담당자가 승인했습니다. 시연용 안내입니다.",
  // 평시 대비 안내는 담당자 결정이 아니라 기기 사양 계산이다(통합 레드팀 2라운드)
  prepAi: "※ AI가 쓴 글입니다. 시간은 기기 사양으로 계산한 값입니다. 시연용 안내입니다.",
  prep: "※ 시간은 기기 사양으로 계산한 값입니다. 시연용 안내입니다.",
  // 시간이 없는 평시 안내(수동검토 등)
  prepNoTime: "※ 시연용 안내입니다.",
  prepNoTimeAi: "※ AI가 쓴 글입니다. 시연용 안내입니다.",
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

const done = (f: NoticeFacts, body: string[], rest: Omit<Composed, "sentences">): Composed => ({
  ...rest,
  footer: f.kind !== "PREP" ? rest.footer
    : f.battery.state === "HOURS" || f.battery.state === "UNDER30" || f.cylinder ? (rest.source === "ai" ? FOOTER.prepAi : FOOTER.prep)
    : rest.source === "ai" ? FOOTER.prepNoTimeAi : FOOTER.prepNoTime,
  sentences: [...body, ...tailSentences(f)],
});

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
