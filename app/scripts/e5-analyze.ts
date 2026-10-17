// E5(AI 판독 기여·기록 기반 표적 사전 배치, S7) 집계와 사전등록 채점. 비AI, 결정적.
// 실행: (app/에서) npx tsx scripts/e5-analyze.ts --tag sealed   → out/e5_<tag>.json
// 예측과 판정 규칙은 prereg/predictions_e5.md 1절. 이 파일의 예측 목록은 그 표를 코드로 옮긴 것이다(S7 봉인 대상).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { E2_BOOT } from "../src/lib/sim/analyze";
import { canonicalJson, sha256Hex } from "../src/lib/sim/materialize";
import { rngFor } from "../src/lib/sim/prng";
import type { E3Row } from "../src/lib/sim/sweep";
import { GEN_CLASSES, type GenClass } from "../src/lib/sim/labels";

const repo = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const tag = argv[argv.indexOf("--tag") + 1] ?? "dev";
const file = path.join(repo, "out", "sweeps", `E5_${tag}.json`);
const raw = readFileSync(file, "utf-8");
const doc = JSON.parse(raw) as { variants: string[]; rows: E3Row[]; draws: number; seedLo: number; master: string; arms: Record<string, number> };
const V = doc.variants, rows = doc.rows;
const r4 = (x: number | null | undefined) => (x == null ? null : Math.round(x * 1e4) / 1e4);
const sum = (vi: number) => rows.reduce((a, r) => a + r.m2S[vi], 0);

/** 1 − ΣM2(v)/ΣM2(base), 시나리오 재표본 부트스트랩 95% CI(추첨 오차만), M1 승/무/패 */
function pairRel(base: string, v: string) {
  const bi = V.indexOf(base), vi = V.indexOf(v);
  if (bi < 0 || vi < 0) throw new Error(`변형 없음 ${base} ${v}`);
  const b0 = sum(bi);
  const rel = b0 > 0 ? 1 - sum(vi) / b0 : null;
  let w = 0, t = 0, l = 0;
  for (const r of rows) { if (r.m1[vi] < r.m1[bi]) w++; else if (r.m1[vi] > r.m1[bi]) l++; else t++; }
  const rng = rngFor("E5-BOOT", `${base}|${v}`, "BOOT");
  const rels: number[] = [];
  for (let k = 0; k < E2_BOOT; k++) {
    let a = 0, b = 0;
    for (let i = 0; i < rows.length; i++) { const r = rows[Math.floor(rng.uniform() * rows.length)]; a += r.m2S[vi]; b += r.m2S[bi]; }
    if (b > 0) rels.push(1 - a / b);
  }
  rels.sort((p, q) => p - q);
  const q = (u: number) => rels[Math.min(rels.length - 1, Math.floor(u * rels.length))];
  return { base, v, rel, lo: rels.length ? q(0.025) : null, hi: rels.length ? q(0.975) : null, w, t, l };
}

/** 등급별 가구 공백률 Σ공백/Σ등록(전 추첨 합) */
function hhRates() {
  const out: Record<string, Record<string, { k: number; n: number; rate: number }>> = {};
  for (const cls of GEN_CLASSES) {
    V.forEach((v, j) => {
      let k = 0, n = 0;
      for (const r of rows) { const c = r.cls[cls as GenClass]; if (!c) continue; n += c[0]; k += c[1 + j]; }
      if (n) ((out[cls] ??= {})[v] = { k, n, rate: k / n });
    });
  }
  return out;
}

const aiVsNo = pairRel("NOAI@RULE", "AI@RULE");
const perfVsNo = pairRel("NOAI@RULE", "PERF@RULE");
const aiVsKr = pairRel("AI@KR_BASELINE", "AI@RULE");
const noVsKr = pairRel("AI@KR_BASELINE", "NOAI@RULE");
const p7tVsP7 = pairRel("AI@RULE+P7", "AI@RULE+P7T");
const p7VsRule = pairRel("AI@RULE", "AI@RULE+P7");
const p7tVsRule = pairRel("AI@RULE", "AI@RULE+P7T");
const hh = hhRates();
const rate = (cls: string, v: string) => hh[cls]?.[v]?.rate ?? null;
const gainNo = sum(V.indexOf("NOAI@RULE"));
const captured = gainNo - sum(V.indexOf("PERF@RULE")) > 0
  ? (gainNo - sum(V.indexOf("AI@RULE"))) / (gainNo - sum(V.indexOf("PERF@RULE"))) : null;

