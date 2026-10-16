// 매개변수 장부 로더 (spec.md 3장 상수 규칙). 엔진 상수는 모두 이 모듈의 키로만 읽는다.
// 정본은 저장소 루트 spec/params.json이다. Next 빌드에서 import하려면 next.config의 turbopack.root를
// 저장소 루트로 두어야 한다(DEVLOG 구현 중 결정).
import { z } from "zod";
import raw from "../../../../spec/params.json";

export const PROV_TYPES = ["spec", "measured", "event", "policy", "inferred", "assumed", "calibrated", "operator"] as const;

const RowSchema = z
  .object({
    key: z.string().min(1),
    value: z.unknown().optional(),
    range: z.object({ lo: z.number(), hi: z.number() }).optional(),
    ratio: z.tuple([z.number().int(), z.number().int().positive()]).optional(),
    unit: z.string().min(1),
    type: z.enum(PROV_TYPES),
    sourceIds: z.array(z.string().min(1)),
    note: z.string().min(1),
  })
  .strict()
  .refine((r) => r.value !== undefined || r.range !== undefined, { message: "value 또는 range 필요" })
  .refine((r) => !r.range || r.range.lo <= r.range.hi, { message: "range.lo ≤ range.hi" })
  .refine((r) => !["spec", "measured", "event", "policy"].includes(r.type) || r.sourceIds.length > 0, {
    message: "spec·measured·event·policy 행은 sourceIds 필요",
  })
  .refine((r) => !r.ratio || (typeof r.value === "number" && r.ratio[0] / r.ratio[1] === r.value), {
    message: "ratio는 value와 같아야 한다",
  });

export type ParamRow = z.infer<typeof RowSchema>;
const LedgerSchema = z.object({ meta: z.record(z.string(), z.unknown()), rows: z.array(RowSchema) });

function load(): Map<string, ParamRow> {
  const parsed = LedgerSchema.parse(raw);
  const m = new Map<string, ParamRow>();
  for (const r of parsed.rows) {
    if (m.has(r.key)) throw new Error(`params.json 중복 키 ${r.key}`);
    m.set(r.key, r);
  }
  return m;
}

export const PARAMS: ReadonlyMap<string, ParamRow> = load();

export function paramRow(key: string): ParamRow {
  const r = PARAMS.get(key);
  if (!r) throw new Error(`params.json에 키가 없음: ${key}`);
  return r;
}

export function pNum(key: string): number {
  const v = paramRow(key).value;
  if (typeof v !== "number") throw new Error(`params ${key}: 숫자 value가 아님`);
  return v;
}

/** 결정 경로 정수 유리수 [분자, 분모] */
export function pRatio(key: string): readonly [number, number] {
  const r = paramRow(key).ratio;
  if (!r) throw new Error(`params ${key}: ratio 없음`);
  return r;
}

export function pRange(key: string): { lo: number; hi: number } {
  const r = paramRow(key).range;
  if (!r) throw new Error(`params ${key}: range 없음`);
  return r;
}

export function pValue<T>(key: string): T {
  return paramRow(key).value as T;
}
