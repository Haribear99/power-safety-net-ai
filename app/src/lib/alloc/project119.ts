// 119 화면 투영 (spec.md 1.5절, I7). 비AI.
// 싣는 행: APPROVED이면서 레인이 FALLBACK_119인 행만. View119는 정확히 3키(strict): 위치·기기·예상 안전시간(절대 시각 ISO).
// 가명·승인 시각 같은 다른 키는 타입과 zod .strict()로 막는다. Date 금지(3장)라 ISO 시각은 정수 달력 연산으로 만든다.
import type { DecisionStatus, DeviceClass, HouseholdView, Lane } from "../domain/types";
import { View119 } from "../domain/types";
import { DEFAULT_DB, type EngineDb } from "../engine/lowerBound";
import { floorDiv, qT } from "../engine/quantize";

export const DEVICE_CLASS_LABEL: Record<DeviceClass, string> = {
  O2_STAT: "거치형 산소발생기",
  O2_STAT_CYL: "거치형 산소발생기(실린더 보유)",
  VENT_1H: "인공호흡기(내장 약 1시간급)",
  VENT_3H: "인공호흡기(내장 약 3시간급)",
  O2_PORT: "휴대형 산소발생기",
  VENT_8H: "인공호흡기(내장 약 8시간급)",
  VENT_8H_EXT2: "인공호흡기(내장 약 8시간급 · 외장 2개)",
  INTERMITTENT: "간헐 사용 기기",
  UNKNOWN: "미등록 기기",
};

export interface Row119Input {
  householdId: string;
  lane: Lane;
  status: DecisionStatus;
  /** 소진 하한 절대 모의 시각(h) = L_end */
  lEndH: number | null;
}

// ---- 정수 달력(Howard Hinnant days_from_civil / civil_from_days) ----
function daysFromCivil(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = floorDiv(yy, 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = floorDiv(153 * mp + 2, 5) + d - 1;
  const doe = yoe * 365 + floorDiv(yoe, 4) - floorDiv(yoe, 100) + doy;
  return era * 146097 + doe - 719468;
}
function civilFromDays(z0: number): [number, number, number] {
  const z = z0 + 719468;
  const era = floorDiv(z, 146097);
  const doe = z - era * 146097;
  const yoe = floorDiv(doe - floorDiv(doe, 1460) + floorDiv(doe, 36524) - floorDiv(doe, 146096), 365);
  const doy = doe - (365 * yoe + floorDiv(yoe, 4) - floorDiv(yoe, 100));
  const mp = floorDiv(5 * doy + 2, 153);
  const d = doy - floorDiv(153 * mp + 2, 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})([+-]\d{2}:\d{2}|Z)$/;
const p2 = (n: number) => String(n).padStart(2, "0");

/** 모의 시각 0의 벽시계 ISO(예 "2026-10-17T22:00:00+09:00")에 정수 초를 더한 ISO 문자열 */
export function mockIso(baseIso: string, offsetS: number): string {
  const m = ISO_RE.exec(baseIso);
  if (!m) throw new Error(`기준 시각 ISO 형식 아님: ${baseIso}`);
  const [y, mo, d, hh, mi, ss] = m.slice(1, 7).map(Number);
  const total = daysFromCivil(y, mo, d) * 86400 + hh * 3600 + mi * 60 + ss + offsetS;
  const days = floorDiv(total, 86400);
  const sec = total - days * 86400;
  const [Y, M, D] = civilFromDays(days);
  return `${Y}-${p2(M)}-${p2(D)}T${p2(Math.floor(sec / 3600))}:${p2(Math.floor((sec % 3600) / 60))}:${p2(sec % 60)}${m[7]}`;
}

/**
 * APPROVED ∧ FALLBACK_119 행만 View119(3키)로 투영한다. 승인 전이면 빈 배열. 파기는 화면 상태가 비운다.
 * baseIso는 모의 시각 0의 벽시계(시나리오 데이터).
 */
export function project119(rows: readonly Row119Input[], households: readonly HouseholdView[], baseIso: string, db: EngineDb = DEFAULT_DB): View119[] {
  const out: View119[] = [];
  for (const r of rows) {
    if (r.status !== "APPROVED" || r.lane !== "FALLBACK_119" || r.lEndH == null) continue;
    const hh = households.find((h) => h.id === r.householdId);
    if (!hh) continue;
    const dev = hh.device.specId != null ? db.devices.get(hh.device.specId) : undefined;
    out.push(View119.parse({
      location: `격자 (${hh.cell.x}, ${hh.cell.y}) km`,
      device: DEVICE_CLASS_LABEL[dev?.cls ?? "UNKNOWN"],
      expectedSafeUntil: mockIso(baseIso, qT(r.lEndH)),
    }));
  }
  return out;
}
