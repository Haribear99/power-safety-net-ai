// E7(평시 산소통 보급, S10) 집계와 사전등록 채점. 비AI, 결정적.
// 실행: (app/에서) npx tsx scripts/e7-analyze.ts --tag sealed   → out/e7_<tag>.json
// 예측과 판정 규칙은 prereg/predictions_e7.md 1절. 이 파일의 예측 목록은 그 표를 코드로 옮긴 것이다(S10 봉인 대상).
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
const file = path.join(repo, "out", "sweeps", `E7_${tag}.json`);
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
  const rng = rngFor("E7-BOOT", `${base}|${v}`, "BOOT");
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

const compares = {
  cylVsNone: pairRel("RULE", "RULE+CYL10S"),
  cylVsNoneKr: pairRel("KR_BASELINE", "KR_BASELINE+CYL10S"),
  cylVsBattery: pairRel("RULE+P7P", "RULE+CYL10S"),
  matchedVsBattery: pairRel("RULE+P7P", "RULE+CYL10S+P7V"),
  matchedVsUnmatched: pairRel("RULE+CYL10S+P7P", "RULE+CYL10S+P7V"),
  aiVsOcr: pairRel("RULE+CYL10O", "RULE+CYL10A"),
  selfVsAi: pairRel("RULE+CYL10A", "RULE+CYL10S"),
  cyl3VsNone: pairRel("RULE", "RULE+CYL3S"),
  cyl5VsNone: pairRel("RULE", "RULE+CYL5S"),
  batteryVsNone: pairRel("RULE", "RULE+P7P"),
  cylCovVsNone: pairRel("RULE", "RULE+CYL10SC"),
};
const hh = hhRates();
const rate = (cls: string, v: string) => hh[cls]?.[v]?.rate ?? null;

// ---- 사전등록 채점(prereg/predictions_e7.md 1절) ----
type Pred = { id: string; text: string; hit: boolean | null; value: string };
const PREDICTIONS: Pred[] = [];
const pr = (id: string, text: string, hit: boolean | null, value: string) => PREDICTIONS.push({ id, text, hit, value });
const pc = (x: number | null | undefined) => (x == null ? "없음" : `${(x * 100).toFixed(1)}%`);
const ci = (x: { rel: number | null; lo: number | null; hi: number | null }) => `${pc(x.rel)} [${pc(x.lo)}, ${pc(x.hi)}]`;
const gt0 = (x: { lo: number | null }) => (x.lo == null ? null : x.lo > 0);
const c = compares;
pr("10.1", "산소통(10h·자기신고) 대 없음(RULE) 감소율 95% CI 하한 > 10%", c.cylVsNone.lo == null ? null : c.cylVsNone.lo > 0.10, ci(c.cylVsNone));
pr("10.2", "같은 비교를 현행(KR_BASELINE)에서: 95% CI 하한 > 10%", c.cylVsNoneKr.lo == null ? null : c.cylVsNoneKr.lo > 0.10, ci(c.cylVsNoneKr));
pr("10.3", "산소통(10h·자기신고) 대 E6 표적 배터리(P7P) 감소율 95% CI 하한 > 0", gt0(c.cylVsBattery), ci(c.cylVsBattery));
pr("10.4", "맞춤 조합(산소통 + 인공호흡기에만 배터리 P7V) 대 E6 표적 배터리 감소율 95% CI 하한 > 15%", c.matchedVsBattery.lo == null ? null : c.matchedVsBattery.lo > 0.15, ci(c.matchedVsBattery));
pr("10.5", "맞춤 조합(P7V) 대 맞추지 않은 조합(P7P) 감소율 95% CI 하한 > 0", gt0(c.matchedVsUnmatched), ci(c.matchedVsUnmatched));
pr("10.6", "식별을 AI 판독만으로 할 때 대 OCR만으로 할 때 감소율 95% CI 하한 > 0", gt0(c.aiVsOcr), ci(c.aiVsOcr));
pr("10.7", "자기신고 식별 대 AI 판독만 식별 감소율 95% CI 하한 > 0(종류 식별에는 AI가 필요 없다)", gt0(c.selfVsAi), ci(c.selfVsAi));
pr("10.8", "산소통 시간 민감도: 감소율 3h < 5h < 10h(점추정)", c.cyl3VsNone.rel == null || c.cyl5VsNone.rel == null || c.cylVsNone.rel == null ? null : c.cyl3VsNone.rel < c.cyl5VsNone.rel && c.cyl5VsNone.rel < c.cylVsNone.rel, `${pc(c.cyl3VsNone.rel)} < ${pc(c.cyl5VsNone.rel)} < ${pc(c.cylVsNone.rel)}`);
pr("10.9", "O2_STAT 공백 가구 비율: 맞춤 조합 < E6 표적 배터리", rate("O2_STAT", "RULE+CYL10S+P7V") == null || rate("O2_STAT", "RULE+P7P") == null ? null : rate("O2_STAT", "RULE+CYL10S+P7V")! < rate("O2_STAT", "RULE+P7P")!, `${pc(rate("O2_STAT", "RULE+CYL10S+P7V"))} < ${pc(rate("O2_STAT", "RULE+P7P"))}`);
pr("10.10", "VENT_1H 공백 가구 비율: 맞춤 조합 ≤ E6 표적 배터리", rate("VENT_1H", "RULE+CYL10S+P7V") == null || rate("VENT_1H", "RULE+P7P") == null ? null : rate("VENT_1H", "RULE+CYL10S+P7V")! <= rate("VENT_1H", "RULE+P7P")!, `${pc(rate("VENT_1H", "RULE+CYL10S+P7V"))} ≤ ${pc(rate("VENT_1H", "RULE+P7P"))}`);
pr("10.11", "산소통 보급률을 배터리와 같게(0.6 × covMult) 제한해도 없음 대비 감소율 95% CI 하한 > 5%", c.cylCovVsNone.lo == null ? null : c.cylCovVsNone.lo > 0.05, ci(c.cylCovVsNone));
const scored = PREDICTIONS.filter((x) => x.hit != null);

