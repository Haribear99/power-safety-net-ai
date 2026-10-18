import Link from "next/link";

export const metadata = { title: "법·윤리와 한계 · 전력안심망 AI" };

// 법·윤리 고지, 의료기기 비해당 근거, 착안 공개(공고 5항·참가신청서 유의사항 대응).
export default function AboutPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-6 text-[16px] leading-7">
      <h1 className="text-[22px] font-extrabold">법·윤리와 한계</h1>
      <ul className="mt-3 list-disc space-y-1 pl-5">
        <li>모든 가구·자원은 시연용 합성 데이터입니다. 실제 위치·실시간 정보는 쓰지 않습니다.</li>
        <li>이 도구는 의료기기가 아닙니다. 질병의 진단·치료·예방 목적이 없고, 기기를 제어하거나 생체신호를 읽지 않으며, 제조사 사양의 배터리 시간과 정전 복구 범위를 비교해 비상전원 물류를 돕습니다. 배정은 담당자 승인으로만 확정됩니다.</li>
        <li>복구 시간은 가정 시나리오 범위이며 한전 실시간 예측이 아닙니다.</li>
        <li>역할 분담: AI(Claude)는 확률적 판단이 필요한 기기 라벨 판독을 맡고, 생명과 직결된 배터리 하한·배정 계산은 검증 가능한 규칙이, 결정은 담당자가 맡습니다. (AI기본법 제31조 고지) 규칙 기반 우선순위는 원안 제안자가 사전질의 답변에서 「초기 시제품에서는 이 조건들을 이용한 규칙 기반 또는 휴리스틱 방식으로 우선순위를 산출하고 적합한 자원을 추천해도 원안의 취지에 부합」한다고 한 범위입니다. 여기서 「이 조건들」은 가구별 잔여안전시간, 예상 복구시간 또는 대체전력 도착시간, 자원 호환 여부와 가용 여부이며, 이 도구의 규칙은 넷을 모두 씁니다. 리허설 랩의 해외 보완안은 AI가 만든 것이 아니라 공개 절차를 사람이 정한 규칙으로 옮긴 것입니다.</li>
        <li>보호자 알림(쉬운 글·음성): 담당자 결정 뒤 사실(시각·수단·경고)과 할 일은 코드가 정하고, AI(Claude Sonnet)는 그것을 쉬운 문장으로만 씁니다. 1차로 규칙이 글자(시각 표기·뜻 낱말·금지 표현)를, 2차로 다른 AI(Claude Opus)가 사실표 없이 글만 읽고 뽑은 내용을 규칙이 결정 기록과 대조합니다. 둘 다 맞을 때만 AI 글이, 아니면 고정 문안이 담당자 확인 후보가 됩니다(시연용, 실제 발송 기능 없음). 119·123 문장과 평시의 갈 곳·절전 문장은 늘 고정 문장이며, 절전(기기 설정)은 의료 판단이라 담당 의료진·대여업체 확인으로 넘깁니다. AI가 쓴 글에는 화면 표시와 음성 첫마디로 그 사실을 알립니다. 사전등록(S9)한 봉인 측정 결과는 /lab에 있습니다.</li>
        <li>라벨 사진을 올리면 판독을 위해 국외 AI 사업자(Anthropic, 미국)로 전송됩니다. 이 서비스는 이미지를 저장하지 않으며, 사업자 정책상 최대 30일(정책 위반 분류 시 최대 2년) 보관될 수 있습니다. 업로드는 동의 2개를 해야 열리고, 기본은 기록된 판독 재생입니다. 보호자 알림을 AI로 쓸 때는 기기 종류·시각·수단으로 만든 사실표와 그 글만 같은 사업자로 전송되며, 이름·주소·가명은 보내지 않습니다. 음성은 브라우저가 읽습니다.</li>
        <li>시뮬레이션 수치는 공개 통계·보도에 맞춘 가정 분포 위의 모의 결과입니다. 결과를 보기 전에 예측과 판정 기준을 봉인했고, 틀린 예측도 공개합니다(<Link className="underline" href="/lab#prereg">사전등록 대조</Link>).</li>
      </ul>
      <h2 id="inspiration" className="mt-6 text-[18px] font-bold">착안과 차이</h2>
      <p className="mt-1">이 작품의 리허설 랩은 OpenAI DevDay Exchange Community Hackathon: Seoul(2026-10-09) 출품작 「전조(JEONJO)」(공개 저장소 github.com/Hariuncle/JEONJO, 본 작품 출품자와 관계 없음)에서 착안했습니다. 그 작품은 행사장 안전을 주제로, 같은 조건의 가상 세계 여러 개에서 현행 매뉴얼과 개선 매뉴얼을 비교해 빈틈을 찾습니다. 이 실험 틀을 정전·전력의존 가구에 옮겨 왔고, 그 작품의 코드·자산·화면은 쓰지 않았습니다.</p>
      <table className="mt-2 w-full border-collapse text-[14px]">
        <thead><tr className="border-b border-line text-left"><th className="py-1 pr-2">가져온 것</th><th className="py-1">이 작품에서 새로 한 것</th></tr></thead>
        <tbody>
          <tr className="border-b border-line align-top"><td className="py-1 pr-2">같은 조건의 가상 상황을 여러 번 만들어 현행 절차와 개선 절차를 비교하고 빈틈을 찾는 실험 틀</td><td className="py-1">주제를 정전·전력의존 가구로 옮기고, 원안(12번) 판단식 「배터리 하한 − min(복구, 전원 도착)」을 실행하는 운영자 도구와 같은 엔진으로 비교</td></tr>
          <tr className="border-b border-line align-top"><td className="py-1 pr-2">—</td><td className="py-1">제조사 사양 DB·정부 정전 집계(382건)에 맞춘 정량 시뮬레이션, 부트스트랩·Wilson 구간 같은 통계 판정</td></tr>
          <tr className="border-b border-line align-top"><td className="py-1 pr-2">—</td><td className="py-1">해외 공개 절차(미국 PG&amp;E 등)를 근거로 한 보완안, 결과 전 사전등록·OpenTimestamps 봉인, 틀린 예측 공개</td></tr>
          <tr className="align-top"><td className="py-1 pr-2">—</td><td className="py-1">AI 라벨 판독(봉인 시험셋 실측), 보호자 알림 AI 문장과 두 단계 검사(봉인 측정), 담당자 승인, 119 최소정보 연계</td></tr>
        </tbody>
      </table>
      <p className="mt-6"><Link className="underline" href="/">← 처음으로</Link></p>
    </main>
  );
}
