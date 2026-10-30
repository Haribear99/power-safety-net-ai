// /ops 표시 문구(spec.md 1.4절). 'HOLD'는 「대기(재확인)」로, '모니터링'이라는 단어는 쓰지 않는다.
import type { Lane, LowerBoundFlag, ResourceKind } from "@/lib/domain/types";

export const LANE_KO: Record<Lane, string> = {
  MANUAL_REVIEW: "수동검토",
  PROPOSE_ASSIGN: "배정 제안",
  FALLBACK_119: "119 연계",
  GAP_REDUCE: "공백 단축 배정",
  FALLBACK_SHELTER: "쉼터 이동",
  HOLD: "대기(재확인)",
  UNSERVED_VISIBLE: "미배정(표시)",
};

export const LANE_ORDER: Lane[] = ["MANUAL_REVIEW", "PROPOSE_ASSIGN", "FALLBACK_119", "GAP_REDUCE", "FALLBACK_SHELTER", "HOLD", "UNSERVED_VISIBLE"];

export const LANE_TONE: Record<Lane, string> = {
  MANUAL_REVIEW: "border-gap text-gap",
  PROPOSE_ASSIGN: "border-batt text-batt",
  FALLBACK_119: "border-restore text-restore",
  GAP_REDUCE: "border-warn text-warn",
  FALLBACK_SHELTER: "border-muted text-muted",
  HOLD: "border-muted text-muted",
  UNSERVED_VISIBLE: "border-gap text-gap",
};

export const FLAG_KO: Record<LowerBoundFlag, string> = {
  CHARGE_UNKNOWN: "충전량 모름(½로 계산)",
  AGE_UNKNOWN: "연식 미확인(0.7로 계산)",
  EXT_UNVERIFIED_ZERO: "미확인 외장 0 처리",
  SCREEN_CAPPED: "기기 화면 남은 시간으로 상한",
  USER_INPUT_DISCOUNTED: "이용자 입력 할인(0.9)",
  SETTING_USER_MIN: "설정 미확인 · 최소 가동시간",
  OPERATOR_LOWER: "운영자 보수 하한",
  EXT_CHARGE_UNKNOWN: "외장 충전 미확인(c_ext ½)",
  USER_AGE_IGNORED: "이용자 입력 연식 무시",
  MODEL_AI_UNCONFIRMED: "AI 판독 기종 미확인(이웃 기종 최소값)",
  LOAD_WORST_CASE: "제조사 최악 조건 기준(정격 ½)",
};

export const KIND_KO: Record<ResourceKind, string> = {
  ESS_S: "소형 ESS",
  ESS_L: "대형 ESS",
  MOBILE_GEN: "이동형 발전기",
  RENTAL_EXT: "기기 전용 외장배터리 대여",
  O2_CYL_DELIVERY: "산소 실린더 배송",
  EV_V2L: "전기차 V2L",
};

export const h2 = (h: number) => (Math.round(h * 100) / 100).toFixed(2);
