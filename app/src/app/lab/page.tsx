// /lab 리허설 랩 (spec.md 5.8절, 라운드 5). 정적 서버 컴포넌트. 숫자는 전부 src/data/lab.json(봉인 실행 집계)에서 나온다.
// 탭 ① 손익분기 ② 빈틈 지도 ③ 도구 대 현행 ④ 보완안 ⑦ 실측 정전시간 ⑥ 사전등록 대조. ⑤ 반증 슬라이더는 만들지 않음(레드팀 10/18: 미완 표시 제거).
import Link from "next/link";
import { aptCalib, BEFORE_MEASURE, c1Evidence, e119, e4Evidence, e5Evidence, e6Evidence, e7Evidence, gapDecomp, kpiOverPredict, lbV2, n1Evidence, n1Fresh } from "@/lib/evidence";
import { CAUSE_ORDER, causeLabel, cellParts, CLASS_KO, CLASS_ORDER, lab, pct1, type LabCmp, type LabDoc, type LabE1Cell } from "@/lib/lab";
import { PATCHES, type PatchId } from "@/lib/sim/patches";
import { pRange } from "@/lib/engine/params";

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
  const b2 = d.e2!.pooled.compares.B2_NEAREST;
  const hpr = pRange("sweep.hhPerResource");
  const sup = d.e2!.cells.filter((c) => c.kr.v === "SUPERIOR").length;
  const p0 = d.e2!.cells.filter((c) => c.pClass === "P0").length;
  const robustRule = d.e1!.cells.filter((c) => c.pol === "RULE" && c.label === "ROBUST" && !c.zero);
  return (
    <div className="mt-4 rounded-xl border border-line bg-paper p-4" data-testid="lab-hero">
      <p className="text-[15px] text-muted">합성 정전 {d.e2!.n.toLocaleString("ko-KR")}건을 같은 난수로 정책만 바꿔 다시 돌린 결과(모의정전). 비상전원이 가구 {hpr.lo}~{hpr.hi}곳당 1대 있다고 가정하고, 현행 절차에는 그 전원을 가구와 잇는 단계가 없습니다.</p>
      <p className="mt-1 text-[26px] font-extrabold leading-9">
        현행 절차보다 공백 가구·시간 <span className="text-batt">{pct1(kr.rel)} 감소</span>
      </p>
      <p className="text-[15px]">
        {d.e2!.cells.length}개 조건 중 <strong>{sup}개</strong>에서 우세 · 95% CI {pct1(kr.relLo)}~{pct1(kr.relHi)}(몬테카를로 추첨 오차만, 가정의 불확실성은 조건별 범위로)
      </p>
      <p className="mt-3 text-[15px] leading-6">
        단, 배터리 짧은 순·가까운 순 같은 단순 규칙과는 {d.e2!.cells.length}개 중 <strong>{p0}개</strong> 조건에서 차이가 없고{b2?.v === "INFERIOR" && b2.rel != null ? <>, 합산하면 가까운 순이 {pct1(-b2.rel)} 낫습니다</> : null}. 효과는 정교한 순서가 아니라
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
                      <div className="rounded px-1" style={heatStyle(pk)}>현행 {Math.round(pk * 100)}%</div>
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
        개인 계획을 보조금 요건으로 거는 방식(P3)은 대상이 줄어 효과도 줄었습니다. 넣지 않은 것: P4 충전 순환(외장 재충전 모형 없음), P6·P8 사전 통지·충전(모형이 예보 사건을 이미 완충으로 둠), P5(답변서가 &lsquo;짧은 순만 표시&rsquo;로는 충분하지 않다고 한 규칙). 보급률·고장률 같은 보완안 매개변수는 가정값이며 사람 검수 전입니다.
      </p>
      {e.prereg ? (
        <p className="mt-2 text-[14px]">보완안 사전등록(S5) 예측 <strong>{e.prereg.hit}/{e.prereg.total}</strong> 맞힘 · 검증하지 않음: {e.prereg.notTested.join(", ")}</p>
      ) : null}
    </div>
  );
}

function AptCalibNote() {
  const c = aptCalib();
  if (!c) return <p className="mt-2 text-[13px] text-muted" data-testid="apt-calib">실측 대조: {BEFORE_MEASURE}</p>;
  return (
    <p className="mt-2 rounded-lg border border-line p-2 text-[13px]" data-testid="apt-calib">
      <strong>실측 대조(사후, 봉인 아님).</strong> 위 지도의 아파트 원인 4종은 보도 사건에 맞춘 가정 분포입니다. 이 넷을 어떤 비중으로 섞어도 기후에너지환경부 최근 {c.years}년 아파트 정전 {c.n}건의
      정전시간 분포를 {c.consistent ? "재현했습니다" : "재현하지 못했습니다"}(G = {c.G.toFixed(1)}, 자유도 3, p {c.p < 0.001 ? "< 0.001" : `= ${c.p.toFixed(3)}`}). 12·24시간 초과 꼬리는 맞지만 3~6시간 구간이 실측 {c.counts[3]}건 대 모형 {Math.round(c.expected[3])}건으로 모자랍니다.
      그래서 실측 분포를 그대로 넣어 다시 돌렸습니다 → <a className="underline" href="#empirical">⑦</a>
    </p>
  );
}

const BIN_LABEL = (c: { binsUpperH: number[] }, i: number) => (i < c.binsUpperH.length ? `~${c.binsUpperH[i]}h` : `${c.binsUpperH[c.binsUpperH.length - 1]}h~`);

