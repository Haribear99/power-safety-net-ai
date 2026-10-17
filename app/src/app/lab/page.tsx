// /lab 리허설 랩 (spec.md 5.8절, 라운드 5). 정적 서버 컴포넌트. 숫자는 전부 src/data/lab.json(봉인 실행 집계)에서 나온다.
// 탭 ① 손익분기 ② 빈틈 지도 ③ 도구 대 현행 ⑥ 사전등록 대조. ④ 보완안·⑤ 반증 슬라이더는 Should(아직 없음, 「측정 전」).
import Link from "next/link";
import { BEFORE_MEASURE } from "@/lib/evidence";
import { CAUSE_ORDER, causeLabel, cellParts, CLASS_KO, CLASS_ORDER, lab, pct1, type LabCmp, type LabDoc, type LabE1Cell } from "@/lib/lab";
import { PATCHES, type PatchId } from "@/lib/sim/patches";

export const metadata = { title: "리허설 랩 · 전력안심망 AI" };

const LABEL_KO: Record<LabE1Cell["label"], { short: string; cls: string; desc: string }> = {
  ROBUST: { short: "견고", cls: "lab-robust", desc: "가정 범위 추첨의 90% 이상(95% 신뢰하한)에서 그 기기 가구 과반에 공백" },
  CONDITIONAL: { short: "조건", cls: "lab-conditional", desc: "공백 비율이 30~90% 안: 정전 길이 등 조건에 따라 갈림" },
  BORDERLINE: { short: "경계", cls: "lab-borderline", desc: "표지 경계에 걸침(추첨 오차 안에서 판정 보류)" },
  FRAGILE: { short: "드묾", cls: "lab-fragile", desc: "공백 비율 30% 미만(95% 신뢰상한)" },
};
const CI_NOTE = "추첨 오차만 반영 · 가정 범위 자체의 불확실성 아님";
const AXIS_KO: Record<string, string> = {
  scaleMult: "복구 배율", kSetTrue: "설정 소모", kAgeTrue: "배터리 노후", sigmaE: "확정 통지 오차", pConfirm: "복구 확정 통지 확률",
  hhPerResource: "가구/자원 비", travelProfile: "이동 속도", k119PerH: "119 시간당 용량", stress119: "119 지연 배수", shelterRefuseRate: "쉼터 거부율",
  backupFailProb: "예비전원 고장 확률", unregisteredRate: "미등록 비율", extOwnRate: "외장 보유", extVerifyRate: "외장 확인", unknownModelRate: "미확인 기종",
  overInputProb: "충전량 과대입력", pEarly: "조기 119 호출 확률", ageUnknownRate: "연식 미상", screenChargeRate: "기기 화면 충전량 비율",
};
const POLICY_KO: Record<string, string> = {
  NONE: "도움 없음", KR_BASELINE: "현행 공개 절차(119 자가 호출)", B1_SHORTEST: "같은 자원 · 배터리 짧은 순", B2_NEAREST: "같은 자원 · 가까운 자원 순",
  RULE: "같은 자원 · 원안 판단식 규칙", ORACLE_INFO: "완전정보 상한(참고)",
  R_L: "절제: 하한 오름차순", RULE_NO_R: "절제: 복구 범위 단계 제거", RULE_FEASIBLE_FIRST: "절제: 도착 가능 가구 먼저", RULE_NO_RESERVE: "절제: 검토 예약 없음",
};
const VERDICT_KO: Record<string, string> = { SUPERIOR: "우세", INFERIOR: "열등", NON_INFERIOR: "비열등", NO_DIFF: "차이 없음" };

function Section({ id, n, title, children }: { id: string; n: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="mt-10 scroll-mt-16">
      <h2 id={`${id}-h`} className="text-[20px] font-extrabold"><span className="text-muted">{n}</span> {title}</h2>
      {children}
    </section>
  );
}

