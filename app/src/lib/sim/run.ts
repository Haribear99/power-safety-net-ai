// 이산 사건 시뮬레이터 (spec.md 4.3절, 3.8절 채점). 비AI, 결정적 — Math.random·Date 없음.
// 입력은 materialize JSON(저장값 = 사용값)뿐이다. 계획자 쪽(배정기)은 PlannerView만 받는다.
// 진실(WorldTruth)은 ① 사건 시각(수동검토 완료 = tReport + mrDelayH) ② 진실 119 대기열(KR-07 호출 시각) ③ 채점(outcome.ts)
// ④ ORACLE_INFO 정보 상한에만 쓴다.
//
// 규약(4.3절)
// ① tReport는 materialize 값. 수동검토 완료 시각 = max(t₀, tReport + mrDelayH)(t₀ 이전 완료는 t₀ 실행 전에 재진입, 오라클과 같음)
// ② 결정 시점 = {t₀ = max tReport} ∪ {수동검토 완료 시각} ∪ {HOLD의 holdRecheckBy}. 오름차순, 같은 시각은 한 번.
//    각 시점에 아직 배정되지 않은 가구(재진입 가구·만료 HOLD·UNSERVED_VISIBLE)만 남은 자원·119 슬롯으로 다시 돌린다.
//    검토를 기다리는 수동검토 가구도 함께 넘겨 검토 예약을 유지한다(alloc/rule.ts AllocState). 배정된 행은 고정, 승인 지연 0.
// ③ 진실 119 대기열 = 정책의 FALLBACK_119(호출 = 그 레인을 받은 결정 시점) + 미등록 가구 KR-07 호출(+ KR_BASELINE의 등록 가구 호출).
//    서비스 1/k h, 슬롯 시작 = max(호출, 앞 슬롯 종료), 호출 시각·id 순. 실제 도착 = 슬롯 시작 + A_119(진실).
// ④ M3 = 한 번이라도 HOLD였던 가구 중 G>0 비율(outcome.ts).
import type { HouseholdView, Lane, PlannerView } from "../domain/types";
import { runPolicy } from "../alloc/baselines";
import { cmpStr, deviceEnvelope, type AllocOptions, type OracleInput } from "../alloc/feasible";
import { makePlanner119 } from "../alloc/fallback";
import { nextState, type AllocState, type PolicyId } from "../alloc/rule";
import { computeLowerBoundDetail, DEFAULT_DB, type EngineDb } from "../engine/lowerBound";
import { qT, sToH } from "../engine/quantize";
import { restorationAtS, toWorldTruth, type MaterializedScenario } from "./materialize";
import { judgeScenario, type HouseholdOutcome, type Metrics, type ServicePlan } from "./outcome";
import { applyReentry } from "./reentry";

export type SimPolicy = PolicyId | "KR_BASELINE";
export const SIM_POLICIES: readonly SimPolicy[] = [
  "RULE", "B1_SHORTEST", "B2_NEAREST", "R_L", "RULE_NO_R", "RULE_FEASIBLE_FIRST", "RULE_NO_RESERVE", "ORACLE_INFO", "NONE", "KR_BASELINE",
] as const;

/** 레인 + 시뮬레이터 전용 표기: KR_BASELINE 자가 119 호출, NONE 도움 없음 */
export type SimLane = Lane | "KR07_SELF_CALL" | "NO_HELP";

export interface LTrace {
  status: "AUTO" | "MANUAL_REVIEW";
  hoursS: number | null;
  endS: number | null;
  capS: number | null;
  flags: string[];
}

export interface HouseholdTrace {
  id: string;
  lane: SimLane | null;
  resourceId: string | null;
  /** 결정 시점을 가로지르는 전역 처리 순번(레인을 받을 때 부여). MANUAL_REVIEW·HOLD는 null */
  order: number | null;
  decidedAtS: number | null;
  delayed119: boolean;
  everHold: boolean;
  holdRecheckByS: number | null;
  reservedResourceId: string | null;
  reserved119: boolean;
  /** 마지막 하한(재진입 반영) */
  L: LTrace | null;
  /** 진실 119 대기열: 호출 시각·슬롯 시작(정수 초) */
  call119S: number | null;
  slot119StartS: number | null;
}

export interface DecisionLog {
  tS: number;
  r80EndS: number;
  r90EndS: number;
  /** [전역 순번, 가구, 레인, 자원] */
  assigned: [number, string, Lane, string | null][];
}

