// 리허설 랩 상세 결과 읽기 (spec.md 5.8절, 라운드 5). 서버 컴포넌트 전용 — 클라이언트에서 import하지 않는다(/ops 번들 크기).
// 값은 scripts/sync-evidence.ts가 out/lab_sealed.json에서 만든 src/data/lab.json뿐이다. 키가 없으면 null → 화면은 「측정 전」.
import raw from "@/data/lab.json";
import type { Cause } from "@/lib/domain/types";
import { pValue } from "@/lib/engine/params";
import type { GenClass } from "@/lib/sim/labels";

export interface LabCmp { w: number; t: number; l: number; rel: number | null; relLo: number | null; relHi: number | null; d: number | null; v: string }
export interface LabE2Cell { cell: string; n: number; pClass: "P1" | "P0" | "P2"; cap: number | null; kr: LabCmp; b1: LabCmp; b2: LabCmp }
export interface LabE1Cell {
  cls: GenClass; cause: Cause; pol: "KR_BASELINE" | "RULE"; n: number; p: number; lo: number; hi: number;
  label: "ROBUST" | "CONDITIONAL" | "FRAGILE" | "BORDERLINE"; raw: string; zero: boolean; demoted?: boolean;
  flips?: { axis: string; end: string; value: number | string; p: number }[]; boundaryH?: number;
}
export interface PreregItem { id: string; claim: string; observed: string; hit: boolean }
export interface LabDoc {
  format: string; tag: string | null;
  e2?: {
    n: number; cells: LabE2Cell[];
    pooled: { totals: Record<string, { M1: number; M2H: number }>; compares: Record<string, LabCmp>; cap: number | null };
  };
  e1?: {
    draws: number; falsifyDraws: number; cells: LabE1Cell[];
    stability: { pass: boolean; robustKept: number; robustTotal: number; flipped: { cls: string; cause: string; policy: string; from: string; to: string }[] } | null;
    e1b: Record<string, { binLoH: number; n: number; gap: number[] }[]>;
  };
  prereg?: { section1: { hit: number; total: number }; section2: { hit: number; total: number }; items: PreregItem[]; gate2: { a: boolean; b: boolean; pass: boolean } } | null;
}

const doc = raw as unknown as LabDoc;
export function lab(): LabDoc | null {
  return doc.e2 && doc.e1 ? doc : null;
}

export const CLASS_ORDER: readonly GenClass[] = ["O2_STAT", "VENT_1H", "VENT_3H", "O2_PORT", "VENT_8H", "O2_STAT_CYL", "VENT_8H_EXT2"];
export const CLASS_KO: Record<GenClass, string> = {
  O2_STAT: "거치형 산소 · 배터리 없음",
  O2_STAT_CYL: "거치형 산소 + 실린더",
  VENT_1H: "인공호흡기 내장 1시간급",
  VENT_3H: "인공호흡기 내장 3시간급",
  O2_PORT: "휴대형 산소",
  VENT_8H: "인공호흡기 내장 8시간급",
  VENT_8H_EXT2: "인공호흡기 8시간급 + 외장 2개",
};
export const CAUSE_ORDER: readonly Cause[] = ["KEPCO_DIST", "APT_SHORT", "TYPHOON_WEAK", "TYPHOON_STRONG", "APT_NIGHT_XFMR", "APT_PARTS", "APT_FIRE", "ROTATING"];
const CAUSE_NAME: Record<Cause, string> = {
  KEPCO_DIST: "한전 배전 고장", APT_SHORT: "단지 단기 고장", APT_NIGHT_XFMR: "야간 변압기", APT_PARTS: "부품 조달 지연",
  APT_FIRE: "전기실 화재", TYPHOON_WEAK: "약한 태풍", TYPHOON_STRONG: "강한 태풍", ROTATING: "순환단전",
};

/** 원인 이름 + 장부의 가정 복구 범위(P10~P90). 범위는 spec/params.json에서 읽는다 */
export function causeLabel(c: Cause): { name: string; range: string } {
  const v = pValue<{ p10H?: number; p90H?: number; valueH?: number; dist: string }>(`restoration.${c}`);
  let range = "";
  if (v.p10H != null && v.p90H != null) range = `가정 ${v.p10H}~${v.p90H}h`;
  else if (v.valueH != null) range = `${v.valueH}h 블록`;
  else range = "보정 분포";
  return { name: CAUSE_NAME[c], range };
}

/** E2 칸 id("s0.5-r1.5-fast") → 사람이 읽는 조건 */
export function cellParts(id: string): { sigmaE: number; ratio: number; travel: string } {
  const m = /^s([\d.]+)-r([\d.]+)-(\w+)$/.exec(id);
  if (!m) throw new Error(`칸 id 형식 오류 ${id}`);
  return { sigmaE: Number(m[1]), ratio: Number(m[2]), travel: ({ fast: "빠름", standard: "보통", slow: "느림" } as Record<string, string>)[m[3]] ?? m[3] };
}

export const pct1 = (x: number | null | undefined) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