function Empirical() {
  const c = aptCalib(), e = e4Evidence();
  if (!c || !e) return <p className="mt-2 text-[14px]" data-testid="e4">실측 분포 재시뮬레이션: <strong>{BEFORE_MEASURE}</strong></p>;
  const max = Math.max(...c.counts);
  const row = (cls: "VENT_1H" | "VENT_3H") => {
    const r = e.hhGap[cls];
    return (
      <tr key={cls} className="border-t border-line tabular-nums">
        <th className="px-2 py-1 text-left font-normal">{CLASS_KO[cls]}</th>
        <td className="px-2 py-1 text-right">{pct1(r.KR_BASELINE)}</td><td className="px-2 py-1 text-right">{pct1(r.RULE)}</td><td className="px-2 py-1 text-right font-bold">{pct1(r["RULE+P7"])}</td>
      </tr>
    );
  };
  return (
    <div data-testid="e4">
      <p className="mt-1 text-[14px]">
        복구시간을 가정 분포 대신 <a className="underline" href={c.sourceUrl} target="_blank" rel="noreferrer">기후에너지환경부 집계({c.sourceDate} 보도자료 붙임)</a>의 아파트 정전 {c.n}건 분포로 바꾸고, 나머지 18개 가정 축은 그대로 둔 채
        {" "}{e.n.toLocaleString("ko-KR")}번 다시 돌렸습니다. 구간 안은 선형 보간, 24시간 초과 {c.gt24h}건은 24~72시간에 고르게 둔 것이 가정입니다. 계획자(도구)도 이 분포를 가정 범위로 봅니다.
      </p>
      <div className="mt-3 grid gap-1 text-[12px]" aria-label="정전시간별 건수">
        {c.counts.map((n, i) => (
          <div key={i} className="flex items-center gap-2 tabular-nums">
            <span className="w-14 text-right text-muted">{BIN_LABEL(c, i)}</span>
            <span className="inline-block h-3 rounded bg-ink/70" style={{ width: `${(n / max) * 60}%` }} />
            <span>{n}건</span>
          </div>
        ))}
      </div>
      <div className="mt-3 overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[420px] border-collapse text-[13px]">
          <caption className="px-2 py-1 text-left text-[14px] font-bold">전원 공백이 생긴 가구 비율(모의)</caption>
          <thead><tr className="text-muted"><th className="px-2 py-1 text-left font-normal">기기</th><th className="px-2 py-1 text-right font-normal">현행 절차</th><th className="px-2 py-1 text-right font-normal">도구</th><th className="px-2 py-1 text-right font-normal">도구 + 휴대용 배터리 사전 배치</th></tr></thead>
          <tbody>{row("VENT_1H")}{row("VENT_3H")}</tbody>
        </table>
      </div>
      <p className="mt-2 text-[14px]">
        도구는 공백 가구·시간을 {pct1(e.ruleVsKr.rel)} 줄였지만(95% CI {pct1(e.ruleVsKr.lo)}~{pct1(e.ruleVsKr.hi)}, 추첨 오차만. 계획자도 실측 분포를 아는 낙관 조건), 1시간급 인공호흡기 가구 중 공백이 생기는 비율은 줄이지 못했습니다. 공백을 짧게 할 뿐 막지는 못합니다.
        정전 전에 배터리를 가구에 미리 두어야 그 비율이 내려갑니다(도구 위 사전 배치: 공백 가구·시간 {pct1(e.p7.rel)} 추가 감소).
      </p>
      <p className="mt-1 text-[13px] text-muted">
        사전등록(S6, 결과 전 봉인) {e.prereg.hit}/{e.prereg.total} 맞힘.{" "}
        {e.prereg.missed.map((m) => `틀림 ${m.id}: ${m.text} → 실제 ${m.value}`).join(" · ")}
      </p>
    </div>
  );
}

