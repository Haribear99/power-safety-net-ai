// 차등 시험 실행기 (spec.md 8절 시험 집합·통과 기준, 9절 '차등' 층). 비AI, 결정적, 네트워크 없음.
// 실행: (app/에서) npx tsx scripts/diff-oracle.ts [--skip-python] [--only std50|fuzz]
//   1) 표준 50건 + 프리셋 3개 + 경계 퍼즈 500건을 materialize 정본 JSON으로 out/diff/input/에 쓴다
//   2) 같은 JSON을 다시 읽어 TS RULE(sim/run.ts) → out/diff/ts/, Python 오라클(python -I oracle/run.py) → out/diff/oracle/
//   3) 시나리오마다 lowerBound(L)·RULE 배정(레인·자원·처리 순서)·M1/M2를 비교한다(+ 진단용 보조 필드)
//   4) out/diff_report.json, out/diff_report.md에 일치 수와 모든 불일치를 쓴다. 통과 기준(8절) 불일치가 있으면 종료 코드 1
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalJson, materialize, sha256Hex } from "../src/lib/sim/materialize";
import { runScenario, toOracleOut } from "../src/lib/sim/run";
import { presetDefs, standard50Defs } from "../src/lib/sim/scenarios";
import { boundaryFuzz, FUZZ_COUNT, fuzzDb, type FuzzScenario } from "../src/lib/sim/fuzz";

const repo = path.resolve(__dirname, "..", "..");
const base = path.join(repo, "out", "diff");
const dirs = { input: path.join(base, "input"), ts: path.join(base, "ts"), oracle: path.join(base, "oracle") };
const args = process.argv.slice(2);
const skipPython = args.includes("--skip-python");
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

type Group = "std50" | "preset" | "fuzz";
interface Item { id: string; group: Group; category: string; json: string }

function resetJsonDir(dir: string) {
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.endsWith(".json")) rmSync(path.join(dir, f));
}

// ---------- 1) 시나리오 펼치기 ----------
const items: Item[] = [];
if (only == null || only === "std50") {
  for (const c of standard50Defs()) items.push({ id: c.def.scenarioId, group: "std50", category: c.def.cause, json: materialize(c.def).json });
  for (const p of presetDefs()) items.push({ id: p.def.scenarioId, group: "preset", category: p.def.cause, json: materialize(p.def).json });
}
if (only == null || only === "fuzz") {
  const fz = boundaryFuzz();
  if (fz.length !== FUZZ_COUNT) throw new Error(`경계 퍼즈 수 ${fz.length} ≠ ${FUZZ_COUNT}`);
  for (const f of fz) items.push({ id: f.scenarioId, group: "fuzz", category: f.category, json: f.json });
}
for (const d of Object.values(dirs)) resetJsonDir(d);
const manifest: Record<string, string> = {};
for (const it of items) {
  writeFileSync(path.join(dirs.input, `${it.id}.json`), it.json + "\n", "utf-8");
  manifest[`${it.id}.json`] = sha256Hex(it.json);
}
writeFileSync(path.join(base, "input_manifest.json"), canonicalJson({ format: "pl26-diff-input-manifest/1", files: manifest }) + "\n", "utf-8");

// ---------- 2a) TS: 저장한 JSON을 다시 읽어 RULE ----------
const tsErr: Record<string, string> = {};
for (const it of items) {
  const m = JSON.parse(readFileSync(path.join(dirs.input, `${it.id}.json`), "utf-8")) as FuzzScenario;
  try {
    // 시험 전용 overrides.devices(미끼 기종)가 있으면 오라클과 같은 DB로 돈다(oracle/FORMAT.md)
    writeFileSync(path.join(dirs.ts, `${it.id}.json`), canonicalJson(toOracleOut(runScenario(m, "RULE", { db: fuzzDb(m) }))) + "\n", "utf-8");
  } catch (e) {
    tsErr[it.id] = String((e as Error).message ?? e);
  }
}

// ---------- 2b) Python 오라클 ----------
let pyLog = "";
if (!skipPython) {
  const r = spawnSync("python", ["-I", path.join(repo, "oracle", "run.py"), dirs.input, "-o", dirs.oracle], {
    encoding: "utf-8", maxBuffer: 1 << 28,
  });
  pyLog = (r.stderr ?? "").trim();
  if (r.status !== 0) {
    console.error(pyLog);
    throw new Error(`oracle/run.py 종료 코드 ${r.status}`);
  }
}

// ---------- 3) 비교 ----------
type J = Record<string, unknown>;
const CRIT_HH = ["lane", "resourceId", "order"] as const;               // 8절 통과 기준(레인·배정·처리 순서)
const AUX_HH = ["decidedAtS", "delayed119", "everHold", "holdRecheckByS", "reservedResourceId", "reserved119"] as const;
const L_FIELDS = ["status", "hoursS", "endS", "capS", "flags"] as const;

