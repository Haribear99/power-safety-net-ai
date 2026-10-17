// E4(실측 정전시간 분포 APT_EMP, S6) 집계와 사전등록 채점. 비AI, 결정적.
// 실행: (app/에서) npx tsx scripts/e4-analyze.ts --tag sealed   → out/e4_<tag>.json
// 예측과 판정 규칙은 prereg/predictions_e4.md. 이 파일의 PREDICTIONS는 그 표를 코드로 옮긴 것이다(S6 봉인 대상).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { E2_BOOT, e3Effect, labelsByVariant } from "../src/lib/sim/analyze";
import { canonicalJson, sha256Hex } from "../src/lib/sim/materialize";
import { PATCHES, type PatchId } from "../src/lib/sim/patches";
import { rngFor } from "../src/lib/sim/prng";
import { E4_CAUSE, type E3Row } from "../src/lib/sim/sweep";
import { GEN_CLASSES, type GenClass } from "../src/lib/sim/labels";

const repo = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const tag = argv[argv.indexOf("--tag") + 1] ?? "dev";
const file = path.join(repo, "out", "sweeps", `E4_${tag}.json`);
const raw = readFileSync(file, "utf-8");
const doc = JSON.parse(raw) as { variants: string[]; rows: E3Row[]; draws: number; seedLo: number; master: string };
const V = doc.variants, rows = doc.rows;
const r4 = (x: number | null | undefined) => (x == null ? null : Math.round(x * 1e4) / 1e4);

/** 1 − ΣM2(v)/ΣM2(base), 시나리오 재표본 부트스트랩 95% CI, M1 승/무/패 */
function pairRel(base: string, v: string) {
  const bi = V.indexOf(base), vi = V.indexOf(v);
  const rel = (rs: readonly E3Row[]) => { let a = 0, b = 0; for (const r of rs) { a += r.m2S[vi]; b += r.m2S[bi]; } return b > 0 ? 1 - a / b : null; };
  let w = 0, t = 0, l = 0;
  for (const r of rows) { if (r.m1[vi] < r.m1[bi]) w++; else if (r.m1[vi] > r.m1[bi]) l++; else t++; }
  const rng = rngFor("E4-BOOT", `${base}|${v}`, "BOOT");
  const rels: number[] = [];
  for (let k = 0; k < E2_BOOT; k++) {
    let a = 0, b = 0;
    for (let i = 0; i < rows.length; i++) { const r = rows[Math.floor(rng.uniform() * rows.length)]; a += r.m2S[vi]; b += r.m2S[bi]; }
    if (b > 0) rels.push(1 - a / b);
  }
  rels.sort((p, q) => p - q);
  const q = (u: number) => rels[Math.min(rels.length - 1, Math.floor(u * rels.length))];
  return { base, v, rel: rel(rows), lo: rels.length ? q(0.025) : null, hi: rels.length ? q(0.975) : null, w, t, l };
}

/** 등급별 가구 공백률 Σ공백/Σ등록(전 추첨 합) + Wilson(가구 독립 가정 아님 — 화면 설명용) */
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

const labels = labelsByVariant(rows, V, [E4_CAUSE]);
const p = (cls: string, v: string) => labels.find((c) => c.cls === cls && c.variant === v) ?? null;
const ruleVsKr = pairRel("KR_BASELINE", "RULE");
const patchEffects = V.filter((v) => v.includes("+")).map((v) => e3Effect(rows, V, v, PATCHES.get(v.split("+")[1] as PatchId)!));
const p7 = patchEffects.find((e) => e.variant === "RULE+P7")!;

