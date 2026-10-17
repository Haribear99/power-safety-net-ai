// C1 라벨 판독 실행·채점 (spec.md 7.2절, prereg/c1.json). 실시간 직렬 호출.
// 실행 (app/에서):
//   npx tsx scripts/c1-run.ts --split dev --tag v1-r1            (dev 풀, 5xx 1회 재시도 허용)
//   npx tsx scripts/c1-run.ts --split test --tag sealed --sealed  (sealed 풀, 1회만 — 이미 있으면 거부)
// 원시 응답(요청 ID 포함)은 out/c1/<tag>/ 또는 out/sealed/c1/에, 지출 행은 out/spend.jsonl(append-only)에 쓴다.
// 사전점검: spend.jsonl의 Σreserve − Σ(settle 되돌림)이 Upstash dev+sealed 합과 $0.10 넘게 다르면 중단(7.1절).
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { budgetBackend, keys, MICRO } from "../src/lib/claude/budget";
import { callStructured, type SpendRow } from "../src/lib/claude/client";
import { LabelOut, PROMPT_VERSION, SYSTEM_PROMPT, USER_TEXT, type LabelOutT } from "../src/lib/vision/label";
import { aggregate, scoreItem, type ItemScore, type LabelTruth } from "../src/lib/vision/score";

const app = path.resolve(__dirname, "..");
const repo = path.resolve(app, "..");
if (existsSync(path.join(app, ".env.local"))) process.loadEnvFile(path.join(app, ".env.local"));
const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const split = arg("split", "dev")!;
const tag = arg("tag", "dev")!;
const sealed = argv.includes("--sealed");
const limit = Number(arg("limit", "9999"));
const pool = sealed ? "sealed" : "dev";
if (split === "test" && !sealed) throw new Error("시험셋은 --sealed로만(봉인 실행 1회)");
if (sealed && split !== "test") throw new Error("--sealed는 시험셋 전용");

const spendFile = path.join(repo, "out", "spend.jsonl");

/** 사전점검(7.1절): 로컬 기록 대 Upstash dev+sealed */
export function ledgerBalanceUsd(lines: string[]): number {
  let s = 0;
  for (const l of lines) {
    if (!l.trim()) continue;
    const r = JSON.parse(l) as SpendRow;
    if (r.kind === "reserve") s += r.usd;
    else if (r.kind === "settle") s -= r.usd; // 되돌림(음수면 추가 지출)
  }
  return s;
}

async function main() {
  const be = budgetBackend();
  if (!be) { console.error("Upstash 환경변수 없음 — 스크립트는 폴백 없이 종료(7.1절)"); process.exit(2); }
  mkdirSync(path.dirname(spendFile), { recursive: true });
  const local = existsSync(spendFile) ? ledgerBalanceUsd(readFileSync(spendFile, "utf-8").split("\n")) : 0;
  const remote = ((await be.get(keys.pool("dev"))) + (await be.get(keys.pool("sealed")))) / MICRO;
  console.log(`사전점검: 로컬 ${local.toFixed(4)} · Upstash dev+sealed ${remote.toFixed(4)}`);
  if (Math.abs(local - remote) > 0.1) { console.error("차이 $0.10 초과 — 중단"); process.exit(3); }

  const outDir = sealed ? path.join(repo, "out", "sealed", "c1") : path.join(repo, "out", "c1", tag);
  if (sealed && existsSync(path.join(outDir, "summary.json"))) { console.error("봉인 실행은 1회 — 이미 있음"); process.exit(4); }
  mkdirSync(outDir, { recursive: true });
  const dir = path.join(repo, "datasets", "labels", split);
  const ids = readdirSync(dir).filter((f) => f.endsWith(".jpg")).map((f) => f.replace(/\.jpg$/, "")).sort().slice(0, limit);
  const items: ItemScore[] = [];
  const fails: { id: string; reason: string }[] = [];
  const stops: Record<string, number> = {};
  let cost = 0;
  const lat: number[] = [];
  for (const id of ids) {
    const truth = JSON.parse(readFileSync(path.join(dir, `${id}.json`), "utf-8")) as LabelTruth;
    const b64 = readFileSync(path.join(dir, `${id}.jpg`)).toString("base64");
    const r = await callStructured({
      stage: "PW_C1_label", pool, system: SYSTEM_PROMPT, user: USER_TEXT, images: [{ mediaType: "image/jpeg", base64: b64 }],
      allow5xxRetry: !sealed, spendLog: (row) => appendFileSync(spendFile, JSON.stringify(row) + "\n"),
    }, LabelOut);
    writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify({ promptVersion: PROMPT_VERSION, id, ok: r.ok, meta: r.meta, ...(r.ok ? { data: r.data } : { reason: r.reason }) }, null, 1));
    stops[r.meta.stopReason ?? (r.ok ? "?" : r.reason)] = (stops[r.meta.stopReason ?? (r.ok ? "?" : r.reason)] ?? 0) + 1;
    cost += r.meta.costUsd ?? 0;
    if (r.meta.latencyMs) lat.push(r.meta.latencyMs);
    if (!r.ok) {
      fails.push({ id, reason: r.reason });
      if (r.reason === "spend_limit" || r.reason === "budget" || r.reason === "no_budget_store") { console.error(`중단: ${r.reason}`); break; }
      // 실패 = 판독 없음 → 모든 필드 null(확신 없음)으로 채점
      const empty: LabelOutT = LabelOut.parse({
        manufacturer: { verbatim: null, legibility: "illegible", confidence: "low" }, model: { verbatim: null, legibility: "illegible", confidence: "low" },
        ratedPower: { verbatim: null, legibility: "illegible", confidence: "low" }, voltage: { verbatim: null, legibility: "illegible", confidence: "low" },
        batteryText: { verbatim: null, legibility: "illegible", confidence: "low" }, personalInfoVisible: false, language: "mixed", otherText: [],
      });
      items.push(scoreItem(truth, empty));
      continue;
    }
    items.push(scoreItem(truth, r.data));
    process.stdout.write(`${id} ${r.data.model.verbatim} (${r.data.model.legibility}/${r.data.model.confidence}) $${(r.meta.costUsd ?? 0).toFixed(4)}\n`);
  }
  const m = aggregate(items);
  lat.sort((a, b) => a - b);
  const summary = {
    promptVersion: PROMPT_VERSION, split, tag, n: items.length, fails, stopReasons: stops, costUsd: cost, costPerImage: cost / Math.max(1, items.length),
    latencyP50: lat[Math.floor(lat.length * 0.5)] ?? null, latencyP95: lat[Math.floor(lat.length * 0.95)] ?? null, metrics: m, items,
  };
  writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify({ n: items.length, fails: fails.length, stopReasons: stops, cost: cost.toFixed(4), headline: m.degradedModelConfidentWrong, unflagged: m.unflaggedMismatch, unregToReview: m.unregisteredToReview, dbMatch: m.dbMatchRate, supplement: m.supplementViolations, fieldExact: m.fieldExact }, null, 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
