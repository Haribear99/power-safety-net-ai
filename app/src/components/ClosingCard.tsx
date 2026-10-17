// 끝 카드 (spec.md 12.3절, 라운드 5 '끝 카드'). evidence.json만 읽는다. 측정 전이면 「측정 전」으로 표시하고 숫자를 하드코딩하지 않는다.
// 관문 2를 통과하지 못했으면 비교 문장을 싣지 않는다(대체안의 C1·C2 실측은 아직 없으므로 「측정 전」).
import { BEFORE_MEASURE, labHeadline } from "@/lib/evidence";
import { CLASS_KO, CLASS_ORDER } from "@/lib/lab";
import type { GenClass } from "@/lib/sim/labels";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** ROBUST 쌍 → 「기기(정전 원인 k종)」 요약. 기기 순서는 CLASS_ORDER, 칸별 상세는 /lab 빈틈 지도 */
export function robustPhrase(pairs: { cls: string; cause: string }[]): string {
  const n = new Map<string, number>();
  for (const p of pairs) n.set(p.cls, (n.get(p.cls) ?? 0) + 1);
  return CLASS_ORDER.filter((c) => n.has(c)).map((c) => `${CLASS_KO[c as GenClass]}(정전 원인 ${n.get(c)}종)`).join(", ");
}

export function ClosingCard() {
  const h = labHeadline();
  const ok = h && h.gate2?.pass !== false;
  return (
    <section data-testid="closing-card" aria-label="끝 카드" className="rounded-xl border border-line bg-paper p-5">
      {h && ok ? (
        <div data-testid="closing-measured">
          <p className="text-[22px] font-extrabold leading-8">
            현행 절차보다 공백 가구·시간 <span className="text-batt">{pct(h.e2.pooledRel)} 감소</span>
          </p>
          <p className="mt-1 text-[15px]">
            {h.e2.nCells}개 조건 중 {h.e2.superiorVsKr}개에서 우세 · 모의정전 {h.e2.n.toLocaleString("ko-KR")}회 · 조건별 {pct(h.e2.relRange.lo)}~{pct(h.e2.relRange.hi)}
          </p>
          <p className="mt-3 text-[15px] leading-6">
            짧은 순·가까운 순 단순 규칙과는 {h.e2.nCells}개 중 {h.e2.P0}개 조건에서 차이가 없습니다. 효과는 정교한 순서가 아니라 등록 기록을 호환 자원과 잇는 데서 나옵니다(모의).
          </p>
          {h.e1.robustRule.length > 0 ? (
            <p className="mt-3 text-[15px] leading-6 text-gap">
              도구를 써도 기기×정전 조합 {h.e1.robustRule.length}곳에는 가정 범위 추첨 90% 이상(95% 신뢰하한)에서 공백이 남습니다: {robustPhrase(h.e1.robustRule)}. 정전 뒤 배정이 아니라 사전 배치가 필요한 곳입니다(모의정전).
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-[17px] leading-7" data-testid="closing-before">
          같은 정전을 여러 번 다시 돌린 결과: <strong>{BEFORE_MEASURE}</strong>
        </p>
      )}
      <p className="mt-4 text-[20px] font-bold leading-8">
        기록은 이미 공공기관에 있습니다. 남은 것은 그 기록을 시간과 잇는 일입니다.
      </p>
      <p className="mt-3 text-[12px] text-muted">AI 기반 운용 · 시연용 합성 데이터</p>
    </section>
  );
}
