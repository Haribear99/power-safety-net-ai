// 법정 배너 (spec.md 1.1절, AI기본법 제31조①). 모든 페이지 상단 고정.
export const LEGAL_BANNER_TEXT = "본 서비스는 AI 기반으로 운용됩니다 · 시연용 합성 데이터 · 계산·배정 규칙은 AI가 아닙니다";

export function LegalBanner() {
  return (
    <div role="note" aria-label="법정 고지" data-testid="legal-banner"
      className="sticky top-0 z-50 border-b border-line bg-ink px-4 py-1 text-center text-[12px] leading-5 text-white">
      {LEGAL_BANNER_TEXT}
    </div>
  );
}
