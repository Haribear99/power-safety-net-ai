// /ops 운영자 화면의 세션 상태와 재계산 (spec.md 1.4절). 비AI, 순수 함수. 화면(React)은 이 모듈만 부른다.
// 상태는 탭 세션 메모리에만 둔다(서버 DB 없음, 새로고침하면 초기화).
// 승인 행은 고정하고(AllocState), 나머지 가구만 RULE로 다시 돈다(4.3절 ②와 같은 방식). 승인 행은 매 재계산마다 recheckApproved로 다시 본다.
// APPROVED 상태는 ApproveDrawer의 승인 핸들러 한 곳에서만 만든다(I6, 관문 1 '승인 우회 0'). 이 모듈은 결정을 받아 저장만 한다.
import type { AuditEntry, DeviceClass, HouseholdView, Lane, PlannerView } from "../domain/types";
import { auditEntryRuleSchema, verifyAgePayloadSchema, verifyCylPayloadSchema, verifyExtPayloadSchema, type VerifyContext } from "../domain/audit";
import { computeLowerBoundDetail, DEFAULT_DB } from "../engine/lowerBound";
import { computeRestoration, type RestorationDetail } from "../engine/restoration";
import { pNum } from "../engine/params";
import { qT, sToH } from "../engine/quantize";
import type { TravelProfile } from "../engine/arrival";
import { holdExpiredEntries } from "../alloc/need";
import { arrivalS, buildCtx, physCandidates, type AllocOptions } from "../alloc/feasible";
import { recheckApproved, rule, type AllocResult, type AllocRow, type AllocState, type ApprovedRow } from "../alloc/rule";
import { mockIso } from "../alloc/project119";
import type { Slot119 } from "../alloc/fallback";
import { consumeApproval, type ApprovalTicket } from "./approvalGate";

export interface UiPreset {
  format: "pl26-ui-preset/1";
  meta: { scenarioId: string; name: string; description: string; seed: string; scenarioSha256: string; baseIso: string };
  allocOpts: { travel: TravelProfile; stress119: number };
  planner: Omit<PlannerView, "households"> & { households: (HouseholdView & { reentry?: { specId?: string; operatorLowerH?: number } })[] };
}

/** 운영자 결정(승인·수정). status는 ApproveDrawer가 정한다 */
export interface Decision {
  householdId: string;
  status: "APPROVED" | "MODIFIED";
  lane: Lane;
  resourceId?: string;
  /** 자원 레인: 도착 절대 시각 h. 119: 이송 완료 예상 절대 시각 h */
  etaH?: number;
  slot119?: Slot119;
  late119?: boolean;
  decidedAtS: number;
}

export interface Notice { confirmedEndH: number; sigmaE: number }

export interface Session {
  preset: UiPreset;
  households: HouseholdView[];
  /** 수동검토 '현장 확인' 시연 힌트(시나리오 데이터, PlannerView 쪽 BEHAVIOR 표본. WorldTruth 아님) */
  reviewHints: Record<string, { specId?: string; operatorLowerH?: number }>;
  started: boolean;
  nowS: number;
  notice: Notice | null;
  decisions: Record<string, Decision>;
  /** 재확인 시한이 지나 '필요'로 되돌린 HOLD 가구(1.4절 HOLD_EXPIRED) */
  forceNeedIds: string[];
  /** 재검토 필요 배지(RECHECK_FLAG) */
  flagged: Record<string, string>;
  /** 재검토 대안(새 PROPOSED, 승인 필요) */
  alternatives: Record<string, AllocRow>;
  result: AllocResult | null;
  restoration: RestorationDetail | null;
  audit: AuditEntry[];
  /** /ops/119에서 파기한 가구 id(재난안전법 제74조의3⑤). 파기 뒤 새로 승인한 119 건은 다시 보인다 */
  purged119Ids: string[];
  auditSeq: number;
  /** 결정 관문에서 이미 적용한 표 id. 같은 표를 다시 쓰면 아무것도 바꾸지 않는다(감사 행 중복·이전 결정으로 되돌리기 방지) */
  appliedTickets: string[];
}

export const DB = DEFAULT_DB;

