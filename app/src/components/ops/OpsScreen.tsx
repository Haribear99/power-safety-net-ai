"use client";
// /ops 운영자 화면 (spec.md 1.4절). 계산·배정은 비AI 규칙(RULE)이며, 모든 결과는 PROPOSED다. 확정은 승인 서랍에서 사람만 한다(I6).
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Lane } from "@/lib/domain/types";
import { RESTORATION_LABEL } from "@/lib/domain/types";
import { computeLowerBoundDetail } from "@/lib/engine/lowerBound";
import { sToH } from "@/lib/engine/quantize";
import { renderReason, type Reason } from "@/lib/alloc/reasons";
import { DEVICE_CLASS_LABEL } from "@/lib/alloc/project119";
import type { AllocRow } from "@/lib/alloc/rule";
import { DB, deviceClass, nowIso, setNotice, type Session } from "@/lib/ops/session";
import { presetAb } from "@/lib/evidence";
import { PRESETS, SPEEDS, useOps } from "./OpsProvider";
import { ApproveDrawer } from "./ApproveDrawer";
import { AuditLog, OmissionAudit, ResourcePanel } from "./SidePanels";
import { FLAG_KO, h2, LANE_KO, LANE_ORDER, LANE_TONE } from "./labels";

export function OpsScreen() {
  const params = useSearchParams();
  const { session, load, presetId } = useOps();
  const want = params.get("s") ?? presetId ?? "PRESET-SUWON";
  useEffect(() => {
    if (!session || session.preset.meta.scenarioId !== want) load(want);
  }, [want, session, load]);
  if (!session) return <main className="p-6 text-[16px]">시나리오를 불러오는 중…</main>;
  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-16">
      <TopBar />
      <AbStrip scenarioId={session.preset.meta.scenarioId} />
      {session.started ? <Board /> : <BeforeOutage />}
    </main>
  );
}

function clock(s: Session): string {
  const iso = nowIso(s);
  return iso.slice(11, 16);
}

