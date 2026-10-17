// C1 기준선(Must): tesseract.js(kor+eng) + 정규식 → 같은 matcher·같은 채점 (spec.md 7.2절 '기준선과 절제'). AI 아님.
// 규칙(시험셋 실행 전 고정): 줄마다 '키: 값'을 찾는다. 키 → 필드 대응은 아래 FIELD_KEYS. 값 줄의 단어 신뢰도 평균 ≥ 80이면 confidence=high,
// 값이 비면 illegible. legibility는 항상 clear(OCR은 부분 판독을 표시하지 못함 — 이 기준선의 약점이 그대로 드러나게 둔다).
// 실행 (app/에서): npx tsx scripts/c1-tesseract.ts --split dev --tag tess
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createWorker } from "tesseract.js";
import { LabelOut, type LabelField, type LabelOutT } from "../src/lib/vision/label";
import { aggregate, scoreItem, type LabelTruth } from "../src/lib/vision/score";

const repo = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const split = arg("split", "dev")!;
const tag = arg("tag", "tess")!;

export const FIELD_KEYS: Record<LabelField, RegExp> = {
  manufacturer: /^(제조원|제조사|Manufacturer)/i,
  model: /^(모델명|Model)/i,
  ratedPower: /^(정격\s*소비전력|정격|Rated)/i,
  voltage: /^(정격\s*전압|전원|Input)/i,
  batteryText: /^(배터리|Battery)/i,
};
const PERSONAL = /^(사용자|Patient)/i;

async function main() {
  const worker = await createWorker(["kor", "eng"]);
  const dir = path.join(repo, "datasets", "labels", split);
  const outDir = path.join(repo, "out", "c1", tag);
  mkdirSync(outDir, { recursive: true });
  const ids = readdirSync(dir).filter((f) => f.endsWith(".jpg")).map((f) => f.replace(/\.jpg$/, "")).sort();
  const items = [];
  for (const id of ids) {
    const { data } = await worker.recognize(path.join(dir, `${id}.jpg`), {}, { blocks: true });
    const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
    const out: Record<string, unknown> = { personalInfoVisible: false, language: "mixed", otherText: [] };
    for (const f of Object.keys(FIELD_KEYS) as LabelField[]) out[f] = { verbatim: null, legibility: "illegible", confidence: "low" };
    for (const ln of lines) {
      const text = ln.text.trim();
      // 영문 'Rated power'와 국문 '정격 전압'처럼 겹치는 키는 더 긴 쪽을 먼저 본다
      const m = /^(.+?)[:：]\s*(.*)$/.exec(text);
      if (!m) continue;
      const key = m[1].trim(), val = m[2].trim();
      if (PERSONAL.test(key)) { out.personalInfoVisible = true; continue; }
      const f = (["voltage", "ratedPower", "manufacturer", "model", "batteryText"] as LabelField[]).find((k) => FIELD_KEYS[k].test(key) && !(k === "ratedPower" && /전압/.test(key)));
      if (!f || (out[f] as { verbatim: string | null }).verbatim != null) continue;
      const words = ln.words.filter((w) => val.includes(w.text));
      const conf = words.length ? words.reduce((s, w) => s + w.confidence, 0) / words.length : 0;
      out[f] = val ? { verbatim: val, legibility: "clear", confidence: conf >= 80 ? "high" : "low" } : { verbatim: null, legibility: "illegible", confidence: "low" };
    }
    const parsed: LabelOutT = LabelOut.parse(out);
    writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify({ id, ok: true, engine: "tesseract.js 5 kor+eng", data: parsed }, null, 1));
    items.push(scoreItem(JSON.parse(readFileSync(path.join(dir, `${id}.json`), "utf-8")) as LabelTruth, parsed));
  }
  await worker.terminate();
  const m = aggregate(items);
  writeFileSync(path.join(outDir, "summary.json"), JSON.stringify({ engine: "tesseract.js", split, metrics: m, items }, null, 1));
  console.log(JSON.stringify({ n: items.length, headline: m.degradedModelConfidentWrong, unflagged: m.unflaggedMismatch, unregToReview: m.unregisteredToReview, dbMatch: m.dbMatchRate, fieldExact: m.fieldExact, supplement: m.supplementViolations }));
}
main().catch((e) => { console.error(e); process.exit(1); });
