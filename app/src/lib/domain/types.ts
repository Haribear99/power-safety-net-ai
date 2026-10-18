// 도메인 모델 (spec.md 2장). 판단(PlannerView)과 진실(WorldTruth)을 분리한다.
// WorldTruth는 src/app/**·src/lib/alloc/**·sim/reentry.ts에서 import 금지(ESLint no-restricted-imports, 2장).
import { z } from "zod";

export type ProvType = "spec" | "measured" | "event" | "policy" | "inferred" | "assumed" | "calibrated" | "operator";
export interface Prov { type: ProvType; sourceIds: string[]; note?: string }
export interface Range { lo: number; hi: number }

// 등급은 표시·분석·라벨 집계용이다. 배정기의 입력이 아니다(I5).
export type DeviceClass = "O2_STAT" | "O2_STAT_CYL" | "VENT_1H" | "VENT_3H" | "O2_PORT"
  | "VENT_8H" | "VENT_8H_EXT2" | "INTERMITTENT" | "UNKNOWN";
export type Connector = "AC220" | "DC12" | "VENDOR_EXT" | "O2_FLOW";
export type Cause = "KEPCO_DIST" | "APT_SHORT" | "APT_NIGHT_XFMR" | "APT_PARTS" | "APT_FIRE"
  | "TYPHOON_WEAK" | "TYPHOON_STRONG" | "ROTATING" | "APT_EMP";
/** 봉인 실험(E1·E2·E3)의 원인 8종. APT_EMP는 E4(실측 경험 분포) 전용이라 여기 넣지 않는다(넣으면 E2 원인 추첨이 바뀐다) */
export const CAUSES: readonly Cause[] = [
  "KEPCO_DIST", "APT_SHORT", "APT_NIGHT_XFMR", "APT_PARTS", "APT_FIRE", "TYPHOON_WEAK", "TYPHOON_STRONG", "ROTATING",
] as const;
/** 봉인 표 밖의 원인(spec/restoration_empirical.json) */
export const EXTRA_CAUSES: readonly Cause[] = ["APT_EMP"] as const;

export interface DeviceSpec {
  specId: string; manufacturer: string; model: string;
  matchKeys: string[];                 // 정규화(대문자, 공백·하이픈 제거) 정확 일치 키
  cls: DeviceClass; continuous: boolean; // false(기침유발기 등) → 수동검토
  internalH: { value: number; condition: string; prov: Prov };
  settingTable?: { setting: number; runtimeH: number }[];
  drawW: { value: Range; prov: Prov };
  connectors: Connector[]; inverterSensitive: boolean;
}
export interface ExtSpec { extSpecId: string; forSpecIds: string[]; runtimeH: number; prov: Prov }

// ---- PlannerView: 도구·배정기가 보는 것 ----
export interface HouseholdView {
  id: string; pseudonym: string;            // "H-017"
  cell: { x: number; y: number };           // 합성 격자 km, 주소·GPS 없음
  floor: number; mobilityNeed: boolean; caregiver: boolean;
  tReport: number;                          // 신고(충전량 입력) 모의 시각 h. L_end = tReport + L, 재신고 시 비증가(3.9절)
  lEndPrev: number | null;                  // 직전 신고의 L_end. 재신고 단조 규칙용(3.9절)
  lEndPrevBattery?: number | null;          // 직전 신고의 배터리만(산소통 제외) 끝. 보호자 알림 전용(엔진은 쓰지 않음, 10/18 N1)
  device: {
    specId: string | null; specBy: "db_exact" | "ai_label_user_confirmed" | "operator" | null;
      // operator = 수동검토 완료에서 DB 기종 선택(1.4절). ai_label_user_confirmed = AI 판독 정확 일치 + 가구 확인만(검증 사양 아님,
      // VERIFY_MODEL 전에는 이웃 기종 최소값, 3.2절). db_exact = 운영자 VERIFY_MODEL 완료, 또는 시나리오 데이터(프리셋·시뮬레이션)
    setting?: number; settingSource?: "user" | "operator";          // user면 min(runtimeH)를 쓴다(3.2절)
    batteryAgeY: number | null;               // 운영자 VERIFY_AGE로만 채운다(prov operator). 이용자 입력 연식은 null + USER_AGE_IGNORED
    userAgeY?: number | null;                 // 이용자가 입력한 연식(계산에 쓰지 않음, USER_AGE_IGNORED 표지용). DEVLOG '구현 중 결정' 참조
    // value는 정수 퍼센트 0~100(3.1절 규칙 2). 3.2절의 min(value, 1)은 min(value, 100)/100으로 읽는다
    charge: { value: number | null; source: "device_screen" | "user" | "unknown" };
    screenRemainingH?: number;
    operatorLowerH?: { hours: number; basis: string; auditId: string };  // DB 밖 기종·비연속 기기: 사람 입력 보수 하한
  };
  // 가구는 보유 신고만 한다. 확인(opVerified)은 운영자 조작 AuditEntry로만 생긴다(I2·I3)
  ext: { extSpecId: string | null; declaredCount: number;
         opVerified: { count: number; chargeConfirmed: "device_screen" | null; extAgeY: number | null; auditId: string } | null }[];
  cylinder?: { declared: boolean; opVerified: { count: number; hoursLo: number; auditId: string } | null };   // hoursLo ≤ 10h × count (zod)
}
export type ResourceKind = "ESS_S" | "ESS_L" | "MOBILE_GEN" | "RENTAL_EXT" | "O2_CYL_DELIVERY" | "EV_V2L";
export interface ResourceView {
  id: string; kind: ResourceKind; cell: { x: number; y: number };
  outputW: number; energyWh: number; connectors: Connector[];
  inverterSafe: boolean | "unknown"; prepH: Range; available: boolean;
  mock: true; schemaRef: "data.go.kr/15151542";
}
export type EstimateStatus = "ASSUMED_RANGE" | "NEAR_CERTAIN" | "CONFIRMED";
export const RESTORATION_LABEL = "가정 시나리오 범위 · 한전 실시간 예측 아님" as const;
export interface RestorationView {
  cause: Cause; tOutage: number;
  p10: number; p50: number; p80: number; p90: number;   // now 기준 조건부 분위의 절대 모의 시각(3.9절)
  status: EstimateStatus; sigmaE: number | null;
  label: typeof RESTORATION_LABEL;
}
export interface PlannerView {
  scenarioId: string;
  now: number; tOutage: number;             // 모의 시각 h(시나리오 시작 0). 모든 시각은 절대값(3.9절)
  households: HouseholdView[]; resources: ResourceView[];
  restoration: RestorationView;
  lanes: { k119PerH: number; a119H: Range; shelter: { seats: number; prepH: Range } };
}