function TopBar() {
  const { session, speed, setSpeed, startOutage, latencyMs, update } = useOps();
  const router = useRouter();
  const s = session!;
  const elapsed = sToH(s.nowS) - s.preset.planner.tOutage;
  const [eta, setEta] = useState("");
  const [sigma, setSigma] = useState("0.3");
  return (
    <header className="sticky top-[var(--banner-h,29px)] z-40 -mx-4 border-b border-line bg-white px-4 py-3 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-[22px] font-extrabold text-brand-strong">운영자 화면</h1>
        <label className="flex items-center gap-2 text-[15px]">
          <span className="text-muted">시나리오</span>
          <select className="rounded-xl border border-line bg-white px-3 py-1.5" value={s.preset.meta.scenarioId}
            onChange={(e) => router.replace(`/ops?s=${e.target.value}`)}>
            {PRESETS.map((p) => <option key={p.meta.scenarioId} value={p.meta.scenarioId}>{p.meta.name}</option>)}
          </select>
        </label>
        {!s.started ? (
          <button type="button" onClick={startOutage} data-testid="start-outage"
            className="press rounded-xl bg-gap px-5 py-2 text-[16px] font-bold text-white shadow-[var(--shadow-raised)]">모의 정전 발생</button>
        ) : (
          <span className="rounded-full bg-gap-soft px-3 py-1 text-[14px] font-semibold text-gap">정전 중 · 경과 {h2(elapsed)}h</span>
        )}
        <div className="flex items-center gap-1 text-[14px]" role="group" aria-label="모의 시계 배속">
          <span className="text-muted">모의시각 <strong className="text-ink" data-testid="mock-clock">{clock(s)}</strong></span>
          {SPEEDS.map((v) => (
            <button key={v} type="button" disabled={!s.started} aria-pressed={speed === v} onClick={() => setSpeed(v)} data-testid={`speed-${v}`}
              className={`rounded-full border px-2.5 py-0.5 ${speed === v ? "border-brand bg-brand text-white" : "border-line bg-white"} disabled:opacity-40`}>
              {v === 0 ? "정지" : `×${v}`}
            </button>
          ))}
        </div>
        <span className="text-[14px] text-muted" data-testid="latency">정전→순위 표시 지연 {latencyMs != null ? `${latencyMs}ms` : "—"}(실측)</span>
        <Link href="/ops/119" className="press ml-auto rounded-xl border border-restore bg-white px-3 py-1.5 text-[15px] font-semibold text-restore" data-testid="link-119">119 화면 →</Link>
      </div>
      {s.started && (
        <form className="mt-2 flex flex-wrap items-center gap-2 text-[14px]" onSubmit={(e) => {
          e.preventDefault();
          const v = Number(eta);
          if (!(v > 0)) return;
          update((x) => setNotice(x, { confirmedEndH: sToH(x.nowS) + v, sigmaE: Math.max(0, Number(sigma) || 0) }));
        }}>
          <span className="font-semibold">한전 복구 예정 통보 받음</span>
          <label>지금부터 <input aria-label="복구까지 남은 시간(시간)" className="w-16 rounded border border-line px-1" inputMode="decimal" value={eta} onChange={(e) => setEta(e.target.value)} />시간 뒤</label>
          <label>불확실성 σ <input aria-label="불확실성 시그마" className="w-12 rounded border border-line px-1" inputMode="decimal" value={sigma} onChange={(e) => setSigma(e.target.value)} /></label>
          <button className="rounded border border-ink px-2 py-0.5" type="submit" data-testid="notice-submit">입력</button>
          {s.notice && <button type="button" className="rounded border border-line px-2 py-0.5" onClick={() => update((x) => setNotice(x, null))}>통보 지우기</button>}
          <span className="text-muted">이 통보가 있어야만 대기(재확인) 판정이 가능합니다</span>
          <span className="ml-auto text-muted">새로고침하면 초기화됩니다</span>
        </form>
      )}
    </header>
  );
}

function AbStrip({ scenarioId }: { scenarioId: string }) {
  const ab = presetAb(scenarioId);
  const r = ab?.policies.RULE, b1 = ab?.policies.B1_SHORTEST, b2 = ab?.policies.B2_NEAREST, kr = ab?.policies.KR_BASELINE;
  return (
    <section className="mt-4 rounded-2xl border border-brand-line bg-brand-soft px-4 py-3 text-[15px]" data-testid="ab-strip"
      title="프리셋 시드는 결과를 보기 전에 봉인 · 규칙은 그 뒤 화면 점검으로 고침(개발 기록) · 이 시나리오 1건의 결과일 뿐 · 27개 조건 비교는 /lab">
      {r && b1 && b2 ? (
        <p>
          같은 정전·같은 시드 — 공백 가구·시간(모의): {kr ? <>현행 절차 <strong>{kr.M2H}</strong> / </> : null}원안 판단식 구현 규칙 <strong>{r.M2H}</strong> / 배터리 짧은 순 <strong>{b1.M2H}</strong> / 가까운 자원 순 <strong>{b2.M2H}</strong>
          {" "}· 공백이 남은 고위험 가구: {kr ? <><strong>{kr.M1}</strong> / </> : null}<strong>{r.M1}</strong> / <strong>{b1.M1}</strong> / <strong>{b2.M1}</strong>
          <span className="text-muted"> (고위험 {r.highRisk}가구, 봉인 프리셋 기준값(조작 전)) · </span>
          <Link className="underline" href="/lab#compare">27개 조건 비교</Link>
        </p>
      ) : (
        <p>같은 정전·같은 시드 비교: 측정 전</p>
      )}
    </section>
  );
}

