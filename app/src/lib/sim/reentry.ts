// 수동검토 재진입 (spec.md 4.1절 2단계, 4.3절 ①). 비AI, 결정적.
// 진실 mrDelayH 뒤 사람이 확인을 마쳤다고 보고 가구를 다시 들인다. 재진입 값은 PlannerView 쪽 표본(materialize의 reentry)만 쓴다.
// - DB에 있는 연속 기기(판독 오류·라벨 미확인): 운영자가 DB 기종을 고른 것으로 보고 사양 기반 L(3.2절), specBy = "operator"
// - DB 밖 기종·비연속 기기: operatorLowerH = 가구별 가정 범위 표본(params sim.operatorLowerRangeH)
// 이 파일은 WorldTruth(LTrueH)를 import하지 않는다(2장 판단·진실 분리). 시험이 소스에 진실 참조가 없음을 확인한다.
import type { HouseholdView } from "../domain/types";

export interface ReentryValues {
  specId?: string;
  operatorLowerH?: number;
}

/** 수동검토 완료 뒤 가구 상태(새 객체). 재진입 값이 없으면 그대로 돌려준다(계속 MANUAL_REVIEW) */
export function applyReentry(hh: HouseholdView, re: ReentryValues | undefined): HouseholdView {
  if (!re) return hh;
  const device = { ...hh.device };
  if (re.specId != null) {
    device.specId = re.specId;
    device.specBy = "operator";
  }
  if (re.operatorLowerH != null) {
    if (!(Number.isFinite(re.operatorLowerH) && re.operatorLowerH >= 0)) throw new Error(`operatorLowerH 오류 ${hh.id}`);
    device.operatorLowerH = {
      hours: re.operatorLowerH,
      basis: "모의 수동검토 완료 · 가정 범위 표본(sim.operatorLowerRangeH)",
      auditId: `sim-mr-${hh.id}`,
    };
  }
  return { ...hh, device };
}
