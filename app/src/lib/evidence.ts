// evidence.json 읽기 (spec.md 1.1절 '마지막 10초', 11.4절). 화면 숫자는 모두 여기서 나온다.
// 키가 없으면 null을 돌려주고, 화면은 「측정 전」으로 바꿔 쓴다(하드코딩 금지).
import raw from "@/data/evidence.json";

export const BEFORE_MEASURE = "측정 전" as const;

export interface PresetAbPolicy { M1: number; M2H: number; M2S: number; highRisk: number }
export interface PresetAb {
  scenarioId: string; name: string; seed: string; scenarioSha256: string;
  policies: Partial<Record<"RULE" | "B1_SHORTEST" | "B2_NEAREST" | "KR_BASELINE", PresetAbPolicy>>;
}
export interface DiffSummary {
  total: { scenarios: number; pass: number; households: number };
  mismatchCounts: Record<string, number>;
  inputManifestSha256: string;
}

/** 라운드 5 끝 카드 헤드라인(봉인 실행, sync-evidence가 out/lab_sealed.json에서 채운다) */
export interface LabHeadline {
  tag: string;
  e2: { n: number; nCells: number; superiorVsKr: number; inferiorVsKr: number; pooledRel: number; pooledRelLo: number; pooledRelHi: number; relRange: { lo: number; hi: number }; P1: number; P0: number; P2: number };
  e1: { draws: number; scenarios: number; robustKr: { cls: string; cause: string }[]; robustRule: { cls: string; cause: string }[]; stabilityPass: boolean | null };
  gate2?: { a: boolean; b: boolean; pass: boolean };
  prereg?: { section1: { hit: number; total: number }; section2: { hit: number; total: number } };
}

interface EvidenceDoc {
  format: string;
  presetsAb?: PresetAb[];
  diff?: DiffSummary;
  sweepN?: number;
  lab?: LabHeadline;
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
export function evidenceSources(): Record<string, string> {
  return doc.sources ?? {};
}
export function labHeadline(): LabHeadline | null {
  return doc.lab ?? null;
}