function BeforeOutage() {
  const { session } = useOps();
  const s = session!;
  const pl = s.preset.planner;
  return (
    <div className="mt-6 grid items-center gap-6 lg:grid-cols-[minmax(0,42rem)_1fr]">
    <section className="card p-6 text-[16px] leading-7">
      <h2 className="text-[20px] font-extrabold text-brand-strong">{s.preset.meta.name}</h2>
      <p className="mt-1">{s.preset.meta.description}</p>
      <p className="mt-2">등록 가구 {pl.households.length}곳, 비상전원 자원 {pl.resources.length}개(모의 값), 119 시간당 {pl.lanes.k119PerH}건, 쉼터 {pl.lanes.shelter.seats}석. 가구·자원은 모두 합성 데이터입니다.</p>
      <p className="mt-2">「모의 정전 발생」을 누르면 신고가 들어온 가구마다 배터리 하한을 계산하고 처리 순서와 추천을 냅니다. 확정은 담당자 승인으로만 됩니다.</p>
      <p className="mt-2 text-[14px] text-muted">봉인 sha256 {s.preset.meta.scenarioSha256.slice(0, 16)}… · 시드 {s.preset.meta.seed}</p>
    </section>
    <figure className="hidden lg:block">
      <div role="img" aria-label="처리 순서 화면에서 한 집을 고르고, 사람이 버튼을 눌러 승인하면 구급차로 이어지는 흐름" className="illust aspect-[3/1] w-full bg-white bg-contain bg-[url('/illustrations/approve-flow.webp')]" />
      <figcaption className="mt-2 text-[13px] text-muted">처리 순서 → 담당자 승인 → 119 연계. 일러스트: AI 생성</figcaption>
    </figure>
    </div>
  );
}

function reasonText(r: Reason | { templateId: string; params: Record<string, string | number> }): string {
  try { return renderReason(r as Reason); } catch { return r.templateId; }
}

interface ViewRow {
  id: string; pseudonym: string; cls: string; badge: "사양 확인" | "수동검토" | "AI 판독 미확인";
  lane: Lane; status: "제안" | "승인" | "수정"; flagged?: string;
  lRemH: number | null; resourceId?: string; etaRemH?: number; tier: 0 | 1 | null; slackH: number | null;
  margin: { lo: number; hi: number } | null; reason: string; flags: string[]; order: number; holdBy?: number; reserved?: string;
}

function buildRows(s: Session): ViewRow[] {
  const now = sToH(s.nowS);
  const byId = new Map<string, AllocRow>(s.result?.rows.map((r) => [r.rec.householdId, r]) ?? []);
  const out: ViewRow[] = [];
  let decidedOrder = -1000;
  for (const hh of s.households) {
    const lbd = computeLowerBoundDetail(hh, DB);
    const cls = DEVICE_CLASS_LABEL[deviceClass(hh)];
    const badge = lbd.lb.status === "MANUAL_REVIEW" ? "수동검토" : hh.device.specBy === "ai_label_user_confirmed" ? "AI 판독 미확인" : "사양 확인";
    const lRemH = lbd.endS != null ? sToH(lbd.endS) - now : null;
    const flags = lbd.lb.flags.map((f) => FLAG_KO[f]);
    const d = s.decisions[hh.id];
    if (d) {
      out.push({
        id: hh.id, pseudonym: hh.pseudonym, cls, badge, lane: d.lane, status: d.status === "APPROVED" ? "승인" : "수정", flagged: s.flagged[hh.id],
        lRemH, resourceId: d.resourceId, etaRemH: d.etaH != null ? d.etaH - now : undefined, tier: null, slackH: null, margin: null,
        reason: s.flagged[hh.id] ? `재검토 필요: ${s.flagged[hh.id]}. 승인 배정은 자동으로 바꾸지 않음 · 대안은 승인 필요` : "운영자 결정",
        flags, order: decidedOrder++,
      });
      continue;
    }
    const r = byId.get(hh.id);
    if (!r) continue;
    out.push({
      id: hh.id, pseudonym: hh.pseudonym, cls, badge, lane: r.rec.lane, status: "제안", lRemH,
      resourceId: r.rec.resourceId, etaRemH: r.rec.etaH != null ? r.rec.etaH - now : undefined,
      tier: r.rec.tier, slackH: r.rec.slackH, margin: r.rec.marginH, reason: [reasonText(r.rec.reason), ...r.notes.map(reasonText)].join(" · "),
      flags, order: r.rec.order, holdBy: r.rec.holdRecheckBy, reserved: r.rec.reservedResourceId,
    });
  }
  return out;
}

