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
const doc = JSON.parse(raw) as { variants: string[]; rows: (E3Row & { used: [number, number][] })[]; draws: number; seedLo: number; master: string; arms: Record<string, number> };
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
      if (v.startsWith("U:")) return; // 층화 없는 변형은 등급별로 세지 않는다(runE7)
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
  cylKVsBattery: pairRel("RULE+P7P", "RULE+CYL10SK"),
  cylVsBattery: pairRel("RULE+P7P", "RULE+CYL10S"),
  matchedVsBattery: pairRel("RULE+P7P", "RULE+CYL10S+P7E"),
  noOverlap: pairRel("RULE+CYL10S+P7P", "RULE+CYL10S+P7E"),
  ventFirstNoCyl: pairRel("RULE+P7P", "RULE+P7E"),
  uVentFirstNoCyl: pairRel("U:RULE+P7P", "U:RULE+P7E"),
  ventOnlyVsNoOverlap: pairRel("RULE+CYL10S+P7E", "RULE+CYL10S+P7V"),
  noOverlapCorr: pairRel("RULE+CYL10SR+P7P", "RULE+CYL10SR+P7E"),
  aiVsOcr: pairRel("RULE+CYL10O", "RULE+CYL10A"),
  selfVsAi: pairRel("RULE+CYL10A", "RULE+CYL10S"),
  cyl3VsNone: pairRel("RULE", "RULE+CYL3S"),
  cyl5VsNone: pairRel("RULE", "RULE+CYL5S"),
  cylCovVsNone: pairRel("RULE", "RULE+CYL10SC"),
  batteryVsNone: pairRel("RULE", "RULE+P7P"),
  uCylVsNone: pairRel("U:RULE", "U:RULE+CYL10S"),
  uCylVsBattery: pairRel("U:RULE+P7P", "U:RULE+CYL10S"),
  uNoOverlap: pairRel("U:RULE+CYL10S+P7P", "U:RULE+CYL10S+P7E"),
  uBatteryVsNone: pairRel("U:RULE", "U:RULE+P7P"),
};
/** 산소통 때문에 생기는 몫 = (CYL+P7P→CYL+P7E 감소율) − (P7P→P7E 감소율), 같은 재표본으로 부트스트랩 95% CI(보고만) */
function interaction(prefix: string) {
  const ix = (v: string) => { const i = V.indexOf(prefix + v); if (i < 0) throw new Error(`변형 없음 ${prefix}${v}`); return i; };
  const [a0, a1, b0, b1] = [ix("RULE+CYL10S+P7P"), ix("RULE+CYL10S+P7E"), ix("RULE+P7P"), ix("RULE+P7E")];
  const val = (rs: typeof rows) => {
    const s = (i: number) => rs.reduce((x, r) => x + r.m2S[i], 0);
    return (1 - s(a1) / s(a0)) - (1 - s(b1) / s(b0));
  };
  const rng = rngFor("E7-BOOT", `interaction|${prefix}`, "BOOT");
  const xs: number[] = [];
  for (let k = 0; k < E2_BOOT; k++) xs.push(val(rows.map(() => rows[Math.floor(rng.uniform() * rows.length)])));
  xs.sort((p, q) => p - q);
  const q = (u: number) => xs[Math.min(xs.length - 1, Math.floor(u * xs.length))];
  return { rel: r4(val(rows)), lo: r4(q(0.025)), hi: r4(q(0.975)) };
}
const cylShare = { strat: interaction(""), unstrat: interaction("U:") };
const hh = hhRates();
const rate = (cls: string, v: string) => hh[cls]?.[v]?.rate ?? null;
/** 변형별 평균 보급 개수 [산소통, 배터리](고장 전) */
const usedMean = Object.fromEntries(V.map((v, i) => [v, [r4(rows.reduce((a, r) => a + r.used[i][0], 0) / rows.length), r4(rows.reduce((a, r) => a + r.used[i][1], 0) / rows.length)]]));

