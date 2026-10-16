// 분석용 기기 등급 라벨 (spec.md 3.3절 7행 분류, 5.4절 E1 층화·집계). 비AI.
// 등급은 표시·분석·라벨 집계용이며 배정기 입력이 아니다(I5). 라벨은 materialize JSON의 최상위 labels에만 두고
// PlannerView에는 넣지 않는다. 미확인 모델 가구도 진실 기종으로 라벨을 단다.
import type { DeviceClass } from "../domain/types";
import { DEFAULT_DB, type EngineDb } from "../engine/lowerBound";

/** 생성기가 만드는 7등급(INTERMITTENT·UNKNOWN 제외, 5.6절) */
export type GenClass = Exclude<DeviceClass, "INTERMITTENT" | "UNKNOWN">;
export const GEN_CLASSES: readonly GenClass[] = [
  "O2_STAT", "O2_STAT_CYL", "VENT_1H", "VENT_3H", "O2_PORT", "VENT_8H", "VENT_8H_EXT2",
] as const;

/**
 * 진실 기종 + 운영자 확인 외장 개수 + 실린더 보유 → 3.3절 등급.
 * - O2_STAT 기기 + 실린더 보유 → O2_STAT_CYL
 * - VENT_8H 기기 + 확인된 외장 2개 이상 → VENT_8H_EXT2 (3.3절: 'Astral에 확인된 외장 2개')
 */
export function classOf(trueSpecId: string, verifiedExtCount: number, cylinderDeclared: boolean, db: EngineDb = DEFAULT_DB): DeviceClass {
  const dev = db.devices.get(trueSpecId);
  if (!dev) return "UNKNOWN";
  if (dev.cls === "O2_STAT" && cylinderDeclared) return "O2_STAT_CYL";
  if (dev.cls === "VENT_8H" && verifiedExtCount >= 2) return "VENT_8H_EXT2";
  return dev.cls;
}
