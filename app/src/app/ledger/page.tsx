import Link from "next/link";
import { BEFORE_MEASURE, c1Evidence, diffSummary, n1Evidence, n1Fresh, type C1Rate } from "@/lib/evidence";

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
          {c1.tesseract ? (
            <p className="mt-2 rounded border border-line p-2 text-[14px]" data-testid="c1-workload">
              <strong>AI의 몫(수동검토 부담)</strong>: 봉인 시험셋의 자동 확정 비율로 환산하면, DB에 있는 기종을 쓰는 등록 가구 1,000곳마다 담당자가 기종을 직접 확인할 가구는 AI 판독 {Math.round(1000 * (1 - c1.sonnet.dbMatchRate.k / c1.sonnet.dbMatchRate.n))}곳, OCR {Math.round(1000 * (1 - c1.tesseract.dbMatchRate.k / c1.tesseract.dbMatchRate.n))}곳, 판독 없음 1,000곳입니다. 정전 모의에서 판독 정확도가 공백을 바꾼다는 근거는 없었고(랩 ⑧), 검토 1건당 시간과 실제 업무량은 재지 않았습니다.
            </p>
          ) : null}
          <p className="mt-1 text-[13px] text-muted">AI가 정한 기종도 담당자가 「기종 확인」을 하기 전까지는 비슷한 이름 기종 중 가장 짧은 배터리 시간으로 계산합니다. 원시 응답(요청 ID 포함)은 저장소 out/sealed/c1에 있습니다. <Link className="underline" href="/household">라벨 판독 해 보기</Link></p>
        </div>
      ) : <p className="mt-1">{BEFORE_MEASURE}</p>}
      <NoticeLedger />
      <h2 id="judge" className="mt-6 text-[18px] font-bold">심사위원 3분 경로</h2>
      <ol className="mt-1 list-decimal pl-5">
        <li><Link className="underline" href="/">첫 화면</Link>: 두 시계와 판단식 한 줄</li>
        <li><Link className="underline" href="/ops?s=PRESET-SUWON">운영자 화면</Link>: 「모의 정전 발생」 → 표에서 가구 선택 → 승인은 직접 누르세요 → 아래 「보호자 알림」에서 「AI로 쉬운 글 쓰기」·「소리로 듣기」</li>
        <li><Link className="underline" href="/ops/119">119 화면</Link>: 승인된 119 연계 건만 3필드</li>
      </ol>
      <p className="mt-6"><Link className="underline" href="/">← 처음으로</Link></p>
    </main>
  );
}

/** AI가 하는 일 ②: 보호자 알림(봉인 S9, evidence.n1) */
function NoticeLedger() {
  const n = n1Evidence(), f = n1Fresh();
  const ci = (x: { k: number; n: number; lo: number | null; hi: number | null }) => `${x.k}/${x.n}(95% ${((x.lo ?? 0) * 100).toFixed(1)}~${((x.hi ?? 0) * 100).toFixed(1)}%)`;
  return (
    <>
      <h2 className="mt-6 text-[18px] font-bold">AI가 하는 일 ②: 보호자 알림(생성 Claude Sonnet, 검사 Claude Opus)</h2>
      {n ? (
        <div className="mt-1 text-[14px]">
          <p>규칙이 정한 시각·할 일과 담당자가 승인한 수단을 AI가 쉬운 글로 쓰고, 규칙 검사와 다른 AI의 역추출 대조를 통과해야 담당자 확인 후보가 됩니다. 아니면 고정 문안입니다. 시연용·담당자 확인 뒤 발송이며 실제 발송 기능은 없습니다.</p>
          <ul className="mt-1 list-disc pl-5">
            <li>봉인 시험셋(봉인 커밋 뒤 공개 난수로 생성) AI 글 통과 {ci(n.aiSent)}, 고정 문안을 잘못 막음 {ci(n.templateFalseReject)}(봉인 당시 모순 고정 문안 {n.judgeSplit?.contradiction.n ?? "—"}건도 통과시킨 값). 나간 AI 글 중 {n.judgeSplit?.aiSameTime.n ?? "—"}건은 같은 시각 경고 모순, {n.extUndisclosed?.k ?? "—"}건은 외장 합산 미표기, 나간 고정 문안 {n.judgeSplit?.sentContradiction ?? "—"}건은 모순, {n.marginMissed?.length ?? "—"}건은 지금 기준이면 경고가 붙었을 글, {n.unsupportedPromise?.length ?? "—"}건은 사실에 없는 약속(나간 글 중 봉인 뒤 결함 판정 {n.sentDefects ?? "—"}/60, &lsquo;적어도&rsquo;만 있는 글 {n.atLeastOnly?.length ?? "—"}건은 기준 변경이라 제외(합치면 {(n.sentDefects ?? 0) + (n.atLeastOnly?.length ?? 0)}/60), 고침·고친 검사는 미측정)</li>
            <li>쉬움 쌍 비교(탐색, Opus 판정): AI {n.judge.ai} · 고정 {n.judge.template} · 같음 {n.judge.same}, AI 우세 근거 없음{n.judgeSplit ? `(부호검정 p≈${n.judgeSplit.signP.toFixed(1)}. 사후: 모순 고정 문안 ${n.judgeSplit.contradiction.judged}쌍 빼면 ${n.judgeSplit.rest.ai}:${n.judgeSplit.rest.template})` : ""}</li>
            <li>개발 세션이 띄운 Claude Opus 레드팀 에이전트(검사기와 같은 모델)가 쓴 틀린 글 통과 {ci(n.badMissed)}(예측 &lsquo;5% 이하&rsquo; 틀림), 맞는 글 잘못 막음 {ci(n.goodFalseReject)}</li>
            <li>지연 중앙값 {n.latencyP50 != null ? `${(n.latencyP50 / 1000).toFixed(1)}초` : "—"}(생성+검사), 건당 비용 평균 {n.costPerNotice ? `$${n.costPerNotice.mean.toFixed(4)}(최대 $${n.costPerNotice.max.toFixed(4)})` : "—"}(봉인 실행, 검사 v6·프롬프트 캐시 적중 기준. 검사 n1-check-v23·프롬프트 n1-v17의 dev 회귀 40건은 평균 $0.0173·최대 $0.0543(최대는 2차 지시문을 바꾼 뒤 첫 건의 캐시 쓰기. 생성+2차 검사, 저장소 밖 원시 응답 out/n1/v24-r1 집계. 공개 요약 seal/outputs/n1_regression/v24-r1.summary.json의 costUsd는 고정 문안 검사까지 더한 값), 캐시가 식은 단발 호출은 더 비쌀 수 있음). 국외 전송: 사실표와 그 글만(이름·주소 없음)</li>
          </ul>
          <p className="mt-1 text-[13px] text-muted">수치는 봉인 당시 검사(n1-check-v6) 결과입니다. {f ? `지금 쓰는 검사(${f.versions.check})를 10/30 처음 새 사례로 쟀습니다(사후·탐색 측정): 틀린 글 통과 ${ci(f.badMissed)}, 맞는 글 잘못 막음 ${ci(f.goodFalseReject)}(2차 검사만 ${ci(f.goodRejectGate2)}). 사례를 쓴 에이전트도 Claude 계열이라 맹점이 겹칠 수 있습니다. ` : "지금 쓰는 검사는 봉인 뒤 고친 버전이며 새 사례로 측정하지 않았습니다. "}<Link className="underline" href="/lab#notice">리허설 랩 ⑨</Link></p>
        </div>
      ) : <p className="mt-1">{BEFORE_MEASURE}</p>}
    </>
  );
}