// ---- 사전등록 채점(prereg/predictions_e7.md 1절) ----
// 문턱은 예비 실행(시드 9,600,001~, 200추첨)의 95% CI 하한을 내림한 값이다. 모두 '예비 실행 뒤 확인'으로 센다.
// structural = 구성상 거의 보장되는 항목(보고만, 집계에서 뺌. 레드팀 경미 6)
type Pred = { id: string; text: string; hit: boolean | null; value: string; structural?: boolean };
const PREDICTIONS: Pred[] = [];
const pr = (id: string, text: string, hit: boolean | null, value: string, structural = false) => PREDICTIONS.push({ id, text, hit, value, ...(structural ? { structural } : {}) });
const pc = (x: number | null | undefined) => (x == null ? "없음" : `${(x * 100).toFixed(1)}%`);
const ci = (x: { rel: number | null; lo: number | null; hi: number | null }) => `${pc(x.rel)} [${pc(x.lo)}, ${pc(x.hi)}]`;
const loGt = (x: { lo: number | null }, t: number) => (x.lo == null ? null : x.lo > t);
const c = compares;
const T = { cylVsNone: 0.18, cylVsNoneKr: 0.21, cylKVsBattery: 0.02, matchedVsBattery: 0.23, noOverlap: 0.08, aiVsOcr: 0.1, selfVsAi: 0.05, cylCovVsNone: 0.08, uCylVsNone: 0.29, uNoOverlap: 0.04, noOverlapCorr: 0.1, ventFirstNoCyl: 0.02 }; // 예비 실행 95% CI 하한을 1%p 단위로 내림
pr("10.1", `산소통(10h·자기신고, 산소 기기 가구 전원) 대 없음(RULE) 감소율 95% CI 하한 > ${pc(T.cylVsNone)}`, loGt(c.cylVsNone, T.cylVsNone), ci(c.cylVsNone));
pr("10.2", `같은 비교를 현행(KR_BASELINE)에서 95% CI 하한 > ${pc(T.cylVsNoneKr)}`, loGt(c.cylVsNoneKr, T.cylVsNoneKr), ci(c.cylVsNoneKr));
pr("10.3", `같은 개수(k)의 표적 산소통 대 E6 표적 배터리 감소율 95% CI 하한 > ${pc(T.cylKVsBattery)}`, loGt(c.cylKVsBattery, T.cylKVsBattery), ci(c.cylKVsBattery));
pr("10.4", `맞춤 조합(산소통 전원 + 배터리 인공호흡기 먼저 P7E) 대 E6 표적 배터리, 산소통이 더해진 비교: 95% CI 하한 > ${pc(T.matchedVsBattery)}`, loGt(c.matchedVsBattery, T.matchedVsBattery), ci(c.matchedVsBattery));
pr("10.5", `같은 산소통·같은 배터리 개수에서 배터리를 인공호흡기 가구에 먼저(남는 것만 산소 가구에, P7E 대 P7P) 95% CI 하한 > ${pc(T.noOverlap)}`, loGt(c.noOverlap, T.noOverlap), ci(c.noOverlap));
pr("10.6", `식별을 AI 판독만으로 할 때 대 OCR만으로 할 때 감소율 95% CI 하한 > ${pc(T.aiVsOcr)}`, loGt(c.aiVsOcr, T.aiVsOcr), ci(c.aiVsOcr));
pr("10.7", `자기신고 식별 대 AI 판독만 식별 감소율 95% CI 하한 > ${pc(T.selfVsAi)}(종류 식별에는 AI가 필요 없다)`, loGt(c.selfVsAi, T.selfVsAi), ci(c.selfVsAi));
pr("10.8", `보급률을 배터리와 같게 제한한 산소통 대 없음 95% CI 하한 > ${pc(T.cylCovVsNone)}`, loGt(c.cylCovVsNone, T.cylCovVsNone), ci(c.cylCovVsNone));
pr("10.9", `층화 없는 등록부: 산소통 대 없음 95% CI 하한 > ${pc(T.uCylVsNone)}`, loGt(c.uCylVsNone, T.uCylVsNone), ci(c.uCylVsNone));
pr("10.10", `층화 없는 등록부: 인공호흡기 먼저(P7E 대 P7P, 산소통 있음) 95% CI 하한 > ${pc(T.uNoOverlap)}`, loGt(c.uNoOverlap, T.uNoOverlap), ci(c.uNoOverlap));
pr("10.11", `고장 상관(산소통·배터리 같은 난수) 민감도: 인공호흡기 먼저 95% CI 하한 > ${pc(T.noOverlapCorr)}`, loGt(c.noOverlapCorr, T.noOverlapCorr), ci(c.noOverlapCorr));
pr("10.12", `산소통 없이도 배터리를 인공호흡기 가구에 먼저(P7E 대 P7P) 95% CI 하한 > ${pc(T.ventFirstNoCyl)}`, loGt(c.ventFirstNoCyl, T.ventFirstNoCyl), ci(c.ventFirstNoCyl));
pr("10.S1", "산소통 시간 민감도: 감소율 3h < 5h < 10h(점추정)", c.cyl3VsNone.rel == null || c.cyl5VsNone.rel == null || c.cylVsNone.rel == null ? null : c.cyl3VsNone.rel < c.cyl5VsNone.rel && c.cyl5VsNone.rel < c.cylVsNone.rel, `${pc(c.cyl3VsNone.rel)} < ${pc(c.cyl5VsNone.rel)} < ${pc(c.cylVsNone.rel)}`, true);
pr("10.S2", "O2_STAT 공백 가구 비율: 맞춤 조합 < E6 표적 배터리", rate("O2_STAT", "RULE+CYL10S+P7E") == null || rate("O2_STAT", "RULE+P7P") == null ? null : rate("O2_STAT", "RULE+CYL10S+P7E")! < rate("O2_STAT", "RULE+P7P")!, `${pc(rate("O2_STAT", "RULE+CYL10S+P7E"))} < ${pc(rate("O2_STAT", "RULE+P7P"))}`, true);
pr("10.S3", "VENT_1H 공백 가구 비율: 맞춤 조합 ≤ E6 표적 배터리", rate("VENT_1H", "RULE+CYL10S+P7E") == null || rate("VENT_1H", "RULE+P7P") == null ? null : rate("VENT_1H", "RULE+CYL10S+P7E")! <= rate("VENT_1H", "RULE+P7P")!, `${pc(rate("VENT_1H", "RULE+CYL10S+P7E"))} ≤ ${pc(rate("VENT_1H", "RULE+P7P"))}`, true);
const scored = PREDICTIONS.filter((x) => x.hit != null && !x.structural);

