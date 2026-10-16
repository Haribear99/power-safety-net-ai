// 원안 판단식 구현 규칙 RULE (spec.md 4.1절, margin-gated least-slack greedy)과 공용 배정 골격. 비AI, 결정적.
// 기준선(4.2절)도 같은 골격을 쓴다: 같은 물리 필터·같은 검토 예약·같은 대체 레인, 차이는 필요성 판정·0.8L 도착 필터·처리 순서뿐.
// 결과는 모두 PROPOSED다. APPROVED·MODIFIED는 운영자 승인 이벤트(ApproveDrawer)로만 생긴다(I6).
// 결정 시점 재실행(4.3절 ②): AllocState로 이미 고정된 자원·119 슬롯·쉼터 좌석을 넘기고, view.households에는 아직 배정되지 않은 가구만 넣는다.
import type { AuditEntry, Lane, PlannerView, Recommendation, ResourceView } from "../domain/types";
import { aStarEndS, arrivalLimitS, marginH, slackS, tierOf } from "../engine/margin";
import { pNum } from "../engine/params";
import { plan119S, transport119S } from "../engine/arrival";
import { NEG_INF_S, qT, sToH } from "../engine/quantize";
import {
  bestGapReduce, bookSlot, makePlanner119, nextSlotStartS, onTime119, plan119DoneS, remainingSlotsBefore, reserveCap,
  step6Lane, type Planner119, type Slot119, type Step6State,
} from "./fallback";
import {
  buildCtx, cmpStr, compatible, filterReport, inverterOk, physCandidates, type AllocCtx, type AllocOptions, type Candidate, type HHInfo,
} from "./feasible";
import { judgeNeed, NEED_WHY_KO, type NeedResult } from "./need";
import { fmtH, type Reason } from "./reasons";

export type PolicyId =
  | "RULE" | "B1_SHORTEST" | "B2_NEAREST" | "R_L" | "RULE_NO_R" | "RULE_FEASIBLE_FIRST" | "RULE_NO_RESERVE" | "ORACLE_INFO" | "NONE";

export interface PolicyCfg {
  id: PolicyId;
  /** 4.1절 3단계 필요성 판정(HOLD) 사용 */
  need: boolean;
  /** 0.8L 도착 필터 사용(PROPOSE_ASSIGN의 정의 + 루프 안 ①119·②GAP_REDUCE) */
  arrivalFilter: boolean;
  /** 처리 순서 키 */
  order: "TIER_SLACK" | "SLACK" | "L";
  /** v1: 도착 필터 통과 가구만 루프에서 처리하고 나머지는 6단계로 */
  feasibleFirst: boolean;
  /** 4.1절 2단계 물리 검토 예약 */
  reserve: boolean;
  /** GREEDY_HH: 가구 하나씩, PAIR_A: (i,j) 쌍 A 오름차순 탐욕 매칭(B2) */
  matching: "GREEDY_HH" | "PAIR_A";
  /** 가능 자원 고르기: 최소 낭비(RULE) / 가장 가까운 물리 가능 자원(B1) */
  pick: "MIN_WASTE" | "NEAREST";
}

export const RULE_CFG: PolicyCfg = {
  id: "RULE", need: true, arrivalFilter: true, order: "TIER_SLACK", feasibleFirst: false, reserve: true,
  matching: "GREEDY_HH", pick: "MIN_WASTE",
};

export interface Reservation {
  resourceId: string | null;
  slot119: Slot119 | null;
  /** 예약 시한 = tReport + mrHoldH (절대 정수 초) */
  untilS: number;
  /** 자원 예약이 없을 때 사유: CAP | NONE | EXPIRED | POLICY | WAITING */
  noResourceWhy: "CAP" | "NONE" | "EXPIRED" | "POLICY" | "WAITING" | null;
}

export interface AllocRow {
  rec: Recommendation;
  status: "PROPOSED";
  lEndS: number | null;
  slackS: number | null;
  aS?: number;
  aEndS?: number;
  slot119?: Slot119;
  late119?: boolean;
  deltaS?: number;
  reservation?: Reservation;
  need?: NeedResult;
  /** 부가 근거(R-EXT0 등) */
  notes: Reason[];
}

export interface CarriedReservation {
  householdId: string;
  resourceId: string | null;
  slot119: Slot119 | null;
  untilS: number;
}

