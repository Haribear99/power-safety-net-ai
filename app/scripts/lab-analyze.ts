// 스윕 결과 집계 (spec.md 5.4절, 라운드 5). out/sweeps/{E1,E2}_<tag>.json → out/lab_<tag>.json. 비AI, 결정적.
// 실행 (app/에서): npx tsx scripts/lab-analyze.ts --tag dev
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CAUSES } from "../src/lib/domain/types";
import { analyzeE1, analyzeE2Cell, e1bCurves, e3Effect, labelsByVariant, stabilityCheck, type E1Cell, type E2CellResult } from "../src/lib/sim/analyze";
import { PATCHES, type PatchId } from "../src/lib/sim/patches";
import { canonicalJson, sha256Hex } from "../src/lib/sim/materialize";
import type { E1Row, E2CellDef, E2Row, E3Row, FalsifyVariant } from "../src/lib/sim/sweep";

const repo = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const tag = argv[argv.indexOf("--tag") + 1] ?? "dev";
const COMPARATORS = ["KR_BASELINE", "B1_SHORTEST", "B2_NEAREST", "ORACLE_INFO", "NONE", "R_L", "RULE_NO_R", "RULE_FEASIBLE_FIRST", "RULE_NO_RESERVE"];
const h1 = (x: number) => Math.round(x * 10) / 10;
const pct = (x: number | null | undefined) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);

const out: Record<string, unknown> = { format: "pl26-lab/1", tag };

const e2File = path.join(repo, "out", "sweeps", `E2_${tag}.json`);
if (existsSync(e2File)) {
  const raw = readFileSync(e2File, "utf-8");
  const doc = JSON.parse(raw) as { cells: E2CellDef[]; rows: E2Row[]; seedLo: number; nCells: number; perCell: number };
  const cells: E2CellResult[] = doc.cells.map((c) => analyzeE2Cell(c.id, doc.rows.filter((r) => r.cell === c.id), COMPARATORS));
  const pooled = analyzeE2Cell("ALL", doc.rows, COMPARATORS);
  const count = (vs: string, v: string) => cells.filter((c) => c.compares[vs].verdict === v).length;
  const rels = cells.map((c) => c.compares.KR_BASELINE.relReduction).filter((x): x is number => x != null).sort((a, b) => a - b);
  out.e2 = {
    source: { file: `out/sweeps/E2_${tag}.json`, sha256: sha256Hex(raw.trim()), seedLo: doc.seedLo, nCells: doc.nCells, perCell: doc.perCell, n: doc.rows.length },
    cells, pooled,
    headline: {
      nCells: cells.length,
      superiorVsKr: count("KR_BASELINE", "SUPERIOR"), inferiorVsKr: count("KR_BASELINE", "INFERIOR"),
      krRelReductionRange: rels.length ? { lo: rels[0], hi: rels[rels.length - 1] } : null,
      P1: cells.filter((c) => c.pClass === "P1").length, P0: cells.filter((c) => c.pClass === "P0").length, P2: cells.filter((c) => c.pClass === "P2").length,
    },
  };
  console.log(`\nE2 (${tag}) ${doc.rows.length}건 · 칸 ${cells.length}`);
  console.log("칸 | 대 KR: 승/무/패 · M2 감소율 [CI] · 판정 | 대 B1 | 대 B2 | 정보상한 몫");
  for (const c of cells) {
    const k = c.compares.KR_BASELINE, b1 = c.compares.B1_SHORTEST, b2 = c.compares.B2_NEAREST;
    console.log(`${c.cell.padEnd(18)} | ${k.win}/${k.tie}/${k.loss} · ${pct(k.relReduction)} [${pct(k.relCi?.lo)}, ${pct(k.relCi?.hi)}] · ${k.verdict} | ${b1.win}/${b1.tie}/${b1.loss} ${pct(b1.relReduction)} ${b1.verdict} | ${b2.win}/${b2.tie}/${b2.loss} ${pct(b2.relReduction)} ${b2.verdict} | ${pct(c.oracleCapture)}`);
  }
  const P = pooled.totals;
  console.log("합계 M1/M2h:", Object.entries(P).map(([k, v]) => `${k} ${v.M1}/${h1(v.M2H)}`).join(" · "));
  console.log("헤드라인:", JSON.stringify((out.e2 as { headline: unknown }).headline));
}

