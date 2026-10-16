// 계획자 119 대기열(spec.md 4.3절 ③)과 대체 레인(4.1절 5단계 ①·② 판정, 6단계). 비AI, 결정 경로 — 정수 초만.
// 계획자 대기열은 계획자가 아는 호출(자기 FALLBACK_119와 검토 예약)만 담는다. 진실 대기열(미등록·KR-07 포함)은 sim 몫.
// 서비스 시간 = 1/k h, 슬롯 시작 = max(호출 시각, 앞 슬롯 종료), 호출 시각·id 순(단일 대기열).
import type { ResourceView } from "../domain/types";
import { plan119S, transport119S } from "../engine/arrival";
import { pNum, pRatio } from "../engine/params";
import { mulDivFloor, qT } from "../engine/quantize";
import { cmpStr, filterReport, type AllocCtx, type Candidate, type HHInfo } from "./feasible";

export interface Slot119 {
  householdId: string;
  /** 호출 시각(결정 시점, 절대 정수 초) */
  callS: number;
  startS: number;
  endS: number;
  /** CALL = FALLBACK_119 배정, RESERVE = 수동검토 검토 예약(다음 결정 시점에 다시 계산) */
  kind: "CALL" | "RESERVE";
}

export interface Planner119 {
  /** 서비스 시간 1/k h (정수 초) */
  svcS: number;
  slots: Slot119[];
}

export function makePlanner119(k119PerH: number, slots: readonly Slot119[] = []): Planner119 {
  if (!(k119PerH > 0)) throw new Error(`119 용량 k는 양수 (${k119PerH})`);
  const svcS = qT(1 / k119PerH);
  if (svcS <= 0) throw new Error("119 서비스 시간이 0초");
  return { svcS, slots: [...slots].sort((a, b) => a.startS - b.startS || cmpStr(a.householdId, b.householdId)) };
}

/** 지금 호출하면 받을 슬롯 시작 = max(now, 마지막 슬롯 종료) */
export function nextSlotStartS(q: Planner119, nowS: number): number {
  let free = nowS;
  for (const s of q.slots) if (s.endS > free) free = s.endS;
  return free;
}

export function bookSlot(q: Planner119, householdId: string, nowS: number, kind: Slot119["kind"]): Slot119 {
  const startS = nextSlotStartS(q, nowS);
  const slot: Slot119 = { householdId, callS: nowS, startS, endS: startS + q.svcS, kind };
  q.slots.push(slot);
  return slot;
}

/** [nextStart, horizon) 안에서 시작 가능한 남은 슬롯 수 */
export function remainingSlotsBefore(q: Planner119, nowS: number, horizonS: number): number {
  const s0 = nextSlotStartS(q, nowS);
  if (horizonS <= s0) return 0;
  return Math.floor((horizonS - s0 + q.svcS - 1) / q.svcS);
}

/** 계획 119 이송 완료 시각 = 슬롯 시작 + A_119(계획) + 0.33h */
export function plan119DoneS(ctx: AllocCtx, startS: number): number {
  return startS + plan119S(ctx.view.lanes.a119H, ctx.stress119) + transport119S();
}

/** ① 계획자 대기열의 다음 슬롯으로 qT(s + A_119 + 0.33) ≤ qT(L_end)인가 */
export function onTime119(ctx: AllocCtx, q: Planner119, lEndS: number): { ok: boolean; startS: number; doneS: number } {
  const startS = nextSlotStartS(q, ctx.nowS);
  const doneS = plan119DoneS(ctx, startS);
  return { ok: doneS <= lEndS, startS, doneS };
}

/** (c) L_end 이전에 시작 가능한 슬롯이 있는가: qT(s) < qT(L_end) */
export function late119Possible(ctx: AllocCtx, q: Planner119, lEndS: number): boolean {
  return nextSlotStartS(q, ctx.nowS) < lEndS;
}