export interface AllocState {
  usedResourceIds?: readonly string[];
  /** CALL 슬롯과, 아직 수동검토 중인 가구의 RESERVE 슬롯 */
  slots119?: readonly Slot119[];
  shelterSeatsUsed?: number;
  /**
   * 이전 결정 시점의 검토 예약. 그 가구가 이번에도 MANUAL_REVIEW이고 시한 전이면 그대로 유지하고,
   * 검토가 끝났거나(재진입) 시한이 지나면 푼다(4.1절 2단계). 없으면 이번 시점에 새로 계산한다.
   */
  reservations?: readonly CarriedReservation[];
  /**
   * true면 새 검토 예약을 만들지 않고 넘겨받은 예약만 유지한다. 시뮬레이션의 둘째 결정 시점부터(4.3절 ②: 재실행 대상은
   * 재진입·만료 HOLD·UNSERVED_VISIBLE뿐이고 검토 대기 가구는 다시 돌지 않으므로 예약은 첫 시점 것이 시한까지 유지된다.
   * 차등 시험 결정, DEVLOG TASK D)
   */
  carryOnlyReservations?: boolean;
  /**
   * 재확인 시한이 지나 다시 도는 HOLD 가구. 필요성 판정을 다시 하지 않고 '필요'로 되돌린다(3.9절 'now ≥ holdRecheckBy이면
   * HOLD를 자동으로 필요로', 1.4절 HOLD_EXPIRED). 다시 판정하면 예약 해제로 A_min이 줄어 HOLD가 되풀이될 수 있다(DEVLOG TASK D)
   */
  forceNeedIds?: readonly string[];
}

export interface AllocResult {
  policy: PolicyId;
  nowS: number;
  rows: AllocRow[];
  /** 이번 결과까지 소모된 자원(state 포함, 검토 예약 제외) */
  usedResourceIds: string[];
  /** 계획자 대기열(state의 슬롯 + 이번 CALL·RESERVE) */
  slots119: Slot119[];
  shelterSeatsUsed: number;
  reserveCapResources: number;
  reserveCap119: number;
  protectedResourceIds: string[];
}

const NO_RES_WHY_KO: Record<NonNullable<Reservation["noResourceWhy"]>, string> = {
  CAP: "예약 상한 도달",
  NONE: "예약 가능한 자원 없음",
  EXPIRED: "예약 시한 경과",
  POLICY: "검토 예약 없는 비교 규칙",
  WAITING: "검토 대기 중 · 첫 결정 시점 예약만 유지",
};

const LANE_RANK: Record<Lane, number> = {
  MANUAL_REVIEW: 0, PROPOSE_ASSIGN: 1, FALLBACK_119: 2, GAP_REDUCE: 3, FALLBACK_SHELTER: 4, HOLD: 5, UNSERVED_VISIBLE: 6,
};
export function laneRank(l: Lane): number {
  return LANE_RANK[l];
}

interface Keyed { info: HHInfo; phys: Candidate[]; slack: number; tier: 0 | 1 }

function keyCmp(cfg: PolicyCfg, a: Keyed, b: Keyed): number {
  const la = a.info.lEndS as number, lb = b.info.lEndS as number;
  if (cfg.order === "TIER_SLACK" && a.tier !== b.tier) return a.tier - b.tier;
  if (cfg.order !== "L" && a.slack !== b.slack) return a.slack - b.slack;
  if (la !== lb) return la - lb;
  return cmpStr(a.info.hh.id, b.info.hh.id);
}

/** 커넥터 폭 = {AC220, DC12}와의 교집합 크기('AC220+DC12 우선', 4.1절 2단계) */
function breadth(r: ResourceView): number {
  return r.connectors.filter((c) => c === "AC220" || c === "DC12").length;
}

function extNotes(info: HHInfo): Reason[] {
  if (!info.lbd.lb.flags.includes("EXT_UNVERIFIED_ZERO")) return [];
  let n = 0;
  for (const e of info.hh.ext) n += e.opVerified ? Math.max(0, e.declaredCount - e.opVerified.count) : e.declaredCount;
  return n > 0 ? [{ templateId: "R-EXT0", params: { n } }] : [];
}