const e1File = path.join(repo, "out", "sweeps", `E1_${tag}.json`);
if (existsSync(e1File)) {
  const raw = readFileSync(e1File, "utf-8");
  const doc = JSON.parse(raw) as { groups: Record<string, E1Row[]>; variants: FalsifyVariant[]; draws: number; seedLo: number; master: string; falsifyDraws: number };
  const variants = doc.variants.map((v) => ({ variant: v, rows: doc.groups[`${v.axis}:${v.end}`] ?? [] }));
  const cells = analyzeE1(doc.groups.main, variants, CAUSES);
  let stability: ReturnType<typeof stabilityCheck> | null = null;
  if (doc.groups.lognormal) stability = stabilityCheck(cells, analyzeE1(doc.groups.lognormal, [], CAUSES));
  const robust = (pol: string) => cells.filter((c: E1Cell) => c.policy === pol && c.label === "ROBUST" && !c.physicalZero);
  out.e1 = {
    source: { file: `out/sweeps/E1_${tag}.json`, sha256: sha256Hex(raw.trim()), draws: doc.draws, seedLo: doc.seedLo, master: doc.master, falsifyDraws: doc.falsifyDraws },
    cells, stability, e1b: e1bCurves(doc.groups.main),
    headline: {
      robustKr: robust("KR_BASELINE").map((c) => ({ cls: c.cls, cause: c.cause, p: c.p, lo: c.ci.lo, flips: c.flips?.length ?? 0 })),
      robustRule: robust("RULE").map((c) => ({ cls: c.cls, cause: c.cause, p: c.p, lo: c.ci.lo, flips: c.flips?.length ?? 0 })),
    },
  };
  console.log(`\nE1 (${tag}) 추첨 ${doc.draws} × 원인 ${CAUSES.length}`);
  for (const pol of ["KR_BASELINE", "RULE"]) {
    console.log(`\n[${pol}] 등급 × 원인 표지(p)`);
    console.log("등급".padEnd(14) + CAUSES.map((c) => c.slice(0, 12).padEnd(13)).join(""));
    const classes = [...new Set(cells.map((c) => c.cls))];
    for (const cls of classes) {
      const line = CAUSES.map((cause) => {
        const c = cells.find((x) => x.policy === pol && x.cls === cls && x.cause === cause);
        return c ? `${c.label.slice(0, 4)} ${c.p.toFixed(2)}${c.flips?.length ? `*${c.flips.length}` : ""}`.padEnd(13) : "".padEnd(13);
      }).join("");
      console.log(cls.padEnd(14) + line);
    }
  }
  if (stability) console.log("\n안정성:", `ROBUST 유지 ${stability.robustKept}/${stability.robustTotal}`, stability.pass ? "통과" : "실패", `뒤집힌 칸 ${stability.flipped.length}`);
  for (const c of robust("KR_BASELINE")) if (c.flips?.length) console.log(`  뒤집힘 ${c.cls}×${c.cause}:`, c.flips.map((f) => `${f.axis}=${f.value}(p ${f.p.toFixed(2)})`).join(", "));
}

const e3File = path.join(repo, "out", "sweeps", `E3_${tag}.json`);
if (existsSync(e3File)) {
  const raw = readFileSync(e3File, "utf-8");
  const doc = JSON.parse(raw) as { variants: string[]; rows: E3Row[]; draws: number; seedLo: number; master: string };
  const effects = doc.variants.filter((v) => v.includes("+")).map((v) => e3Effect(doc.rows, doc.variants, v, PATCHES.get(v.split("+")[1] as PatchId)!));
  const labels = labelsByVariant(doc.rows, doc.variants, CAUSES);
  const robust = (v: string) => labels.filter((c) => c.variant === v && c.label === "ROBUST" && c.cls !== "O2_STAT");
  const closure = doc.variants.filter((v) => v.includes("+")).map((v) => {
    const base = v.split("+")[0];
    const before = robust(base), after = robust(v);
    const closed = before.filter((c) => !after.some((x) => x.cls === c.cls && x.cause === c.cause));
    const opened = after.filter((c) => !before.some((x) => x.cls === c.cls && x.cause === c.cause));
    return { variant: v, base, robustBefore: before.length, robustAfter: after.length, closed: closed.map((c) => ({ cls: c.cls, cause: c.cause })), opened: opened.map((c) => ({ cls: c.cls, cause: c.cause })) };
  });
  out.e3 = { source: { file: `out/sweeps/E3_${tag}.json`, sha256: sha256Hex(raw.trim()), draws: doc.draws, seedLo: doc.seedLo, master: doc.master, n: doc.rows.length }, effects, labels, closure };
  console.log(`
E3 (${tag}) ${doc.rows.length}건`);
  for (const e of effects) {
    const c = closure.find((x) => x.variant === e.variant)!;
    console.log(`${e.variant.padEnd(16)} M2 ${pct(e.rel)} [${pct(e.relCi?.lo)}, ${pct(e.relCi?.hi)}] · M1 ${e.win}/${e.tie}/${e.loss} · 실효보급 하위~상위 ${pct(e.byEff.lo)}~${pct(e.byEff.hi)} · ROBUST ${c.robustBefore}→${c.robustAfter} (해소 ${c.closed.length})`);
  }
  for (const c of closure.filter((x) => x.base === "RULE")) console.log(`  ${c.variant} 해소:`, c.closed.map((x) => `${x.cls}×${x.cause}`).join(", ") || "없음");
  const o2 = (v: string) => labels.filter((c) => c.variant === v && c.cls === "O2_STAT").map((c) => `${c.cause.slice(0, 6)} ${c.p.toFixed(2)}`).join(" ");
  console.log("  O2_STAT RULE:", o2("RULE")); console.log("  O2_STAT RULE+P2:", o2("RULE+P2"));
}

writeFileSync(path.join(repo, "out", `lab_${tag}.json`), canonicalJson(out) + "\n", "utf-8");
console.log(`\n→ out/lab_${tag}.json`);
