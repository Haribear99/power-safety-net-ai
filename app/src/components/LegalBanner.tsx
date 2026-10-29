// 법정 배너 (spec.md 1.1절, AI기본법 제31조①). 모든 페이지 상단 고정.
import { BannerHeightSync } from "./BannerHeightSync";
export const LEGAL_BANNER_TEXT = "본 서비스는 AI 기반으로 운용됩니다 · AI: 라벨 판독·알림 문장 · 계산: 검증 가능한 규칙 · 결정: 담당자 · 시연용 합성 데이터";

/** 좁은 화면(< 640px)용 짧은 문안: 한 줄에 들어가게(1.3절 '배너 한 줄') */
export const LEGAL_BANNER_SHORT = "AI 기반 운용(판독·알림) · 계산은 규칙 · 합성 데이터";

export function LegalBanner() {
  return (
    <div role="note" aria-label="법정 고지" data-testid="legal-banner"
      className="sticky top-0 z-50 border-b border-line bg-ink px-4 py-1 text-center text-[12px] leading-5 text-white">
      <span className="hidden sm:inline">{LEGAL_BANNER_TEXT}</span>
      <span className="sm:hidden">{LEGAL_BANNER_SHORT}</span>
      <BannerHeightSync />
    </div>
  );
}
