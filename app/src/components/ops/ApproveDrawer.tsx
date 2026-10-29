"use client";
// 승인 서랍 (spec.md 1.4절). 「승인」「수정」만 있고 거절 버튼·일괄 자동 확정은 없다(I6).
// status "APPROVED"는 이 파일의 onApprove 한 곳에서만 만든다(관문 1 '승인 우회 경로 0', grep 시험).
import { useEffect, useMemo, useRef, useState } from "react";
import type { AuditEntry, Lane } from "@/lib/domain/types";
import { computeLowerBoundDetail } from "@/lib/engine/lowerBound";
import { qT, sToH } from "@/lib/engine/quantize";
import { outageInput } from "@/lib/notice/facts";
import { NoticePanel } from "@/components/NoticePanel";
import { renderReason, type Reason } from "@/lib/alloc/reasons";
import { DEVICE_CLASS_LABEL } from "@/lib/alloc/project119";
import {
  applyVerify, commitDecision, DB, decisionFromRow, parseOperatorNumber, deviceClass, etaForResource, modifyOptions, MODIFY_REASON_CODES, nowIso, reReport,
  type Decision, type VerifyInput,
} from "@/lib/ops/session";
import { issueApproval, type ApprovalTicket } from "@/lib/ops/approvalGate";
import { useOps } from "./OpsProvider";
import { h2, LANE_KO } from "./labels";