export interface RunResult {
  format: "pl26-sim-run/1";
  scenarioId: string;
  seed: string;
  policy: SimPolicy;
  households: Record<string, HouseholdTrace>;
  decisions: DecisionLog[];
  /** 진실 119 대기열(등록·미등록) */
  true119: { id: string; callS: number; startS: number }[];
  outcome: { rows: HouseholdOutcome[]; metrics: Metrics };
}

export interface RunOptions {
  db?: EngineDb;
  /**
   * 미해결(DEVLOG TASK C 미해결 2): 도구 정책에서 끝까지 UNSERVED_VISIBLE·MANUAL_REVIEW로 남은 등록 가구도
   * KR-07처럼 스스로 119를 부르는가. 명세는 미등록 가구만 KR-07을 따른다고 적어 기본값은 false(명세 문자 그대로).
   */
  unservedSelfCall?: boolean;
}

function stripReentry(h: MaterializedScenario["planner"]["households"][number]): HouseholdView {
  const { reentry: _re, ...rest } = h;
  void _re;
  return rest;
}

function lTrace(hh: HouseholdView, db: EngineDb): LTrace {
  const d = computeLowerBoundDetail(hh, db);
  return { status: d.lb.status, hoursS: d.Ls, endS: d.endS, capS: d.capS, flags: [...d.lb.flags] };
}

/** 시나리오 1건을 한 정책으로 돌린다 */
export function runScenario(m: MaterializedScenario, policy: SimPolicy, opts: RunOptions = {}): RunResult {
  const db = opts.db ?? DEFAULT_DB;
  const allocOpts: AllocOptions = { db, travel: m.sim.travel, stress119: m.sim.stress119 };
  const pl = m.planner;
  const ids = pl.households.map((h) => h.id).sort(cmpStr);
  const views = new Map<string, HouseholdView>(pl.households.map((h) => [h.id, stripReentry(h)]));
  const reentry = new Map(pl.households.map((h) => [h.id, h.reentry] as const));
  const tReportS = new Map(pl.households.map((h) => [h.id, qT(h.tReport)] as const));
  const traces = new Map<string, HouseholdTrace>(ids.map((id) => [id, {
    id, lane: null, resourceId: null, order: null, decidedAtS: null, delayed119: false, everHold: false, holdRecheckByS: null,
    reservedResourceId: null, reserved119: false, L: null, call119S: null, slot119StartS: null,
  }]));
  const decisions: DecisionLog[] = [];

  if (policy === "NONE" || policy === "KR_BASELINE") {
    for (const id of ids) {
      const tr = traces.get(id)!;
      tr.lane = policy === "NONE" ? "NO_HELP" : "KR07_SELF_CALL";
      tr.L = lTrace(views.get(id)!, db);
    }
  } else {
    runDecisionLoop(m, policy, db, allocOpts, ids, views, reentry, tReportS, traces, decisions);
  }

  // ---- 진실 119 대기열(4.3절 ③) ----
  const calls: { id: string; callS: number }[] = [];
  for (const id of ids) {
    const tr = traces.get(id)!;
    if (tr.lane === "FALLBACK_119") calls.push({ id, callS: tr.decidedAtS as number });
    if (tr.lane === "KR07_SELF_CALL") calls.push({ id, callS: m.truth.hh[id].kr07CallS });
    if (opts.unservedSelfCall && (tr.lane === "UNSERVED_VISIBLE" || tr.lane === "MANUAL_REVIEW")) {
      calls.push({ id, callS: m.truth.hh[id].kr07CallS });
    }
  }
  if (policy !== "NONE") for (const u of m.truth.unregistered) calls.push({ id: u.id, callS: u.callS });
  calls.sort((a, b) => a.callS - b.callS || cmpStr(a.id, b.id));
  const svcS = makePlanner119(pl.lanes.k119PerH).svcS;
  const true119: RunResult["true119"] = [];
  let prevEnd: number | null = null;
  for (const c of calls) {
    const startS: number = prevEnd == null ? c.callS : Math.max(c.callS, prevEnd);
    prevEnd = startS + svcS;
    true119.push({ id: c.id, callS: c.callS, startS });
    const tr = traces.get(c.id);
    if (tr) { tr.call119S = c.callS; tr.slot119StartS = startS; }
  }
  const startById = new Map(true119.map((x) => [x.id, x.startS] as const));

  // ---- 서비스 계획 → 채점(3.8절) ----
  const resById = new Map(pl.resources.map((r) => [r.id, r] as const));
  const services: ServicePlan[] = [];
  for (const id of ids) {
    const tr = traces.get(id)!;
    const sp: ServicePlan = { householdId: id, tReportH: sToH(tReportS.get(id)!), everHold: tr.everHold, displayedLH: tr.L?.hoursS != null ? sToH(tr.L.hoursS) : null };
    if ((tr.lane === "PROPOSE_ASSIGN" || tr.lane === "GAP_REDUCE") && tr.resourceId) {
      const r = resById.get(tr.resourceId);
      if (!r) throw new Error(`자원 없음 ${tr.resourceId}`);
      sp.resource = {
        resourceId: r.id, dispatchH: sToH(tr.decidedAtS as number), kind: r.kind, energyWh: r.energyWh,
        deviceDrawWHi: deviceEnvelope(views.get(id)!, db).drawHiW,
      };
    } else if (startById.has(id)) {
      sp.lane119 = { slotStartH: sToH(startById.get(id)!) };
    } else if (tr.lane === "FALLBACK_SHELTER") {
      sp.shelter = { dispatchH: sToH(tr.decidedAtS as number) };
    }
    services.push(sp);
  }
  for (const u of m.truth.unregistered) {
    const s = startById.get(u.id);
    services.push(s != null ? { householdId: u.id, lane119: { slotStartH: sToH(s) } } : { householdId: u.id });
  }
  const registeredReportH = Object.fromEntries(ids.map((id) => [id, sToH(tReportS.get(id)!)]));
  const outcome = judgeScenario(toWorldTruth(m), pl.tOutage, services, registeredReportH);

  return {
    format: "pl26-sim-run/1", scenarioId: m.scenarioId, seed: m.seed, policy,
    households: Object.fromEntries(ids.map((id) => [id, traces.get(id)!])),
    decisions, true119, outcome,
  };
}

