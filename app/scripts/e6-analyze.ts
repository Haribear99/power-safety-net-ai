// E6(평시 정보 표적 사전 배치, S8) 집계와 사전등록 채점. 비AI, 결정적.
// 실행: (app/에서) npx tsx scripts/e6-analyze.ts --tag sealed   → out/e6_<tag>.json
// 예측과 판정 규칙은 prereg/predictions_e6.md 1절. 이 파일의 예측 목록은 그 표를 코드로 옮긴 것이다(S8 봉인 대상).
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
const file = path.join(repo, "out", "sweeps", `E6_${tag}.json`);
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
  const rng = rngFor("E6-BOOT", `${base}|${v}`, "BOOT");
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

const preVsRand = pairRel("AI@RULE+P7", "AI@RULE+P7P");
const outVsRand = pairRel("AI@RULE+P7", "AI@RULE+P7T");
const preVsOut = pairRel("AI@RULE+P7T", "AI@RULE+P7P");
const randVsRule = pairRel("AI@RULE", "AI@RULE+P7");
const preVsRule = pairRel("AI@RULE", "AI@RULE+P7P");
const hh = hhRates();
const rate = (cls: string, v: string) => hh[cls]?.[v]?.rate ?? null;

// ---- 사전등록 채점(prereg/predictions_e6.md 1절) ----
type Pred = { id: string; text: string; hit: boolean | null; value: string };
const PREDICTIONS: Pred[] = [];
const pr = (id: string, text: string, hit: boolean | null, value: string) => PREDICTIONS.push({ id, text, hit, value });
const pc = (x: number | null | undefined) => (x == null ? "없음" : `${(x * 100).toFixed(1)}%`);
const ci = (x: { rel: number | null; lo: number | null; hi: number | null }) => `${pc(x.rel)} [${pc(x.lo)}, ${pc(x.hi)}]`;
const lt = (a: number | null, b: number | null) => (a == null || b == null ? null : a < b);
pr("7.1", "P7P(평시 정보 표적) 대 P7(무작위) 감소율 95% CI 하한 > 0", preVsRand.lo == null ? null : preVsRand.lo > 0, ci(preVsRand));
pr("7.2", "P7P 감소율 점추정 < P7T(정전 시점 정보) 감소율 점추정(평시 정보는 낙관 상한보다 덜 준다)", preVsRand.rel == null || outVsRand.rel == null ? null : preVsRand.rel < outVsRand.rel, `${pc(preVsRand.rel)} < ${pc(outVsRand.rel)}`);
pr("7.3", "VENT_1H 공백 가구 비율 P7P < P7", lt(rate("VENT_1H", "AI@RULE+P7P"), rate("VENT_1H", "AI@RULE+P7")), `${pc(rate("VENT_1H", "AI@RULE+P7P"))} < ${pc(rate("VENT_1H", "AI@RULE+P7"))}`);
pr("7.4", "O2_STAT 공백 가구 비율 P7P < P7", lt(rate("O2_STAT", "AI@RULE+P7P"), rate("O2_STAT", "AI@RULE+P7")), `${pc(rate("O2_STAT", "AI@RULE+P7P"))} < ${pc(rate("O2_STAT", "AI@RULE+P7"))}`);
pr("7.5", "VENT_3H 공백 가구 비율 P7P > P7(맞바꿈이 평시 정보에서도 남는다)", lt(rate("VENT_3H", "AI@RULE+P7"), rate("VENT_3H", "AI@RULE+P7P")), `${pc(rate("VENT_3H", "AI@RULE+P7P"))} > ${pc(rate("VENT_3H", "AI@RULE+P7"))}`);
const scored = PREDICTIONS.filter((x) => x.hit != null);

const slim = (x: ReturnType<typeof pairRel>) => ({ ...x, rel: r4(x.rel), lo: r4(x.lo), hi: r4(x.hi) });
const out = {
  format: "pl26-e6/1", tag,
  source: { file: `out/sweeps/E6_${tag}.json`, sha256: sha256Hex(raw.trim()), draws: doc.draws, seedLo: doc.seedLo, master: doc.master, n: rows.length },
  compares: { preVsRand: slim(preVsRand), outVsRand: slim(outVsRand), preVsOut: slim(preVsOut), randVsRule: slim(randVsRule), preVsRule: slim(preVsRule) },
  hhRates: hh,
  prereg: { hit: scored.filter((x) => x.hit).length, total: scored.length, items: PREDICTIONS },
};
writeFileSync(path.join(repo, "out", `e6_${tag}.json`), canonicalJson(out) + "\n", "utf-8");
console.log(`E6 (${tag}) ${rows.length}건 → out/e6_${tag}.json`);
for (const [k, x] of Object.entries(out.compares)) console.log(`${k.padEnd(10)} ${ci(x)} · M1 ${x.w}/${x.t}/${x.l}`);
for (const cls of GEN_CLASSES) {
  const h = out.hhRates[cls]; if (!h) continue;
  console.log(`${cls.padEnd(12)} ${V.map((v) => `${v} ${pc(h[v]?.rate)}`).join(" · ")}`);
}
for (const x of PREDICTIONS) console.log(`${x.hit == null ? "–" : x.hit ? "✓" : "✗"} ${x.id} ${x.text}: ${x.value}`);
console.log(`사전등록 ${out.prereg.hit}/${out.prereg.total}`);
