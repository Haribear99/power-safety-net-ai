/**
 * 모델 배치 (spec.md 7.1·7.2절). 출처: 형제 저장소 `AI 라이프 솔루션 챌린지/app/src/lib/claude/models.ts`를 복사해 고쳤다.
 * 바꾼 점: Stage를 이 출품작 단계로, StageConfig에 timeoutMs·reserveUsd(호출 전 예약액)를 더했다.
 */
export const MODEL = {
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-5-5",
  opus: "claude-opus-5-5",
} as const;

export type ModelKey = keyof typeof MODEL;

/** 단가 USD / 1M tokens (2026-10 기준). CLAUDE_INFERENCE_GEO는 설정하지 않으므로 ×1.1 없음(7.1절) */
export const PRICE_PER_MTOK: Record<ModelKey, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  sonnet: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  haiku: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  opus: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};

export type Stage = "PW_C1_label" | "PW_C1_haiku_arm" | "PW_C2_dsl" | "PW_C3_patch" | "PW_C3_repair";

export interface StageConfig {
  model: ModelKey;
  /** adaptive = 사고 켬, between_tools = 사고 끔(Sonnet 5.5 전용), omit = 파라미터 생략 */
  thinking: "adaptive" | "between_tools" | "omit";
  effort: "low" | "medium" | "high";
  maxTokens: number;
  /** SDK timeout(ms). C1 20s(7.2절: 함수 30s 안에서 끝나야 기록이 빠지지 않음), C2·C3 300s */
  timeoutMs: number;
  /** 호출 1회 예약액(USD). 이미지 1장 Sonnet 최대 $0.03(7.2절) */
  reserveUsd: number;
  /** max_tokens 재시도 상한 */
  retryMaxTokens: number;
}

export const STAGE: Record<Stage, StageConfig> = {
  PW_C1_label: { model: "sonnet", thinking: "between_tools", effort: "low", maxTokens: 1500, timeoutMs: 20_000, reserveUsd: 0.03, retryMaxTokens: 3000 },
  PW_C1_haiku_arm: { model: "haiku", thinking: "omit", effort: "low", maxTokens: 1500, timeoutMs: 20_000, reserveUsd: 0.005, retryMaxTokens: 3000 },
  PW_C2_dsl: { model: "sonnet", thinking: "adaptive", effort: "medium", maxTokens: 16_000, timeoutMs: 300_000, reserveUsd: 0.3, retryMaxTokens: 24_000 },
  PW_C3_patch: { model: "sonnet", thinking: "adaptive", effort: "medium", maxTokens: 16_000, timeoutMs: 300_000, reserveUsd: 0.3, retryMaxTokens: 24_000 },
  PW_C3_repair: { model: "sonnet", thinking: "adaptive", effort: "medium", maxTokens: 16_000, timeoutMs: 300_000, reserveUsd: 0.3, retryMaxTokens: 24_000 },
};