function AiAndTarget() {
  const e = e5Evidence(), g = e6Evidence(), c1 = c1Evidence();
  if (!e || !g) return <p className="mt-2 text-[14px]" data-testid="e5">AI 판독 기여·표적 배치: <strong>{BEFORE_MEASURE}</strong></p>;
  const ci = (x: { rel: number | null; lo: number | null; hi: number | null }) => `${pct1(x.rel)}(95% CI ${pct1(x.lo)}~${pct1(x.hi)}, 추첨 오차만)`;
  const sig = (x: { lo: number | null; hi: number | null }) => x.lo != null && x.hi != null && (x.lo > 0 || x.hi < 0);
  // 판독 정확도 효과로 읽으려면 AI·완전 판독이 둘 다 판독 없음보다 유의하게 낫고, 완전 판독이 AI보다 못하지 않아야 한다(단조)
  const aiClear = sig(e.aiVsNo) && e.aiVsNo.rel! > 0 && sig(e.perfVsNo) && e.perfVsNo.rel! > 0 && e.perfVsNo.rel! >= e.aiVsNo.rel!;
  const ocr = c1?.tesseract ? pct1(c1.tesseract.dbMatchRate.k / c1.tesseract.dbMatchRate.n) : BEFORE_MEASURE;
  const KO: Record<string, string> = { VENT_1H: "1시간급 인공호흡기", VENT_3H: "3시간급 인공호흡기", VENT_8H: "8시간급 인공호흡기", VENT_8H_EXT2: "8시간급 + 외장", O2_STAT: "거치형 산소(배터리 없음)", O2_PORT: "휴대형 산소", O2_STAT_CYL: "거치형 산소 + 실린더" };
  const order = ["VENT_1H", "O2_STAT", "VENT_3H", "O2_PORT", "VENT_8H", "VENT_8H_EXT2", "O2_STAT_CYL"].filter((k) => g.hhGap[k]);
  return (
    <div data-testid="e5">
      <h3 className="mt-2 text-[16px] font-bold">AI 판독의 몫(E5, 봉인 S7)</h3>
      <p className="mt-1 text-[14px]">
        ⑦과 같은 실측 정전 분포에서 {e.n.toLocaleString("ko-KR")}번, 한 시나리오 안에서 &lsquo;기종을 모르는 가구 비율&rsquo;만 바꿨습니다: AI 판독(봉인 시험셋의 DB 등록 기종 자동 확정 실패율 {pct1(e.unknownRateAI)}), 판독 없음(전부 수동검토), 완전 판독(0).
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px]">
        <li>실측 판독 오류를 넣어도 도구는 현행 절차보다 공백 가구·시간을 {ci(e.aiVsKr)} 줄였습니다.</li>
        <li>판독 없음 대비: AI 판독 {ci(e.aiVsNo)}, 완전 판독 {ci(e.perfVsNo)}.{" "}
          {aiClear ? "판독이 정확할수록 공백이 줄었습니다." : "판독이 더 정확해도 공백이 단조롭게 줄지 않아, 판독 정확도의 공백 효과는 확인되지 않았습니다. 모르는 기종을 가장 짧은 배터리로 보수 계산하고 수동검토로 넘기는 설계가 판독 실패의 손해를 막고, 이 모형에는 검토 인력 한도가 없기 때문으로 보입니다(원인은 미확인)."}</li>
        <li>그래서 AI의 몫은 공백보다 수동검토 부담으로 봅니다: 봉인 시험셋 DB 등록 기종 자동 확정 AI {pct1(1 - e.unknownRateAI)}, OCR 기준선 {ocr}. 업무량 효과는 모형 밖이라 측정하지 않았습니다(가설).</li>
      </ul>
      <p className="mt-1 text-[13px] text-muted">
        예측(S7, 예측 커밋 뒤 실행) {e.prereg.hit}/{e.prereg.total} 맞힘.{" "}
        {e.prereg.missed.map((m) => `틀림 ${m.id}: ${m.text} → 실제 ${m.value}`).join(" · ")}
        {e.prereg.notScored.length ? ` · 판정 불가 ${e.prereg.notScored.map((m) => m.id).join(", ")}(완전 판독이 판독 없음보다 낫지 않아 전제가 깨짐. 사전등록 문구를 문언대로 계산하면 '맞음'이지만 집계하지 않음)` : null}
      </p>
      <h3 className="mt-4 text-[16px] font-bold">기록 기반 표적 사전 배치(E6, 봉인 S8)</h3>
      <p className="mt-1 text-[14px]">
        같은 양의 휴대용 배터리(보급률 가정)를 무작위가 아니라 정전 전 등록부 정보(기종 사양·연식·외장 신고, 충전량 모름. 기종은 평시 수동검토로 모두 확인됐다고 가정)로 계산한 배터리 하한이 짧은 집부터 두었습니다.
        무작위보다 공백 가구·시간이 {ci(g.preVsRand)}{sig(g.preVsRand) && g.preVsRand.rel! > 0 ? " 더 줄었습니다" : " 달라졌습니다(유의하지 않음)"}.
        정전 중 신고 시각·충전량까지 알고 고르면(낙관 상한, E5 방식) {ci(g.outVsRand)}입니다.
      </p>
      <div className="mt-3 overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[420px] border-collapse text-[13px]">
          <caption className="px-2 py-1 text-left text-[14px] font-bold">전원 공백이 생긴 가구 비율(모의, 도구 + 사전 배치)</caption>
          <thead><tr className="text-muted"><th className="px-2 py-1 text-left font-normal">기기</th><th className="px-2 py-1 text-right font-normal">무작위 배치</th><th className="px-2 py-1 text-right font-normal">평시 기록 기반 표적</th></tr></thead>
          <tbody>{order.map((k) => (
            <tr key={k} className="border-t border-line tabular-nums">
              <th className="px-2 py-1 text-left font-normal">{KO[k] ?? k}</th>
              <td className="px-2 py-1 text-right">{pct1(g.hhGap[k].rand)}</td>
              <td className={`px-2 py-1 text-right font-bold ${g.worse.includes(k) ? "text-gap" : ""}`}>{pct1(g.hhGap[k].pre)}{g.worse.includes(k) ? " ▲" : ""}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="mt-1 text-[13px]">▲ = 표적 배치로 오히려 늘어난 기기({g.worse.map((k) => KO[k] ?? k).join(", ")}). 배터리가 짧은 집에 몰아주는 맞바꿈입니다.</p>
      <p className="mt-1 text-[13px] text-muted">
        예측(S8, 예측 커밋 뒤 실행) {g.prereg.hit}/{g.prereg.total} 맞힘. 단 레드팀이 봉인 E5 시드 400추첨으로 같은 평시 순위의 효과를 먼저 보고한 뒤 쓴 예측이라 &lsquo;실행 전 예측&rsquo;이 아니라 &lsquo;사전 분석 뒤 확인&rsquo;으로 셉니다.{g.prereg.missed.length ? " " + g.prereg.missed.map((m) => `틀림 ${m.id}: ${m.text} → 실제 ${m.value}`).join(" · ") : ""}
      </p>
    </div>
  );
}

function NoticeCheck() {
  const n = n1Evidence();
  if (!n) return <p className="mt-2 text-[14px]" data-testid="n1">보호자 알림 검사: <strong>{BEFORE_MEASURE}</strong></p>;
  const r = (x: { k: number; n: number; lo: number | null; hi: number | null }) => `${x.k}/${x.n}(${pct1(x.k / x.n)}, 95% ${pct1(x.lo)}~${pct1(x.hi)})`;
  const KO: Record<string, string> = {
    time_value: "시각 값", date_shift: "날짜 밀기", time_role_swap: "시각 맞바꿈", time_meaning: "시각 뜻(까지→이후 등)", negation: "부정", warning_flip: "경고 뒤집기",
    late_flip: "늦음 뒤집기", state_flip: "배터리·산소통 상태 뒤집기", means_wrong: "수단 틀림", resource_name_wrong: "수단·기기 이름 틀림", extra_instruction: "정하지 않은 지시",
    contradict_tail: "119·123 문장과 어긋남", reassurance: "안심 약속", medical_or_device: "의료·기기 조작", risky_action: "위험 행동", omission_by_meaning: "뜻으로 빠뜨림",
    subtle_paraphrase_error: "미묘한 바꿔쓰기 오류", switch_not_now: "산소통 교체 미룸",
    // 작성자 범주 이름 resource_name_wrong에는 수단 덧붙임(t061)과 기기 이름 틀림(t062)이 함께 들어 있다
  };
  return (
    <div data-testid="n1">
      <p className="mt-1 text-[14px]">
        원안의 &lsquo;쉬운 글·음성·보호자 알림&rsquo;입니다. 담당자 결정 뒤 사실(시각·수단·경고)과 할 일은 코드가 정하고, AI(Claude Sonnet)는 쉬운 문장만 씁니다.
        1차로 규칙이 글자를, 2차로 다른 AI(Claude Opus)가 사실표 없이 글만 읽고 뽑은 내용을 규칙이 결정 기록과 대조합니다. 둘 다 맞을 때만 AI 글이, 아니면 고정 문안이 담당자 확인 후보가 됩니다(시연용·담당자 확인 뒤 발송, 실제 발송 기능 없음). 119·123 문장은 늘 고정입니다.
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px]">
        <li>개발 세션이 띄운 Claude Opus 레드팀 에이전트가 틀리게 쓴 글 {n.badMissed.n}건(라벨은 작성자 판단, 범주 예시와 작성 중 유형 일부는 개발 세션이 제안, 내용은 봉인 실행 전 미열람) 중 두 검사를 모두 통과한 글: <strong>{r(n.badMissed)}</strong>. 2차 검사도 Opus라 맹점이 겹쳐 실제보다 적게 놓쳤을 수 있습니다. 1차 검사만이면 {n.badCaughtGate1.k}건, 2차 검사만이면 {n.badCaughtGate2.k}건을 막았습니다.
          {n.missedCategories.length ? ` 놓친 범주: ${n.missedCategories.map((m) => `${KO[m.category] ?? m.category} ${m.missed}/${m.n}`).join(", ")}.` : ""}</li>
        <li>같은 모음의 맞는 글 {n.goodFalseReject.n}건 중 잘못 막은 글: {r(n.goodFalseReject)}. 막히면 고정 문안이 후보가 되므로 안내가 끊기지는 않습니다.</li>
        <li>봉인 시험셋 {n.aiSent.n}건(봉인 커밋 뒤 공개 난수로 만든 결정 장면)에서 AI 글이 그대로 나간 비율: {r(n.aiSent)}. 고정 문안을 2차 검사가 잘못 막은 비율 {r(n.templateFalseReject)}(봉인 당시 고정 문안 {n.judgeSplit?.contradiction.n ?? "—"}건은 스스로 모순이었는데 이것도 통과시킨 값 — 아래). 나간 AI 글 중 {n.judgeSplit?.aiSameTime.n ?? "—"}건도 &lsquo;X까지 버팁니다 / X까지 도착 / 먼저 떨어질 수 있다&rsquo;의 같은 시각 경고 모순이었습니다(봉인 당시 검사는 통과. 지금은 &lsquo;배터리가 계산보다 일찍 떨어지면 도착 전에 기기가 멈출 수 있습니다&rsquo;로 쓰고 &lsquo;늦어지면&rsquo; 조건은 거부).{n.extUndisclosed ? ` 또 ${n.extUndisclosed.k}건은 확인 외장 배터리가 합쳐진 시간을 기기 배터리만의 시간처럼 썼고(봉인 뒤 고침), AI 글이 탈락해 나간 고정 문안 ${n.judgeSplit?.sentContradiction ?? "—"}건도 모순이었습니다. ${n.unsupportedPromise?.length ? ` 평시 AI 글 ${n.unsupportedPromise.length}건(${n.unsupportedPromise.join("·")})은 사실에 없는 ‘다시 알려 드립니다’ 약속을 썼습니다.` : ""}${n.marginMissed?.length ? ` 지금 경고 기준이면 경고가 붙었을 텐데 경고 없이 나간 AI 글도 ${n.marginMissed.length}건(${n.marginMissed.join("·")})입니다.` : ""} 나간 글 ${n.aiSent.n}건 중 봉인 뒤 결함 판정 ${n.sentDefects ?? "—"}건(중복 없이). 그 밖에 봉인 당시 글은 모두 배터리 시각을 단서 없이 썼습니다(‘적어도’ 보장 표현만 있는 나간 글 ${n.atLeastOnly?.length ?? "—"}건은 표현 기준을 바꾼 것이라 결함 수에 넣지 않음, 합치면 ${(n.sentDefects ?? 0) + (n.atLeastOnly?.length ?? 0)}건).` : ""} 지금은 배터리·산소통 시각에 &lsquo;적어도&rsquo;를 쓰지 않고 &lsquo;계산값이라 더 일찍 떨어질 수 있습니다&rsquo;를 늘 붙이며, 표시 도착이 보호 수단(산소통이 있으면 산소통, 없으면 배터리) 끝보다 늦으면 &lsquo;오기 전에 먼저 떨어질 수 있습니다&rsquo;, 끝과 같거나 30분 안에서 이르면 &lsquo;계산보다 일찍 떨어지면 도착 전에 멈출 수 있습니다&rsquo;로 경고합니다(⑥ 사후 집계: 하한이 모의 실제보다 긴 경우 {(() => { const k = kpiOverPredict(); return k ? `${((100 * k.rule.k) / k.rule.n).toFixed(1)}%` : "—"; })()}). 지연 중앙값 {n.latencyP50 != null ? `${(n.latencyP50 / 1000).toFixed(1)}초` : "—"}(생성+검사).</li>
        <li>AI 글이 고정 문안보다 쉬운가(탐색, Opus 눈가림 판정, 같은 사실 항목{n.judgeSplit ? ` — 다만 AI 글은 배터리·산소통 시각 문장 ${n.judgeSplit.atLeastDropped.n}개 중 ${n.judgeSplit.atLeastDropped.k}개에서 '적어도'를 뺐습니다` : ""}): AI {n.judge.ai} · 고정 문안 {n.judge.template} · 같음 {n.judge.same}. 예측(AI ≤ 고정)은 틀렸고, 차이는 우연 범위입니다{n.judgeSplit ? `(부호검정 p≈${n.judgeSplit.signP.toFixed(1)})` : ""}. {n.judgeSplit ? `사후 분석: 봉인 당시 고정 문안 ${n.aiSent.n}건 중 ${n.judgeSplit.contradiction.n}건은 '적어도 …까지 버팁니다' 뒤에 '먼저 떨어질 수 있다'가 오는 모순이었고(119 경고, 또는 표시 도착이 보호 끝보다 늦지 않은 경고. 봉인 뒤 고침), 그중 쌍 비교가 된 ${n.judgeSplit.contradiction.judged}쌍은 AI ${n.judgeSplit.contradiction.ai} · 고정 ${n.judgeSplit.contradiction.template} · 같음 ${n.judgeSplit.contradiction.same}, 나머지 쌍은 AI ${n.judgeSplit.rest.ai} · 고정 ${n.judgeSplit.rest.template} · 같음 ${n.judgeSplit.rest.same}입니다. AI 글 쪽 같은 시각 경고 ${n.judgeSplit.aiSameTime.n}쌍은 AI ${n.judgeSplit.aiSameTime.ai} · 고정 ${n.judgeSplit.aiSameTime.template} · 같음 ${n.judgeSplit.aiSameTime.same}이고, 그중 ${n.judgeSplit.aiSameTime.inContradiction}쌍은 위 모순 쌍에도 듭니다(양쪽 모두 모순). 고정 문안만 모순인 쌍은 AI ${n.judgeSplit.contradiction.ai - n.judgeSplit.aiSameTime.ai} · 고정 ${n.judgeSplit.contradiction.template - n.judgeSplit.aiSameTime.template} · 같음 ${n.judgeSplit.contradiction.same - n.judgeSplit.aiSameTime.same}입니다. ` : ""}AI 글이 더 쉽다는 근거는 없습니다. 내용을 코드가 정하면 문장만 바꿔 얻는 이득은 작습니다. 사람 평가는 하지 않았습니다.</li>
      </ul>
      {n.examples.length > 0 && (
        <div className="mt-3" data-testid="n1-examples">
          <h3 className="text-[15px] font-bold">봉인 측정 때 AI가 쓴 글(검사 통과, 기록)</h3>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {n.examples.map((e) => (
              <div key={e.id} className="rounded border border-line p-2 text-[14px]">
                <p className="text-[12px] text-muted">{e.label} · {e.id}</p>
                <ol className="mt-1 space-y-0.5">{e.sentences.map((s, i) => <li key={i}>{s}</li>)}</ol>
              </div>
            ))}
          </div>
          <p className="mt-1 text-[12px] text-muted">실시간 생성은 하루 한도가 있습니다. 한도에 걸려도 위 기록으로 AI 글을 볼 수 있습니다. 마지막 두 문장(119·123)은 늘 고정 문장입니다. 봉인 당시 기록이라 지금 규칙과 다를 수 있습니다(지금은 고정 문안이 시각을 &lsquo;계산상&rsquo;으로 쓰고 AI 글의 &lsquo;적어도&rsquo;·&lsquo;최소한&rsquo;은 거부하며 &lsquo;계산값이라 더 일찍 떨어질 수 있습니다&rsquo; 문장이 늘 붙고, 119 → 123 순서, 평시에는 갈 곳·절전 고정 문장이 붙고, 확인 외장 배터리가 합쳐진 시간이면 &lsquo;외장 배터리까지 합쳐&rsquo;라고 쓰고, 휴대용 산소발생기에서 기기 배터리 몫의 계산 끝이 10분 안이거나 지났으면 &lsquo;기기 배터리는 이미 떨어졌을 수 있습니다 / 집에 있는 외장 배터리가 꽂혀 있는지 확인하세요&rsquo; 고정 문장이 붙음 — 이 두 문장은 검사를 거치지 않는 코드 문장). 봉인 시험셋은 봉인 커밋 뒤 공개된 drand 난수로 만들었지만, 비트코인 증명은 실행 도중(시작 약 14분 뒤)에 확정돼, 순서의 근거는 git 커밋 시각(자기 기록)과 OTS 캘린더 접수(서명 없음)뿐입니다. 다른 봉인(S4~S8)도 블록이 실행 시작 뒤입니다(seal/CHANGELOG.md).</p>
        </div>
      )}
      <p className="mt-1 text-[13px] text-muted">
        검사가 보는 범위: 시각 표기·날짜, 수단과 이름, 먼저 떨어질 수 있다는 경고, 늦음, 할 일(정해진 것만), 안심 약속·의료·기기 조작·위험 행동. 문장의 모든 뜻을 보장하지는 않습니다(2차 검사도 AI).
        예측(S9, dev를 보고 정한 문턱이라 &lsquo;확인&rsquo;으로 셈) {n.prereg.hit}/{n.prereg.total} 맞힘({n.prereg.structural.map((x) => x.id).join(", ")}는 사전등록 때 &lsquo;구조상 보장 확인 항목&rsquo;으로 표시한 것이라 집계에서 뺌, 넣으면 {n.prereg.hit + 1}/{n.prereg.total + 1}).{n.prereg.missed.length ? " " + n.prereg.missed.map((m) => `틀림 ${m.id}: ${m.text}(봉인 원문) → 실제 ${m.value}`).join(" · ") : ""}
        {" "}위 수치는 봉인 당시 검사(n1-check-v6) 결과입니다. 지금 화면에서 쓰는 검사는 봉인 뒤 놓친 4건 등을 반영해 고친 버전입니다.{(() => { const f = n1Fresh(); return f ? ` 이 검사(${f.versions.check})를 10/30 처음 새 사례로 쟀습니다(사후·탐색 측정, 독립 에이전트가 쓴 모음 100건): 틀린 글 통과 ${f.badMissed.k}/${f.badMissed.n}(95% ${(100 * (f.badMissed.lo ?? 0)).toFixed(1)}~${(100 * (f.badMissed.hi ?? 0)).toFixed(1)}%), 맞는 글 잘못 막음 ${f.goodFalseReject.k}/${f.goodFalseReject.n}. 같은 Claude 계열이 쓴 사례라 맹점이 겹칠 수 있습니다.` : " 새 사례로 측정하지 않았습니다."; })()}
      </p>
    </div>
  );
}

/** 실패 가정 점검(10/30): 남는 공백 분해(사후) → 평시 산소통·인공호흡기 먼저(E7, 봉인 S10) → 하한 v2·119 실측(사후) */
function Premortem() {
  const g = gapDecomp(), e = e7Evidence(), v = lbV2(), a = e119();
  const ci = (x: { rel: number | null; lo: number | null; hi: number | null }) => `${pct1(x.rel)}(95% CI ${pct1(x.lo)}~${pct1(x.hi)})`;
  const h = (x: number) => `${x.toFixed(1)}시간`;
  return (
    <div data-testid="premortem">
      <p className="mt-1 text-[14px]">&lsquo;이 작품이 실패했다면 왜일까&rsquo;를 먼저 가정하고 다시 잰 결과입니다. 모두 합성 가구 위 모의이며, 봉인(S10) 실험과 사후 집계(사전등록 밖)를 나눠 표시합니다.</p>
      <h3 className="mt-3 text-[16px] font-bold">남는 공백은 어디서 나오는가(사후 집계)</h3>
      {g ? (
        <p className="mt-1 text-[14px]">
          봉인 E2 시드 {g.runs.toLocaleString("ko-KR")}회를 다시 돌려(봉인 값과 {g.mismatch === 0 ? "모두 일치" : `${g.mismatch}건 불일치`}) 도구를 써도 남는 공백 가구·시간 {h(g.ruleGapHPerRun)}/실행을 나눴습니다. 배터리 없는 거치형 산소발생기 가구가 {pct1(g.byClassShare.O2_STAT)}, 미등록 가구가 {pct1(g.byClassShare.UNREG)}입니다(모의). 정전과 동시에 공백이 시작되는 가구라, 정전 뒤 처리 순서를 바꾸는 탐색(개발 시드)에서는 줄이기 어려웠습니다. 같은 기기에 산소통이 있는 가구는 실행당 {h(g.byClassHPerRun.O2_STAT_CYL ?? 0)}만 남았습니다(가구 수가 달라 인과 추정은 아님).
        </p>
      ) : <p className="mt-1 text-[14px]">{BEFORE_MEASURE}</p>}
      <h3 className="mt-3 text-[16px] font-bold">평시 산소통과 &lsquo;배터리는 인공호흡기 먼저&rsquo;(E7, 봉인 S10)</h3>
      {e ? (
        <>
          <p className="mt-1 text-[14px]">영국 NHS 가정산소처럼 산소 기기 가구에 예비 산소통(10시간)을 두고, 배터리는 같은 개수를 인공호흡기 가구에 먼저 줍니다. <strong>AI가 아닌 평시 보급 정책의 효과</strong>입니다. 등록부는 기기 등급을 고르게 뽑아 인공호흡기가 실제 비율보다 많고, 보급률·고장률은 가정입니다.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px]">
            <li>같은 산소통·같은 배터리 개수에서 배터리를 인공호흡기 가구에 먼저 주면 모의 공백 {ci(e.compares.noOverlap)} 감소. 이 감소 시간 중 산소통 때문에 생기는 몫은 {ci(e.cylShare.strat)}입니다(나머지는 배터리가 인공호흡기에서 더 오래 가서, 모의). 등급을 고르게 뽑지 않은 등록부에서는 {ci(e.compares.uNoOverlap)}입니다(모의).</li>
            <li>산소 기기 가구 전원(60가구 중 평균 {(e.usedMean["RULE+CYL10S"]?.[0] ?? 0).toFixed(0)}개)에 산소통만 두면 도구의 모의 공백 {ci(e.compares.cylVsNone)} 감소(보호자 자기신고가 늘 맞다고 가정). 등급을 고르게 뽑지 않은 등록부 {ci(e.compares.uCylVsNone)}, 보급률을 배터리와 같게 제한하면 {ci(e.compares.cylCovVsNone)}입니다(모의).</li>
            <li>E6 표적 배터리 대비 맞춤 조합(산소통이 더해진 비교)은 {ci(e.compares.matchedVsBattery)} 감소입니다(모의). 같은 개수끼리는 표적 산소통이 배터리보다 {ci(e.compares.cylKVsBattery)} 낫습니다(모의).</li>
            <li>AI의 몫: 등록부가 라벨로만 기종을 안다면 AI 판독이 OCR보다 {ci(e.compares.aiVsOcr)} 낫지만, 보호자가 기기 종류만 체크해도 AI 판독만보다 {ci(e.compares.selfVsAi)} 낫습니다(모의). 산소통 보급에는 AI 판독이 필요 없습니다.</li>
            <li>모의 공백 가구 비율(E6 배터리 → 맞춤 조합): 배터리 없는 산소발생기 {pct1(e.hhGap.O2_STAT?.battery)} → {pct1(e.hhGap.O2_STAT?.matched)}, 1시간급 인공호흡기 {pct1(e.hhGap.VENT_1H?.battery)} → {pct1(e.hhGap.VENT_1H?.matched)}.</li>
          </ul>
          <p className="mt-1 text-[14px]">실현 경로: 국내 가정산소치료는 건강보험공단에 등록한 업체가 산소발생기를 대여하고, 등록 기준(요양비 고시 별표 2)은 업체에 365일 24시간 콜센터와 응급상황에 즉각 대처하는 전국 조직망, 전원 중단 경보를 요구합니다. 이 업체를 평시 예비 산소통 보급 경로로 쓸 수 있는지, 산소통이 요양비 대상인지는 확인하지 못했습니다(도상훈련 과제).</p>
          <p className="mt-1 text-[13px] text-muted">E7 사전등록 {e.prereg.hit}/{e.prereg.total}(예비 실행을 보고 문턱을 정한 확인 항목이라 다른 사전등록과 따로 셉니다){e.prereg.missed.length ? ` · 틀림: ${e.prereg.missed.map((x) => x.id).join(", ")}` : ""}{e.prereg.structuralMissed.length ? ` · 구조 확인 틀림: ${e.prereg.structuralMissed.map((x) => x.id).join(", ")}` : ""}. 봉인 전 레드팀 4라운드(prereg/predictions_e7.md).</p>
        </>
      ) : <p className="mt-1 text-[14px]" data-testid="e7">E7 봉인 실행: <strong>{BEFORE_MEASURE}</strong></p>}
      <h3 className="mt-3 text-[16px] font-bold">배터리 하한 v2(운영 화면, 사후 집계)</h3>
      {v ? (
        <p className="mt-1 text-[14px]">제조사 설명서의 최악 조건(최상 8시간 대비 4시간 이상)을 반영해 설정표 없는 기기의 정격에 ½을 곱했습니다. 봉인 E2 시드에서 표시 하한이 모의 실제보다 긴 경우 {pct1(v.v1.k / v.v1.n)} → {pct1(v.v2.k / v.v2.n)}, 가장 크게 넘친 폭 {v.v1.overH ? h(v.v1.overH.max) : "—"} → {v.v2.overH ? h(v.v2.overH.max) : "—"}, 공백 변화 {v.gapDiffHPerRun.toFixed(2)}시간/실행(차이 없음). 모의 실제의 설정 계수 하한도 ½이라 설정 때문에 넘치는 경우가 없어지는 것은 구성상 결과이고(감소의 대부분), 남은 경우는 노후·외장 고장·충전 입력입니다. ½의 근거는 한 기종 설명서라 다른 기종에는 가정입니다. 시뮬레이션 실험(E1~E7)은 봉인 당시 하한(v1)으로 돌립니다.</p>
      ) : <p className="mt-1 text-[14px]">{BEFORE_MEASURE}</p>}
      <h3 className="mt-3 text-[16px] font-bold">119 도착 실측으로 다시(사후 집계)</h3>
      {a ? (
        <p className="mt-1 text-[14px]">소방청 전국 구급 현황 {a.year}년 {a.n.toLocaleString("ko-KR")}건의 신고→현장 도착은 중앙값 {a.p50Min.toFixed(1)}분, 90% {a.p90Min.toFixed(1)}분으로, 모의 가정(10~30분 × 지연 배수 1~4)보다 짧습니다. 이 실측(평시)으로 바꿔도 도구의 남는 공백은 {h(a.assumed.ruleGapHPerRun)} → {h(a.empirical.ruleGapHPerRun)}/실행, 그중 119 경로 {h(a.assumed.rule119H)} → {h(a.empirical.rule119H)}에 그칩니다. 남는 공백은 도착 시간보다 다른 경로(119 처리 용량 가정 등)에서 나오는 것으로 보이나, 용량은 실측 자료가 없어 확인하지 못했습니다. 꼬리는 60분에서 잘랐습니다(실측에서 60분을 넘는 출동은 1,000건 중 4건꼴). 모의에서 도구 대 현행 {pct1(a.empirical.toolVsKr)} 감소, 가까운 순과는 차이 없음({pct1(a.empirical.toolVsNearest)})으로 결론은 같습니다. 실측은 평시 값이라 대규모 정전의 수요 폭증을 담지 않습니다.</p>
      ) : <p className="mt-1 text-[14px]">{BEFORE_MEASURE}</p>}
    </div>
  );
}

