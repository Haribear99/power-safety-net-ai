// C1 채점 (spec.md 7.2절 '지표', prereg/c1.json). 비AI, 결정적.
// 필드 판정: CORRECT | WRONG | SUPPLEMENT(가린 글자를 채워 전체 정답과 같음 — 정답 아님, 따로 셈)
// 자신 있게 틀림 = (WRONG ∨ SUPPLEMENT) ∧ confidence=high ∧ legibility=clear
import { normalizeKey } from "../engine/lowerBound";
import { LABEL_FIELDS, matchLabel, type LabelField, type LabelOutT } from "./label";

export interface LabelTruth {
  id: string; split: string; kind: "real" | "decoy"; strength: "none" | "light" | "full"; template: string;
  truthSpecId: string | null; decoy: boolean;
  fields: Partial<Record<LabelField, string | null>>;
  personalInfoVisible: boolean;
  /** 필드 → 가린 글자 인덱스 */
  occluded: Partial<Record<string, number[]>>;
}

export type FieldVerdict = "CORRECT" | "WRONG" | "SUPPLEMENT";

export function judgeField(truthText: string | null | undefined, occludedIdx: number[] | undefined, out: LabelOutT[LabelField]): FieldVerdict {
  const v = out.verbatim == null ? null : normalizeKey(out.verbatim);
  if (truthText == null) return v == null || v === "" ? "CORRECT" : "WRONG";
  const full = normalizeKey(truthText);
  if (!occludedIdx || occludedIdx.length === 0) return v === full ? "CORRECT" : "WRONG";
  // 가림이 닿은 필드
  if (v === full) return "SUPPLEMENT";
  if (out.legibility !== "clear" && (v == null || v === "")) return "CORRECT";
  const lo = Math.min(...occludedIdx), hi = Math.max(...occludedIdx);
  const pre = normalizeKey(truthText.slice(0, lo)), suf = normalizeKey(truthText.slice(hi + 1));
  // 가린 자리를 ?·…·*·_ 등으로 표시한 출력은 그 표시를 지우고 본다
  const w = (v ?? "").replace(/[?…*_·]+/g, "");
  const consistent = w !== "" && (pre.includes(w) || suf.includes(w) || w === pre + suf || (w.startsWith(pre) && w.endsWith(suf) && w.length < full.length));
  return consistent ? "CORRECT" : "WRONG";
}

export const confident = (f: LabelOutT[LabelField]) => f.confidence === "high" && f.legibility === "clear";

export interface ItemScore {
  id: string; kind: string; strength: string; template: string;
  fields: Record<LabelField, { verdict: FieldVerdict; confident: boolean }>;
  match: { status: string; specId?: string; reason?: string };
  truthSpecId: string | null;
  /** DB 수준 무플래그 오매칭: MATCHED인데 정답 기종과 다름(미끼는 MATCHED 자체가 오매칭) */
  unflaggedMismatch: boolean;
  personalOk: boolean;
}

export function scoreItem(t: LabelTruth, out: LabelOutT): ItemScore {
  const fields = {} as ItemScore["fields"];
  for (const f of LABEL_FIELDS) fields[f] = { verdict: judgeField(t.fields[f], t.occluded[f], out[f]), confident: confident(out[f]) };
  const m = matchLabel(out);
  return {
    id: t.id, kind: t.kind, strength: t.strength, template: t.template, fields, truthSpecId: t.truthSpecId,
    match: m.status === "MATCHED" ? { status: m.status, specId: m.specId } : { status: m.status, reason: m.reason },
    unflaggedMismatch: m.status === "MATCHED" && m.specId !== t.truthSpecId,
    personalOk: out.personalInfoVisible === t.personalInfoVisible,
  };
}

export interface Rate { k: number; n: number }
export interface C1Metrics {
  n: number;
  /** 헤드라인: 열화 × model 필드 자신 있게 틀림 */
  degradedModelConfidentWrong: Rate;
  degradedAllFieldsConfidentWrong: Rate;
  fieldExact: Record<LabelField, Rate>;
  unflaggedMismatch: Rate;
  dbMatchRate: Rate;
  unregisteredToReview: Rate;
  supplementViolations: number;
  personalInfo: Rate;
  byTemplateGroup: { testOnly: Rate; shared: Rate };
}

export function aggregate(items: ItemScore[], testOnlyTemplates: readonly string[] = ["T7", "T8"]): C1Metrics {
  const r = (pred: (x: ItemScore) => boolean, among: ItemScore[]): Rate => ({ k: among.filter(pred).length, n: among.length });
  const deg = items.filter((x) => x.kind === "real" && x.strength === "full");
  const cw = (x: ItemScore, f: LabelField) => x.fields[f].verdict !== "CORRECT" && x.fields[f].confident;
  const fieldExact = {} as C1Metrics["fieldExact"];
  for (const f of LABEL_FIELDS) fieldExact[f] = r((x) => x.fields[f].verdict === "CORRECT", items);
  let degAllK = 0;
  for (const x of deg) for (const f of LABEL_FIELDS) if (cw(x, f)) degAllK++;
  const real = items.filter((x) => x.truthSpecId != null);
  const unreg = items.filter((x) => x.truthSpecId == null);
  const to = items.filter((x) => testOnlyTemplates.includes(x.template)), sh = items.filter((x) => !testOnlyTemplates.includes(x.template));
  const degModelCw = (x: ItemScore) => x.kind === "real" && x.strength === "full" && cw(x, "model");
  return {
    n: items.length,
    degradedModelConfidentWrong: r((x) => cw(x, "model"), deg),
    degradedAllFieldsConfidentWrong: { k: degAllK, n: deg.length * LABEL_FIELDS.length },
    fieldExact,
    unflaggedMismatch: r((x) => x.unflaggedMismatch, items),
    dbMatchRate: r((x) => x.match.status === "MATCHED" && x.match.specId === x.truthSpecId, real),
    unregisteredToReview: r((x) => x.match.status === "MANUAL_REVIEW", unreg),
    supplementViolations: items.reduce((s, x) => s + LABEL_FIELDS.filter((f) => x.fields[f].verdict === "SUPPLEMENT").length, 0),
    personalInfo: r((x) => x.personalOk, items),
    byTemplateGroup: { testOnly: r(degModelCw, to.filter((x) => x.kind === "real" && x.strength === "full")), shared: r(degModelCw, sh.filter((x) => x.kind === "real" && x.strength === "full")) },
  };
}