/** 공용 배정 골격 */
export function allocate(view: PlannerView, cfg: PolicyCfg, opts: AllocOptions = {}, state: AllocState = {}): AllocResult {
  const ctx = buildCtx(view, opts);
  const now = ctx.nowS;
  const mrHoldS = qT(pNum("alloc.mrHoldH"));
  const used = new Set(state.usedResourceIds ?? []);
  const pool0 = view.resources.filter((r) => r.available && !used.has(r.id)).sort((a, b) => cmpStr(a.id, b.id));
  const mrIds = new Set(ctx.infos.filter((i) => i.manual).map((i) => i.hh.id));
  const carried = new Map<string, CarriedReservation>();
  if (cfg.reserve) for (const c of state.reservations ?? []) if (mrIds.has(c.householdId) && now < c.untilS) carried.set(c.householdId, c);
  // RESERVE 슬롯은 예약이 유지되는 가구 것만 남긴다(검토 완료·시한 경과면 대기열에서 지운다)
  const queue: Planner119 = makePlanner119(view.lanes.k119PerH,
    (state.slots119 ?? []).filter((x) => x.kind === "CALL" || carried.get(x.householdId)?.slot119 != null));
  let shelterLeft = Math.max(0, view.lanes.shelter.seats - (state.shelterSeatsUsed ?? 0));
  const rows: AllocRow[] = [];
  let order = 0;

  const base = (info: HHInfo, lane: Lane, reason: Reason, extra: Partial<Recommendation> = {}): Recommendation => ({
    householdId: info.hh.id, lane, order: -1, L: info.lbd.lb, R: view.restoration,
    marginH: null, slackH: null, tier: null, reason, ...extra,
  });

  const mr = ctx.infos.filter((i) => i.manual).sort((a, b) => qT(a.hh.tReport) - qT(b.hh.tReport) || cmpStr(a.hh.id, b.hh.id));
  const auto = ctx.infos.filter((i) => !i.manual);

  // ---- 물리 후보(검토 예약 전 전체 풀) ----
  const prePhys = new Map<string, Candidate[]>();
  for (const info of auto) prePhys.set(info.hh.id, physCandidates(ctx, info, pool0));

  // ---- 2단계 검토 예약 ----
  // 제약 ②: tier 0 ∧ slack < mrHoldH인 비수동검토 가구(HOLD 후보 포함, 예약 전 전체 풀 기준)의 유일한 phys 자원
  const protectedIds = new Set<string>();
  for (const info of auto) {
    const p = prePhys.get(info.hh.id)!;
    const lEnd = info.lEndS as number;
    const sl = slackS(lEnd, now, p.length > 0 ? p[0].f.aS : null);
    if (tierOf(lEnd, ctx.r.p90S) === 0 && sl < mrHoldS && p.length === 1) protectedIds.add(p[0].res.id);
  }
  // 상한: 자원 floor(가용 × 1/5), 119 floor([now, now + mrHoldH)에 시작 가능한 남은 슬롯 × 1/5). 유지 예약도 상한에 센다
  const capRes = reserveCap(pool0.length);
  const cap119 = reserveCap(remainingSlotsBefore(queue, now, now + mrHoldS));
  const reserved = new Set<string>();
  let n119 = 0;
  for (const c of carried.values()) {
    if (c.resourceId && pool0.some((r) => r.id === c.resourceId)) reserved.add(c.resourceId);
    if (c.slot119) n119 += 1;
  }
  for (const info of mr) {
    const untilS = qT(info.hh.tReport) + mrHoldS;
    const resv: Reservation = { resourceId: null, slot119: null, untilS, noResourceWhy: null };
    const keep = cfg.reserve ? carried.get(info.hh.id) : undefined;
    if (now >= untilS) resv.noResourceWhy = "EXPIRED";
    else if (!cfg.reserve) resv.noResourceWhy = "POLICY";
    else {
      if (keep?.resourceId && reserved.has(keep.resourceId)) resv.resourceId = keep.resourceId; // 유지 예약
      else if (state.carryOnlyReservations) resv.noResourceWhy = "WAITING";
      else if (reserved.size >= capRes) resv.noResourceWhy = "CAP";
      else {
        const cands = pool0
          .filter((r) => !reserved.has(r.id) && !protectedIds.has(r.id) && compatible(info.env, r) && inverterOk(info.env, r))
          .map((r) => ({ r, a: filterReport(ctx, info, r).aS }))
          .sort((x, y) => x.a - y.a || breadth(y.r) - breadth(x.r) || y.r.outputW - x.r.outputW || cmpStr(x.r.id, y.r.id));
        if (cands.length > 0) {
          resv.resourceId = cands[0].r.id;
          reserved.add(cands[0].r.id);
        } else resv.noResourceWhy = "NONE";
      }
      if (keep?.slot119) resv.slot119 = keep.slot119; // 유지 예약(대기열에 이미 있음)
      else if (!state.carryOnlyReservations && n119 < cap119) {
        resv.slot119 = bookSlot(queue, info.hh.id, now, "RESERVE");
        n119 += 1;
      }
    }
    const t = fmtH(untilS - now);
    const r119 = resv.slot119 ? `슬롯 시작 ${fmtH(resv.slot119.startS - now)}h 뒤` : "없음";
    const reason: Reason = resv.resourceId
      ? { templateId: "R-MR", params: { res: resv.resourceId, r119, t } }
      : { templateId: "R-MR-NORES", params: { why: NO_RES_WHY_KO[resv.noResourceWhy ?? "NONE"], r119, t } };
    rows.push({
      rec: { ...base(info, "MANUAL_REVIEW", reason), order: order++, ...(resv.resourceId ? { reservedResourceId: resv.resourceId } : {}) },
      status: "PROPOSED", lEndS: null, slackS: null, reservation: resv, notes: extNotes(info),
    });
  }

  // ---- 3단계 필요성 판정: 4.1절 단계 순서대로 검토 예약 뒤 풀 기준 phys(i)·A_min(차등 시험 결정, DEVLOG TASK D) ----
  const pre = new Map<string, { phys: Candidate[]; need: NeedResult | null }>();
  for (const info of auto) {
    const phys = prePhys.get(info.hh.id)!.filter((c) => !reserved.has(c.res.id));
    let need = cfg.need ? judgeNeed(ctx, info, phys.length > 0 ? phys[0].f.aS : null) : null;
    if (need?.hold && state.forceNeedIds?.includes(info.hh.id)) need = { ...need, hold: false, why: "HOLD_EXPIRED" };
    pre.set(info.hh.id, { phys, need });
  }
  const holds = auto.filter((i) => pre.get(i.hh.id)?.need?.hold === true);
  const U = auto.filter((i) => pre.get(i.hh.id)?.need?.hold !== true);

  // ---- 5단계 ----
  const pool: ResourceView[] = pool0.filter((r) => !reserved.has(r.id));
  const physCache = new Map<string, Candidate[]>();
  for (const info of U) physCache.set(info.hh.id, pre.get(info.hh.id)!.phys);
  const taken = new Set<string>();
  const physOf = (info: HHInfo) => physCache.get(info.hh.id)!.filter((c) => !taken.has(c.res.id));
  const take = (id: string) => {
    taken.add(id);
    const k = pool.findIndex((r) => r.id === id);
    if (k >= 0) pool.splice(k, 1);
  };
  const deferred: { info: HHInfo; k: Keyed; order: number }[] = [];

  // 5단계 1항: slack = 0.8·L − min A. 물리 자원이 없는 가구는 −∞가 아니라 119 레인 계획 도착(A_119 계획 + 이송 0.33h)으로 잰다.
  // −∞로 두면 하한이 10시간 남은 가구도 맨 앞에서 119 첫 슬롯을 가져간다(Phase 2 화면 점검에서 발견, DEVLOG·spec 라운드 4)
  const a119PlanS = plan119S(view.lanes.a119H, ctx.stress119) + transport119S();
  const slackOf = (lEnd: number, phys: readonly Candidate[]) => slackS(lEnd, now, phys.length > 0 ? phys[0].f.aS : a119PlanS);
  const keyed = (info: HHInfo): Keyed => {
    const phys = physOf(info);
    const lEnd = info.lEndS as number;
    return { info, phys, slack: slackOf(lEnd, phys), tier: tierOf(lEnd, ctx.r.p90S) };
  };

  const r90Rem = ctx.r.p90S - now;
  const r80Rem = ctx.r.p80S - now;

  const commonRec = (k: Keyed, aStarEnd: number | null) => {
    const lEnd = k.info.lEndS as number;
    return {
      marginH: marginH(lEnd, ctx.r.p10S, ctx.r.p90S, aStarEnd),
      slackH: sToH(k.slack), tier: k.tier,
    };
  };
  const feasibleAEnds = (k: Keyed) => k.phys.filter((c) => c.f.feasible).map((c) => c.f.aS);

  const pushResource = (k: Keyed, c: Candidate, ord: number, lane: "PROPOSE_ASSIGN" | "GAP_REDUCE", reason: Reason, deltaS?: number) => {
    const aEnd = c.f.aEndS;
    rows.push({
      rec: {
        ...base(k.info, lane, reason), order: ord, resourceId: c.res.id, etaH: sToH(aEnd),
        ...commonRec(k, aStarEndS(now, c.f.aS, [])),
      },
      status: "PROPOSED", lEndS: k.info.lEndS, slackS: k.slack, aS: c.f.aS, aEndS: aEnd, deltaS,
      need: pre.get(k.info.hh.id)?.need ?? undefined, notes: extNotes(k.info),
    });
  };
  const push119 = (k: Keyed, ord: number, slot: Slot119, doneS: number, late: boolean) => {
    const lRem = (k.info.lEndS as number) - now;
    const reason: Reason = late
      ? { templateId: "R-119-LATE", params: { s0: fmtH(slot.startS - now), done: fmtH(doneS - now), L: fmtH(lRem) } }
      : { templateId: "R-119", params: { s: fmtH(k.slack), done: fmtH(doneS - now), L: fmtH(lRem) } };
    rows.push({
      rec: { ...base(k.info, "FALLBACK_119", reason), order: ord, etaH: sToH(doneS), ...commonRec(k, aStarEndS(now, null, feasibleAEnds(k))) },
      status: "PROPOSED", lEndS: k.info.lEndS, slackS: k.slack, slot119: slot, late119: late,
      need: pre.get(k.info.hh.id)?.need ?? undefined, notes: extNotes(k.info),
    });
  };

  const assignReason = (k: Keyed, c: Candidate): Reason => {
    const lEnd = k.info.lEndS as number;
    const lRem = lEnd - now;
    const mg = marginH(lEnd, ctx.r.p10S, ctx.r.p90S, c.f.aEndS);
    const common = {
      tier: k.tier, R90: fmtH(r90Rem), s: fmtH(k.slack), res: c.res.id, A: fmtH(c.f.aS), L08: fmtH(arrivalLimitS(lEnd, now)),
      W: c.res.outputW, w: k.info.env.drawHiW,
      conn: c.res.connectors.filter((x) => k.info.env.connectors.includes(x)).join("+"),
      mlo: fmtH(qT(mg.lo)), mhi: fmtH(qT(mg.hi)), L: fmtH(lRem), R80: fmtH(r80Rem),
    };
    if (lRem < r80Rem) return { templateId: "R-ASSIGN", params: common };
    const need = pre.get(k.info.hh.id)?.need;
    return { templateId: "R-ASSIGN-DEF", params: { ...common, why: need?.why ? NEED_WHY_KO[need.why] : "필요성 판정 없음" } };
  };
  const baseReason = (k: Keyed, c: Candidate): Reason => ({
    templateId: "R-BASE",
    params: {
      policy: cfg.id, res: c.res.id, A: fmtH(c.f.aS), L08: fmtH(arrivalLimitS(k.info.lEndS as number, now)),
      arr: c.f.feasible ? "안 도착" : "밖 도착 · 공백 단축 목적",
    },
  });

  if (cfg.matching === "PAIR_A") {
    // B2: 물리 가능 (i,j) 쌍을 A 오름차순으로 탐욕 매칭
    const pairs: { k: Keyed; c: Candidate }[] = [];
    const ks = U.map(keyed);
    for (const k of ks) for (const c of k.phys) pairs.push({ k, c });
    pairs.sort((x, y) => x.c.f.aS - y.c.f.aS || cmpStr(x.k.info.hh.id, y.k.info.hh.id) || cmpStr(x.c.res.id, y.c.res.id));
    const done = new Set<string>();
    for (const { k, c } of pairs) {
      if (done.has(k.info.hh.id) || taken.has(c.res.id)) continue;
      done.add(k.info.hh.id);
      take(c.res.id);
      pushResource(k, c, order++, c.f.feasible ? "PROPOSE_ASSIGN" : "GAP_REDUCE", baseReason(k, c));
    }
    const rest = ks.filter((k) => !done.has(k.info.hh.id))
      .sort((a, b) => (a.info.lEndS as number) - (b.info.lEndS as number) || cmpStr(a.info.hh.id, b.info.hh.id));
    for (const k of rest) deferred.push({ info: k.info, k: keyed(k.info), order: order++ });
  } else {
    let left = [...U];
    while (left.length > 0) {
      let ks = left.map(keyed);
      if (cfg.feasibleFirst) {
        const withF = ks.filter((k) => k.phys.some((c) => c.f.feasible));
        if (withF.length === 0) {
          ks.sort((a, b) => keyCmp(cfg, a, b));
          for (const k of ks) deferred.push({ info: k.info, k, order: order++ });
          break;
        }
        ks = withF;
      }
      let best = ks[0];
      for (const k of ks) if (keyCmp(cfg, k, best) < 0) best = k;
      left = left.filter((i) => i !== best.info);
      const ord = order++;

      if (!cfg.arrivalFilter) {
        // B1: 가장 가까운 물리 가능 자원(도착 필터 없음)
        if (best.phys.length > 0) {
          const c = best.phys[0];
          take(c.res.id);
          pushResource(best, c, ord, c.f.feasible ? "PROPOSE_ASSIGN" : "GAP_REDUCE", baseReason(best, c));
        } else deferred.push({ info: best.info, k: best, order: ord });
        continue;
      }
      const feas = best.phys.filter((c) => c.f.feasible);
      if (feas.length > 0) {
        let c = feas[0];
        if (cfg.pick === "MIN_WASTE") {
          for (const x of feas) {
            if (x.f.wasteMWh < c.f.wasteMWh || (x.f.wasteMWh === c.f.wasteMWh && (x.f.aS < c.f.aS || (x.f.aS === c.f.aS && cmpStr(x.res.id, c.res.id) < 0)))) c = x;
          }
        }
        take(c.res.id);
        pushResource(best, c, ord, "PROPOSE_ASSIGN", cfg.need ? assignReason(best, c) : baseReason(best, c));
        continue;
      }
      if (cfg.feasibleFirst) continue; // 도달하지 않음(withF로 걸렀음)
      const lEnd = best.info.lEndS as number;
      const t119 = onTime119(ctx, queue, lEnd);
      if (t119.ok) {
        const slot = bookSlot(queue, best.info.hh.id, now, "CALL");
        push119(best, ord, slot, plan119DoneS(ctx, slot.startS), false);
        continue;
      }
      const g = bestGapReduce(ctx, best.info, best.phys);
      if (g) {
        take(g.c.res.id);
        pushResource(best, g.c, ord, "GAP_REDUCE", {
          templateId: "R-GAP",
          params: {
            L08: fmtH(arrivalLimitS(lEnd, now)), A: fmtH(best.phys.length > 0 ? best.phys[0].f.aS : NEG_INF_S),
            s: fmtH(best.slack), d: fmtH(g.deltaS), res: g.c.res.id,
          },
        }, g.deltaS);
        continue;
      }
      deferred.push({ info: best.info, k: best, order: ord });
    }
  }

  // ---- 6단계 대체 레인(마감 L 오름차순) ----
  deferred.sort((a, b) => (a.info.lEndS as number) - (b.info.lEndS as number) || cmpStr(a.info.hh.id, b.info.hh.id));
  const st: Step6State = { pool, queue, shelterSeatsLeft: shelterLeft };
  for (const d of deferred) {
    const k = keyed(d.info);
    k.slack = d.k.slack; // 처리 순서 키는 5단계에서 정해진 값
    k.tier = d.k.tier;
    const lane = step6Lane(ctx, d.info, st);
    const lRem = (d.info.lEndS as number) - now;
    if (lane.lane === "FALLBACK_119") push119(k, d.order, lane.slot, lane.doneS, lane.late);
    else if (lane.lane === "GAP_REDUCE") {
      taken.add(lane.c.res.id);
      pushResource(k, lane.c, d.order, "GAP_REDUCE", { templateId: "R-GAP-FB", params: { res: lane.c.res.id, A: fmtH(lane.c.f.aS), L: fmtH(lRem) } });
    } else if (lane.lane === "FALLBACK_SHELTER") {
      rows.push({
        rec: { ...base(d.info, "FALLBACK_SHELTER", { templateId: "R-SHELTER", params: { seats: lane.seatsLeftAfter } }), order: d.order, ...commonRec(k, aStarEndS(now, null, feasibleAEnds(k))) },
        status: "PROPOSED", lEndS: d.info.lEndS, slackS: k.slack, need: pre.get(d.info.hh.id)?.need ?? undefined, notes: extNotes(d.info),
      });
    } else {
      rows.push({
        rec: { ...base(d.info, "UNSERVED_VISIBLE", { templateId: "R-UNSERVED", params: { L: fmtH(lRem) } }), order: d.order, ...commonRec(k, aStarEndS(now, null, feasibleAEnds(k))) },
        status: "PROPOSED", lEndS: d.info.lEndS, slackS: k.slack, need: pre.get(d.info.hh.id)?.need ?? undefined, notes: extNotes(d.info),
      });
    }
  }
  shelterLeft = st.shelterSeatsLeft;

  // ---- HOLD 행(처리 순서 맨 뒤, 재확인 시한 오름차순) ----
  const holdSorted = [...holds].sort((a, b) =>
    (pre.get(a.hh.id)!.need!.holdRecheckByS as number) - (pre.get(b.hh.id)!.need!.holdRecheckByS as number) || cmpStr(a.hh.id, b.hh.id));
  for (const info of holdSorted) {
    const p = pre.get(info.hh.id)!;
    const need = p.need!;
    const by = need.holdRecheckByS as number;
    const lEnd = info.lEndS as number;
    const sl = slackOf(lEnd, p.phys);
    rows.push({
      rec: {
        ...base(info, "HOLD", { templateId: "R-HOLD", params: { R80: fmtH(need.r80RemS), th: fmtH(need.thresholdS), t: fmtH(by - now) } }),
        order: order++, holdRecheckBy: sToH(by), slackH: sToH(sl),
        marginH: marginH(lEnd, ctx.r.p10S, ctx.r.p90S, aStarEndS(now, null, p.phys.filter((c) => c.f.feasible).map((c) => c.f.aS))),
      },
      status: "PROPOSED", lEndS: lEnd, slackS: sl, need, notes: extNotes(info),
    });
  }

  rows.sort((a, b) => a.rec.order - b.rec.order);
  const usedOut = new Set(used);
  for (const r of rows) if (r.rec.resourceId) usedOut.add(r.rec.resourceId);
  return {
    policy: cfg.id, nowS: now, rows,
    usedResourceIds: [...usedOut].sort(cmpStr),
    slots119: [...queue.slots],
    shelterSeatsUsed: view.lanes.shelter.seats - shelterLeft,
    reserveCapResources: capRes, reserveCap119: cap119,
    protectedResourceIds: [...protectedIds].sort(cmpStr),
  };
}