interface Mismatch { scenarioId: string; layer: "L" | "RULE" | "METRIC" | "AUX" | "RUN"; key: string; oracle: unknown; ts: unknown }

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
function normL(l: unknown): unknown {
  if (l == null) return null;
  const o = l as J;
  const out: J = {};
  for (const k of L_FIELDS) out[k] = k === "flags" ? [...((o.flags as string[]) ?? [])].sort() : (o[k] ?? null);
  return out;
}

const mismatches: Mismatch[] = [];
interface ScenRow { id: string; group: Group; category: string; L: boolean; RULE: boolean; METRIC: boolean; AUX: boolean; pass: boolean; nHH: number }
const rows: ScenRow[] = [];
for (const it of items) {
  const ms: Mismatch[] = [];
  const add = (layer: Mismatch["layer"], key: string, o: unknown, t: unknown) => ms.push({ scenarioId: it.id, layer, key, oracle: o ?? null, ts: t ?? null });
  let nHH = 0;
  if (tsErr[it.id]) add("RUN", "ts", null, tsErr[it.id]);
  let o: J | null = null, t: J | null = null;
  try { o = JSON.parse(readFileSync(path.join(dirs.oracle, `${it.id}.json`), "utf-8")) as J; } catch { if (!skipPython) add("RUN", "oracle", "missing", null); }
  try { t = JSON.parse(readFileSync(path.join(dirs.ts, `${it.id}.json`), "utf-8")) as J; } catch { /* tsErr에 기록 */ }
  if (o && t) {
    const ho = (o.households ?? {}) as Record<string, J>, ht = (t.households ?? {}) as Record<string, J>;
    const ids = [...new Set([...Object.keys(ho), ...Object.keys(ht)])].sort();
    nHH = ids.length;
    for (const id of ids) {
      const a = ho[id], b = ht[id];
      if (!a || !b) { add("RULE", `${id}`, a ? "present" : "missing", b ? "present" : "missing"); continue; }
      if (!same(normL(a.L), normL(b.L))) add("L", `${id}.L`, normL(a.L), normL(b.L));
      for (const f of CRIT_HH) if (!same(a[f], b[f])) add("RULE", `${id}.${f}`, a[f], b[f]);
      for (const f of AUX_HH) if (!same(a[f], b[f])) add("AUX", `${id}.${f}`, a[f], b[f]);
    }
    const mo = (o.metrics ?? {}) as J, mt = (t.metrics ?? {}) as J;
    for (const f of ["M1", "M2S"]) if (!same(mo[f], mt[f])) add("METRIC", f, mo[f], mt[f]);
    if (!same(mo.highRisk, mt.highRisk)) add("AUX", "metrics.highRisk", mo.highRisk, mt.highRisk);
    for (const f of ["gapS", "serveSource"] as const) {
      const a = (mo[f] ?? {}) as J, b = (mt[f] ?? {}) as J;
      for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) if (!same(a[k], b[k])) add("AUX", `metrics.${f}.${k}`, a[k], b[k]);
    }
    const dO = (o.decisions ?? []) as J[], dT = (t.decisions ?? []) as J[];
    if (!same(dO.map((d) => [d.tS, d.r80EndS, d.r90EndS]), dT.map((d) => [d.tS, d.r80EndS, d.r90EndS]))) {
      add("AUX", "decisions.times", dO.map((d) => [d.tS, d.r80EndS, d.r90EndS]), dT.map((d) => [d.tS, d.r80EndS, d.r90EndS]));
    }
  }
  const has = (l: Mismatch["layer"]) => ms.some((m) => m.layer === l || m.layer === "RUN");
  const row: ScenRow = {
    id: it.id, group: it.group, category: it.category, nHH,
    L: !has("L"), RULE: !has("RULE"), METRIC: !has("METRIC"), AUX: !has("AUX"), pass: false,
  };
  row.pass = row.L && row.RULE && row.METRIC;
  rows.push(row);
  mismatches.push(...ms);
}

// ---------- 4) 보고서 ----------
function tally(sel: ScenRow[]) {
  return {
    scenarios: sel.length,
    households: sel.reduce((s, r) => s + r.nHH, 0),
    L: sel.filter((r) => r.L).length,
    RULE: sel.filter((r) => r.RULE).length,
    METRIC: sel.filter((r) => r.METRIC).length,
    AUX: sel.filter((r) => r.AUX).length,
    pass: sel.filter((r) => r.pass).length,
  };
}
const groups: Group[] = ["std50", "preset", "fuzz"];
const byGroup = Object.fromEntries(groups.map((g) => [g, tally(rows.filter((r) => r.group === g))]));
const cats = [...new Set(rows.filter((r) => r.group === "fuzz").map((r) => r.category))].sort();
const byFuzzCategory = Object.fromEntries(cats.map((c) => [c, tally(rows.filter((r) => r.group === "fuzz" && r.category === c))]));
const total = tally(rows);
const layerCount = (l: Mismatch["layer"]) => mismatches.filter((m) => m.layer === l).length;