// ---- WorldTruth: 시뮬레이터 채점 전용 ----
export interface WorldTruth {
  seed: string; restorationH: number;
  hh: Record<string, { LTrueH: number; extWorks: boolean[]; backupFails: boolean; shelterRefuses: boolean; mrDelayH: number }>;
  unregistered: { id: string; LTrueH: number; cell: { x: number; y: number } }[]; // 도구에 안 보임
  arrivalTrueH: Record<string, number>;   // key `${hh}|${res}`
  a119TrueH: Record<string, number>; shelterTrueH: Record<string, number>;
}

// ---- 출력 ----
export type LowerBoundFlag = "CHARGE_UNKNOWN" | "AGE_UNKNOWN" | "EXT_UNVERIFIED_ZERO" | "SCREEN_CAPPED" | "USER_INPUT_DISCOUNTED"
  | "SETTING_USER_MIN" | "OPERATOR_LOWER" | "EXT_CHARGE_UNKNOWN" | "USER_AGE_IGNORED" | "MODEL_AI_UNCONFIRMED";
export interface LowerBound {
  hours: number | null; endT: number | null;   // endT = L_end = tReport + hours (3.9절)
  status: "AUTO" | "MANUAL_REVIEW"; capH: number | null;
  terms: { label: string; hours: number; prov: Prov }[];
  flags: LowerBoundFlag[];
}
export type Lane = "MANUAL_REVIEW" | "PROPOSE_ASSIGN" | "FALLBACK_119" | "GAP_REDUCE"
  | "FALLBACK_SHELTER" | "HOLD" | "UNSERVED_VISIBLE";
export interface Recommendation {
  householdId: string; lane: Lane; order: number; L: LowerBound; R: RestorationView;
  resourceId?: string; etaH?: number; marginH: Range | null; slackH: number | null;
  tier: 0 | 1 | null;                       // 4.1절 5단계 순서 키 1단(MANUAL_REVIEW·HOLD는 null)
  reservedResourceId?: string;              // MANUAL_REVIEW만: 검토 예약 자원(4.1절 2단계)
  holdRecheckBy?: number;                   // HOLD만: L_end − 1.25·A_min (모의 시각)
  reason: { templateId: string; params: Record<string, string | number> };
}
export type DecisionStatus = "PROPOSED" | "APPROVED" | "MODIFIED";   // REJECTED는 없다(I6)
export interface AuditEntry {
  at: string; actor: "demo-operator" | "system"; householdId: string;   // system은 HOLD_EXPIRED·RECHECK_FLAG만
  action: "APPROVE" | "MODIFY" | "VERIFY_EXT" | "VERIFY_CYL" | "VERIFY_AGE" | "VERIFY_MODEL" | "MANUAL_REVIEW_DONE" | "HOLD_EXPIRED"
    | "RECHECK_FLAG"                        // 승인 행의 feasible·도착 조건 위반 감지(1.4절 재계산)
    | "POWER_SUPPLIED"                      // 자원 도착·복구 확인. 재신고로 L_end가 늘 수 있는 유일한 예외(3.9절)
    | "PURGE_119";                          // /ops/119 표시분 파기(재난안전법 제74조의3⑤). 운영 결정 기록은 감사용으로 남는다
  from: { lane: Lane; resourceId?: string }; to: { lane: Lane; resourceId?: string };
  reasonCode?: string; reasonText?: string;  // MODIFY·VERIFY_*·MANUAL_REVIEW_DONE은 필수
  payload?: { extSpecId?: string; count?: number; hoursLo?: number; specId?: string; operatorLowerH?: number; basis?: string;
              chargeConfirmed?: "device_screen"; extAgeY?: number; batteryAgeY?: number };
}
// I7: 3키 strict. 세 번째 값은 소진 하한의 절대 모의 시각(ISO 문자열)이다
export const View119 = z.object({ location: z.string(), device: z.string(), expectedSafeUntil: z.string() }).strict();
export type View119 = z.infer<typeof View119>;