/** RULE (4.1절) */
export function rule(view: PlannerView, opts: AllocOptions = {}, state: AllocState = {}): AllocResult {
  return allocate(view, RULE_CFG, opts, state);
}

/** 고정 행(PROPOSE_ASSIGN·GAP_REDUCE·FALLBACK_119·FALLBACK_SHELTER)만 다음 결정 시점 상태로 넘긴다(4.3절 ②). 검토 예약은 매번 다시 계산 */
export function nextState(prev: AllocState, res: AllocResult): AllocState {
  const used = new Set(prev.usedResourceIds ?? []);
  const slots = [...(prev.slots119 ?? []).filter((s) => s.kind === "CALL")];
  let seats = prev.shelterSeatsUsed ?? 0;
  const reservations: CarriedReservation[] = [];
  for (const r of res.rows) {
    if (r.rec.resourceId && (r.rec.lane === "PROPOSE_ASSIGN" || r.rec.lane === "GAP_REDUCE")) used.add(r.rec.resourceId);
    if (r.rec.lane === "FALLBACK_119" && r.slot119) slots.push(r.slot119);
    if (r.rec.lane === "FALLBACK_SHELTER") seats += 1;
    const rv = r.reservation;
    if (r.rec.lane === "MANUAL_REVIEW" && rv && (rv.resourceId || rv.slot119)) {
      reservations.push({ householdId: r.rec.householdId, resourceId: rv.resourceId, slot119: rv.slot119, untilS: rv.untilS });
      if (rv.slot119) slots.push(rv.slot119);
    }
  }
  return { usedResourceIds: [...used].sort(cmpStr), slots119: slots, shelterSeatsUsed: seats, reservations };
}