function runDecisionLoop(
  m: MaterializedScenario, policy: PolicyId, db: EngineDb, allocOpts: AllocOptions, ids: string[],
  views: Map<string, HouseholdView>, reentry: Map<string, MaterializedScenario["planner"]["households"][number]["reentry"]>,
  tReportS: Map<string, number>, traces: Map<string, HouseholdTrace>, decisions: DecisionLog[],
): void {
  const pl = m.planner;
  const t0 = Math.max(...ids.map((id) => tReportS.get(id)!));
  // 수동검토 완료 시각(진실 mrDelayH, 4.3절 ①)
  const reviewAt = new Map<string, number>();
  for (const id of ids) {
    if (computeLowerBoundDetail(views.get(id)!, db).lb.status === "MANUAL_REVIEW") {
      reviewAt.set(id, Math.max(t0, tReportS.get(id)! + m.truth.hh[id].mrDelayS));
    }
  }
  const oracle: OracleInput | undefined = policy === "ORACLE_INFO"
    ? {
      lEndS: Object.fromEntries(ids.map((id) => [id, tReportS.get(id)! + m.truth.hh[id].LTrueS])),
      rTrueS: qT(pl.tOutage) + m.truth.restorationS,
    }
    : undefined;
  const events = new Set<number>([t0, ...reviewAt.values()]);
  const done = new Set<number>();
  const reviewed = new Set<string>();
  const finalManual = new Set<string>();
  let state: AllocState = {};
  let first = true;
  let counter = 0;

  for (;;) {
    let t: number | null = null;
    for (const e of events) if (!done.has(e) && (t == null || e < t)) t = e;
    if (t == null) break;
    done.add(t);

    // 이 시각에 검토가 끝나는 가구: 재진입 값 적용(PlannerView 쪽 표본만)
    const reentered: string[] = [];
    for (const id of ids) {
      if (reviewAt.get(id) === t && !reviewed.has(id)) {
        reviewed.add(id);
        const v = applyReentry(views.get(id)!, reentry.get(id));
        views.set(id, v);
        if (computeLowerBoundDetail(v, db).lb.status === "MANUAL_REVIEW") finalManual.add(id); // 재진입 값 없음 → 수동검토로 남음
        else reentered.push(id);
      }
    }
    const active = first ? ids.filter((id) => !finalManual.has(id)) : ids.filter((id) => {
      const tr = traces.get(id)!;
      if (reentered.includes(id)) return true;
      if (tr.lane === "UNSERVED_VISIBLE") return true;
      return tr.lane === "HOLD" && tr.holdRecheckByS != null && t >= tr.holdRecheckByS;
    });
    if (!first && active.length === 0) continue;
    // 검토를 기다리는 수동검토 가구는 예약 유지를 위해 함께 넘긴다
    const waiting = ids.filter((id) => !active.includes(id) && !finalManual.has(id) && reviewAt.has(id) && !reviewed.has(id));
    const cands = [...active, ...waiting].sort(cmpStr);

    const view: PlannerView = {
      scenarioId: pl.scenarioId, now: sToH(t), tOutage: pl.tOutage,
      households: cands.map((id) => views.get(id)!),
      resources: pl.resources,
      restoration: restorationAtS({
        cause: pl.restoration.cause, tOutage: pl.tOutage, status: pl.restoration.status,
        sigmaE: pl.restoration.sigmaE, confirmed: pl.restoration.confirmed, table: m.sim.table,
      }, t),
      lanes: pl.lanes,
    };
    // 시한이 지난 HOLD 가구는 다시 판정하지 않고 '필요'로 되돌린다(3.9절, DEVLOG TASK D)
    const forceNeedIds = active.filter((id) => traces.get(id)!.lane === "HOLD");
    const res = runPolicy(policy, view, allocOpts, { ...state, forceNeedIds }, oracle);
    // 둘째 시점부터는 첫 시점 검토 예약만 시한까지 유지하고 새로 만들지 않는다(4.3절 ②, DEVLOG TASK D)
    state = { ...nextState(state, res), carryOnlyReservations: true };

    const log: DecisionLog["assigned"] = [];
    for (const row of [...res.rows].sort((a, b) => a.rec.order - b.rec.order)) {
      const id = row.rec.householdId;
      const tr = traces.get(id)!;
      // 수동검토 행의 결정 시각은 처음 MANUAL_REVIEW로 표시된 시각으로 둔다(대기 중 재전달로 바뀌지 않게, DEVLOG TASK D)
      if (!(row.rec.lane === "MANUAL_REVIEW" && tr.lane === "MANUAL_REVIEW")) tr.decidedAtS = t;
      tr.lane = row.rec.lane;
      tr.resourceId = row.rec.resourceId ?? null;
      tr.L = lTrace(views.get(id)!, db);
      if (row.rec.lane === "HOLD") {
        tr.order = null;
        tr.everHold = true;
        const by = row.need?.holdRecheckByS ?? null;
        tr.holdRecheckByS = by;
        if (by != null && by > t) events.add(by);
      } else if (row.rec.lane === "MANUAL_REVIEW") {
        tr.order = null;
        tr.reservedResourceId = row.reservation?.resourceId ?? null;
        tr.reserved119 = row.reservation?.slot119 != null;
      } else {
        tr.order = ++counter;
        tr.delayed119 = row.late119 === true;
        log.push([tr.order, id, row.rec.lane, tr.resourceId]);
      }
    }
    for (const id of finalManual) {
      const tr = traces.get(id)!;
      tr.lane = "MANUAL_REVIEW";
      tr.order = null;
      if (tr.decidedAtS == null) tr.decidedAtS = t;
      tr.L = lTrace(views.get(id)!, db);
    }
    decisions.push({ tS: t, r80EndS: qT(view.restoration.p80), r90EndS: qT(view.restoration.p90), assigned: log });
    first = false;
  }
}