function Board() {
  const { session } = useOps();
  const s = session!;
  const [group, setGroup] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const rows = useMemo(() => buildRows(s), [s]);
  const sorted = useMemo(() => {
    const mr = rows.filter((r) => r.lane === "MANUAL_REVIEW" && r.status === "제안");
    const rest = rows.filter((r) => !(r.lane === "MANUAL_REVIEW" && r.status === "제안")).sort((a, b) => a.order - b.order);
    if (!group) return [...mr, ...rest];
    return LANE_ORDER.flatMap((l) => [...mr, ...rest].filter((r) => r.lane === l));
  }, [rows, group]);
  const now = sToH(s.nowS);
  const R = s.restoration?.view;
  return (
    <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section aria-labelledby="tbl-title" className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="tbl-title" className="text-[20px] font-extrabold text-brand-strong">처리 순서</h2>
          {R && (
            <span className="text-[14px]" data-testid="restoration-line">
              복구 {R.status === "CONFIRMED" ? "통보 범위" : "가정 범위"} P10~P90 <strong>{h2(Math.max(0, R.p10 - now))}~{h2(Math.max(0, R.p90 - now))}h 뒤</strong>
              <span className="text-muted"> · {RESTORATION_LABEL}{s.restoration?.beyondAssumedRange ? " · 가정 범위 초과 경과" : ""}</span>
            </span>
          )}
          <label className="ml-auto flex items-center gap-1 text-[14px]">
            <input type="checkbox" checked={group} onChange={(e) => setGroup(e.target.checked)} /> 레인별 묶어 보기
          </label>
        </div>
        <div className="mt-2 overflow-x-auto rounded-2xl border border-line bg-white shadow-[var(--shadow-card)]">
          <table className="w-full min-w-[980px] border-collapse text-[14px]" data-testid="lane-table">
            <thead className="bg-paper text-left text-[13px] text-muted">
              <tr>
                <th className="px-2 py-2">가명</th>
                <th className="px-2 py-2">기기</th>
                <th className="px-2 py-2" title="제조사 사양·입력 기반, 실측 보장 아님">남은 하한 L</th>
                <th className="px-2 py-2">추천</th>
                <th className="whitespace-nowrap px-2 py-2">도착·완료</th>
                <th className="px-2 py-2" title="실제 처리 순서를 정한 값: tier 다음 slack">순서 키 tier · slack</th>
                <th className="px-2 py-2" title="범위로만 표시">여유</th>
                <th className="whitespace-nowrap px-2 py-2">상태</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} data-testid={`row-${r.id}`} data-lane={r.lane}
                  className={`cursor-pointer border-t border-line align-top hover:bg-paper ${r.lane === "MANUAL_REVIEW" && r.status === "제안" ? "outline outline-2 -outline-offset-2 outline-gap" : ""} ${sel === r.id ? "bg-restore-soft" : ""}`}
                  onClick={() => setSel(r.id)}>
                  <td className="whitespace-nowrap px-2 py-2 font-semibold">
                    <button type="button" className="underline" onClick={(e) => { e.stopPropagation(); setSel(r.id); }} data-testid={`open-${r.id}`}>{r.pseudonym}</button>
                  </td>
                  <td className="px-2 py-2">
                    <div>{r.cls}</div>
                    <span className={`mt-0.5 inline-block rounded px-1 text-[12px] ${r.badge === "사양 확인" ? "bg-batt-soft text-batt-strong" : r.badge === "수동검토" ? "bg-gap-soft text-gap" : "bg-warn-soft text-warn"}`}>{r.badge}</span>
                  </td>
                  <td className="px-2 py-2 tabular-nums">{r.lRemH == null ? "자동 계산 안 함" : r.lRemH < 0 ? <span className="font-semibold text-gap">소진({h2(-r.lRemH)}h 전)</span> : `${h2(r.lRemH)}h`}
                    {r.flags.length > 0 && <div className="mt-0.5 text-[12px] text-muted">{r.flags.join(" · ")}</div>}
                  </td>
                  <td className="px-2 py-2">
                    <span className={`inline-block rounded border px-1.5 text-[13px] font-semibold ${LANE_TONE[r.lane]}`}>{LANE_KO[r.lane]}</span>
                    {r.resourceId && <span className="ml-1">{r.resourceId}</span>}
                    {r.reserved && <div className="text-[12px] text-muted">검토 예약 자원 {r.reserved}</div>}
                    <details className="mt-1 text-[12px] text-muted" onClick={(e) => e.stopPropagation()}>
                      <summary className="cursor-pointer">근거</summary>
                      <p className="mt-1 max-w-[420px] leading-5">{r.reason}</p>
                    </details>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 tabular-nums">{r.etaRemH != null ? `${h2(Math.max(0, r.etaRemH))}h 뒤` : "—"}</td>
                  <td className="px-2 py-2 tabular-nums">
                    {r.tier != null && r.slackH != null ? (
                      <>
                        <span title={r.tier === 0 ? "복구 가정 P90 전에 하한 소진 가능" : "가정 범위를 넘을 때만 공백"}>{r.tier} · {h2(r.slackH)}h</span>
                        {r.slackH < 0 && <div className="text-[12px] text-gap">0.8×하한 안 도착 불가</div>}
                      </>
                    ) : r.holdBy != null ? (
                      <span>재확인 시한 {h2(Math.max(0, r.holdBy - now))}h 뒤</span>
                    ) : "—"}
                  </td>
                  <td className="px-2 py-2 tabular-nums">{r.margin ? `${h2(r.margin.lo)}~${h2(r.margin.hi)}h` : "—"}</td>
                  <td className="whitespace-nowrap px-2 py-2">
                    <span className={r.status === "제안" ? "text-muted" : "font-semibold text-batt"}>{r.status}</span>
                    {r.flagged && <div className="mt-0.5 inline-block rounded bg-gap px-1 text-[12px] font-semibold text-white" data-testid={`recheck-${r.id}`}>재검토 필요</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[13px] text-muted">
          하한 L은 제조사 사양과 입력으로 계산한 값이며 실측 보장이 아닙니다. 여유 = 하한 소진 시각 − min(복구 P90·P10, 도착)으로 범위로만 표시합니다.
          기기 등급은 표시·감사용이며 배정 입력이 아닙니다. 모든 추천은 제안 상태이며 담당자 승인 전에는 확정·119 전달이 없습니다.
        </p>
        <OmissionAudit />
        <AuditLog />
      </section>
      {/* 좁은 화면: 가구를 고르면 서랍이 표 위로(표 아래에 열려 보이지 않던 문제, 10/30 디자인 개편). 서랍 파일은 그대로 */}
      <aside className={`space-y-4 ${sel ? "order-first lg:order-none" : ""}`}>
        {sel ? <ApproveDrawer householdId={sel} onClose={() => setSel(null)} /> : (
          <p className="rounded-2xl border border-dashed border-brand-line bg-white p-4 text-[14px] text-muted">표에서 가구를 고르면 승인 서랍이 열립니다.</p>
        )}
        <ResourcePanel />
      </aside>
    </div>
  );
}
