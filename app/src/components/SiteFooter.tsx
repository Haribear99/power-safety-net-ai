// 공통 푸터(10/30 디자인 개편). 서버 컴포넌트. 배너와 같은 고지를 한 번 더 둔다.
import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line bg-white">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 text-[14px] leading-6 text-muted md:grid-cols-[1.4fr_1fr]">
        <div>
          <p className="text-[15px] font-bold text-ink">전력안심망 AI</p>
          <p className="mt-1">2026 AI 라이프 아이디어 챌린지 12번 후보작 「전력안심망 AI」 구현</p>
          <p className="mt-1">시연용 합성 데이터 · 의료 판단 도구가 아닙니다 · 배정은 담당자가 결정합니다</p>
        </div>
        <nav aria-label="심사 자료" className="grid grid-cols-2 gap-x-6 gap-y-1">
          <Link className="underline-offset-4 hover:underline" href="/ledger#judge">심사위원 경로</Link>
          <Link className="underline-offset-4 hover:underline" href="/ledger">AI 사용 장부</Link>
          <Link className="underline-offset-4 hover:underline" href="/lab">리허설 랩</Link>
          <Link className="underline-offset-4 hover:underline" href="/about">법·윤리</Link>
          <a className="underline-offset-4 hover:underline" href="https://github.com/Haribear99/power-safety-net-ai">GitHub 저장소</a>
        </nav>
      </div>
    </footer>
  );
}