/** 원안 KPI '과대예측 0건'(사후 집계, 통합 레드팀 8라운드) */
function KpiOver() {
  const k = kpiOverPredict();
  if (!k) return null;
  const p = (x: number, n: number) => `${((100 * x) / n).toFixed(1)}%`;
  const c = k.rule.cause;
  return (
    <p className="mb-2 rounded border border-line p-2 text-[14px]">
      원안 KPI &lsquo;과대예측 0건&rsquo;(사후 집계, 사전등록 밖): 봉인 E2 시드 {k.runs.toLocaleString()}회를 다시 돌리면(공백 지표는 봉인 값과 {k.mismatch === 0 ? "모두 일치" : `${k.mismatch}회 불일치`}) 표시 배터리 하한이 모의 실제보다 긴 경우가 도구 {k.rule.k.toLocaleString()}/{k.rule.n.toLocaleString()} 가구·회({p(k.rule.k, k.rule.n)}), 현행 {p(k.baseline.k, k.baseline.n)}입니다(현행 수치는 같은 엔진 하한을 현행 절차 가구에 적용해 본 값이며 현행 화면에는 하한 표시가 없음, 분모는 하한이 계산된 가구). 목표 0건에 못 미칩니다. 넘는 폭은 중앙값 {Math.round(k.rule.overH.p50 * 60)}분, 상위 10% {k.rule.overH.p90.toFixed(1)}시간 이상, 최대 {k.rule.overH.max.toFixed(1)}시간입니다. 원인(겹치면 앞의 것): 확인 외장 고장 {c.extFailed.toLocaleString()}, 입력 충전량 100%(과대입력 주입 포함) {c.charge100.toLocaleString()}, 그 밖(모의 실제의 노후·설정 계수가 엔진 가정보다 낮음 등) {c.other.toLocaleString()}. 모의는 이런 오차를 일부러 넣었고, 하한이 &lsquo;틀릴 수 없는 값&rsquo;은 아닙니다. 이 값은 봉인 당시 하한(v1)이며, 운영 화면은 10/30부터 하한 v2를 씁니다(⑩).
    </p>
  );
}