export function newSession(preset: UiPreset): Session {
  const reviewHints: Session["reviewHints"] = {};
  const households = preset.planner.households.map((h) => {
    const { reentry, ...hv } = h;
    if (reentry) reviewHints[h.id] = reentry;
    return hv as HouseholdView;
  });
  return {
    preset, households, reviewHints, started: false, nowS: qT(preset.planner.now), notice: null, decisions: {},
    forceNeedIds: [], flagged: {}, alternatives: {}, result: null, restoration: null, audit: [], purged119Ids: [], auditSeq: 0, appliedTickets: [],
  };
}

export function allocOpts(s: Session): AllocOptions {
  return { db: DB, travel: s.preset.allocOpts.travel, stress119: s.preset.allocOpts.stress119 };
}

export function nowIso(s: Session): string {
  return mockIso(s.preset.meta.baseIso, s.nowS);
}

export function restorationAt(s: Session, nowS: number): RestorationDetail {
  const pl = s.preset.planner;
  const base = { cause: pl.restoration.cause, tOutageH: pl.tOutage, nowH: sToH(nowS) };
  if (s.notice) return computeRestoration({ ...base, status: "CONFIRMED", confirmedEndH: s.notice.confirmedEndH, sigmaE: s.notice.sigmaE });
  return computeRestoration(base);
}

/** 현재 시각의 PlannerView(가구 전원) */
export function viewAt(s: Session, nowS: number, households: HouseholdView[] = s.households): PlannerView {
  const pl = s.preset.planner;
  return {
    scenarioId: pl.scenarioId, now: sToH(nowS), tOutage: pl.tOutage, households, resources: pl.resources,
    restoration: restorationAt(s, nowS).view, lanes: pl.lanes,
  };
}

function approvedRows(s: Session): ApprovedRow[] {
  return Object.values(s.decisions).map((d) => ({
    householdId: d.householdId, lane: d.lane, resourceId: d.resourceId, etaH: d.etaH, slot119: d.slot119, late119: d.late119,
  }));
}

function stateFromDecisions(s: Session): AllocState {
  const ds = Object.values(s.decisions);
  return {
    usedResourceIds: ds.filter((d) => d.resourceId && (d.lane === "PROPOSE_ASSIGN" || d.lane === "GAP_REDUCE")).map((d) => d.resourceId!),
    slots119: ds.filter((d) => d.lane === "FALLBACK_119" && d.slot119).map((d) => ({ ...d.slot119!, kind: "CALL" as const })),
    shelterSeatsUsed: ds.filter((d) => d.lane === "FALLBACK_SHELTER").length,
  };
}

function pushAudit(s: Session, entries: AuditEntry[]): Session {
  for (const e of entries) {
    const v = auditEntryRuleSchema.safeParse(e);
    if (!v.success) throw new Error(`감사 행 규칙 위반: ${v.error.issues[0]?.message}`);
  }
  return { ...s, audit: [...s.audit, ...entries], auditSeq: s.auditSeq + entries.length };
}

/** 재계산(1.4절 '재계산'): 승인 행 고정, 나머지 RULE, 승인 행 재검토, HOLD 시한 경과 처리 */
export function recompute(s0: Session, nowS: number = s0.nowS): Session {
  if (!s0.started) return { ...s0, nowS };
  let s: Session = { ...s0, nowS };
  const at = nowIso(s);
  const opts = allocOpts(s);
  const restoration = restorationAt(s, nowS);

  // HOLD 시한 경과 → forceNeed (직전 결과 기준)
  const prevRows = s0.result?.rows.map((r) => ({ householdId: r.rec.householdId, lane: r.rec.lane, holdRecheckBy: r.rec.holdRecheckBy })) ?? [];
  const expired = prevRows.filter((p) => p.lane === "HOLD" && p.holdRecheckBy != null && nowS >= qT(p.holdRecheckBy) && !s.decisions[p.householdId]);
  const forceNeedIds = [...new Set([...s.forceNeedIds, ...expired.map((e) => e.householdId)])];

  const free = s.households.filter((h) => !s.decisions[h.id]);
  const result = rule(viewAt(s, nowS, free), opts, { ...stateFromDecisions(s), forceNeedIds });
  if (expired.length > 0) {
    const next = result.rows.map((r) => ({ householdId: r.rec.householdId, lane: r.rec.lane, resourceId: r.rec.resourceId }));
    s = pushAudit(s, holdExpiredEntries(prevRows.filter((p) => expired.some((e) => e.householdId === p.householdId)), sToH(nowS), at, next));
  }

  // 승인 행 재검토(재신고·자원 불가·시계 경과)
  const rc = recheckApproved(viewAt(s, nowS), approvedRows(s), at, opts);
  const flagged: Record<string, string> = {};
  const alternatives: Record<string, AllocRow> = {};
  const fresh: AuditEntry[] = [];
  for (const f of rc.flagged) {
    flagged[f.householdId] = String(f.reason.params.why);
    if (!s.flagged[f.householdId]) fresh.push(...rc.audit.filter((a) => a.householdId === f.householdId));
  }
  for (const a of rc.alternatives) alternatives[a.rec.householdId] = a;
  s = pushAudit(s, fresh);
  return { ...s, result, restoration, forceNeedIds, flagged, alternatives };
}