export function ApproveDrawer({ householdId, onClose }: { householdId: string; onClose: () => void }) {
  const { session, update } = useOps();
  const s = session!;
  const hh = s.households.find((h) => h.id === householdId)!;
  const row = s.result?.rows.find((r) => r.rec.householdId === householdId);
  const decided = s.decisions[householdId];
  const alt = s.alternatives[householdId];
  const lbd = computeLowerBoundDetail(hh, DB);
  const now = sToH(s.nowS);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { ref.current?.focus(); }, [householdId]);

  function onApprove(e: React.MouseEvent) {
    if (!row) return;
    const t = issueApproval(e.nativeEvent, householdId);
    const d: Decision = { ...decisionFromRow(row), status: "APPROVED", decidedAtS: s.nowS };
    const slot = { lane: row.rec.lane, ...(row.rec.resourceId ? { resourceId: row.rec.resourceId } : {}) };
    const a: AuditEntry = { at: nowIso(s), actor: "demo-operator", householdId, action: "APPROVE", from: slot, to: slot };
    update((x) => commitDecision(x, d, a, t));
  }
  function onApproveAlternative(e: React.MouseEvent) {
    if (!alt || !decided) return;
    const t = issueApproval(e.nativeEvent, householdId);
    const d: Decision = { ...decisionFromRow(alt), status: "MODIFIED", decidedAtS: s.nowS };
    const a: AuditEntry = {
      at: nowIso(s), actor: "demo-operator", householdId, action: "MODIFY",
      from: { lane: decided.lane, ...(decided.resourceId ? { resourceId: decided.resourceId } : {}) },
      to: { lane: alt.rec.lane, ...(alt.rec.resourceId ? { resourceId: alt.rec.resourceId } : {}) },
      reasonCode: "RECHECK_ALT", reasonText: "재검토 대안 승인",
    };
    update((x) => commitDecision(x, d, a, t));
  }

  return (
    <section role="dialog" aria-modal="false" aria-labelledby="drawer-title" className="rounded-lg border border-ink p-3" data-testid="approve-drawer" data-household={householdId}>
      <div className="flex items-start justify-between">
        <h2 id="drawer-title" className="text-[18px] font-bold">{hh.pseudonym} · {DEVICE_CLASS_LABEL[deviceClass(hh)]}</h2>
        <button type="button" onClick={onClose} className="text-[14px] underline">닫기</button>
      </div>
      <p className="mt-1 text-[14px] text-muted">격자 ({hh.cell.x}, {hh.cell.y}) km · {hh.floor}층 · 보호자 {hh.caregiver ? "있음" : "없음"} · 이동지원 {hh.mobilityNeed ? "필요" : "불필요"}</p>

      <h3 className="mt-3 text-[15px] font-bold">하한 분해식</h3>
      {lbd.lb.status === "MANUAL_REVIEW" ? (
        <p className="text-[14px] text-gap">기종이 DB와 정확히 일치하지 않아 자동 계산하지 않습니다(수동검토).</p>
      ) : (
        <ul className="text-[14px] tabular-nums">
          {lbd.lb.terms.map((t, i) => <li key={i}>{t.label}: {h2(t.hours)}h <span className="text-muted">({t.prov.type})</span></li>)}
          <li className="font-semibold">= 하한 {h2(lbd.lb.hours ?? 0)}h(상한 {lbd.lb.capH != null ? h2(lbd.lb.capH) : "—"}h) · 남은 하한 {h2(sToH(lbd.endS ?? 0) - now)}h</li>
        </ul>
      )}

      {decided ? (
        <div className="mt-3 rounded bg-batt-soft p-2 text-[14px]">
          <strong>{decided.status === "APPROVED" ? "승인됨" : "수정됨"}</strong>: {LANE_KO[decided.lane]}{decided.resourceId ? ` · ${decided.resourceId}` : ""}
          {s.flagged[householdId] && <p className="mt-1 font-semibold text-gap">재검토 필요: {s.flagged[householdId]}</p>}
          {alt && (
            <div className="mt-2 rounded border border-gap bg-white p-2">
              <p>대안(제안): {LANE_KO[alt.rec.lane]}{alt.rec.resourceId ? ` · ${alt.rec.resourceId}` : ""}</p>
              <p className="text-[13px] text-muted">{safeReason(alt.rec.reason)}</p>
              <button ref={ref} type="button" className="mt-1 rounded bg-ink px-3 py-1 text-white" onClick={onApproveAlternative} data-testid="approve-alt" data-gate="gate-approve-alt">대안 승인</button>
            </div>
          )}
        </div>
      ) : row ? (
        <div className="mt-3">
          <h3 className="text-[15px] font-bold">추천(제안)</h3>
          <p className="text-[15px]"><strong>{LANE_KO[row.rec.lane]}</strong>{row.rec.resourceId ? ` · ${row.rec.resourceId}` : ""}</p>
          <p className="mt-1 text-[13px] leading-5 text-muted" data-testid="drawer-reason">{safeReason(row.rec.reason)}</p>
          <div className="mt-2 flex gap-2">
            <button ref={ref} type="button" onClick={onApprove} disabled={row.rec.lane === "MANUAL_REVIEW" || row.rec.lane === "HOLD" || row.rec.lane === "UNSERVED_VISIBLE"}
              className="rounded bg-ink px-4 py-1.5 text-[15px] font-bold text-white disabled:opacity-40" data-testid="approve" data-gate="gate-approve">승인</button>
          </div>
          {(row.rec.lane === "MANUAL_REVIEW" || row.rec.lane === "HOLD" || row.rec.lane === "UNSERVED_VISIBLE") && (
            <p className="mt-1 text-[12px] text-muted">이 레인은 승인할 배정이 없습니다. 「수정」으로 수단을 고르거나 확인 조작을 하세요.</p>
          )}
          {/* key: 가구를 바꾸면 입력 양식을 새로 만들어 앞 가구에 쓰던 사유·선택이 이어지지 않게 한다(보호자 알림 판은 사실이 같으면 글을 유지) */}
          <ModifyForm key={`modify-${householdId}`} householdId={householdId} fromLane={row.rec.lane} fromRes={row.rec.resourceId} />
        </div>
      ) : null}

      {decided && <DecidedNotice householdId={householdId} />}
      <VerifyForms key={`verify-${householdId}`} householdId={householdId} />
      <ReReportForm key={`rereport-${householdId}`} householdId={householdId} />
    </section>
  );
}

