// 저장된 C1 원시 응답을 다시 채점한다(호출 없음). 회차 간 불일치율은 dev 셋 두 회차를 비교한다(7.2절 '지표').
// 실행 (app/에서): npx tsx scripts/c1-rescore.ts --dir out/c1/v1-r2 [--vs out/c1/v1-r1] [--split dev]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizeKey } from "../src/lib/engine/lowerBound";
import { LABEL_FIELDS, LabelOut, type LabelOutT } from "../src/lib/vision/label";
import { aggregate, scoreItem, type LabelTruth } from "../src/lib/vision/score";

const repo = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const dir = path.join(repo, arg("dir")!);
const split = arg("split", "dev")!;
const vs = arg("vs");

const EMPTY = { verbatim: null, legibility: "illegible", confidence: "low" } as const;
function load(d: string): Map<string, LabelOutT> {
  const m = new Map<string, LabelOutT>();
  for (const f of readdirSync(d).filter((x) => /^(dev|test)-\d+\.json$/.test(x))) {
    const j = JSON.parse(readFileSync(path.join(d, f), "utf-8")) as { id: string; ok: boolean; data?: unknown };
    m.set(j.id, j.ok ? LabelOut.parse(j.data) : LabelOut.parse({ manufacturer: EMPTY, model: EMPTY, ratedPower: EMPTY, voltage: EMPTY, batteryText: EMPTY, personalInfoVisible: false, language: "mixed", otherText: [] }));
  }
  return m;
}
const outs = load(dir);
const items = [...outs].map(([id, o]) => scoreItem(JSON.parse(readFileSync(path.join(repo, "datasets", "labels", split, `${id}.json`), "utf-8")) as LabelTruth, o));
const m = aggregate(items);
let consistency: unknown = null;
if (vs) {
  const other = load(path.join(repo, vs));
  let same = 0, n = 0, sameAll = 0;
  for (const [id, o] of outs) {
    const p = other.get(id);
    if (!p) continue;
    n++;
    const eq = (f: (typeof LABEL_FIELDS)[number]) => (o[f].verbatim == null ? null : normalizeKey(o[f].verbatim!)) === (p[f].verbatim == null ? null : normalizeKey(p[f].verbatim!)) && o[f].confidence === p[f].confidence && o[f].legibility === p[f].legibility;
    if (eq("model")) same++;
    if (LABEL_FIELDS.every(eq)) sameAll++;
  }
  consistency = { n, modelSame: same, allFieldsSame: sameAll, note: "원문(정규화)·판독 상태·확신이 모두 같아야 같음으로 센다" };
}
writeFileSync(path.join(dir, "rescore.json"), JSON.stringify({ metrics: m, consistency, items }, null, 1));
console.log(JSON.stringify({ n: items.length, headline: m.degradedModelConfidentWrong, unflagged: m.unflaggedMismatch, unregToReview: m.unregisteredToReview, dbMatch: m.dbMatchRate, supplement: m.supplementViolations, fieldExact: m.fieldExact, personal: m.personalInfo, consistency }));
