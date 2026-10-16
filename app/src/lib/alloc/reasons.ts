// 근거 문장 템플릿 (spec.md 4.1절 7단계). 비AI — 문장은 이 템플릿으로만 만든다.
// 숫자 자리는 결정 레코드의 정수 초를 fmtH로 바꾼 값만 넣는다(문장 숫자 = 레코드 숫자, 단위 시험).
// 금지 표현(9절 lint-claims)과 HOLD 표기 「대기(재확인)」 규칙을 따른다.
import { INF_S, NEG_INF_S } from "../engine/quantize";

export const TEMPLATES = {
  "R-ASSIGN":
    "남은 하한 {L}h < 복구 가정 P80까지 {R80}h → 전원 필요. 처리 순서 키 tier {tier}(복구 가정 P90 {R90}h 대비) · slack {s}h. " +
    "{res} 도착 {A}h ≤ 0.8×하한 {L08}h, 출력 {W}W ≥ 1.25×{w}W, {conn} 호환. 여유 {mlo}~{mhi}h",
  "R-ASSIGN-DEF":
    "남은 하한 {L}h, 복구 가정 P80까지 {R80}h · 대기 조건 미충족({why}) → 기본값은 배정. 처리 순서 키 tier {tier}(복구 가정 P90 {R90}h 대비) · slack {s}h. " +
    "{res} 도착 {A}h ≤ 0.8×하한 {L08}h, 출력 {W}W ≥ 1.25×{w}W, {conn} 호환. 여유 {mlo}~{mhi}h",
  "R-HOLD": "복구 통보 P80 {R80}h ≤ 하한 기준 {th}h → 대기(재확인). 재확인 시한까지 {t}h. 언제든 배정으로 전환 가능",
  "R-HOLD-EXP": "재확인 시한 {t} 경과 → 대기 해제, 필요 판정으로 전환(승인 필요)",
  "R-EXT0": "외장배터리 {n}개 미확인 → 0시간으로 계산",
  "R-GAP":
    "0.8×하한 {L08}h 안에 도착 가능한 호환 자원 없음(최단 {A}h, slack {s}h) → 예상 공백 {d}h 단축 목적 배정 제안({res})",
  "R-GAP-FB": "도착 전 공백 예상 · 공백 단축 목적. {res} 도착 {A}h, 남은 하한 {L}h",
  "R-119": "0.8×하한 안 도착 가능한 자원 없음(slack {s}h) → 119 연계. 이송 완료 예상 {done}h ≤ 남은 하한 {L}h",
  "R-119-LATE": "지연 플래그: 119 슬롯 시작 {s0}h 뒤, 이송 완료 예상 {done}h > 남은 하한 {L}h. 앞선 수단 없음",
  "R-SHELTER": "자원·119 연계 불가 → 쉼터 이동 제안(배정 뒤 남은 좌석 {seats})",
  "R-UNSERVED": "물리 조건을 만족하는 자원, 119 슬롯, 쉼터가 모두 없음 → 미배정으로 표시(숨기지 않음). 남은 하한 {L}h",
  "R-MR": "수동검토 필요(자동 계산 안 함). 검토 예약 자원 {res} · 119 예약 {r119} · 예약 시한까지 {t}h",
  "R-MR-NORES": "수동검토 필요(자동 계산 안 함). 자원 예약 없음({why}) · 119 예약 {r119} · 대기열 최상단 · 검토 시한까지 {t}h",
  "R-RECHECK": "승인 배정 재검토 필요: {why}. 승인 배정은 자동으로 바꾸지 않음 · 대안은 승인 필요",
  "R-BASE": "기준선 {policy}: {res} 배정 제안(도착 {A}h, 물리 필터 통과, 0.8×하한 {L08}h {arr})",
} as const;

export type TemplateId = keyof typeof TEMPLATES;
export interface Reason { templateId: TemplateId; params: Record<string, string | number> }

/** 정수 초 → 시간 소수 둘째 자리 문자열(반올림 half-up, 정수 연산). 감시값은 ∞ 기호 */
export function fmtH(s: number): string {
  if (s >= INF_S) return "∞";
  if (s <= NEG_INF_S) return "−∞";
  const neg = s < 0;
  const c = Math.floor((Math.abs(s) * 100 + 1800) / 3600); // 1/100 h
  const str = `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
  return neg && c !== 0 ? `-${str}` : str;
}

export function placeholders(t: TemplateId): string[] {
  return [...TEMPLATES[t].matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
}

/** 템플릿 렌더. 자리표시자가 빠지거나 남는 매개변수가 있으면 예외(문장 = 레코드 보장) */
export function renderReason(r: Reason): string {
  const keys = placeholders(r.templateId);
  for (const k of keys) if (!(k in r.params)) throw new Error(`${r.templateId}: 매개변수 ${k} 없음`);
  for (const k of Object.keys(r.params)) if (!keys.includes(k)) throw new Error(`${r.templateId}: 쓰지 않는 매개변수 ${k}`);
  return TEMPLATES[r.templateId].replace(/\{(\w+)\}/g, (_, k: string) => String(r.params[k]));
}