const slim = (x: ReturnType<typeof pairRel>) => ({ ...x, rel: r4(x.rel), lo: r4(x.lo), hi: r4(x.hi) });
const out = {
  format: "pl26-e7/1", tag,
  source: { file: `out/sweeps/E7_${tag}.json`, sha256: sha256Hex(raw.trim()), draws: doc.draws, seedLo: doc.seedLo, master: doc.master, n: rows.length },
  gapHPerRun: Object.fromEntries(V.map((v, i) => [v, r4(sum(i) / 3600 / rows.length)])),
  usedMean,
  cylShare,
  compares: Object.fromEntries(Object.entries(compares).map(([k, x]) => [k, slim(x)])),
  hhRates: hh,
  prereg: { hit: scored.filter((x) => x.hit).length, total: scored.length, items: PREDICTIONS },
};
writeFileSync(path.join(repo, "out", `e7_${tag}.json`), canonicalJson(out) + "\n", "utf-8");
console.log(`E7 (${tag}) ${rows.length}건 → out/e7_${tag}.json`);
for (const [v, h] of Object.entries(out.gapHPerRun)) console.log(`${v.padEnd(20)} ${h}h/실행`);
for (const [k, x] of Object.entries(out.compares)) console.log(`${k.padEnd(20)} ${ci(x)} · M1 ${x.w}/${x.t}/${x.l}`);
console.log(`산소통 몫(층화) ${ci(cylShare.strat)} · (층화 없음) ${ci(cylShare.unstrat)}`);
for (const cls of GEN_CLASSES) {
  const h = out.hhRates[cls]; if (!h) continue;
  console.log(`${cls.padEnd(12)} ${["RULE", "RULE+P7P", "RULE+CYL10S", "RULE+CYL10S+P7E"].map((v) => `${v} ${pc(h[v]?.rate)}`).join(" · ")}`);
}
for (const [v, u] of Object.entries(usedMean)) console.log(`보급 ${v.padEnd(20)} 산소통 ${u[0]} · 배터리 ${u[1]}`);
for (const x of PREDICTIONS) console.log(`${x.hit == null ? "–" : x.hit ? "✓" : "✗"}${x.structural ? "(구조)" : ""} ${x.id} ${x.text}: ${x.value}`);
console.log(`사전등록 ${out.prereg.hit}/${out.prereg.total}`);
