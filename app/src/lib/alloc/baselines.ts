// 기준선 (spec.md 4.2절, 같은 시드·공통 난수). 비AI, 결정적.
// 허수아비 비교를 막기 위해 모든 기준선은 RULE과 같은 물리 필터·같은 검토 예약·같은 대체 레인(6단계)을 쓴다.
// 차이는 필요성 판정, 0.8L 도착 필터, 처리 순서뿐이다(DEVLOG 구현 중 결정).
// KR_BASELINE은 배정기가 아니라 시뮬레이터의 행동 규칙(6.2절 DSL + KR-07 119 호출)이라 여기서는 호출 시각 규칙만 둔다.
import type { PlannerView } from "../domain/types";
import { pRange } from "../engine/params";
import { qT, sToH } from "../engine/quantize";
import { cmpStr, type AllocOptions, type OracleInput } from "./feasible";
import { fmtH } from "./reasons";
import { allocate, RULE_CFG, type AllocResult, type AllocState, type PolicyCfg, type PolicyId } from "./rule";
import { computeLowerBoundDetail, DEFAULT_DB } from "../engine/lowerBound";

export const POLICY_CFGS: Record<Exclude<PolicyId, "NONE" | "ORACLE_INFO">, PolicyCfg> = {
  RULE: RULE_CFG,
  /** 필요성 판정·도착 필터 없음. L 오름차순으로 가장 가까운 물리 가능 자원(ASTHO 가동시간 우선 권고 P5) */
  B1_SHORTEST: { ...RULE_CFG, id: "B1_SHORTEST", need: false, arrivalFilter: false, order: "L", pick: "NEAREST" },
  /** 필요성 판정·도착 필터 없음. 물리 가능 (i,j) 쌍을 A 오름차순으로 탐욕 매칭 */
  B2_NEAREST: { ...RULE_CFG, id: "B2_NEAREST", need: false, arrivalFilter: false, order: "L", matching: "PAIR_A", pick: "NEAREST" },
  /** RULE에서 (tier, slack) 대신 L 오름차순(예비 실험 재현) */
  R_L: { ...RULE_CFG, id: "R_L", order: "L" },
  /** RULE에서 tier를 빼고 slack만(라운드 2 이전 판) */
  RULE_NO_R: { ...RULE_CFG, id: "RULE_NO_R", order: "SLACK" },
  /** v1: 도착 필터 통과 가구만 루프, 나머지는 자원 소모 뒤 6단계. 순서 키 (tier, slack)는 RULE과 같게 둔다(단일 요인 절제) */
  RULE_FEASIBLE_FIRST: { ...RULE_CFG, id: "RULE_FEASIBLE_FIRST", feasibleFirst: true },
  /** 검토 예약을 물리 자원·119 슬롯 대신 '대기열 최상단 + 검토 시한' 표시로만 */
  RULE_NO_RESERVE: { ...RULE_CFG, id: "RULE_NO_RESERVE", reserve: false },
};

/** NONE: 아무 도움 없음(공백 = R_true − L_true는 sim/outcome이 계산). 모든 가구를 미배정으로 둔다 */
export function noneBaseline(view: PlannerView, opts: AllocOptions = {}): AllocResult {
  const db = opts.db ?? DEFAULT_DB;
  const nowS = qT(view.now);
  const hs = [...view.households].sort((a, b) => cmpStr(a.id, b.id));
  return {
    policy: "NONE", nowS,
    rows: hs.map((hh, i) => {
      const lbd = computeLowerBoundDetail(hh, db);
      return {
        rec: {
          householdId: hh.id, lane: "UNSERVED_VISIBLE" as const, order: i, L: lbd.lb, R: view.restoration, marginH: null, slackH: null, tier: null,
          reason: { templateId: "R-UNSERVED", params: { L: lbd.endS == null ? "미상" : fmtH(lbd.endS - nowS) } },
        },
        status: "PROPOSED" as const, lEndS: lbd.endS, slackS: null, notes: [],
      };
    }),
    usedResourceIds: [], slots119: [], shelterSeatsUsed: 0, reserveCapResources: 0, reserveCap119: 0, protectedResourceIds: [],
  };
}

/** ORACLE_INFO: RULE에 L_true·R_true를 넣는다(정보 상한). 진실은 sim이 평범한 숫자로 넘긴다 */
export function oracleInfo(view: PlannerView, oracle: OracleInput, opts: AllocOptions = {}, state: AllocState = {}): AllocResult {
  return allocate(view, { ...RULE_CFG, id: "ORACLE_INFO" }, { ...opts, oracle }, state);
}

export function runPolicy(
  id: PolicyId, view: PlannerView, opts: AllocOptions = {}, state: AllocState = {}, oracle?: OracleInput,
): AllocResult {
  if (id === "NONE") return noneBaseline(view, opts);
  if (id === "ORACLE_INFO") {
    if (!oracle) throw new Error("ORACLE_INFO에는 진실값(oracle) 입력이 필요");
    return oracleInfo(view, oracle, opts, state);
  }
  return allocate(view, POLICY_CFGS[id], opts, state);
}

export const ALL_POLICIES: readonly PolicyId[] = [
  "RULE", "B1_SHORTEST", "B2_NEAREST", "R_L", "RULE_NO_R", "RULE_FEASIBLE_FIRST", "RULE_NO_RESERVE", "ORACLE_INFO", "NONE",
] as const;

/**
 * KR_BASELINE·미등록 가구의 KR-07 119 호출 시각(4.2절): 확률 p_early로 조기 호출(정전 시작 + U[0, L_true]),
 * 나머지는 배터리 소진 시점(L_true). u1·u2는 sim의 BEHAVIOR 스트림 난수, 입력은 평범한 숫자(WorldTruth 비의존).
 * 반환은 절대 모의 시각 정수 초.
 */
export function kr07CallS(tOutageS: number, lTrueEndS: number, pEarly: number, u1: number, u2: number): number {
  const r = pRange("sweep.pEarly");
  if (!(pEarly >= r.lo && pEarly <= r.hi)) throw new Error(`p_early 범위 밖 ${pEarly}`);
  if (u1 < pEarly) return tOutageS + qT(sToH(Math.max(0, lTrueEndS - tOutageS)) * u2);
  return lTrueEndS;
}
