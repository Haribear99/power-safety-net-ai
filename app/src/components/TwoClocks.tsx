// 두 시계 (spec.md 1.3절). CSS 애니메이션만 쓴다. 막대에는 시간 숫자를 쓰지 않는다.
// 막대 길이는 params.json landingGapBarH(inferred)에서 읽는다.
import { pNum } from "@/lib/engine/params";

const TARGET_H = 24;

export function TwoClocks() {
  const gapH = pNum("landingGapBarH");
  const battH = TARGET_H - gapH;
  return (
    <div className="grid gap-3" data-testid="two-clocks">
      <div className="card p-4">
        <div className="text-[15px] text-muted">인공호흡기 내장배터리</div>
        <div className="mt-1 text-[34px] font-bold leading-10 text-batt">
          <span className="sr-only">3시간</span>
          <span aria-hidden className="clock-digits" />
        </div>
        <div aria-hidden className="mt-2 h-3 w-full overflow-hidden rounded bg-line">
          <div className="clock-fill h-3 bg-batt" style={{ width: `${(battH / TARGET_H) * 100}%` }} />
        </div>
        <div aria-hidden className="empty-reveal mt-1 text-[13px] font-semibold text-gap">배터리 끝</div>
      </div>
      <div className="card p-4">
        <div className="text-[15px] text-muted">최악의 단지 설비 고장 · 정부 임시전력 목표</div>
        <div className="mt-1 text-[34px] font-bold leading-10 text-restore" style={{ fontVariantNumeric: "tabular-nums" }}>
          24:00:00 <span className="text-[18px] font-semibold">이내</span>
        </div>
        <div aria-hidden className="relative mt-2 h-3 w-full rounded bg-restore-soft">
          <div className="gap-reveal absolute top-0 h-3 rounded-r bg-gap" data-testid="gap-bar"
            style={{ left: `${(battH / TARGET_H) * 100}%`, width: `${(gapH / TARGET_H) * 100}%` }} />
        </div>
        <div className="empty-reveal mt-1 text-[13px] text-gap">목표 상한까지 남는 차이 · 내장배터리만, 외장·이송 없을 때의 단순 비교</div>
      </div>
    </div>
  );
}
