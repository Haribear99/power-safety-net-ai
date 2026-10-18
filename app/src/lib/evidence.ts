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
  e2: { n: number; nCells: number; superiorVsKr: number; inferiorVsKr: number; pooledRel: number; pooledRelLo: number; pooledRelHi: number; relRange: { lo: number; hi: number }; P1: number; P0: number; P2: number; vsB2?: { rel: number | null; v: string } };
  e1: { draws: number; scenarios: number; robustKr: { cls: string; cause: string }[]; robustRule: { cls: string; cause: string }[]; stabilityPass: boolean | null };
  gate2?: { a: boolean; b: boolean; pass: boolean };
  prereg?: { section1: { hit: number; total: number }; section2: { hit: number; total: number } };
  /** E3 끝 카드 문장(RULE+P7 고정, prereg/predictions_e3.md 3절) */
  e3?: { n: number; variant: string; rel: number; effLo: number; effHi: number; robustBefore: number; closed: number; prereg?: { hit: number; total: number } };
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

/** C1 라벨 판독 봉인 측정(S3, 1회)과 tesseract 기준선 */
export interface C1Rate { k: number; n: number; ciLo: number; ciHi: number }
export interface C1Side {
  n: number; degradedModelConfidentWrong: C1Rate; degradedAllFieldsConfidentWrong: C1Rate; unflaggedMismatch: C1Rate; dbMatchRate: C1Rate;
  unregisteredToReview: C1Rate; modelExact: C1Rate; supplementViolations: number; supplementConfident: number; personalInfo: { k: number; n: number };
  byTemplateGroup: { testOnly: { k: number; n: number }; shared: { k: number; n: number } }; costPerImage?: number; latencyP50?: number; latencyP95?: number;
}
export interface C1Evidence { sonnet: C1Side; tesseract?: C1Side; gate3: { pointEstimate: number; threshold: number; pass: boolean }; devRunConsistency?: { n: number; modelSame: number } }
export function c1Evidence(): C1Evidence | null {
  return (doc as unknown as { c1?: C1Evidence }).c1 ?? null;
}

/** 사후 외부 대조(봉인 아님): 아파트 정전 복구시간 가정 분포 대 기후에너지환경부 3년 7구간 분포 */
export interface AptCalib {
  n: number; years: number; binsUpperH: number[]; counts: number[]; gt12h: number; gt24h: number; perYear: number;
  sourceUrl: string; sourceDate: string; capH: number; consistent: boolean; G: number; p: number; expected: number[];
}
export function aptCalib(): AptCalib | null {
  return (doc as unknown as { calib?: { apt?: AptCalib } }).calib?.apt ?? null;
}

/** E4: 실측 정전시간 분포 재시뮬레이션(S6 봉인 실행) */
type ByPolicy = { KR_BASELINE: number | null; RULE: number | null; "RULE+P7": number | null };
export interface E4Evidence {
  n: number;
  ruleVsKr: { rel: number; lo: number; hi: number };
  p7: { rel: number; lo: number; hi: number };
  hhGap: { VENT_1H: ByPolicy; VENT_3H: ByPolicy };
  prereg: { hit: number; total: number; missed: { id: string; text: string; value: string }[] };
}
export function e4Evidence(): E4Evidence | null {
  return (doc as unknown as { e4?: E4Evidence }).e4 ?? null;
}

/** E5: AI 판독 기여·기록 기반 표적 사전 배치(S7 봉인 실행) */
type Rel = { rel: number | null; lo: number | null; hi: number | null };
type ByArm = { "AI@RULE": number | null; "AI@RULE+P7": number | null; "AI@RULE+P7T": number | null };
export interface E5Evidence {
  n: number; unknownRateAI: number;
  aiVsNo: Rel; perfVsNo: Rel; aiVsKr: Rel; p7tVsP7: Rel;
  hhGap: { VENT_1H: ByArm; VENT_3H: ByArm; O2_STAT: ByArm };
  prereg: { hit: number; total: number; missed: { id: string; text: string; value: string }[]; notScored: { id: string; text: string; value: string }[] };
}
export function e5Evidence(): E5Evidence | null {
  return (doc as unknown as { e5?: E5Evidence }).e5 ?? null;
}

/** E6: 평시 정보 표적 사전 배치(S8 봉인 실행) */
export interface E6Evidence {
  n: number; preVsRand: Rel; outVsRand: Rel;
  hhGap: Record<string, { rand: number | null; pre: number | null }>;
  worse: string[];
  prereg: { hit: number; total: number; missed: { id: string; text: string; value: string }[] };
}
export function e6Evidence(): E6Evidence | null {
  return (doc as unknown as { e6?: E6Evidence }).e6 ?? null;
}

/** N1: 보호자 알림 AI 문장 + 두 단계 검사(S9 봉인 실행). lo·hi = Wilson 95% */
export interface RateCI { k: number; n: number; lo: number | null; hi: number | null }
export interface N1Evidence {
  aiSent: RateCI; templateFalseReject: RateCI;
  badMissed: RateCI; badCaughtGate1: RateCI; badCaughtGate2: RateCI; goodFalseReject: RateCI;
  missedCategories: { category: string; missed: number; n: number }[];
  judge: { ai: number; template: number; same: number; fail: number };
  latencyP50: number | null;
  /** 봉인 실행에서 AI 글이 나간 대표 예시(sentences = 본문 + 고정 119·123 문장) */
  examples: { label: string; id: string; sentences: string[] }[];
  /** 봉인 당시 고정 문안 모순 쌍과 나머지로 나눈 쌍 비교 */
  judgeSplit?: { contradiction: { n: number; ai: number; template: number; same: number }; rest: { ai: number; template: number; same: number } };
  costPerNotice?: { mean: number; max: number } | null;
  prereg: { hit: number; total: number; structural: { id: string; text: string; value: string; hit: boolean | null }[]; missed: { id: string; text: string; value: string }[] };
}
export function n1Evidence(): N1Evidence | null {
  return (doc as unknown as { n1?: N1Evidence }).n1 ?? null;
}
