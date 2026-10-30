// 전역 내비(10/30 디자인 개편). 서버 컴포넌트: 랜딩 초기 JS를 늘리지 않는다(JS 예산). sticky가 아니다 —
// 고정 머리줄은 배너와 /ops 상단 바·/lab 탭 바뿐이어야 한다(e2e layout.spec: 첫 header.sticky = 상단 바). 이름에 「승인」이 든 항목 금지(ops.spec).
import Link from "next/link";

const ITEMS: { href: string; label: string }[] = [
  { href: "/ops?s=PRESET-SUWON", label: "운영자 화면" },
  { href: "/household", label: "라벨 판독" },
  { href: "/lab", label: "리허설 랩" },
  { href: "/ledger", label: "사용 장부" }, // 랜딩 첫 화면 금지어(AI) 규칙 때문에 내비는 「사용 장부」
  { href: "/about", label: "소개·법·윤리" },
];

export function SiteNav() {
  return (
    <nav aria-label="사이트" className="border-b border-line bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2.5">
        <Link href="/" prefetch={false} className="press font-display flex shrink-0 items-center gap-2 rounded-xl py-1 pr-2 text-[16px] font-extrabold tracking-tight text-brand">
          <span aria-hidden="true" className="inline-block h-7 w-7 rounded-lg bg-[url('/logo.svg')] bg-cover" />
          전력안심망
        </Link>
        <ul className="-mr-4 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pr-4 text-[15px] font-semibold text-muted [scrollbar-width:none] md:justify-end">
          {ITEMS.map((it) => (
            <li key={it.href} className="shrink-0">
              <Link href={it.href} prefetch={false} className="press block whitespace-nowrap rounded-full px-3 py-1.5 hover:bg-brand-soft hover:text-brand">
                {it.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