export function start(s: Session): Session {
  return recompute({ ...s, started: true, purged119Ids: [] });
}

// ---------- 승인 서랍이 쓰는 결정 저장 ----------

/** 추천 행을 결정으로 바꿀 때 필요한 값(ETA·119 슬롯) */
export function decisionFromRow(row: AllocRow): Omit<Decision, "status" | "decidedAtS"> {
  const r = row.rec;
  // 자원 레인은 도착 절대 시각, 119는 이송 완료 예상 절대 시각(Recommendation.etaH 그대로)
  return { householdId: r.householdId, lane: r.lane, resourceId: r.resourceId, etaH: r.etaH, slot119: row.slot119, late119: row.late119 };
}

/** 결정 저장 + 감사 행(APPROVE·MODIFY). 상태 문자열은 호출자(ApproveDrawer)가 정한다.
 *  ticket: 승인 서랍의 실제 조작으로 발급한 표(approvalGate). 조작 1번 = 결정 1건 */
export function commitDecision(s: Session, d: Decision, audit: AuditEntry, ticket: ApprovalTicket): Session {
  const ticketId = consumeApproval(ticket, d, audit);
  // 이미 적용한 표: React 재실행은 적용 전 상태로 다시 부르므로 같은 결과가 되고, 적용된 상태에 다시 부르면 그대로 둔다
  if (s.appliedTickets.includes(ticketId)) return s;
  const s1 = pushAudit({ ...s, appliedTickets: [...s.appliedTickets, ticketId] }, [audit]);
  const { [d.householdId]: _drop, ...alts } = s1.alternatives;
  void _drop;
  // 파기 뒤 같은 가구를 다시 결정하면 새 결정이므로 119 화면에 다시 보인다
  const purged119Ids = s1.purged119Ids.filter((id) => id !== d.householdId);
  return recompute({ ...s1, decisions: { ...s1.decisions, [d.householdId]: d }, alternatives: alts, purged119Ids });
}

