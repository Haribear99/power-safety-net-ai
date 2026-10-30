// `/` 랜딩 (spec.md 1.3절). SSG. 첫 화면: 배너·H1·두 시계·평균 인정·CTA. 위젯 값은 빌드 때 엔진으로 계산한다(클라이언트 API 호출 0).
// 첫 화면에는 배너 밖에서 'AI'·'시뮬레이션'·'예측'·'생명'·'안전'을 쓰지 않는다(1.1절).
import Link from "next/link";
import type { Cause, HouseholdView } from "@/lib/domain/types";
import { APP_DB, computeLowerBound } from "@/lib/engine/lowerBound";
import { computeRestoration } from "@/lib/engine/restoration";
import { TwoClocks } from "@/components/TwoClocks";
import { GapWidget, type WidgetCause, type WidgetDevice } from "@/components/GapWidget";
import { ClosingCard } from "@/components/ClosingCard";
import { aptCalib, kpiOverPredict, n1Evidence, sweepN } from "@/lib/evidence";

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
    const spec = APP_DB.devices.get(specId);
    if (!spec) throw new Error(`device_db에 ${specId} 없음`);
    const hh: HouseholdView = {
      id: "W", pseudonym: "W", cell: { x: 0, y: 0 }, floor: 1, mobilityNeed: false, caregiver: true, tReport: 0, lEndPrev: null,
      device: { specId, specBy: "db_exact", batteryAgeY: null, charge: { value: 100, source: "device_screen" } }, ext: [],
    };
    const lb = computeLowerBound(hh, APP_DB);
    return {
      key: specId, label, specH: spec.internalH.value, lowerH: lb.hours ?? 0, source,
      formula: spec.internalH.value === 0
        ? "사양상 0시간(정전과 동시에 전원 필요)"
        : `사양 ${spec.internalH.value}시간 × 연식 미확인 0.7 × 기기 화면 완충 표시 0.9 × 제조사 최악 조건 ½`,
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
    <main className="pb-4">
      {/* 첫 화면(390×844: 배너·H1·두 시계·CTA). 데스크톱은 왼쪽 글·오른쪽 두 시계, 모바일은 H1 → 시계 → 문장 → CTA 순서 그대로 */}
      <section className="border-b border-line bg-white" aria-labelledby="h1">
        <div className="mx-auto grid max-w-6xl gap-x-12 px-4 pb-8 pt-4 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:pb-14 lg:pt-12 lg:[grid-template-areas:'h_c'_'a_c'_'b_c']">
          <h1 id="h1" className="text-[28px] font-extrabold leading-9 tracking-tight text-brand-strong lg:text-[44px] lg:leading-[1.15] lg:[grid-area:h]">배터리가 먼저 끝날까, 전기가 먼저 올까</h1>
          <div className="mt-3 lg:mt-0 lg:[grid-area:c]"><TwoClocks /></div>
          <p className="mt-3 max-w-[60ch] text-[16px] leading-7 text-ink lg:mt-5 lg:text-[18px] lg:leading-8 lg:[grid-area:a]" data-testid="avg-line">
            {apt
              ? <>한국 정전은 한 집당 1년 9분입니다. 그러나 최근 {apt.years}년 아파트 정전 {apt.n}건 중 {apt.gt12h}건, {Math.round(apt.n / apt.gt12h)}건에 1건꼴로 12시간을 넘겼습니다(기후에너지환경부 집계).</>
              : <>한국 정전은 한 집당 1년 9분입니다. 그러나 2026년 8월 인천 계양 아파트는 11시간, 충남 서산 아파트는 14시간 동안 전기가 끊겼습니다(보도).</>}
          </p>
          <div className="mt-4 grid gap-2 lg:mt-7 lg:flex lg:flex-wrap lg:gap-3 lg:[grid-area:b]">
            <Link href="/ops?s=PRESET-SUWON" data-testid="cta-ops"
              className="press block rounded-xl bg-brand px-5 py-3 text-center text-[17px] font-bold text-white shadow-[var(--shadow-raised)] hover:bg-brand-strong lg:whitespace-nowrap">
              운영자 화면 체험 (수원형 야간 변압기)
            </Link>
            <Link href="/lab" data-testid="cta-lab"
              className="press block rounded-xl border border-brand-line bg-white px-5 py-3 text-center text-[16px] font-semibold text-brand hover:bg-brand-soft lg:whitespace-nowrap">
              {n != null ? `합성 정전 ${n.toLocaleString("ko-KR")}건, 정책만 바꿔 돌린 결과` : "같은 정전을 다시 돌린 결과 보기"}
            </Link>
          </div>
        </div>
      </section>

      {/* 문제: 정전이 길어지면 먼저 꺼지는 집 */}
      <section className="mx-auto mt-12 grid max-w-6xl items-center gap-8 px-4 md:grid-cols-2 lg:mt-16" aria-labelledby="problem">
        <figure>
          <div role="img" aria-label="밤에 정전된 아파트 단지. 한 집 창문에만 의료기기 불빛이 켜져 있다" className="illust illust-reveal aspect-[3/2] w-full bg-[url('/illustrations/outage-apartment.webp')]" />
          <figcaption className="mt-2 text-[13px] text-muted">일러스트: AI 생성(실제 장소 아님)</figcaption>
        </figure>
        <div>
          <h2 id="problem" className="text-[24px] font-extrabold leading-8 tracking-tight text-brand-strong lg:text-[30px] lg:leading-10">정전이 길어지면, 배터리가 먼저 끝나는 집이 생깁니다</h2>
          <p className="mt-3 max-w-[60ch] text-[16px] leading-7">인공호흡기·산소발생기를 쓰는 집은 정전과 동시에 기기 배터리 시간이 줄어듭니다. 공개된 복구·순환단전 절차에는 어느 집이 먼저 꺼지는지 계산하는 단계가 없습니다.</p>
          <p className="mt-2 max-w-[60ch] text-[16px] leading-7">전력안심망은 집마다 배터리가 버티는 시간과 전기가 돌아올 시각을 나란히 놓고, 담당자가 먼저 챙길 집을 고르게 돕습니다.</p>
        </div>
      </section>

      <div className="mx-auto mt-12 max-w-3xl px-4 lg:mt-16"><GapWidget devices={widgetDevices()} causes={widgetCauses()} /></div>

      {/* 이 도구가 하는 일: 세로 4단계 흐름 */}
      <section className="mx-auto mt-12 max-w-6xl px-4 lg:mt-16" aria-labelledby="how">
        <h2 id="how" className="text-[24px] font-extrabold leading-8 tracking-tight text-brand-strong lg:text-[30px] lg:leading-10">이 도구가 하는 일</h2>
        <div className="mt-5 grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-start">
          <ol className="step-list text-[16px] leading-7">
            <li>기기 라벨을 읽어(AI) 제조사 사양과 맞춰 집마다 <strong>배터리 하한</strong>(계산값)을 검증 가능한 규칙으로 계산합니다.{(() => { const k = kpiOverPredict(); return k ? ` 모의에서는 이 하한이 실제보다 긴 경우가 ${((100 * k.rule.k) / k.rule.n).toFixed(1)}%였습니다(원안 목표 0건 미달, 사후 집계, ` : ""; })()}{kpiOverPredict() && <><Link className="underline" href="/lab#prereg">랩 ⑥</Link>). </>} <Link className="underline" href="/household">라벨 판독 해 보기</Link></li>
            <li>하한을 <strong>복구 가정 범위</strong>와 <strong>비상전원 도착 시각</strong>에 비교해 처리 순서와 추천을 냅니다.</li>
            <li><strong>담당자가 승인</strong>해야 배정되고, 119에는 위치·기기·예상 안전시간 세 가지만 넘어갑니다.</li>
            <NoticeItem />
          </ol>
          <figure className="lg:sticky lg:top-[calc(var(--banner-h,29px)+16px)]">
            <div role="img" aria-label="처리 순서 화면에서 한 집을 고르고, 사람이 버튼을 눌러 승인하면 구급차로 이어지는 흐름" className="illust illust-reveal aspect-[3/1] w-full bg-[url('/illustrations/approve-flow.webp')] bg-contain bg-white" />
            <figcaption className="mt-2 text-[13px] text-muted">처리 순서 → 담당자 승인 → 119 연계. 일러스트: AI 생성</figcaption>
          </figure>
        </div>
      </section>

      {/* 정전 전에 할 수 있는 일(E7 자세한 수치는 랩 ⑩) */}
      <section className="mx-auto mt-12 grid max-w-6xl items-center gap-8 px-4 md:grid-cols-[1fr_1.2fr] lg:mt-16" aria-labelledby="prepare">
        <div className="md:order-2">
          <h2 id="prepare" className="text-[24px] font-extrabold leading-8 tracking-tight text-brand-strong lg:text-[30px] lg:leading-10">정전 전에 준비해 두면 달라집니다</h2>
          <p className="mt-3 max-w-[60ch] text-[16px] leading-7">배터리가 없는 산소발생기 집에는 예비 산소통을, 배터리는 인공호흡기 집에 먼저 두는 평시 대비를 같은 조건에서 비교했습니다. 이 결과는 AI가 아니라 평시 정책에서 나온 모의 결과입니다.</p>
          <p className="mt-2 text-[16px]"><Link className="font-semibold text-brand underline underline-offset-4" href="/lab#premortem">가정과 수치 보기(리허설 랩 ⑩)</Link></p>
        </div>
        <figure className="md:order-1">
          <div role="img" aria-label="산소통과 휴대용 배터리를 콘센트 옆에 미리 준비해 둔 모습" className="illust illust-reveal aspect-[3/2] w-full bg-[url('/illustrations/prepare-kit.webp')]" />
          <figcaption className="mt-2 text-[13px] text-muted">일러스트: AI 생성</figcaption>
        </figure>
      </section>

      <div className="mx-auto mt-12 max-w-3xl px-4 lg:mt-16"><ClosingCard /></div>
    </main>
  );
}

