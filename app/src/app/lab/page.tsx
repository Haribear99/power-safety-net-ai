import Link from "next/link";
import { BEFORE_MEASURE } from "@/lib/evidence";

export const metadata = { title: "리허설 랩 · 전력안심망 AI" };

// Phase 3에서 실험 결과(evidence.json)로 채운다. 그 전에는 「측정 전」만 보인다(하드코딩 금지).
export default function LabPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-6 text-[16px] leading-7">
      <h1 className="text-[22px] font-extrabold">리허설 랩</h1>
      <p className="mt-2">같은 정전을 같은 시드로 여러 번 다시 돌려, 어떤 가정에서도 남는 공백과 규칙별 결과를 비교합니다.</p>
      <p id="dominance" className="mt-4 rounded-lg border border-line p-3">조건별 승/무/패: <strong>{BEFORE_MEASURE}</strong></p>
      <p className="mt-4"><Link className="underline" href="/">← 처음으로</Link></p>
    </main>
  );
}