/** 운영자 숫자 입력 파싱: 0 이상 십진수만(빈 칸·공백·"abc"·"0x1"·"1e1"·음수는 null). 빈 칸이 0으로 바뀌어 하한이 오르는 것을 막는다 */
export function parseOperatorNumber(raw: string): number | null {
  const t = raw.trim();
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

export const MODIFY_REASON_CODES = [
  { code: "FIELD_INFO", label: "현장 정보(가구 연락·방문)" },
  { code: "RESOURCE_STATE", label: "자원 상태 변경" },
  { code: "ROUTE", label: "도로·이동 여건" },
  { code: "LINK_119", label: "119 연계 판단" },
  { code: "OTHER", label: "기타" },
] as const;

export interface ModifyOption { lane: Lane; resourceId?: string; aS?: number; feasible?: boolean; label: string }

/** 「수정」에서 고를 수 있는 레인·자원(1.4절). 수동검토 완료 전에는 PROPOSE_ASSIGN 불가 */
export function modifyOptions(s: Session, householdId: string): ModifyOption[] {
  const hh = s.households.find((h) => h.id === householdId);
  if (!hh) return [];
  const usedIds = new Set(stateFromDecisions(s).usedResourceIds);
  const pool = s.preset.planner.resources.filter((r) => r.available && !usedIds.has(r.id));
  const ctx = buildCtx(viewAt(s, s.nowS, [hh]), allocOpts(s));
  const info = ctx.byId.get(householdId)!;
  const out: ModifyOption[] = [];
  if (!info.manual) {
    for (const c of physCandidates(ctx, info, pool)) {
      if (c.f.feasible) out.push({ lane: "PROPOSE_ASSIGN", resourceId: c.res.id, aS: c.f.aS, feasible: true, label: `자원 ${c.res.id}(${c.res.kind}) 배정 · 도착 ${fmtHours(c.f.aS)}` });
      out.push({ lane: "GAP_REDUCE", resourceId: c.res.id, aS: c.f.aS, feasible: c.f.feasible, label: `자원 ${c.res.id}(${c.res.kind}) 공백 단축 · 도착 ${fmtHours(c.f.aS)}` });
    }
  } else {
    // 하한을 모르므로 물리 필터를 다 볼 수 없다: 가용 자원 중 호환 자원을 GAP_REDUCE로만 허용(1.4절)
    for (const r of pool) out.push({ lane: "GAP_REDUCE", resourceId: r.id, label: `자원 ${r.id}(${r.kind}) 공백 단축(수동검토 중)` });
  }
  out.push({ lane: "FALLBACK_119", label: "119 연계" });
  out.push({ lane: "FALLBACK_SHELTER", label: "쉼터 이동" });
  return out;
}

/** 수정 결정에 쓸 ETA(자원 레인만, 계획 도착 절대 시각 h) */
export function etaForResource(s: Session, householdId: string, resourceId: string): number | undefined {
  const hh = s.households.find((h) => h.id === householdId);
  const res = s.preset.planner.resources.find((r) => r.id === resourceId);
  if (!hh || !res) return undefined;
  const ctx = buildCtx(viewAt(s, s.nowS, [hh]), allocOpts(s));
  return sToH(s.nowS + arrivalS(ctx, ctx.byId.get(householdId)!, res));
}

// ---------- 확인 조작 (1.4절, 사유 필수) ----------
export const VERIFY_CTX: VerifyContext = {
  cylHoursLoPerUnitH: pNum("lb.cyl.hoursLoPerUnitH"),
  extForSpecIds: new Map([...DB.ext.values()].map((e) => [e.extSpecId, e.forSpecIds] as const)),
};

export type VerifyInput =
  | { action: "VERIFY_EXT"; householdId: string; extIndex: number; count: number; chargeConfirmed: boolean; reasonText: string }
  | { action: "VERIFY_CYL"; householdId: string; count: number; hoursLo: number; reasonText: string }
  | { action: "VERIFY_AGE"; householdId: string; batteryAgeY: number; reasonText: string }
  | { action: "VERIFY_MODEL"; householdId: string; reasonText: string }
  | { action: "MANUAL_REVIEW_DONE"; householdId: string; specId?: string; operatorLowerH?: number; reasonText: string };

export type VerifyOutcome = { ok: true; session: Session } | { ok: false; error: string };

export function applyVerify(s: Session, v: VerifyInput): VerifyOutcome {
  const idx = s.households.findIndex((h) => h.id === v.householdId);
  if (idx < 0) return { ok: false, error: "가구 없음" };
  const hh = s.households[idx];
  if (v.reasonText.trim().length === 0) return { ok: false, error: "사유를 입력하세요" };
  const auditId = `A${s.auditSeq + 1}`;
  const laneNow = laneOf(s, hh.id);
  let next: HouseholdView;
  let payload: AuditEntry["payload"] = {};
  if (v.action === "VERIFY_EXT") {
    const decl = hh.ext[v.extIndex];
    const p = { extSpecId: decl?.extSpecId ?? "", count: v.count, ...(v.chargeConfirmed ? { chargeConfirmed: "device_screen" as const } : {}) };
    const r = verifyExtPayloadSchema(hh, v.extIndex, VERIFY_CTX).safeParse(p);
    if (!r.success) return { ok: false, error: r.error.issues[0]?.message ?? "저장 불가" };
    next = { ...hh, ext: hh.ext.map((e, i) => i === v.extIndex ? { ...e, opVerified: { count: v.count, chargeConfirmed: v.chargeConfirmed ? "device_screen" : null, extAgeY: null, auditId } } : e) };
    payload = p;
  } else if (v.action === "VERIFY_CYL") {
    const p = { count: v.count, hoursLo: v.hoursLo };
    const r = verifyCylPayloadSchema(hh, VERIFY_CTX).safeParse(p);
    if (!r.success) return { ok: false, error: r.error.issues[0]?.message ?? "저장 불가" };
    next = { ...hh, cylinder: { declared: true, opVerified: { ...p, auditId } } };
    payload = p;
  } else if (v.action === "VERIFY_AGE") {
    const p = { batteryAgeY: v.batteryAgeY, basis: v.reasonText };
    const r = verifyAgePayloadSchema.safeParse(p);
    if (!r.success) return { ok: false, error: r.error.issues[0]?.message ?? "저장 불가" };
    next = { ...hh, device: { ...hh.device, batteryAgeY: v.batteryAgeY } };
    payload = p;
  } else if (v.action === "VERIFY_MODEL") {
    if (hh.device.specBy !== "ai_label_user_confirmed") return { ok: false, error: "AI 판독 정확 일치 + 가구 확인 행에만 쓸 수 있습니다" };
    next = { ...hh, device: { ...hh.device, specBy: "db_exact" } };
    payload = { specId: hh.device.specId ?? undefined };
  } else {
    if (computeLowerBoundDetail(hh, DB).lb.status !== "MANUAL_REVIEW") return { ok: false, error: "수동검토 행이 아닙니다" };
    if (v.specId) {
      if (!DB.devices.has(v.specId)) return { ok: false, error: "DB에 없는 기종" };
      next = { ...hh, device: { ...hh.device, specId: v.specId, specBy: "operator" } };
      payload = { specId: v.specId };
    } else if (v.operatorLowerH != null && Number.isFinite(v.operatorLowerH) && v.operatorLowerH > 72) {
      return { ok: false, error: "보수 하한은 72시간 이하로 입력하세요(시뮬레이션 상한과 같음)" };
    } else if (v.operatorLowerH != null && Number.isFinite(v.operatorLowerH) && v.operatorLowerH > 0) {
      next = { ...hh, device: { ...hh.device, operatorLowerH: { hours: v.operatorLowerH, basis: v.reasonText, auditId } } };
      payload = { operatorLowerH: v.operatorLowerH, basis: v.reasonText };
    } else {
      return { ok: false, error: "DB 기종 선택 또는 보수 하한(시간) 중 하나가 필요합니다" };
    }
    if (computeLowerBoundDetail(next, DB).lb.status === "MANUAL_REVIEW") return { ok: false, error: "입력 뒤에도 자동 계산이 안 됩니다(연속 기기가 아님). 보수 하한을 입력하세요" };
  }
  // 확인 조작은 재신고가 아니다: 지난 신고마다 지금 확인값으로 다시 센 끝의 최솟값으로 묶음을 다시 쓴다(순서 무관, 통합 레드팀 16·17라운드)
  const rebased = rebasePrev(next);
  if (rebased.lEndPrev !== next.lEndPrev) payload = { ...payload, lEndPrevH: [next.lEndPrev, rebased.lEndPrev] };
  next = rebased;
  const entry: AuditEntry = {
    at: nowIso(s), actor: "demo-operator", householdId: hh.id, action: v.action,
    from: { lane: laneNow }, to: { lane: laneNow }, reasonText: v.reasonText, payload,
  };
  const households = s.households.map((h, i) => (i === idx ? next : h));
  return { ok: true, session: recompute(pushAudit({ ...s, households }, [entry])) };
}

/**
 * 재신고 단조 묶음(3.9절)을 지난 신고 근거로 다시 센다: lEndPrev = min_i(t_i + L(지금 확인값, 신고 i의 충전량·화면 남은 시간)).
 * 3.9절 비증가의 근거는 '배터리가 다시 차지 않는다'이고, 운영자 확인(외장·산소통·연식·기종·보수 하한)은 그 대상이 아니다.
 * 확인 → 재신고와 재신고 → 확인이 같은 값이 된다. 16라운드의 '확인 전후 L 차이만큼 옮기기'는 더하기 꼴(외장·산소통)에만 맞아,
 * 충전량과 곱해지는 연식과 수동검토 완료는 순서에 따라 갈렸다(통합 레드팀 17라운드). 엔진(봉인)은 그대로다.
 * 보수 하한(수동검토 완료)도 지난 신고 시각부터 센다(확인 → 재신고 순서와 같은 기준).
 */
function rebasePrev(h: HouseholdView): HouseholdView {
  const hist = h.reportHistory;
  if (!hist?.length) return h;
  let e: number | null = null, eB: number | null = null;
  for (const b of hist) {
    const hb: HouseholdView = { ...h, tReport: b.tReport, lEndPrev: null, device: { ...h.device, charge: b.charge, screenRemainingH: b.screenRemainingH } };
    const x = computeLowerBoundDetail(hb, DB).endS;
    const xB = h.cylinder ? computeLowerBoundDetail({ ...hb, cylinder: undefined }, DB).endS : x;
    if (x != null) e = e == null ? x : Math.min(e, x);
    if (xB != null) eB = eB == null ? xB : Math.min(eB, xB);
  }
  return { ...h, lEndPrev: e != null ? sToH(e) : null, lEndPrevBattery: eB != null ? sToH(eB) : null };
}

/** 가구 재신고(시연, 3.9절): 정전 중에는 L_end 비증가 */
export function reReport(s: Session, householdId: string, chargePct: number): Session {
  const idx = s.households.findIndex((h) => h.id === householdId);
  if (idx < 0) return s;
  const hh = s.households[idx];
  const prevEnd = computeLowerBoundDetail(hh, DB).endS;
  // 보호자 알림용: 배터리만의 끝도 같은 단조 규칙으로 따로 남긴다(산소통 확인값이 바뀌어도 배터리 끝이 늘지 않게)
  const prevBatteryEnd = hh.cylinder ? computeLowerBoundDetail({ ...hh, cylinder: undefined, lEndPrev: hh.lEndPrevBattery ?? null }, DB).endS : prevEnd;
  const next: HouseholdView = {
    ...hh, tReport: sToH(s.nowS), lEndPrev: prevEnd != null ? sToH(prevEnd) : null,
    lEndPrevBattery: prevBatteryEnd != null ? sToH(prevBatteryEnd) : null,
    device: { ...hh.device, charge: { value: Math.max(0, Math.min(100, Math.round(chargePct))), source: "user" } },
    // 이 신고 전의 신고 근거를 쌓는다(뒤의 확인 조작이 묶음을 다시 셀 때 쓴다, 통합 레드팀 17라운드)
    reportHistory: [...(hh.reportHistory ?? []), { tReport: hh.tReport, charge: hh.device.charge, ...(hh.device.screenRemainingH != null ? { screenRemainingH: hh.device.screenRemainingH } : {}) }],
  };
  return recompute({ ...s, households: s.households.map((h, i) => (i === idx ? next : h)) });
}

export function setNotice(s: Session, n: Notice | null): Session {
  return recompute({ ...s, notice: n });
}

/** 119 연계 화면 파기: 그 시점에 보이는 FALLBACK_119 건만 지우고 가구마다 감사 행을 남긴다 */
export function purge119(s: Session): Session {
  const ids = visible119Ids(s);
  if (ids.length === 0) return s;
  const at = nowIso(s);
  return pushAudit({ ...s, purged119Ids: [...s.purged119Ids, ...ids] }, ids.map((householdId) => ({
    at, actor: "demo-operator" as const, householdId, action: "PURGE_119" as const,
    from: { lane: "FALLBACK_119" as const }, to: { lane: "FALLBACK_119" as const }, reasonText: "재난 대응 종료 파기(119 연계 화면 표시분)",
  })));
}

/** /ops/119에 보일 가구 id: 운영자가 결정한 FALLBACK_119 중 파기하지 않은 것 */
export function visible119Ids(s: Session): string[] {
  return Object.values(s.decisions).filter((d) => d.lane === "FALLBACK_119" && !s.purged119Ids.includes(d.householdId)).map((d) => d.householdId);
}

// ---------- 표시 보조 ----------
export function laneOf(s: Session, householdId: string): Lane {
  return s.decisions[householdId]?.lane ?? s.result?.rows.find((r) => r.rec.householdId === householdId)?.rec.lane ?? "UNSERVED_VISIBLE";
}

export function deviceClass(hh: HouseholdView): DeviceClass {
  const cls = (hh.device.specId != null ? DB.devices.get(hh.device.specId)?.cls : undefined) ?? "UNKNOWN";
  // 표시용 등급(배정 입력 아님, I5): 실린더를 신고한 거치형은 하위 등급으로 보인다
  return cls === "O2_STAT" && hh.cylinder?.declared ? "O2_STAT_CYL" : cls;
}

export function fmtHours(s: number): string {
  return `${(Math.round((s / 3600) * 100) / 100).toFixed(2)}h`;
}

export function lEndH(hh: HouseholdView): number | null {
  const e = computeLowerBoundDetail(hh, DB).endS;
  return e == null ? null : sToH(e);
}