const report = {
  format: "pl26-diff-report/1",
  criterion: "spec.md 8절: 레인·배정·처리 순서(order)·M1·M2 완전 일치 + lowerBound(L: status·hoursS·endS·capS·flags) 일치. AUX(결정 시각·HOLD 시한·검토 예약·가구별 공백·공급원·결정 시점 목록)는 진단용",
  inputs: { std50: "app/src/lib/sim/scenarios.ts standard50Defs", presets: "presetDefs", fuzz: "app/src/lib/sim/fuzz.ts boundaryFuzz" },
  inputManifestSha256: sha256Hex(canonicalJson(manifest)),
  total, byGroup, byFuzzCategory,
  mismatchCounts: { L: layerCount("L"), RULE: layerCount("RULE"), METRIC: layerCount("METRIC"), AUX: layerCount("AUX"), RUN: layerCount("RUN") },
  mismatches,
};
writeFileSync(path.join(repo, "out", "diff_report.json"), canonicalJson(report) + "\n", "utf-8");

const pct = (k: number, n: number) => (n === 0 ? "—" : `${k}/${n}`);
const md: string[] = [];
md.push("# 차등 시험 보고 (TS 대 Python 오라클)", "");
md.push(`- 기준: ${report.criterion}`);
md.push(`- 입력 매니페스트 sha256: \`${report.inputManifestSha256}\``, "");
md.push("| 집합 | 시나리오 | 가구 | L 일치 | RULE 일치 | M1·M2 일치 | 통과(8절) | 보조(AUX) 일치 |", "|---|---|---|---|---|---|---|---|");
for (const [name, t] of [...Object.entries(byGroup), ["합계", total] as const]) {
  if (t.scenarios === 0) continue;
  md.push(`| ${name} | ${t.scenarios} | ${t.households} | ${pct(t.L, t.scenarios)} | ${pct(t.RULE, t.scenarios)} | ${pct(t.METRIC, t.scenarios)} | **${pct(t.pass, t.scenarios)}** | ${pct(t.AUX, t.scenarios)} |`);
}
if (cats.length) {
  md.push("", "## 경계 퍼즈 범주별", "", "| 범주 | 시나리오 | 통과 | 보조 일치 |", "|---|---|---|---|");
  for (const c of cats) { const t = byFuzzCategory[c]; md.push(`| ${c} | ${t.scenarios} | ${pct(t.pass, t.scenarios)} | ${pct(t.AUX, t.scenarios)} |`); }
}
md.push("", `## 불일치 (${mismatches.length}건: L ${report.mismatchCounts.L}, RULE ${report.mismatchCounts.RULE}, METRIC ${report.mismatchCounts.METRIC}, AUX ${report.mismatchCounts.AUX}, RUN ${report.mismatchCounts.RUN})`, "");
if (mismatches.length === 0) md.push("없음.");
else {
  md.push("| 시나리오 | 층 | 키 | 오라클 | TS |", "|---|---|---|---|---|");
  for (const m of mismatches) md.push(`| ${m.scenarioId} | ${m.layer} | ${m.key} | \`${JSON.stringify(m.oracle)}\` | \`${JSON.stringify(m.ts)}\` |`);
}
writeFileSync(path.join(repo, "out", "diff_report.md"), md.join("\n") + "\n", "utf-8");

console.log(`시나리오 ${total.scenarios}, 가구 ${total.households}`);
for (const [g, t] of Object.entries(byGroup)) if (t.scenarios) console.log(`  ${g}: 통과 ${t.pass}/${t.scenarios} (L ${t.L}, RULE ${t.RULE}, M1·M2 ${t.METRIC}, AUX ${t.AUX})`);
console.log(`불일치 ${mismatches.length}건 (L ${report.mismatchCounts.L}, RULE ${report.mismatchCounts.RULE}, METRIC ${report.mismatchCounts.METRIC}, AUX ${report.mismatchCounts.AUX}, RUN ${report.mismatchCounts.RUN})`);
console.log(`→ out/diff_report.json, out/diff_report.md`);
if (pyLog) console.log(`(oracle stderr) ${pyLog.slice(0, 2000)}`);
process.exit(total.pass === total.scenarios ? 0 : 1);