/**
 * 다음 결정 시점(nextNowS)에 다시 도는 가구(4.3절 ②): MANUAL_REVIEW, UNSERVED_VISIBLE, 그 시점에 만료된 HOLD.
 * 고정 행(PROPOSE_ASSIGN·GAP_REDUCE·FALLBACK_119·FALLBACK_SHELTER)과 만료 전 HOLD는 빠진다.
 */
export function unassignedIds(res: AllocResult, nextNowS: number): string[] {
  return res.rows.filter((r) => r.rec.lane === "MANUAL_REVIEW" || r.rec.lane === "UNSERVED_VISIBLE" ||
    (r.rec.lane === "HOLD" && r.need?.holdRecheckByS != null && nextNowS >= r.need.holdRecheckByS))
    .map((r) => r.rec.householdId);
}

// ---------- 승인 행 재검토 (1.4절 재계산, 라운드 3 #4) ----------
export interface ApprovedRow {
  householdId: string;
  lane: Lane;
  resourceId?: string;
  /** 자원 레인: 도착 절대 시각(h). 119: 이송 완료 예상 절대 시각(h) */
  etaH?: number;
  slot119?: Slot119;
  late119?: boolean;
}

export type RecheckCause = "RESOURCE_UNAVAILABLE" | "PHYS_VIOLATION" | "ARRIVAL_LATE" | "LANE119_LATE" | "LANE119_NO_SLOT" | "MANUAL_REVIEW";
const RECHECK_KO: Record<RecheckCause, string> = {
  RESOURCE_UNAVAILABLE: "배정 자원 사용 불가",
  PHYS_VIOLATION: "물리 조건(호환·출력·에너지) 위반",
  ARRIVAL_LATE: "0.8×하한 안 도착 조건 깨짐",
  LANE119_LATE: "119 이송 완료 예상이 하한 소진 뒤",
  LANE119_NO_SLOT: "하한 소진 전 시작 가능한 119 슬롯 없음",
  MANUAL_REVIEW: "하한 자동 계산 불가(수동검토)",
};