/** 사전등록(S9) 2절: 랜딩에도 9.1·9.3·9.2를 Wilson 95% CI와 함께 싣는다 */
function NoticeItem() {
  const n = n1Evidence();
  const ci = (x: { k: number; n: number; lo: number | null; hi: number | null }) => `${x.k}/${x.n}(95% ${Math.round((x.lo ?? 0) * 1000) / 10}~${Math.round((x.hi ?? 0) * 1000) / 10}%)`;
  return (
    <li>
      승인 뒤 보호자에게 보낼 <strong>쉬운 글·음성 안내</strong>를 AI가 쓰고, 규칙 검사와 다른 AI의 역추출 대조(검사 범위: 시각·수단·경고·할 일·금지 표현)를 통과해야 담당자 확인 후보가 됩니다(시연용·담당자 확인 뒤 발송, 실제 발송 기능 없음).
      {n ? (
        <ul className="mt-2 space-y-1.5 rounded-xl border border-line bg-paper p-3 text-[16px] leading-7">
          <li>봉인 측정(봉인 당시 검사 기준): AI 글 통과 {ci(n.aiSent)}</li>
          {n.judgeSplit ? <li>봉인 측정의 나간 글 60건 중 봉인 뒤 결함 판정 {n.sentDefects ?? "—"}건: 같은 시각 경고 모순 {n.judgeSplit.aiSameTime.n}·모순 고정 문안 {n.judgeSplit.sentContradiction}·외장 합산 미표기 {n.extUndisclosed?.k ?? "—"}·경고 여유 미달 {n.marginMissed?.length ?? "—"}·없는 약속 {n.unsupportedPromise?.length ?? "—"}. &lsquo;적어도&rsquo;만 있는 글 {n.atLeastOnly?.length ?? "—"}건은 기준 변경이라 제외(합치면 {(n.sentDefects ?? 0) + (n.atLeastOnly?.length ?? 0)}건), 고침·고친 검사는 미측정.</li> : null}
          <li>봉인 측정에서 개발 세션이 띄운 Claude Opus 에이전트(검사기와 같은 모델)가 쓴 틀린 글 통과 {ci(n.badMissed)}(예측 틀림: 경고 대상·수단 덧붙임·기기 이름·구급대 연결), 맞는 글 잘못 막음 {ci(n.goodFalseReject)}. <Link className="underline" href="/lab#notice">자세히</Link></li>
        </ul>
      ) : <>{" "}<Link className="underline" href="/lab#notice">자세히</Link></>}
    </li>
  );
}
