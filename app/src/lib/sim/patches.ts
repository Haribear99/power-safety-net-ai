// 해외 보완안의 시뮬레이터 내장판 (spec.md 6.3절, 라운드 6). 비AI, 결정적. 장부는 spec/patches.json.
// 보완안은 materialize 결과의 '진실'만 바꾼다(계획자 화면은 그대로). 그래서 도구(RULE)는 집에 둔 배터리를 모르고 계획하며,
// 그 가구에 자원을 보내도 막지 않는다 — 보완안 효과를 부풀리지 않는 쪽이다.
// - PREPOSITION(P2·P3·P7): 대상 가구 진실 잔여에 energyWh × 효율 ÷ 기기 소비전력 상한을 더한다. failProb로 고장.
//   KR-07 '소진 시점 호출'(호출 시각 = 원래 소진 시각)이던 가구는 새 소진 시각으로 호출을 미룬다. 조기 호출은 그대로 둔다.
// - PLAN_EVAC(P1): 계획 보유 가구는 max(신고, 하한 끝 − 119 계획 도착 − 1h)에 119를 부른다(원래 호출보다 늦어지지 않음).
// 같은 시나리오에서 패치끼리 공통 난수를 쓴다(PATCH 스트림, 가구 id 순): u_cov, u_fail, u_plan.
import raw from "../../../../spec/patches.json";
import { plan119S, transport119S } from "../engine/arrival";
import { computeLowerBoundDetail, DEFAULT_DB } from "../engine/lowerBound";
import { qT } from "../engine/quantize";
import type { GenClass } from "./labels";
import type { MaterializedScenario } from "./materialize";
import { rngFor } from "./prng";

export type PatchId = "P1" | "P2" | "P3" | "P7";
export const PATCH_IDS: readonly PatchId[] = ["P1", "P2", "P3", "P7"];

interface PatchDef { id: PatchId; kind: "PLAN_EVAC" | "PREPOSITION"; energyWh?: number; coverage?: number; requiresPlan?: boolean; origin: string; actorKr: string }
interface PatchDoc {
  global: { inverterEff: { value: number }; covMultRange: { lo: number; hi: number }; failProbRange: { lo: number; hi: number }; planRateRange: { lo: number; hi: number }; evacMarginH: { value: number } };
  patches: PatchDef[];
}
const doc = raw as unknown as PatchDoc;
export const PATCHES: ReadonlyMap<PatchId, PatchDef> = new Map(doc.patches.map((p) => [p.id, p] as const));
export const PATCH_GLOBAL = doc.global;

/** 시나리오별 E3 축(5.3절 E3 전용): coverage 배수, 고장 확률, 계획 보유율 */
export interface PatchAxes { covMult: number; failProb: number; planRate: number }

/** 축 값은 시드별 PATCH 스트림 균등값(LHS와 별개). 1e-6 반올림 */
export function patchAxes(seed: string): PatchAxes {
  const r = rngFor(seed, "E3-axes", "PATCH");
  const g = PATCH_GLOBAL;
  const lerp = (x: { lo: number; hi: number }) => Math.round((x.lo + (x.hi - x.lo) * r.uniform()) * 1e6) / 1e6;
  return { covMult: lerp(g.covMultRange), failProb: lerp(g.failProbRange), planRate: lerp(g.planRateRange) };
}

/** 등급별 소비전력 상한(W): 그 등급 DB 기종 drawW.hi의 최댓값(보수적) */
export function classDrawHiW(cls: GenClass): number {
  const base = cls === "O2_STAT_CYL" ? "O2_STAT" : cls === "VENT_8H_EXT2" ? "VENT_8H" : cls;
  let w = 0;
  for (const d of DEFAULT_DB.devices.values()) if (d.cls === base && d.continuous) w = Math.max(w, d.drawW.value.hi);
  if (!(w > 0)) throw new Error(`등급 ${cls}의 소비전력 없음`);
  return w;
}

/** 보완안 적용: 진실만 바꾼 새 시나리오(입력은 바꾸지 않음) */
export function applyPatch(m: MaterializedScenario, id: PatchId, ax: PatchAxes): MaterializedScenario {
  const p = PATCHES.get(id);
  if (!p) throw new Error(`보완안 ${id} 없음`);
  const out: MaterializedScenario = { ...m, truth: { ...m.truth, hh: { ...m.truth.hh } } };
  const rng = rngFor(m.seed, m.scenarioId, "PATCH");
  const ids = m.planner.households.map((h) => h.id).sort();
  const view = new Map(m.planner.households.map((h) => [h.id, h] as const));
  const tOutageS = qT(m.planner.tOutage);
  const a119S = plan119S(m.planner.lanes.a119H, m.sim.stress119) + transport119S();
  const marginS = qT(PATCH_GLOBAL.evacMarginH.value);
  for (const hid of ids) {
    const uCov = rng.uniform(), uFail = rng.uniform(), uPlan = rng.uniform();
    const hasPlan = uPlan < ax.planRate;
    const h = { ...m.truth.hh[hid] };
    const tRep = qT(view.get(hid)!.tReport);
    if (p.kind === "PREPOSITION") {
      const covered = uCov < (p.coverage ?? 0) * ax.covMult && (!p.requiresPlan || hasPlan);
      if (covered && uFail >= ax.failProb) {
        const cls = m.labels[hid] as GenClass;
        const extraS = Math.floor((3600 * (p.energyWh ?? 0) * PATCH_GLOBAL.inverterEff.value) / classDrawHiW(cls));
        const oldEnd = tRep + h.LTrueS;
        h.LTrueS += extraS;
        if (h.kr07CallS === oldEnd) h.kr07CallS = oldEnd + extraS;
      }
    } else if (hasPlan) {
      const lb = computeLowerBoundDetail(view.get(hid)!, DEFAULT_DB);
      const planned = lb.endS == null ? tRep : Math.max(tRep, lb.endS - a119S - marginS);
      h.kr07CallS = Math.max(tOutageS, Math.min(h.kr07CallS, planned));
    }
    out.truth.hh[hid] = h;
  }
  return out;
}
