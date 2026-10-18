// `/` 랜딩 (spec.md 1.3절). SSG. 첫 화면: 배너·H1·두 시계·평균 인정·CTA. 위젯 값은 빌드 때 엔진으로 계산한다(클라이언트 API 호출 0).
// 첫 화면에는 배너 밖에서 'AI'·'시뮬레이션'·'예측'·'생명'·'안전'을 쓰지 않는다(1.1절).
import Link from "next/link";
import type { Cause, HouseholdView } from "@/lib/domain/types";
import { computeLowerBound, DEFAULT_DB } from "@/lib/engine/lowerBound";
import { computeRestoration } from "@/lib/engine/restoration";
import { TwoClocks } from "@/components/TwoClocks";
import { GapWidget, type WidgetCause, type WidgetDevice } from "@/components/GapWidget";
import { ClosingCard } from "@/components/ClosingCard";
import { aptCalib, n1Evidence, sweepN } from "@/lib/evidence";

const DEVICE_CHIPS: { specId: string; label: string; source: string }[] = [
  { specId: "PERFECTO2", label: "산소발생기 · 배터리 없음", source: "사양: Invacare Perfecto2 사용자 설명서(거치형, 내장배터리 없음)" },
  { specId: "LTV1150", label: "인공호흡기 1시간", source: "사양: LTV 1150 내장 1시간(ASTHO 2023, 루이지애나 사용자 기기 목록)" },
  { specId: "TRILOGY100", label: "인공호흡기 3시간", source: "사양: Trilogy 100 내장 3시간(ASTHO 2023)" },
  { specId: "ASTRAL150", label: "인공호흡기 8시간", source: "사양: Astral 150 내장 8시간(호주 TGA 안내)" },
];
const CAUSE_CHIPS: { cause: Cause; label: string; source: string }[] = [
  { cause: "APT_SHORT", label: "단지 단기 고장", source: "아파트 정전 보도(오산 2.5시간, 고양 2시간)에 맞춘 가정 분포" },
  { cause: "APT_NIGHT_XFMR", label: "야간 변압기", source: "아파트 정전 보도(수원 영통, 인천 계양 11시간)에 맞춘 가정 분포" },
  { cause: "APT_FIRE", label: "전기실 화재", source: "무안 아파트 정전 보도(종료 시각 미확인)와 정부 48시간 목표(보도)에 맞춘 가정 분포" },
  { cause: "TYPHOON_STRONG", label: "강한 태풍", source: "태풍 마이삭·힌남노 복구 집계에 맞춘 보정 분포(일부 가정)" },
];

function widgetDevices(): WidgetDevice[] {
  return DEVICE_CHIPS.map(({ specId, label, source }) => {
    const spec = DEFAULT_DB.devices.get(specId);
    if (!spec) throw new Error(`device_db에 ${specId} 없음`);
    const hh: HouseholdView = {
      id: "W", pseudonym: "W", cell: { x: 0, y: 0 }, floor: 1, mobilityNeed: false, caregiver: true, tReport: 0, lEndPrev: null,
      device: { specId, specBy: "db_exact", batteryAgeY: null, charge: { value: 100, source: "device_screen" } }, ext: [],
    };
    const lb = computeLowerBound(hh, DEFAULT_DB);
    return {
      key: specId, label, specH: spec.internalH.value, lowerH: lb.hours ?? 0, source,
      formula: spec.internalH.value === 0
        ? "사양상 0시간(정전과 동시에 전원 필요)"
        : `사양 ${spec.internalH.value}시간 × 연식 미확인 0.7 × 기기 화면 완충 표시 0.9`,
    };
  });
}

function widgetCauses(): WidgetCause[] {
  return CAUSE_CHIPS.map(({ cause, label, source }) => {
    const r = computeRestoration({ cause, tOutageH: 0, nowH: 0, status: "ASSUMED_RANGE" }).view;
    return { key: cause, label, p10: r.p10, p50: r.p50, p90: r.p90, source };
  });
}

