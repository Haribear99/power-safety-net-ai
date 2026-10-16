// 끝 카드 (spec.md 12.3절). evidence.json만 읽는다. 측정 전이면 「측정 전」으로 표시하고 숫자를 하드코딩하지 않는다.
import { BEFORE_MEASURE, dominance, patchRange } from "@/lib/evidence";

export function ClosingCard() {
  const d = dominance();
  const m = patchRange();
  return (
    <section data-testid="closing-card" aria-label="끝 카드" className="rounded-xl border border-line bg-paper p-5">
      {d ? (
        <p className="text-[17px] leading-7">
          모의정전 {d.n.toLocaleString("ko-KR")}회 · &apos;짧은 순&apos;·&apos;가까운 순&apos; 두 단순 규칙 모두보다 공백 고위험 가구가 적은 조건{" "}
          {d.cells}칸 중 {d.p1}칸, 같은 조건 {d.p0}칸, 어느 한쪽보다라도 많은 조건 {d.p2}칸(모의)
          {m && m.mLo > 0 ? <> · 가정 범위에서 공백 가구·시간 {m.mLo}~{m.mHi}% 감소(모의)</> : null}
        </p>
      ) : (
        <p className="text-[17px] leading-7" data-testid="closing-before">
          같은 정전을 여러 번 다시 돌린 결과: <strong>{BEFORE_MEASURE}</strong>
        </p>
      )}
      <p className="mt-3 text-[20px] font-bold leading-8">
        기록은 이미 공공기관에 있습니다. 남은 것은 그 기록을 시간과 잇는 일입니다.
      </p>
      <p className="mt-3 text-[12px] text-muted">AI 기반 운용 · 시연용 합성 데이터</p>
    </section>
  );
}