export interface RecheckResult {
  flagged: { householdId: string; cause: RecheckCause; reason: Reason }[];
  audit: AuditEntry[];
  /** 대안(새 PROPOSED, 승인 필요). 승인 행 자체는 바꾸지 않는다 */
  alternatives: AllocRow[];
}

function recheckCause(ctx: AllocCtx, a: ApprovedRow): RecheckCause | null {
  const info = ctx.byId.get(a.householdId);
  if (!info) return null;
  if (info.lEndS == null) return "MANUAL_REVIEW";
  const now = ctx.nowS;
  if (a.lane === "PROPOSE_ASSIGN" || a.lane === "GAP_REDUCE") {
    const res = ctx.view.resources.find((r) => r.id === a.resourceId);
    if (!res || !res.available) return "RESOURCE_UNAVAILABLE";
    const aEnd = a.etaH != null ? qT(a.etaH) : undefined;
    const f = filterReport(ctx, info, res, aEnd);
    if (!f.phys) return "PHYS_VIOLATION";
    const arrived = aEnd != null && now >= aEnd;
    if (a.lane === "PROPOSE_ASSIGN" && !arrived && !f.arrival) return "ARRIVAL_LATE";
    return null;
  }
  if (a.lane === "FALLBACK_119") {
    if (a.late119) {
      const startS = a.slot119 ? a.slot119.startS : nextSlotStartS(makePlanner119(ctx.view.lanes.k119PerH), now);
      return startS < info.lEndS ? null : "LANE119_NO_SLOT";
    }
    const doneS = a.etaH != null ? qT(a.etaH) : a.slot119 ? plan119DoneS(ctx, a.slot119.startS) : null;
    if (doneS != null && doneS > info.lEndS) return "LANE119_LATE";
  }
  return null;
}

