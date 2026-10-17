import Link from "next/link";
import { BEFORE_MEASURE, c1Evidence, diffSummary, type C1Rate } from "@/lib/evidence";

const r = (x: C1Rate | { k: number; n: number }) => `${x.k}/${x.n}`;
const ci = (x: C1Rate) => `95% CI ${(x.ciLo * 100).toFixed(1)}~${(x.ciHi * 100).toFixed(1)}%`;

export const metadata = { title: "AI 사용 장부 · 전력안심망 AI" };

// 7.6절: evidence.json에서 자동 생성. Phase 6에서 전체 장부를 채운다.
export default function LedgerPage() {
  const d = diffSummary();
  const c1 = c1Evidence();
  return (
    <main className="mx-auto max-w-2xl px-4 py-6 text-[16px] leading-7">
      <h1 className="text-[22px] font-extrabold">AI 사용 장부</h1>
      <h2 className="mt-4 text-[18px] font-bold">AI가 아닌 부분의 검증</h2>
      <p className="mt-1">
        배터리 하한·배정 규칙·시뮬레이션은 AI가 아닌 결정적 코드입니다. 같은 입력을 독립 Python 구현과 비교한 차등 시험:{" "}
        {d ? <strong data-testid="diff-pass">{d.total.pass}/{d.total.scenarios} 시나리오 일치(가구 {d.total.households.toLocaleString("ko-KR")})</strong> : "측정 전"}
      </p>
      <h2 className="mt-6 text-[18px] font-bold">AI가 하는 일 ①: 기기 라벨 판독(Claude Sonnet)</h2>
      {c1 ? (
        <div data-testid="c1-ledger">
          <p className="mt-1">프롬프트를 만들기 전에 봉인한 합성 라벨 시험셋 {c1.sonnet.n}장(열화 60, 깨끗 30, 혼동 미끼·DB 밖 기종 30)을 <strong>한 번만</strong> 돌린 결과입니다. 렌더 라벨 성능이며 실제 기기 사진 성능이 아닙니다.</p>
          <div className="mt-2 overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[560px] text-[14px]">
              <thead className="bg-paper text-left text-muted"><tr><th className="px-2 py-1">지표</th><th className="px-2 py-1">Claude Sonnet</th><th className="px-2 py-1">기준선 Tesseract OCR</th></tr></thead>
              <tbody>
                {([
                  ["열화 라벨 모델명을 자신 있게 틀림(헤드라인)", "degradedModelConfidentWrong"],
                  ["DB의 엉뚱한 기종과 표시 없이 일치", "unflaggedMismatch"],
                  ["DB 밖 기종 → 수동검토로 보냄", "unregisteredToReview"],
                  ["모델명 정확히 읽음", "modelExact"],
                  ["실기종이 DB와 자동 일치(나머지는 수동검토)", "dbMatchRate"],
                ] as const).map(([name, k]) => (
                  <tr key={k} className="border-t border-line">
                    <td className="px-2 py-1">{name}</td>
                    <td className="px-2 py-1 tabular-nums">{r(c1.sonnet[k])} <span className="text-[12px] text-muted">{ci(c1.sonnet[k])}</span></td>
                    <td className="px-2 py-1 tabular-nums">{c1.tesseract ? r(c1.tesseract[k]) : BEFORE_MEASURE}</td>
                  </tr>
                ))}
                <tr className="border-t border-line"><td className="px-2 py-1">가린 글자를 채워 넣음(보완 위반)</td><td className="px-2 py-1">{c1.sonnet.supplementViolations}건(모두 &lsquo;일부만 보임·확신 낮음&rsquo; 표시, 확신 있게 채운 것 {c1.sonnet.supplementConfident}건)</td><td className="px-2 py-1">{c1.tesseract?.supplementViolations ?? "—"}건</td></tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[14px]">
            관문 3(열화 라벨 자신 있게 틀린 비율 10% 이하): <strong>{c1.gate3.pass ? "통과" : "미달"}</strong>(점추정 {(c1.gate3.pointEstimate * 100).toFixed(1)}%). 0건이어도 n=60이라 CI 상한은 {(c1.sonnet.degradedModelConfidentWrong.ciHi * 100).toFixed(1)}%입니다.
            {c1.sonnet.costPerImage != null ? ` 장당 비용 $${c1.sonnet.costPerImage.toFixed(4)}, 지연 중앙값 ${((c1.sonnet.latencyP50 ?? 0) / 1000).toFixed(1)}초.` : ""}
            {c1.devRunConsistency ? ` 같은 프롬프트 두 번 실행 시 모델명 판독이 같았던 비율 ${c1.devRunConsistency.modelSame}/${c1.devRunConsistency.n}(개발셋 기준).` : ""}
          </p>
          <p className="mt-1 text-[13px] text-muted">AI가 정한 기종도 담당자가 「기종 확인」을 하기 전까지는 비슷한 이름 기종 중 가장 짧은 배터리 시간으로 계산합니다. 원시 응답(요청 ID 포함)은 저장소 out/sealed/c1에 있습니다. <Link className="underline" href="/household">라벨 판독 해 보기</Link></p>
        </div>
      ) : <p className="mt-1">{BEFORE_MEASURE}</p>}
      <h2 id="judge" className="mt-6 text-[18px] font-bold">심사위원 3분 경로</h2>
      <ol className="mt-1 list-decimal pl-5">
        <li><Link className="underline" href="/">첫 화면</Link>: 두 시계와 판단식 한 줄</li>
        <li><Link className="underline" href="/ops?s=PRESET-SUWON">운영자 화면</Link>: 「모의 정전 발생」 → 표에서 가구 선택 → 승인은 직접 누르세요</li>
        <li><Link className="underline" href="/ops/119">119 화면</Link>: 승인된 119 연계 건만 3필드</li>
      </ol>
      <p className="mt-6"><Link className="underline" href="/">← 처음으로</Link></p>
    </main>
  );
}
