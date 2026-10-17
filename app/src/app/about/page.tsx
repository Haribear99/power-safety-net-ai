import Link from "next/link";

export const metadata = { title: "법·윤리와 한계 · 전력안심망 AI" };

// Phase 6에서 ODD·매개변수 장부·제31·33·34조 대응표·민감정보·의료기기 비해당을 채운다.
export default function AboutPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-6 text-[16px] leading-7">
      <h1 className="text-[22px] font-extrabold">법·윤리와 한계</h1>
      <ul className="mt-3 list-disc space-y-1 pl-5">
        <li>모든 가구·자원은 시연용 합성 데이터입니다. 실제 위치·실시간 정보는 쓰지 않습니다.</li>
        <li>이 도구는 진단·치료 목적이 아니며 의료기기가 아닙니다. 배정은 담당자 승인으로만 확정됩니다.</li>
        <li>복구 시간은 가정 시나리오 범위이며 한전 실시간 예측이 아닙니다.</li>
        <li>AI(Claude)는 지금 기기 라벨의 글자를 옮겨 적는 한 곳에만 씁니다. 기종 결정·배터리 하한·배정 규칙·시뮬레이션은 AI가 아닌 코드입니다(AI기본법 제31조 고지). 리허설 랩의 해외 보완안은 AI가 만든 것이 아니라 공개 절차를 사람이 정한 규칙으로 옮긴 것입니다.</li>
        <li>라벨 사진을 올리면 판독을 위해 국외 AI 사업자(Anthropic, 미국)로 전송됩니다. 이 서비스는 이미지를 저장하지 않으며, 사업자 정책상 최대 30일(정책 위반 분류 시 최대 2년) 보관될 수 있습니다. 업로드는 동의 2개를 해야 열리고, 기본은 기록된 판독 재생입니다.</li>
        <li>시뮬레이션 수치는 공개 통계·보도에 맞춘 가정 분포 위의 모의 결과입니다. 결과를 보기 전에 예측과 판정 기준을 봉인했고, 틀린 예측도 공개합니다(<Link className="underline" href="/lab#prereg">사전등록 대조</Link>).</li>
      </ul>
      <p className="mt-6"><Link className="underline" href="/">← 처음으로</Link></p>
    </main>
  );
}
