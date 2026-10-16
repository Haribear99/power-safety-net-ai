// 필요성 판정 (spec.md 4.1절 3단계, 3.9절 HOLD 재확인 시한). 비AI, 결정 경로 — 정수 초만.
// 세 조건을 모두 만족할 때만 HOLD, 그 밖에는 모두 '필요'(기본값은 배정: 오류 비용 비대칭).
//   status ∈ {CONFIRMED, NEAR_CERTAIN} ∧ σ_e ≤ 0.75 ∧ qT(R80_rem) ≤ qT(min(0.8·L_rem, L_rem − 0.5))
// HOLD는 now < holdRecheckBy = L_end − 1.25·A_min 동안만 유지된다(now ≥ 시한이면 '필요', HOLD_EXPIRED).
import type { AuditEntry } from "../domain/types";
import { arrivalLimitS, holdExpired, holdRecheckByS } from "../engine/margin";
import { pRatio } from "../engine/params";
import { mulDivFloor, qT } from "../engine/quantize";
import type { AllocCtx, HHInfo } from "./feasible";

/**
 * σ_e를 10⁻⁶ 단위 정수(ppm)로(결정 경로 비교용, 3.1절 '모든 부등호는 양자화한 정수로').
 * 정본 JSON이 1e-6 정밀도라 저장값의 대소가 그대로 보존된다(차등 시험 결정, DEVLOG TASK D: 이전 1e-4 판은 0.750001을 0.75로 봐
 * 오라클과 HOLD 판정이 갈렸다).
 */
const SIGMA_SCALE = 1_000_000;
function qSigma(x: number): number {
  return Math.floor(x * SIGMA_SCALE + 0.5);
}

export type NeedWhy = "NO_NOTICE" | "SIGMA_HIGH" | "R80_LATE" | "HOLD_EXPIRED" | "NO_PHYS";

export interface NeedResult {
  hold: boolean;
  /** HOLD 조건 3개가 모두 참이었는가(만료·물리 자원 없음 이전) */
  holdConditions: boolean;
  /** 하한 기준 th = min(0.8·L_rem, L_rem − 0.5) (정수 초, 남은 시간) */
  thresholdS: number;
  r80RemS: number;
  /** HOLD 조건 참일 때의 재확인 시한(절대, 정수 초) */
  holdRecheckByS: number | null;
  /** '필요' 판정의 사유(HOLD면 null) */
  why: NeedWhy | null;
}

/** HOLD 조건 판정. aMinS = phys(i) 중 최소 A(없으면 null) */
export function judgeNeed(ctx: AllocCtx, info: HHInfo, aMinS: number | null): NeedResult {
  if (info.lEndS == null) throw new Error("judgeNeed: MANUAL_REVIEW 가구");
  const lRem = info.lEndS - ctx.nowS;
  const [mn, md] = pRatio("alloc.hold.marginH");
  const thresholdS = Math.min(arrivalLimitS(info.lEndS, ctx.nowS), lRem - mulDivFloor(3600, [mn], [md]));
  const r80RemS = ctx.r.p80S - ctx.nowS;
  const base = { thresholdS, r80RemS };

  const statusOk = ctx.r.status === "CONFIRMED" || ctx.r.status === "NEAR_CERTAIN";
  if (!statusOk) return { ...base, hold: false, holdConditions: false, holdRecheckByS: null, why: "NO_NOTICE" };
  const [sn, sd] = pRatio("alloc.hold.sigmaEMax");
  const sigma = ctx.r.sigmaE ?? 0; // NEAR_CERTAIN은 σ_e 없음 = 0
  if (qSigma(sigma) * sd > SIGMA_SCALE * sn) return { ...base, hold: false, holdConditions: false, holdRecheckByS: null, why: "SIGMA_HIGH" };
  if (r80RemS > thresholdS) return { ...base, hold: false, holdConditions: false, holdRecheckByS: null, why: "R80_LATE" };

  // 세 조건 참. 시한은 물리 필터 통과 자원 중 최소 A로 정한다. 물리 자원이 없으면 시한을 정할 수 없어 '필요'
  if (aMinS == null) return { ...base, hold: false, holdConditions: true, holdRecheckByS: null, why: "NO_PHYS" };
  const by = holdRecheckByS(info.lEndS, aMinS);
  if (holdExpired(ctx.nowS, by)) return { ...base, hold: false, holdConditions: true, holdRecheckByS: by, why: "HOLD_EXPIRED" };
  return { ...base, hold: true, holdConditions: true, holdRecheckByS: by, why: null };
}

export const NEED_WHY_KO: Record<NeedWhy, string> = {
  NO_NOTICE: "복구 예정 통보 없음 · 가정 범위",
  SIGMA_HIGH: "복구 통보 불확실성 큼",
  R80_LATE: "복구 통보 P80이 하한 기준보다 늦음",
  HOLD_EXPIRED: "재확인 시한 경과",
  NO_PHYS: "물리 조건을 만족하는 자원 없음",
};

/**
 * 직전 결과에서 HOLD였고 지금 now ≥ holdRecheckBy인 가구에 HOLD_EXPIRED(actor system) 감사 행을 만든다(1.4절).
 * 새 판정은 PROPOSED로만 올라가며 승인이 필요하다(I6).
 */
export function holdExpiredEntries(
  prev: readonly { householdId: string; lane: string; holdRecheckBy?: number }[],
  nowH: number, at: string,
  next?: readonly { householdId: string; lane: AuditEntry["to"]["lane"]; resourceId?: string }[],
): AuditEntry[] {
  const out: AuditEntry[] = [];
  for (const p of prev) {
    if (p.lane !== "HOLD" || p.holdRecheckBy == null) continue;
    if (!holdExpired(qT(nowH), qT(p.holdRecheckBy))) continue;
    const n = next?.find((x) => x.householdId === p.householdId);
    out.push({
      at, actor: "system", householdId: p.householdId, action: "HOLD_EXPIRED",
      from: { lane: "HOLD" }, to: n ? { lane: n.lane, resourceId: n.resourceId } : { lane: "HOLD" },
      reasonCode: "HOLD_EXPIRED",
    });
  }
  return out;
}
