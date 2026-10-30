// 전역 내비(10/30 디자인 개편). 서버 컴포넌트: 랜딩 초기 JS를 늘리지 않는다(JS 예산). sticky가 아니다 —
// 고정 머리줄은 배너와 /ops 상단 바·/lab 탭 바뿐이어야 한다(e2e layout.spec: 첫 header.sticky = 상단 바). 이름에 「승인」이 든 항목 금지(ops.spec).
import Link from "next/link";

const ITEMS: { href: string; label: string; wide?: string }[] = [
  { href: "/ops", label: "운영자 화면" }, // 쿼리 없음: /ops 안에서 누르면 진행 중인 모의 정전을 그대로 둔다(OpsScreen이 현재 presetId 사용)
  { href: "/household", label: "라벨 판독" },
  { href: "/lab", label: "리허설 랩" },
  { href: "/ledger", label: "사용 장부" }, // 랜딩 첫 화면 금지어(AI) 규칙 때문에 내비는 「사용 장부」
  { href: "/about", label: "소개", wide: "·법·윤리" }, // 좁은 화면은 「소개」만(내비 한 줄 유지, 첫 화면 공간)
];

export function SiteNav() {
  return (
    <nav aria-label="사이트" className="border-b border-line bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
        <Link href="/" prefetch={false} className="press font-display flex shrink-0 items-center gap-2 rounded-xl py-1 pr-2 text-[16px] font-extrabold tracking-tight text-brand">
          <span aria-hidden="true" className="inline-block h-7 w-7 rounded-lg bg-[url('/logo.svg')] bg-cover" />
          전력안심망
        </Link>
        {/* 좁은 화면은 줄바꿈(가로 스크롤은 숨은 항목·잘린 포커스 링 문제, 10/30 레드팀) */}
        <ul className="-mx-2 flex min-w-0 basis-full flex-wrap items-center gap-y-1 text-[14px] font-semibold sm:text-[15px] text-muted md:mx-0 md:flex-1 md:basis-auto md:justify-end md:gap-1">
          {ITEMS.map((it) => (
            <li key={it.href} className="shrink-0">
              <Link href={it.href} prefetch={false} className="press block whitespace-nowrap rounded-full px-2 py-1.5 hover:bg-brand-soft hover:text-brand sm:px-2.5 md:px-3">
                {it.label}{it.wide && <span className="hidden md:inline">{it.wide}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