/** 빈틈 지도 칸 색: 진하기는 비율이 클수록 진해진다(단조 증가). 글자 대비 4.5:1(WCAG AA)을 지키도록 검은 글자는 진하기 0.68까지,
 *  그보다 진하면 진하기를 0.79 이상으로 올려 흰 글자를 쓴다(0.68~0.79 진하기에서는 어느 글자색도 4.5:1에 못 미친다).
 *  그래서 비율 약 75~89% 칸은 같은 진하기(0.79)로 보인다. 칸 안의 % 숫자가 정확한 값이다 */
function heatStyle(pk: number): { background: string; color?: string } {
  const a = 0.08 + 0.8 * pk;
  return a <= 0.68 ? { background: `rgba(180,35,24,${a.toFixed(2)})` } : { background: `rgba(180,35,24,${Math.max(a, 0.79).toFixed(2)})`, color: "#fff" };
}

export default function LabPage() {
  const d = lab();
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 text-[16px] leading-7">
      <h1 className="text-[24px] font-extrabold">리허설 랩</h1>
      <p className="mt-1">같은 정전을 같은 난수로 정책만 바꿔 다시 돌려, 현행 절차의 빈틈과 도구가 닫는 빈틈·닫지 못하는 빈틈을 가릅니다. 모든 값은 합성 가구·가정 분포 위의 모의 결과입니다.</p>
      <nav aria-label="랩 탭" className="sticky top-[calc(var(--banner-h,29px)+3px)] z-10 mt-3 flex flex-wrap gap-2 bg-white/95 py-2 text-[14px]">
        <a className="rounded border border-line px-2 py-0.5" href="#map">② 빈틈 지도</a>
        <a className="rounded border border-line px-2 py-0.5" href="#compare">③ 도구 대 현행</a>
        <a className="rounded border border-line px-2 py-0.5" href="#breakeven">① 손익분기</a>
        <a className="rounded border border-line px-2 py-0.5" href="#patches">④ 보완안</a>
        <a className="rounded border border-line px-2 py-0.5" href="#empirical">⑦ 실측 분포</a>
        <a className="rounded border border-line px-2 py-0.5" href="#ai-target">⑧ AI 판독·표적 배치</a>
        <a className="rounded border border-line px-2 py-0.5" href="#notice">⑨ 보호자 알림</a>
        <a className="rounded border border-line px-2 py-0.5" href="#premortem">⑩ 실패 가정 점검</a>
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
            <AptCalibNote />
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
          <Section id="empirical" n="⑦" title="실측 정전시간으로 다시: 정부 집계 382건">
            <Empirical />
          </Section>
          <Section id="ai-target" n="⑧" title="AI 판독의 몫과 기록 기반 표적 배치">
            <AiAndTarget />
          </Section>
          <Section id="notice" n="⑨" title="보호자 알림: AI 문장과 두 단계 검사">
            <NoticeCheck />
          </Section>
          <Section id="premortem" n="⑩" title="실패 가정 점검: 남는 공백과 평시 대비">
            <Premortem />
          </Section>
          <Section id="prereg" n="⑥" title="사전등록 대조: 맞힌 것과 틀린 것">
            <KpiOver />
            <Prereg d={d} />
          </Section>
        </>
      )}
      <p className="mt-6"><Link className="underline" href="/">← 처음으로</Link> · <Link className="underline" href="/ops?s=PRESET-SUWON">운영자 화면</Link></p>
    </main>
  );
}
