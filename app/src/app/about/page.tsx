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
        <li>AI는 기기 라벨 판독, 절차 문서의 규칙화, 보완안 제안 세 곳에만 쓰고, 계산·배정 규칙은 AI가 아닙니다(AI기본법 제31조 고지).</li>
      </ul>
      <p className="mt-6"><Link className="underline" href="/">← 처음으로</Link></p>
    </main>
  );
}