const slim = (x: ReturnType<typeof pairRel>) => ({ ...x, rel: r4(x.rel), lo: r4(x.lo), hi: r4(x.hi) });
const out = {
  format: "pl26-e7/1", tag,
  source: { file: `out/sweeps/E7_${tag}.json`, sha256: sha256Hex(raw.trim()), draws: doc.draws, seedLo: doc.seedLo, master: doc.master, n: rows.length },
  gapHPerRun: Object.fromEntries(V.map((v, i) => [v, r4(sum(i) / 3600 / rows.length)])),
  compares: Object.fromEntries(Object.entries(compares).map(([k, x]) => [k, slim(x)])),
  hhRates: hh,
  prereg: { hit: scored.filter((x) => x.hit).length, total: scored.length, items: PREDICTIONS },
};
writeFileSync(path.join(repo, "out", `e7_${tag}.json`), canonicalJson(out) + "\n", "utf-8");
console.log(`E7 (${tag}) ${rows.length}건 → out/e7_${tag}.json`);
for (const [v, h] of Object.entries(out.gapHPerRun)) console.log(`${v.padEnd(20)} ${h}h/실행`);
for (const [k, x] of Object.entries(out.compares)) console.log(`${k.padEnd(20)} ${ci(x)} · M1 ${x.w}/${x.t}/${x.l}`);
for (const cls of GEN_CLASSES) {
  const h = out.hhRates[cls]; if (!h) continue;
  console.log(`${cls.padEnd(12)} ${["RULE", "RULE+P7P", "RULE+CYL10S", "RULE+CYL10S+P7V"].map((v) => `${v} ${pc(h[v]?.rate)}`).join(" · ")}`);
}
for (const x of PREDICTIONS) console.log(`${x.hit == null ? "–" : x.hit ? "✓" : "✗"} ${x.id} ${x.text}: ${x.value}`);
console.log(`사전등록 ${out.prereg.hit}/${out.prereg.total}`);