// ---------- 오라클 비교 형식(oracle/FORMAT.md `pl26-oracle-out/1`) ----------
const SERVE_SRC = { RESTORE: "RESTORE", RESOURCE: "RESOURCE", LANE_119: "119", SHELTER: "SHELTER" } as const;

export function toOracleOut(r: RunResult): Record<string, unknown> {
  const households: Record<string, unknown> = {};
  for (const [id, t] of Object.entries(r.households)) {
    households[id] = {
      lane: t.lane, resourceId: t.resourceId, order: t.order, decidedAtS: t.decidedAtS, delayed119: t.delayed119,
      everHold: t.everHold, holdRecheckByS: t.holdRecheckByS, reservedResourceId: t.reservedResourceId, reserved119: t.reserved119,
      L: t.L,
    };
  }
  const gapS: Record<string, number> = {};
  const serveSource: Record<string, string> = {};
  for (const row of r.outcome.rows) {
    gapS[row.householdId] = row.gapS;
    serveSource[row.householdId] = SERVE_SRC[row.servedBy];
  }
  return {
    format: "pl26-oracle-out/1", scenarioId: r.scenarioId, seed: r.seed, households, decisions: r.decisions,
    metrics: { M1: r.outcome.metrics.M1, M2S: r.outcome.metrics.M2S, highRisk: r.outcome.metrics.highRiskCount, gapS, serveSource },
  };
}