/**
 * 매 재계산마다 승인 행의 feasible·도착 조건을 다시 평가한다. 위반이면 RECHECK_FLAG(system) 감사 행과
 * 그 가구를 뺀 나머지 승인 배정을 고정한 RULE 대안(PROPOSED)을 만든다. 승인 배정은 자동으로 바꾸지 않는다(I6).
 * view.households에는 재신고가 반영된 현재 가구 상태를 넣는다.
 */
export function recheckApproved(view: PlannerView, approved: readonly ApprovedRow[], at: string, opts: AllocOptions = {}): RecheckResult {
  const ctx = buildCtx(view, opts);
  const flagged: RecheckResult["flagged"] = [];
  for (const a of approved) {
    const cause = recheckCause(ctx, a);
    if (cause) flagged.push({ householdId: a.householdId, cause, reason: { templateId: "R-RECHECK", params: { why: RECHECK_KO[cause] } } });
  }
  const audit: AuditEntry[] = flagged.map((f) => {
    const a = approved.find((x) => x.householdId === f.householdId)!;
    const slot = { lane: a.lane, ...(a.resourceId ? { resourceId: a.resourceId } : {}) };
    return { at, actor: "system", householdId: f.householdId, action: "RECHECK_FLAG", from: slot, to: slot, reasonCode: f.cause, reasonText: RECHECK_KO[f.cause] };
  });
  if (flagged.length === 0) return { flagged, audit, alternatives: [] };
  const flaggedIds = new Set(flagged.map((f) => f.householdId));
  const others = approved.filter((a) => !flaggedIds.has(a.householdId));
  const state: AllocState = {
    usedResourceIds: others.filter((a) => a.resourceId && (a.lane === "PROPOSE_ASSIGN" || a.lane === "GAP_REDUCE")).map((a) => a.resourceId!),
    slots119: others.filter((a) => a.lane === "FALLBACK_119" && a.slot119).map((a) => ({ ...a.slot119!, kind: "CALL" as const })),
    shelterSeatsUsed: others.filter((a) => a.lane === "FALLBACK_SHELTER").length,
  };
  const sub: PlannerView = { ...view, households: view.households.filter((h) => flaggedIds.has(h.id)) };
  const alt = allocate(sub, RULE_CFG, opts, state);
  return { flagged, audit, alternatives: alt.rows };
}