/** 결정(승인·수정) 뒤 보호자 알림. 사실은 결정 기록·현재 하한에서 코드가 만든다 */
function DecidedNotice({ householdId }: { householdId: string }) {
  const { session } = useOps();
  const s = session!;
  const d = s.decisions[householdId];
  const hh = s.households.find((h) => h.id === householdId)!;
  const input = useMemo(() => outageInput({
    hh, baseIso: s.preset.meta.baseIso, nowS: s.nowS, lane: d.lane,
    resourceKind: s.preset.planner.resources.find((r) => r.id === d.resourceId)?.kind ?? null,
    etaS: d.etaH != null ? qT(d.etaH) : null, late119: d.late119 ?? false, db: DB,
  }), [hh, s.preset, s.nowS, d]);
  if (!input) return null;
  // 재검토 표시가 뜬 결정(도착 전 소진 등)은 낡은 결정이라 알림을 만들지 않는다
  if (s.purged119Ids.includes(householdId)) return <p className="mt-3 rounded bg-gap-soft p-2 text-[14px] text-gap" data-testid="notice-blocked">보호자 알림 없음: 119 표시분을 파기한(대응 종료) 가구입니다.</p>;
  if (s.flagged[householdId]) return <p className="mt-3 rounded bg-gap-soft p-2 text-[14px] text-gap" data-testid="notice-blocked">보호자 알림 보류: 이 결정은 재검토가 필요합니다. 대안을 승인하거나 수정한 뒤 알림을 만드세요.</p>;
  return <NoticePanel input={input} title="보호자 알림(쉬운 글·음성)" />;
}

function safeReason(r: { templateId: string; params: Record<string, string | number> }): string {
  try { return renderReason(r as Reason); } catch { return r.templateId; }
}