export default function Home() {
  const n = sweepN();
  const apt = aptCalib();
  return (
    <main className="mx-auto max-w-xl px-4 pb-12">
      <section className="pt-4" aria-labelledby="h1">
        <h1 id="h1" className="text-[28px] font-extrabold leading-9 tracking-tight">배터리가 먼저 끝날까, 전기가 먼저 올까</h1>
        <div className="mt-3"><TwoClocks /></div>
        <p className="mt-3 text-[16px] leading-7" data-testid="avg-line">
          {apt
            ? <>한국 정전은 한 집당 1년 9분입니다. 그러나 최근 {apt.years}년 아파트 정전 {apt.n}건 중 {apt.gt12h}건, {Math.round(apt.n / apt.gt12h)}건에 1건꼴로 12시간을 넘겼습니다(기후에너지환경부 집계).</>
            : <>한국 정전은 한 집당 1년 9분입니다. 그러나 2026년 8월 인천 계양 아파트는 11시간, 충남 서산 아파트는 14시간 동안 전기가 끊겼습니다(보도).</>}
        </p>
        <div className="mt-4 grid gap-2">
          <Link href="/ops?s=PRESET-SUWON" data-testid="cta-ops"
            className="block rounded-xl bg-ink px-4 py-3 text-center text-[17px] font-bold text-white">
            운영자 화면 체험 (수원형 야간 변압기)
          </Link>
          <Link href="/lab" data-testid="cta-lab"
            className="block rounded-xl border border-ink px-4 py-3 text-center text-[16px] font-semibold">
            {n != null ? `합성 정전 ${n.toLocaleString("ko-KR")}건, 정책만 바꿔 돌린 결과` : "같은 정전을 다시 돌린 결과 보기"}
          </Link>
        </div>
      </section>

      <div className="mt-8"><GapWidget devices={widgetDevices()} causes={widgetCauses()} /></div>

      <section className="mt-8" aria-labelledby="how">
        <h2 id="how" className="text-[18px] font-bold">이 도구가 하는 일</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-[16px] leading-7">
          <li>기기 라벨을 읽어(AI) 제조사 사양과 맞춰 집마다 <strong>배터리 하한</strong>을 검증된 규칙으로 계산합니다. <Link className="underline" href="/household">라벨 판독 해 보기</Link></li>
          <li>하한을 <strong>복구 가정 범위</strong>와 <strong>비상전원 도착 시각</strong>에 비교해 처리 순서와 추천을 냅니다.</li>
          <li><strong>담당자가 승인</strong>해야 배정되고, 119에는 위치·기기·예상 안전시간 세 가지만 넘어갑니다.</li>
          <NoticeItem />
        </ol>
      </section>

      <div className="mt-8"><ClosingCard /></div>

      <footer className="mt-6 text-[14px] leading-6 text-muted">
        <p>2026 AI 라이프 아이디어 챌린지 12번 후보작 「전력안심망 AI」 구현</p>
        <nav className="mt-1 flex flex-wrap gap-x-4" aria-label="심사 자료">
          <Link className="underline" href="/ledger#judge">심사위원 경로</Link>
          <Link className="underline" href="/ledger">AI 사용 장부</Link>
          <Link className="underline" href="/about">법·윤리</Link>
        </nav>
      </footer>
    </main>
  );
}

/** 사전등록(S9) 2절: 랜딩에도 9.1·9.3·9.2를 Wilson 95% CI와 함께 싣는다 */
function NoticeItem() {
  const n = n1Evidence();
  const ci = (x: { k: number; n: number; lo: number | null; hi: number | null }) => `${x.k}/${x.n}(95% ${Math.round((x.lo ?? 0) * 1000) / 10}~${Math.round((x.hi ?? 0) * 1000) / 10}%)`;
  return (
    <li>
      승인 뒤 보호자에게 보낼 <strong>쉬운 글·음성 안내</strong>를 AI가 쓰고, 규칙 검사와 다른 AI의 역추출 대조를 통과해야 담당자 확인 후보가 됩니다(시연용·담당자 확인 뒤 발송, 실제 발송 기능 없음).
      {n ? ` 봉인 측정(봉인 당시 검사 기준): AI 글 통과 ${ci(n.aiSent)}, 개발 세션이 띄운 Claude Opus 에이전트(검사기와 같은 모델)가 쓴 틀린 글 통과 ${ci(n.badMissed)}(예측 틀림: 경고 대상·수단 덧붙임·기기 이름·구급대 연결), 맞는 글 잘못 막음 ${ci(n.goodFalseReject)}.` : ""}{" "}
      <Link className="underline" href="/lab#notice">자세히</Link>
    </li>
  );
}
