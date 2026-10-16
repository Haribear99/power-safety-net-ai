import Link from "next/link";
import { diffSummary } from "@/lib/evidence";

export const metadata = { title: "AI 사용 장부 · 전력안심망 AI" };

// 7.6절: evidence.json에서 자동 생성. Phase 6에서 전체 장부를 채운다.
export default function LedgerPage() {
  const d = diffSummary();
  return (
    <main className="mx-auto max-w-2xl px-4 py-6 text-[16px] leading-7">
      <h1 className="text-[22px] font-extrabold">AI 사용 장부</h1>
      <h2 className="mt-4 text-[18px] font-bold">AI가 아닌 부분의 검증</h2>
      <p className="mt-1">
        배터리 하한·배정 규칙·시뮬레이션은 AI가 아닌 결정적 코드입니다. 같은 입력을 독립 Python 구현과 비교한 차등 시험:{" "}
        {d ? <strong data-testid="diff-pass">{d.total.pass}/{d.total.scenarios} 시나리오 일치(가구 {d.total.households.toLocaleString("ko-KR")})</strong> : "측정 전"}
      </p>
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
