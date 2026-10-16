// AI 표지 (spec.md 1.1절, AI기본법 제31조②). AI 출력에만 붙인다.
export function AiTag({ kind, note }: { kind: "추출" | "생성"; note?: string }) {
  return (
    <span data-testid="ai-tag" className="inline-flex items-center gap-1 rounded border border-warn bg-warn-soft px-1.5 py-0.5 text-[12px] font-semibold text-warn">
      AI {kind}{note ? <span className="font-normal">· {note}</span> : null}
    </span>
  );
}