// ---- 사전등록 채점(prereg/predictions_e4.md) ----
type Pred = { id: string; text: string; hit: boolean | null; value: string };
const PREDICTIONS: Pred[] = [];
const pr = (id: string, text: string, hit: boolean | null, value: string) => PREDICTIONS.push({ id, text, hit, value });
const pc = (x: number | null | undefined) => (x == null ? "없음" : `${(x * 100).toFixed(1)}%`);
pr("4.1", "RULE 대 KR_BASELINE M2 감소율 95% CI 하한 > 0", ruleVsKr.lo != null && ruleVsKr.lo > 0, `${pc(ruleVsKr.rel)} [${pc(ruleVsKr.lo)}, ${pc(ruleVsKr.hi)}]`);
pr("4.2", "RULE+P7 대 RULE M2 감소율 95% CI 하한 > 0", p7.relCi != null && p7.relCi.lo > 0, `${pc(p7.rel)} [${pc(p7.relCi?.lo)}, ${pc(p7.relCi?.hi)}]`);
const v1 = p("VENT_1H", "RULE"), v8 = p("VENT_8H", "RULE"), v3 = p("VENT_3H", "RULE"), v3p = p("VENT_3H", "RULE+P7");
pr("4.3", "VENT_1H RULE 표지 p ≥ 0.5", v1 ? v1.p >= 0.5 : null, v1 ? v1.p.toFixed(3) : "없음");
pr("4.4", "VENT_8H RULE 표지 p ≤ 0.3", v8 ? v8.p <= 0.3 : null, v8 ? v8.p.toFixed(3) : "없음");
pr("4.5", "VENT_3H 표지 p(RULE+P7) < p(RULE)", v3 && v3p ? v3p.p < v3.p : null, v3 && v3p ? `${v3p.p.toFixed(3)} < ${v3.p.toFixed(3)}` : "없음");
pr("4.6", "RULE 대 KR_BASELINE M2 감소율 점추정 5%~30%", ruleVsKr.rel != null && ruleVsKr.rel >= 0.05 && ruleVsKr.rel <= 0.3, pc(ruleVsKr.rel));
// 2절(예비 실행 뒤) 예측은 S6 봉인 전에 아래에 덧붙인다
const scored = PREDICTIONS.filter((x) => x.hit != null);

const out = {
  format: "pl26-e4/1", tag,
  source: { file: `out/sweeps/E4_${tag}.json`, sha256: sha256Hex(raw.trim()), draws: doc.draws, seedLo: doc.seedLo, master: doc.master, n: rows.length },
  ruleVsKr: { ...ruleVsKr, rel: r4(ruleVsKr.rel), lo: r4(ruleVsKr.lo), hi: r4(ruleVsKr.hi) },
  patches: patchEffects.map((e) => ({ variant: e.variant, rel: r4(e.rel), lo: r4(e.relCi?.lo), hi: r4(e.relCi?.hi), w: e.win, t: e.tie, l: e.loss, effLo: r4(e.byEff.lo), effHi: r4(e.byEff.hi) })),
  labels: labels.map((c) => ({ variant: c.variant, cls: c.cls, n: c.n, p: r4(c.p), lo: r4(c.ci.lo), hi: r4(c.ci.hi), label: c.label })),
  hhRates: hhRates(),
  prereg: { hit: scored.filter((x) => x.hit).length, total: scored.length, items: PREDICTIONS },
};
writeFileSync(path.join(repo, "out", `e4_${tag}.json`), canonicalJson(out) + "\n", "utf-8");
console.log(`E4 (${tag}) ${rows.length}건 → out/e4_${tag}.json`);
console.log(`RULE 대 현행 M2 ${pc(ruleVsKr.rel)} [${pc(ruleVsKr.lo)}, ${pc(ruleVsKr.hi)}] · M1 ${ruleVsKr.w}/${ruleVsKr.t}/${ruleVsKr.l}`);
for (const e of out.patches) console.log(`${e.variant.padEnd(16)} ${pc(e.rel)} [${pc(e.lo)}, ${pc(e.hi)}] 실효 10분위 ${pc(e.effLo)}~${pc(e.effHi)}`);
for (const cls of ["VENT_1H", "VENT_3H", "VENT_8H", "O2_PORT", "O2_STAT"]) {
  const h = out.hhRates[cls]; if (!h) continue;
  console.log(`${cls.padEnd(9)} 가구 공백률 현행 ${pc(h.KR_BASELINE?.rate)} · 도구 ${pc(h.RULE?.rate)} · 도구+P7 ${pc(h["RULE+P7"]?.rate)} · 표지 ${p(cls, "KR_BASELINE")?.label}/${p(cls, "RULE")?.label}/${p(cls, "RULE+P7")?.label}`);
}
for (const x of PREDICTIONS) console.log(`${x.hit == null ? "–" : x.hit ? "✓" : "✗"} ${x.id} ${x.text}: ${x.value}`);
console.log(`사전등록 ${out.prereg.hit}/${out.prereg.total}`);