function Hero({ d }: { d: LabDoc }) {
  const kr = d.e2!.pooled.compares.KR_BASELINE;
  const sup = d.e2!.cells.filter((c) => c.kr.v === "SUPERIOR").length;
  const p0 = d.e2!.cells.filter((c) => c.pClass === "P0").length;
  const robustRule = d.e1!.cells.filter((c) => c.pol === "RULE" && c.label === "ROBUST" && !c.zero);
  return (
    <div className="mt-4 rounded-xl border border-line bg-paper p-4" data-testid="lab-hero">
      <p className="text-[15px] text-muted">같은 정전을 같은 난수로 정책만 바꿔 {d.e2!.n.toLocaleString("ko-KR")}회 다시 돌린 결과(모의정전)</p>
      <p className="mt-1 text-[26px] font-extrabold leading-9">
        현행 절차보다 공백 가구·시간 <span className="text-batt">{pct1(kr.rel)} 감소</span>
      </p>
      <p className="text-[15px]">
        {d.e2!.cells.length}개 조건 중 <strong>{sup}개</strong>에서 우세 · 95% CI {pct1(kr.relLo)}~{pct1(kr.relHi)}
      </p>
      <p className="mt-3 text-[15px] leading-6">
        단, 배터리 짧은 순·가까운 순 같은 단순 규칙과는 {d.e2!.cells.length}개 중 <strong>{p0}개</strong> 조건에서 차이가 없습니다. 효과는 정교한 순서가 아니라
        <strong> 등록된 기기 정보로 호환 자원을 정전 즉시 잇는 것</strong>에서 나옵니다.
      </p>
      {robustRule.length > 0 ? (
        <p className="mt-3 rounded-lg bg-gap-soft p-3 text-[15px] leading-6 text-gap">
          도구를 써도 남는 빈틈 {robustRule.length}곳: {robustRule.slice(0, 4).map((c) => `${causeLabel(c.cause).name} × ${CLASS_KO[c.cls]}`).join(", ")}
          {robustRule.length > 4 ? ` 외 ${robustRule.length - 4}곳` : ""}. 준비·이동 시간이 남은 배터리보다 길어 정전 뒤 배정으로는 닫히지 않습니다.
        </p>
      ) : null}
      {(() => {
        const x = d.e3?.effects.find((y) => y.variant === "RULE+P7");
        const c = d.e3?.closure.find((y) => y.variant === "RULE+P7");
        if (!x || !c || (x.effLo ?? 0) <= 0) return null;
        return (
          <p className="mt-3 text-[15px] leading-6">
            그 빈틈에 휴대용 배터리 사전 배치(PG&amp;E 절차의 한국화)를 얹으면 공백 가구·시간이 {pct1(x.effLo)}~{pct1(x.effHi)} 더 줄고, 보완안 시험에서 도구로도 남던 빈틈 {c.robustBefore}곳 중{" "}
            {c.robustBefore - c.robustAfter}곳이 닫힙니다. <a className="underline" href="#patches">④ 보완안</a>
          </p>
        );
      })()}
    </div>
  );
}