/**
 * ② 공백 단축 Δ_ij = min(R80_end, A_end + run_j) − max(A_end, L_end). 최대 Δ ≥ Δ_min이면 그 자원.
 * 동점이면 A가 작은 쪽, 그다음 id 사전순.
 */
export function bestGapReduce(ctx: AllocCtx, info: HHInfo, phys: readonly Candidate[]): { c: Candidate; deltaS: number } | null {
  if (info.lEndS == null) return null;
  let best: { c: Candidate; deltaS: number } | null = null;
  for (const c of phys) {
    const d = Math.min(ctx.r.p80S, c.f.aEndS + c.f.runS) - Math.max(c.f.aEndS, info.lEndS);
    if (!best || d > best.deltaS || (d === best.deltaS && (c.f.aS < best.c.f.aS || (c.f.aS === best.c.f.aS && cmpStr(c.res.id, best.c.res.id) < 0)))) {
      best = { c, deltaS: d };
    }
  }
  if (!best || best.deltaS < qT(pNum("alloc.deltaMinH"))) return null;
  return best;
}

export type Step6Lane =
  | { lane: "FALLBACK_119"; slot: Slot119; doneS: number; late: boolean }
  | { lane: "GAP_REDUCE"; c: Candidate }
  | { lane: "FALLBACK_SHELTER"; seatsLeftAfter: number }
  | { lane: "UNSERVED_VISIBLE" };

export interface Step6State {
  pool: ResourceView[];
  queue: Planner119;
  shelterSeatsLeft: number;
}

/**
 * 6단계 대체 레인: (a) 제때 119 → (b) 물리 필터 통과 자원(가장 이른 A) GAP_REDUCE → (c) L_end 전 시작 가능한 119(지연 플래그)
 * → (d) 이동지원 필요 ∧ 보호자 없음이 아니고 좌석이 남으면 쉼터 → (e) UNSERVED_VISIBLE. 상태(pool·queue·좌석)를 소모한다.
 */
export function step6Lane(ctx: AllocCtx, info: HHInfo, st: Step6State): Step6Lane {
  const lEndS = info.lEndS;
  if (lEndS == null) throw new Error("step6Lane: MANUAL_REVIEW 가구");
  const a = onTime119(ctx, st.queue, lEndS);
  if (a.ok) {
    const slot = bookSlot(st.queue, info.hh.id, ctx.nowS, "CALL");
    return { lane: "FALLBACK_119", slot, doneS: plan119DoneS(ctx, slot.startS), late: false };
  }
  let best: Candidate | null = null;
  for (const res of st.pool) {
    const f = filterReport(ctx, info, res);
    if (!f.phys) continue;
    if (!best || f.aS < best.f.aS || (f.aS === best.f.aS && cmpStr(res.id, best.res.id) < 0)) best = { res, f };
  }
  if (best) {
    const id = best.res.id;
    st.pool.splice(st.pool.findIndex((r) => r.id === id), 1);
    return { lane: "GAP_REDUCE", c: best };
  }
  if (late119Possible(ctx, st.queue, lEndS)) {
    const slot = bookSlot(st.queue, info.hh.id, ctx.nowS, "CALL");
    return { lane: "FALLBACK_119", slot, doneS: plan119DoneS(ctx, slot.startS), late: true };
  }
  const blocked = info.hh.mobilityNeed && !info.hh.caregiver;
  if (!blocked && st.shelterSeatsLeft > 0) {
    st.shelterSeatsLeft -= 1;
    return { lane: "FALLBACK_SHELTER", seatsLeftAfter: st.shelterSeatsLeft };
  }
  return { lane: "UNSERVED_VISIBLE" };
}

/** floor(n × mrReserveCap) — 예약 상한(4.1절 예약 제약 ①) */
export function reserveCap(n: number): number {
  if (n <= 0) return 0;
  const [num, den] = pRatio("alloc.mrReserveCap");
  return mulDivFloor(n, [num], [den]);
}