function ModifyForm({ householdId, fromLane, fromRes }: { householdId: string; fromLane: Lane; fromRes?: string }) {
  const { session, update } = useOps();
  const s = session!;
  const opts = useMemo(() => modifyOptions(s, householdId), [s, householdId]);
  const [pick, setPick] = useState(0);
  const [code, setCode] = useState("");
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const o = opts[pick];
  // 결정 관문은 제출 버튼의 클릭으로 판정한다: 스크립트의 requestSubmit()·button.click()도 브라우저가 낸 submit 이벤트는 isTrusted라서
  // submit 이벤트로는 가를 수 없다. 클릭은 같은 작업 안에서 submit보다 먼저 오므로, 다음 작업에서 지운다
  const clickRef = useRef<Event | null>(null);
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const click = clickRef.current;
    clickRef.current = null;
    if (!o) return;
    if (!code || text.trim().length < 5) { setErr("사유 코드와 자유문 5자 이상이 필요합니다"); return; }
    let t: ApprovalTicket;
    try { t = issueApproval(click ?? e.nativeEvent, householdId); } catch (ex) { setErr(String((ex as Error).message)); return; }
    const etaH = o.resourceId ? etaForResource(s, householdId, o.resourceId) : undefined;
    const d: Decision = { householdId, lane: o.lane, resourceId: o.resourceId, etaH, status: "MODIFIED", decidedAtS: s.nowS };
    const a: AuditEntry = {
      at: nowIso(s), actor: "demo-operator", householdId, action: "MODIFY",
      from: { lane: fromLane, ...(fromRes ? { resourceId: fromRes } : {}) }, to: { lane: o.lane, ...(o.resourceId ? { resourceId: o.resourceId } : {}) },
      reasonCode: code, reasonText: text.trim(),
    };
    try { update((x) => commitDecision(x, d, a, t)); setErr(null); } catch (ex) { setErr(String((ex as Error).message)); }
  }
  return (
    <details className="mt-3 rounded border border-line p-2">
      <summary className="cursor-pointer text-[15px] font-semibold">수정</summary>
      <form onSubmit={submit} className="mt-2 grid gap-2 text-[14px]">
        <label className="grid gap-1">수단
          <select className="rounded border border-line p-1" value={pick} onChange={(e) => setPick(Number(e.target.value))} data-testid="modify-option">
            {opts.map((x, i) => <option key={i} value={i}>{LANE_KO[x.lane]} — {x.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1">사유 코드
          <select className="rounded border border-line p-1" value={code} onChange={(e) => setCode(e.target.value)} data-testid="modify-code">
            <option value="">고르세요</option>
            {MODIFY_REASON_CODES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
        </label>
        <label className="grid gap-1">사유(5자 이상)
          <input className="rounded border border-line p-1" value={text} onChange={(e) => setText(e.target.value)} data-testid="modify-text" />
        </label>
        {err && <p className="text-gap" role="alert">{err}</p>}
        <button type="submit" className="rounded border border-ink px-3 py-1 font-semibold" data-testid="modify-submit" data-gate="gate-modify"
          onClick={(e) => { clickRef.current = e.nativeEvent; setTimeout(() => { clickRef.current = null; }, 0); }}>수정 저장</button>
      </form>
    </details>
  );
}

function VerifyForms({ householdId }: { householdId: string }) {
  const { session, update } = useOps();
  const s = session!;
  const hh = s.households.find((h) => h.id === householdId)!;
  const lbd = computeLowerBoundDetail(hh, DB);
  const [msg, setMsg] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  // 칸마다 상태를 따로 둔다(한 칸 입력이 다른 칸으로 새지 않게)
  const [mrH, setMrH] = useState("");
  const [cylN, setCylN] = useState("");
  const [cylH, setCylH] = useState("");
  const [extN, setExtN] = useState("");
  const [ageY, setAgeY] = useState("");
  const [spec, setSpec] = useState("");
  const [charge, setCharge] = useState(false);
  const hint = s.reviewHints[householdId];
  /** 빈 칸·숫자 아님은 0으로 바꾸지 않고 거부한다(빈 연식이 0년으로 저장되면 하한이 올라간다) */
  function num(raw: string, label: string): number | null {
    const v = parseOperatorNumber(raw);
    if (v == null) setMsg(`저장 불가: ${label}을(를) 0 이상의 숫자로 입력하세요`);
    return v;
  }
  function run(v: VerifyInput) {
    const out = applyVerify(s, v);
    if (!out.ok) { setMsg(`저장 불가: ${out.error}`); return; }
    update(() => out.session);
    setMsg("저장했습니다. 다시 계산했습니다.");
    setReason(""); setMrH(""); setCylN(""); setCylH(""); setExtN(""); setAgeY("");
  }
  const isMr = lbd.lb.status === "MANUAL_REVIEW";
  const extIdx = hh.ext.findIndex((e) => e.extSpecId != null && !e.opVerified);
  return (
    <details className="mt-3 rounded border border-line p-2" open={isMr}>
      <summary className="cursor-pointer text-[15px] font-semibold">확인 조작(운영자, 사유 필수)</summary>
      <div className="mt-2 grid gap-2 text-[14px]">
        <label className="grid gap-1">사유·근거
          <input className="rounded border border-line p-1" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="verify-reason" />
        </label>
        {isMr && (
          <div className="rounded bg-gap-soft p-2">
            <p className="font-semibold">수동검토 완료</p>
            {hint && <p className="text-[12px] text-muted">시연 데이터 · 현장 확인 결과: {hint.specId ? `기종 ${hint.specId}` : `보수 하한 ${hint.operatorLowerH}h`}</p>}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <select className="rounded border border-line p-1" value={spec} onChange={(e) => setSpec(e.target.value)} data-testid="mr-spec" aria-label="DB 기종 선택">
                <option value="">DB 기종 선택</option>
                {[...DB.devices.values()].map((d) => <option key={d.specId} value={d.specId}>{d.manufacturer} {d.model}</option>)}
              </select>
              <span>또는 보수 하한</span>
              <input className="w-16 rounded border border-line p-1" inputMode="decimal" value={mrH} onChange={(e) => setMrH(e.target.value)} aria-label="보수 하한 시간" />h
              <button type="button" className="rounded border border-ink px-2 py-0.5" data-testid="mr-done"
                onClick={() => {
                  if (spec) { run({ action: "MANUAL_REVIEW_DONE", householdId, specId: spec, reasonText: reason }); return; }
                  const h = num(mrH, "보수 하한"); if (h != null) run({ action: "MANUAL_REVIEW_DONE", householdId, operatorLowerH: h, reasonText: reason });
                }}>완료</button>
            </div>
          </div>
        )}
        {extIdx >= 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span>외장 확인({hh.ext[extIdx].extSpecId}, 신고 {hh.ext[extIdx].declaredCount}개)</span>
            <input className="w-12 rounded border border-line p-1" inputMode="numeric" value={extN} onChange={(e) => setExtN(e.target.value)} aria-label="확인 개수" />개
            <label className="flex items-center gap-1"><input type="checkbox" checked={charge} onChange={(e) => setCharge(e.target.checked)} />충전 표시 직접 확인</label>
            <button type="button" className="rounded border border-ink px-2 py-0.5" data-testid="verify-ext"
              onClick={() => { const c = num(extN, "확인 개수"); if (c != null) run({ action: "VERIFY_EXT", householdId, extIndex: extIdx, count: c, chargeConfirmed: charge, reasonText: reason }); }}>저장</button>
          </div>
        )}
        {hh.cylinder?.declared && !hh.cylinder.opVerified && (
          <div className="flex flex-wrap items-center gap-2">
            <span>실린더 확인</span>
            <input className="w-12 rounded border border-line p-1" inputMode="numeric" value={cylN} onChange={(e) => setCylN(e.target.value)} aria-label="실린더 개수" />개
            <input className="w-14 rounded border border-line p-1" inputMode="decimal" value={cylH} onChange={(e) => setCylH(e.target.value)} aria-label="실린더 하한 시간" />h
            <button type="button" className="rounded border border-ink px-2 py-0.5" data-testid="verify-cyl"
              onClick={() => { const c = num(cylN, "실린더 개수"); const h = c == null ? null : num(cylH, "실린더 하한 시간"); if (c != null && h != null) run({ action: "VERIFY_CYL", householdId, count: c, hoursLo: h, reasonText: reason }); }}>저장</button>
          </div>
        )}
        {!isMr && hh.device.batteryAgeY == null && (
          <div className="flex flex-wrap items-center gap-2">
            <span>연식 확인(대여·구입 기록)</span>
            <input className="w-14 rounded border border-line p-1" inputMode="decimal" value={ageY} onChange={(e) => setAgeY(e.target.value)} aria-label="배터리 연식(년)" />년
            <button type="button" className="rounded border border-ink px-2 py-0.5" data-testid="verify-age"
              onClick={() => { const y = num(ageY, "배터리 연식"); if (y != null) run({ action: "VERIFY_AGE", householdId, batteryAgeY: y, reasonText: reason }); }}>저장</button>
          </div>
        )}
        {hh.device.specBy === "ai_label_user_confirmed" && (
          <button type="button" className="justify-self-start rounded border border-ink px-2 py-0.5" data-testid="verify-model"
            onClick={() => run({ action: "VERIFY_MODEL", householdId, reasonText: reason })}>기종 확인(라벨 사진·사양 카드 대조)</button>
        )}
        {msg && <p role="status" className={msg.startsWith("저장 불가") ? "text-gap" : "text-batt"}>{msg}</p>}
      </div>
    </details>
  );
}

function ReReportForm({ householdId }: { householdId: string }) {
  const { update } = useOps();
  const [pct, setPct] = useState("");
  return (
    <details className="mt-3 rounded border border-dashed border-line p-2">
      <summary className="cursor-pointer text-[14px] text-muted">가구 재신고(시연)</summary>
      {/* 빈칸·공백·글자는 0으로 바꾸지 않고 거부한다(Number("   ")은 0이라 0% 재신고가 되던 결함, 레드팀 10/24) */}
      <form className="mt-2 flex items-center gap-2 text-[14px]" onSubmit={(e) => { e.preventDefault(); const v = parseOperatorNumber(pct); if (v != null) update((x) => reReport(x, householdId, v)); }}>
        충전량 <input className="w-14 rounded border border-line p-1" inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value)} aria-label="재신고 충전량 퍼센트" />%
        <button type="submit" className="rounded border border-ink px-2 py-0.5" data-testid="rereport">재신고</button>
        <span className="text-[12px] text-muted">정전 중에는 하한 소진 시각이 늘지 않습니다</span>
      </form>
    </details>
  );
}