// ---- 사전등록 채점(prereg/predictions_e5.md 1절) ----
type Pred = { id: string; text: string; hit: boolean | null; value: string };
const PREDICTIONS: Pred[] = [];
const pr = (id: string, text: string, hit: boolean | null, value: string) => PREDICTIONS.push({ id, text, hit, value });
const pc = (x: number | null | undefined) => (x == null ? "없음" : `${(x * 100).toFixed(1)}%`);
const ci = (x: { rel: number | null; lo: number | null; hi: number | null }) => `${pc(x.rel)} [${pc(x.lo)}, ${pc(x.hi)}]`;
pr("6.1", "AI@RULE 대 NOAI@RULE 감소율 95% CI 하한 > 0", aiVsNo.lo == null ? null : aiVsNo.lo > 0, ci(aiVsNo));
pr("6.2", "AI@RULE 대 NOAI@RULE 감소율 점추정 ≥ 3%", aiVsNo.rel == null ? null : aiVsNo.rel >= 0.03, pc(aiVsNo.rel));
pr("6.3", "AI가 PERF 이득의 절반 이상", captured == null ? null : captured >= 0.5, captured == null ? "없음" : `${(captured * 100).toFixed(1)}%`);
pr("6.4", "AI@RULE 대 AI@KR_BASELINE 감소율 95% CI 하한 > 10%", aiVsKr.lo == null ? null : aiVsKr.lo > 0.1, ci(aiVsKr));
pr("6.5", "NOAI@RULE 대 AI@KR_BASELINE 감소율 95% CI 하한 > 0", noVsKr.lo == null ? null : noVsKr.lo > 0, ci(noVsKr));
pr("6.6", "AI@RULE+P7T 대 AI@RULE+P7 감소율 95% CI 하한 > 0", p7tVsP7.lo == null ? null : p7tVsP7.lo > 0, ci(p7tVsP7));
const v1t = rate("VENT_1H", "AI@RULE+P7T"), v1r = rate("VENT_1H", "AI@RULE+P7");
pr("6.7", "VENT_1H 공백 가구 비율 P7T < P7", v1t == null || v1r == null ? null : v1t < v1r, `${pc(v1t)} < ${pc(v1r)}`);
const o2t = rate("O2_STAT", "AI@RULE+P7T"), o2r = rate("O2_STAT", "AI@RULE+P7");
pr("6.8", "O2_STAT 공백 가구 비율 P7T < P7", o2t == null || o2r == null ? null : o2t < o2r, `${pc(o2t)} < ${pc(o2r)}`);
const scored = PREDICTIONS.filter((x) => x.hit != null);

const slim = (x: ReturnType<typeof pairRel>) => ({ ...x, rel: r4(x.rel), lo: r4(x.lo), hi: r4(x.hi) });
const out = {
  format: "pl26-e5/1", tag, arms: doc.arms,
  source: { file: `out/sweeps/E5_${tag}.json`, sha256: sha256Hex(raw.trim()), draws: doc.draws, seedLo: doc.seedLo, master: doc.master, n: rows.length },
  compares: { aiVsNo: slim(aiVsNo), perfVsNo: slim(perfVsNo), aiVsKr: slim(aiVsKr), noVsKr: slim(noVsKr), p7tVsP7: slim(p7tVsP7), p7VsRule: slim(p7VsRule), p7tVsRule: slim(p7tVsRule) },
  aiCapturedOfPerfect: r4(captured),
  hhRates: hh,
  prereg: { hit: scored.filter((x) => x.hit).length, total: scored.length, items: PREDICTIONS },
};
writeFileSync(path.join(repo, "out", `e5_${tag}.json`), canonicalJson(out) + "\n", "utf-8");
console.log(`E5 (${tag}) ${rows.length}건 → out/e5_${tag}.json`);
for (const [k, x] of Object.entries(out.compares)) console.log(`${k.padEnd(10)} ${ci(x)} · M1 ${x.w}/${x.t}/${x.l}`);
console.log(`AI가 얻은 몫(완전 판독 대비) ${captured == null ? "없음" : (captured * 100).toFixed(1) + "%"}`);
for (const cls of ["VENT_1H", "VENT_3H", "O2_STAT", "O2_PORT"]) {
  const h = out.hhRates[cls]; if (!h) continue;
  console.log(`${cls.padEnd(8)} ${V.map((v) => `${v} ${pc(h[v]?.rate)}`).join(" · ")}`);
}
for (const x of PREDICTIONS) console.log(`${x.hit == null ? "–" : x.hit ? "✓" : "✗"} ${x.id} ${x.text}: ${x.value}`);
console.log(`사전등록 ${out.prereg.hit}/${out.prereg.total}`);
