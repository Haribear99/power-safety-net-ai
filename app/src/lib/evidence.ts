// evidence.json 읽기 (spec.md 1.1절 '마지막 10초', 11.4절). 화면 숫자는 모두 여기서 나온다.
// 키가 없으면 null을 돌려주고, 화면은 「측정 전」으로 바꿔 쓴다(하드코딩 금지).
import raw from "@/data/evidence.json";

export const BEFORE_MEASURE = "측정 전" as const;

export interface PresetAbPolicy { M1: number; M2H: number; M2S: number; highRisk: number }
export interface PresetAb {
  scenarioId: string; name: string; seed: string; scenarioSha256: string;
  policies: Partial<Record<"RULE" | "B1_SHORTEST" | "B2_NEAREST", PresetAbPolicy>>;
}
export interface DiffSummary {
  total: { scenarios: number; pass: number; households: number };
  mismatchCounts: Record<string, number>;
  inputManifestSha256: string;
}
/** /lab 실험 결과(Phase 3에서 sync-evidence가 채운다) */
export interface Dominance { n: number; cells: number; p1: number; p0: number; p2: number }

interface EvidenceDoc {
  format: string;
  presetsAb?: PresetAb[];
  diff?: DiffSummary;
  sweepN?: number;
  dominance?: Dominance;
  e3?: { baseA?: { topSameCost?: { mLo: number; mHi: number } } };
  robustPairs?: string[];
  sources?: Record<string, string>;
}

const doc = raw as unknown as EvidenceDoc;

export function presetAb(scenarioId: string): PresetAb | null {
  return doc.presetsAb?.find((p) => p.scenarioId === scenarioId) ?? null;
}
export function diffSummary(): DiffSummary | null {
  return doc.diff ?? null;
}
export function sweepN(): number | null {
  return typeof doc.sweepN === "number" ? doc.sweepN : null;
}
export function dominance(): Dominance | null {
  return doc.dominance ?? null;
}
export function patchRange(): { mLo: number; mHi: number } | null {
  return doc.e3?.baseA?.topSameCost ?? null;
}
export function robustPairs(): string[] | null {
  return doc.robustPairs && doc.robustPairs.length > 0 ? doc.robustPairs : null;
}
export function evidenceSources(): Record<string, string> {
  return doc.sources ?? {};
}