function GapGrid({ d, pol }: { d: LabDoc; pol: "KR_BASELINE" | "RULE" }) {
  const cells = d.e1!.cells.filter((c) => c.pol === pol);
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[760px] border-collapse text-[12px]" data-testid={`gapmap-${pol}`}>
        <caption className="px-2 py-1 text-left text-[14px] font-bold">{POLICY_KO[pol]}</caption>
        <thead>
          <tr>
            <th className="w-40 px-2 py-1 text-left font-normal text-muted">기기 \ 정전 원인</th>
            {CAUSE_ORDER.map((c) => { const l = causeLabel(c); return <th key={c} className="px-1 py-1 font-normal"><div className="font-bold">{l.name}</div><div className="text-muted">{l.range}</div></th>; })}
          </tr>
        </thead>
        <tbody>
          {CLASS_ORDER.map((cls) => (
            <tr key={cls} className="border-t border-line">
              <th className="px-2 py-1 text-left font-normal">{CLASS_KO[cls]}{cls === "O2_STAT" ? <div className="text-muted">사양상 0시간 · 집계 제외</div> : null}</th>
              {CAUSE_ORDER.map((cause) => {
                const c = cells.find((x) => x.cls === cls && x.cause === cause);
                if (!c) return <td key={cause} />;
                const L = LABEL_KO[c.label];
                const tip = [
                  `${CLASS_KO[cls]} × ${causeLabel(cause).name}: ${c.label}`,
                  `p = ${c.p.toFixed(3)}, 95% Wilson CI ${c.lo.toFixed(3)}~${c.hi.toFixed(3)} (n = ${c.n}) — ${CI_NOTE}`,
                  c.demoted ? "조기 119 호출 확률 끝값(0.8)에서 신뢰하한 < 0.9라 CONDITIONAL로 내림" : "",
                  c.flips?.length ? `뒤집힘 조건: ${c.flips.map((f) => `${AXIS_KO[f.axis] ?? f.axis} = ${f.value}에서 p ${f.p.toFixed(2)}`).join(", ")}` : "",
                  c.boundaryH != null ? `경계 정전시간 약 ${c.boundaryH}h` : "",
                ].filter(Boolean).join("\n");
                return (
                  <td key={cause} className="p-0.5">
                    <div title={tip} className={`${L.cls} ${c.zero ? "opacity-60" : ""} rounded px-1 py-1 text-center leading-4`} data-label={c.label}>
                      <div className="font-bold">{L.short}{c.flips?.length ? "*" : ""}</div>
                      <div className="tabular-nums">{Math.round(c.p * 100)}%</div>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function cmpText(c: LabCmp) {
  return `${c.w}/${c.t}/${c.l} · ${pct1(c.rel)}`;
}

function Decomposition({ d }: { d: LabDoc }) {
  const t = d.e2!.pooled.totals;
  const order = ["NONE", "KR_BASELINE", "B1_SHORTEST", "B2_NEAREST", "RULE", "ORACLE_INFO"].filter((k) => t[k]);
  const max = Math.max(...order.map((k) => t[k].M2H));
  return (
    <div className="mt-3 space-y-1.5" data-testid="decomposition">
      {order.map((k) => (
        <div key={k} className="grid grid-cols-[minmax(0,11rem)_1fr] items-center gap-2 text-[13px]">
          <div className={k === "RULE" ? "font-bold" : ""}>{POLICY_KO[k]}</div>
          <div className="flex items-center gap-2">
            <div className={`h-4 rounded-sm ${k === "NONE" || k === "KR_BASELINE" ? "bg-gap" : k === "ORACLE_INFO" ? "bg-muted" : "bg-batt"}`} style={{ width: `${(100 * t[k].M2H) / max}%` }} />
            <span className="whitespace-nowrap tabular-nums">{t[k].M2H.toLocaleString("ko-KR")}h</span>
          </div>
        </div>
      ))}
      <p className="pt-1 text-[12px] text-muted">공백 가구·시간 합계(M2), {d.e2!.n.toLocaleString("ko-KR")}개 시나리오. 현행 절차는 자원을 쓰지 않으므로, 현행 → 단순 규칙 차이가 &lsquo;자원 + 기기 정보 연결&rsquo;의 몫이고, 단순 규칙 → 원안 규칙 차이가 &lsquo;순서 규칙&rsquo;의 몫입니다.</p>
    </div>
  );
}

function CellTable({ d }: { d: LabDoc }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[760px] text-[12px]" data-testid="e2-table">
        <thead className="bg-paper text-left text-muted">
          <tr>
            <th className="px-2 py-1">통지 오차 σ</th><th className="px-2 py-1">가구/자원</th><th className="px-2 py-1">이동</th>
            <th className="px-2 py-1">대 현행: 승/무/패 · 감소율 · 판정</th><th className="px-2 py-1">대 짧은 순</th><th className="px-2 py-1">대 가까운 순</th><th className="px-2 py-1">단순 규칙 종합</th>
          </tr>
        </thead>
        <tbody>
          {d.e2!.cells.map((c) => {
            const p = cellParts(c.cell);
            return (
              <tr key={c.cell} className="border-t border-line">
                <td className="px-2 py-1 tabular-nums">{p.sigmaE}</td><td className="px-2 py-1 tabular-nums">{p.ratio}</td><td className="px-2 py-1">{p.travel}</td>
                <td className="px-2 py-1 tabular-nums"><span className={c.kr.v === "SUPERIOR" ? "font-bold text-batt" : c.kr.v === "INFERIOR" ? "font-bold text-gap" : ""}>{cmpText(c.kr)} [{pct1(c.kr.relLo)}, {pct1(c.kr.relHi)}] {VERDICT_KO[c.kr.v]}</span></td>
                <td className={`px-2 py-1 tabular-nums ${c.b1.v === "INFERIOR" ? "bg-gap-soft text-gap" : ""}`}>{cmpText(c.b1)} {VERDICT_KO[c.b1.v]}</td>
                <td className={`px-2 py-1 tabular-nums ${c.b2.v === "INFERIOR" ? "bg-gap-soft text-gap" : ""}`}>{cmpText(c.b2)} {VERDICT_KO[c.b2.v]}</td>
                <td className="px-2 py-1">{c.pClass === "P1" ? "둘 다 우세" : c.pClass === "P2" ? "단순 규칙이 이김" : "같음"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const BINS: [number, number][] = [[0, 2], [2, 4], [4, 8], [8, 12], [12, 24], [24, 999]];

function BreakEven({ d }: { d: LabDoc }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[640px] text-[12px]" data-testid="breakeven">
        <thead className="bg-paper text-muted">
          <tr>
            <th className="px-2 py-1 text-left">기기 \ 실제 정전 길이</th>
            {BINS.map(([a, b]) => <th key={a} className="px-2 py-1">{b === 999 ? `${a}h 이상` : `${a}~${b}h`}</th>)}
          </tr>
        </thead>
        <tbody>
          {CLASS_ORDER.map((cls) => {
            const rows = d.e1!.e1b[cls] ?? [];
            return (
              <tr key={cls} className="border-t border-line">
                <th className="px-2 py-1 text-left font-normal">{CLASS_KO[cls]}</th>
                {BINS.map(([a, b]) => {
                  const sel = rows.filter((r) => r.binLoH >= a && r.binLoH < b);
                  const n = sel.reduce((s, r) => s + r.n, 0);
                  const kr = sel.reduce((s, r) => s + r.gap[0], 0), ru = sel.reduce((s, r) => s + r.gap[1], 0);
                  if (n === 0) return <td key={a} className="px-2 py-1 text-center text-muted">—</td>;
                  const pk = kr / n, pr = ru / n;
                  return (
                    <td key={a} className="px-1 py-1 text-center tabular-nums" title={`가구 ${n.toLocaleString("ko-KR")} · 현행 ${pct1(pk)} · 도구 ${pct1(pr)}`}>
                      <div className="rounded px-1" style={{ background: `rgba(180,35,24,${(0.08 + 0.8 * pk).toFixed(2)})`, color: pk > 0.55 ? "#fff" : undefined }}>현행 {Math.round(pk * 100)}%</div>
                      <div className="text-muted">도구 {Math.round(pr * 100)}%</div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Prereg({ d }: { d: LabDoc }) {
  const s = d.prereg;
  if (!s) return <p className="mt-2">{BEFORE_MEASURE}</p>;
  return (
    <div className="mt-3" data-testid="prereg">
      <p className="text-[15px]">
        시뮬레이션 전 예측(전략 보고서) <strong>{s.section1.hit}/{s.section1.total}</strong> 맞힘 · 개발 시드 예비 실행 뒤 예측 <strong>{s.section2.hit}/{s.section2.total}</strong> 맞힘 ·
        관문 2 <strong>{s.gate2.pass ? "통과" : "실패"}</strong>
      </p>
      <ul className="mt-2 space-y-1 text-[13px]">
        {s.items.map((i) => (
          <li key={i.id} className="flex gap-2 border-t border-line pt-1">
            <span className={`w-5 shrink-0 font-bold ${i.hit ? "text-batt" : "text-gap"}`} aria-label={i.hit ? "맞힘" : "틀림"}>{i.hit ? "○" : "×"}</span>
            <span className="w-8 shrink-0 tabular-nums text-muted">{i.id}</span>
            <span>{i.claim} <span className="text-muted">— 결과: {i.observed}</span></span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[12px] text-muted">
        예측·판정식·임계값·실행 코드 sha256은 결과를 보기 전에 커밋하고(태그 S4) OpenTimestamps로 시각을 남겼습니다: prereg/predictions.md, prereg/sweep.json, seal/S4.txt.ots. 채점 코드(scripts/score-prereg.ts)도 결과를 보기 전에 커밋했습니다.
      </p>
    </div>
  );
}

const BASE_KO: Record<string, string> = { KR_BASELINE: "현행 절차 위", RULE: "도구 위" };

function Patches({ d }: { d: LabDoc }) {
  const e = d.e3;
  if (!e) return <p className="mt-2">{BEFORE_MEASURE}</p>;
  const name = (v: string) => {
    const [b, p] = v.split("+");
    const def = PATCHES.get(p as PatchId)!;
    return { base: BASE_KO[b] ?? b, patch: `${p} ${def.origin}`, actor: def.actorKr };
  };
  return (
    <div className="mt-2" data-testid="patches">
      <p className="text-[14px]">
        같은 정전(보류 시드 {e.n.toLocaleString("ko-KR")}회)에 해외 절차 4개를 한국 행위자로 옮겨 얹고 다시 돌렸습니다. 보급률·고장률·계획 작성률은 가정 범위로 흔들고,
        &lsquo;실효 보급&rsquo;(보급 × (1 − 고장)) 하위 10%와 상위 10% 시나리오의 감소율을 함께 보입니다. 도구는 집에 둔 배터리를 모른다고 두었습니다(효과를 부풀리지 않는 쪽).
      </p>
      <div className="mt-3 overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[760px] text-[12px]" data-testid="patch-table">
          <thead className="bg-paper text-left text-muted">
            <tr><th className="px-2 py-1">바탕</th><th className="px-2 py-1">보완안(한국 행위자)</th><th className="px-2 py-1">공백 가구·시간 감소 [95% CI]</th><th className="px-2 py-1">실효 보급 하위~상위 10%</th><th className="px-2 py-1">고위험 공백 승/무/패</th><th className="px-2 py-1">견고한 빈틈</th></tr>
          </thead>
          <tbody>
            {e.effects.map((x) => {
              const n = name(x.variant);
              const c = e.closure.find((y) => y.variant === x.variant)!;
              const neg = (x.rel ?? 0) <= 0;
              return (
                <tr key={x.variant} className={`border-t border-line ${neg ? "bg-gap-soft" : ""}`}>
                  <td className="px-2 py-1">{n.base}</td>
                  <td className="px-2 py-1">{n.patch} <span className="text-muted">({n.actor})</span></td>
                  <td className={`px-2 py-1 tabular-nums ${neg ? "text-gap" : "font-bold text-batt"}`}>{pct1(x.rel)} [{pct1(x.relLo)}, {pct1(x.relHi)}]</td>
                  <td className="px-2 py-1 tabular-nums">{pct1(x.effLo)}~{pct1(x.effHi)}</td>
                  <td className="px-2 py-1 tabular-nums">{x.w}/{x.t}/{x.l}</td>
                  <td className="px-2 py-1 tabular-nums" title={c.closed.map((z) => `${causeLabel(z.cause).name} × ${CLASS_KO[z.cls]}`).join("\n")}>{c.robustBefore} → {c.robustAfter}곳</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[13px] text-muted">
        P1(개인 계획에 따른 조기 119 이송)은 공백을 줄이지 못했습니다. 계획 가구가 일찍 부르면 119 대기열이 먼저 차서 더 급한 가구의 차례가 밀립니다(붉은 행). 사전 배치(P2·P3·P7)는 모든 정전 원인에서 공백을 줄였고,
        개인 계획을 보조금 요건으로 거는 방식(P3)은 대상이 줄어 효과도 줄었습니다. 넣지 않은 것: P4 충전 순환(외장 재충전 모형 없음), P6·P8 사전 통지·충전(모형이 예보 사건을 이미 완충으로 둠), P5(답변서가 거부한 규칙). 수치는 사람 검수 전입니다.
      </p>
      {e.prereg ? (
        <p className="mt-2 text-[14px]">보완안 사전등록(S5) 예측 <strong>{e.prereg.hit}/{e.prereg.total}</strong> 맞힘 · 검증하지 않음: {e.prereg.notTested.join(", ")}</p>
      ) : null}
    </div>
  );
}

export default function LabPage() {
  const d = lab();
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 text-[16px] leading-7">
      <h1 className="text-[24px] font-extrabold">리허설 랩</h1>
      <p className="mt-1">같은 정전을 같은 난수로 정책만 바꿔 다시 돌려, 현행 절차의 빈틈과 도구가 닫는 빈틈·닫지 못하는 빈틈을 가릅니다. 모든 값은 합성 가구·가정 분포 위의 모의 결과입니다.</p>
      <nav aria-label="랩 탭" className="sticky top-8 z-10 mt-3 flex flex-wrap gap-2 bg-white/95 py-2 text-[14px]">
        <a className="rounded border border-line px-2 py-0.5" href="#map">② 빈틈 지도</a>
        <a className="rounded border border-line px-2 py-0.5" href="#compare">③ 도구 대 현행</a>
        <a className="rounded border border-line px-2 py-0.5" href="#breakeven">① 손익분기</a>
        <a className="rounded border border-line px-2 py-0.5" href="#patches">④ 보완안</a>
        <a className="rounded border border-line px-2 py-0.5" href="#prereg">⑥ 사전등록 대조</a>
      </nav>
      {!d ? (
        <p id="dominance" className="mt-4 rounded-lg border border-line p-3">봉인 실행 결과: <strong>{BEFORE_MEASURE}</strong></p>
      ) : (
        <>
          <Hero d={d} />
          <Section id="map" n="②" title="빈틈 지도: 어떤 가정에서도 남는 공백">
            <p className="mt-1 text-[14px]">
              칸마다 가정 범위(19개 축)를 라틴 하이퍼큐브로 {d.e1!.draws.toLocaleString("ko-KR")}번 뽑아, 그 기기 가구의 과반에 공백이 남은 추첨 비율을 셉니다. 견고 칸은 축 하나를 범위 끝에 고정해도 버티는지
              앞 {d.e1!.falsifyDraws}추첨으로 다시 확인했습니다(* = 뒤집히는 축이 있음, 칸에 마우스를 올리면 조건). CI는 {CI_NOTE}.
            </p>
            <ul className="mt-2 flex flex-wrap gap-2 text-[12px]">
              {(Object.keys(LABEL_KO) as LabE1Cell["label"][]).map((k) => (
                <li key={k} className="flex items-center gap-1"><span className={`${LABEL_KO[k].cls} inline-block w-10 rounded px-1 text-center font-bold`}>{LABEL_KO[k].short}</span>{LABEL_KO[k].desc}</li>
              ))}
            </ul>
            <GapGrid d={d} pol="KR_BASELINE" />
            <GapGrid d={d} pol="RULE" />
            {d.e1!.stability ? (
              <p className="mt-2 text-[13px] text-muted">
                안정성 시험(복구 분포를 같은 P10·P90의 로그정규로 교체): 현행 견고 칸 {d.e1!.stability.robustTotal}개 중 {d.e1!.stability.robustKept}개 유지 · 표지가 바뀐 칸 {d.e1!.stability.flipped.length}개 ·{" "}
                {d.e1!.stability.pass ? "통과" : "실패"}
              </p>
            ) : null}
          </Section>
          <Section id="compare" n="③" title="도구 대 현행: 어디서 효과가 나오는가">
            <Decomposition d={d} />
            <CellTable d={d} />
            <p className="mt-2 text-[13px] text-muted">
              승/무/패는 시나리오마다 &lsquo;공백이 남은 고위험 가구 수&rsquo;(M1) 비교, 감소율은 공백 가구·시간(M2) 합계 기준(1 − 원안 규칙/비교 정책). 판정: 승 &gt; 패이고 M2 짝 차이 평균의 부트스트랩 95% CI 상한 &lt; 0이면 우세.
              단순 규칙이 원안 규칙을 이긴 칸은 붉게 표시했습니다.
            </p>
            <details className="mt-2 text-[13px]">
              <summary className="cursor-pointer">절제·상한 비교(전체 합산)</summary>
              <ul className="mt-1 space-y-0.5">
                {Object.entries(d.e2!.pooled.compares).map(([k, c]) => (
                  <li key={k} className="tabular-nums">원안 규칙 대 {POLICY_KO[k] ?? k}: {cmpText(c)} [{pct1(c.relLo)}, {pct1(c.relHi)}] · {VERDICT_KO[c.v]}</li>
                ))}
                <li>정보 상한까지 갈 수 있는 개선 중 원안 규칙이 얻은 몫: {pct1(d.e2!.pooled.cap)}</li>
              </ul>
            </details>
          </Section>
          <Section id="breakeven" n="①" title="손익분기: 정전 길이별 공백 비율">
            <p className="mt-1 text-[14px]">실제 정전 길이(모의) 구간마다 그 기기 가구 중 공백이 남은 비율. 위는 현행 절차, 아래는 도구(원안 규칙). 배터리보다 긴 정전에서 공백이 시작되는 지점이 기기마다 다릅니다.</p>
            <BreakEven d={d} />
          </Section>
          <Section id="patches" n="④" title="보완안: 해외 절차를 얹고 다시 돌리면">
            <Patches d={d} />
          </Section>
          <Section id="prereg" n="⑥" title="사전등록 대조: 맞힌 것과 틀린 것">
            <Prereg d={d} />
          </Section>
          <p className="mt-6 text-[13px] text-muted">⑤ 반증 슬라이더: {BEFORE_MEASURE}</p>
        </>
      )}
      <p className="mt-6"><Link className="underline" href="/">← 처음으로</Link> · <Link className="underline" href="/ops?s=PRESET-SUWON">운영자 화면</Link></p>
    </main>
  );
}
