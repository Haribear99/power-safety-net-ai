// evidence.json 동기화 (spec.md 1.1절 '마지막 10초', 7.6절, 11.4절). 비AI, 결정적.
// 실행: (app/에서) npx tsx scripts/sync-evidence.ts
// 화면·보고서·ClosingCard가 읽는 숫자는 모두 이 파일에서 나온다. 손으로 적은 숫자는 0개다.
// 입력 파일이 없으면 그 키를 싣지 않는다 → 화면은 「측정 전」으로 대체한다(하드코딩 금지).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalJson, sha256Hex } from "../src/lib/sim/materialize";

const repo = path.resolve(__dirname, "..", "..");
const out: Record<string, unknown> = { format: "pl26-evidence/1" };
const sources: Record<string, string> = {};

function take(rel: string): unknown | null {
  const p = path.join(repo, rel);
  if (!existsSync(p)) return null;
  const text = readFileSync(p, "utf-8");
  sources[rel] = sha256Hex(text);
  return JSON.parse(text);
}

const ab = take("out/presets_ab.json") as { presets: unknown[] } | null;
if (ab) out.presetsAb = ab.presets;

const diff = take("out/diff_report.json") as { total: unknown; mismatchCounts: unknown; byGroup: unknown; inputManifestSha256: string } | null;
if (diff) out.diff = { total: diff.total, mismatchCounts: diff.mismatchCounts, byGroup: diff.byGroup, inputManifestSha256: diff.inputManifestSha256 };

// ---- 리허설 랩(라운드 5): 봉인 실행만 싣는다. 자세한 값은 src/data/lab.json(서버 컴포넌트 전용, /ops 번들에 안 들어감) ----
const labTag = process.argv.includes("--lab-tag") ? process.argv[process.argv.indexOf("--lab-tag") + 1] : "sealed";
type Cmp = { win: number; tie: number; loss: number; relReduction: number | null; relCi: { lo: number; hi: number } | null; verdict: string; meanDiffH: number; ci: { lo: number; hi: number } };
type Cell = { cell: string; n: number; compares: Record<string, Cmp>; totals: Record<string, { M1: number; M2H: number }>; pClass: string; oracleCapture: number | null };
const labDoc = take(`out/lab_${labTag}.json`) as {
  e2?: { source: { n: number; nCells: number }; cells: Cell[]; pooled: Cell; headline: Record<string, unknown> };
  e1?: {
    source: { draws: number; falsifyDraws: number };
    cells: { cls: string; cause: string; policy: string; n: number; k: number; p: number; ci: { lo: number; hi: number }; label: string; rawLabel: string; physicalZero: boolean; demotedByPEarly?: boolean; flips?: { axis: string; end: string; value: number | string; p: number }[]; boundaryH?: number | null }[];
    stability: { pass: boolean; robustKept: number; robustTotal: number; flipped: unknown[] } | null;
    e1b: Record<string, { binLoH: number; n: number; gap: number[] }[]>;
    headline: { robustKr: { cls: string; cause: string }[]; robustRule: { cls: string; cause: string }[] };
  };
  e3?: {
    source: { n: number; draws: number };
    effects: { variant: string; n: number; rel: number | null; relCi: { lo: number; hi: number } | null; win: number; tie: number; loss: number; byCause: Record<string, number | null>; byEff: { deciles: (number | null)[]; lo: number | null; hi: number | null } }[];
    closure: { variant: string; base: string; robustBefore: number; robustAfter: number; closed: { cls: string; cause: string }[]; opened: { cls: string; cause: string }[] }[];
  };
} | null;
const score = take(`out/prereg_score_${labTag}.json`) as { section1: unknown; section2: unknown; items: unknown[]; gate2: { pass: boolean; a: boolean; b: boolean } } | null;
const scoreE3 = take(`out/prereg_e3_score_${labTag}.json`) as { hit: number; total: number; notTested: string[]; items: unknown[] } | null;
const r4 = (x: number | null | undefined) => (x == null ? null : Math.round(x * 1e4) / 1e4);
const slimCmp = (c: Cmp) => ({ w: c.win, t: c.tie, l: c.loss, rel: r4(c.relReduction), relLo: r4(c.relCi?.lo), relHi: r4(c.relCi?.hi), d: r4(c.meanDiffH), v: c.verdict });
if (labDoc?.e2 && labDoc.e1) {
  const e2 = labDoc.e2, e1 = labDoc.e1;
  const kr = e2.pooled.compares.KR_BASELINE;
  out.sweepN = e2.source.n;
  out.lab = {
    tag: labTag,
    e2: {
      n: e2.source.n, nCells: e2.source.nCells, superiorVsKr: e2.headline.superiorVsKr, inferiorVsKr: e2.headline.inferiorVsKr,
      pooledRel: r4(kr.relReduction), pooledRelLo: r4(kr.relCi?.lo), pooledRelHi: r4(kr.relCi?.hi),
      relRange: e2.headline.krRelReductionRange, P1: e2.headline.P1, P0: e2.headline.P0, P2: e2.headline.P2,
    },
    e1: {
      draws: e1.source.draws, scenarios: e1.source.draws * 8,
      robustKr: e1.headline.robustKr.map((c) => ({ cls: c.cls, cause: c.cause })), robustRule: e1.headline.robustRule.map((c) => ({ cls: c.cls, cause: c.cause })),
      stabilityPass: e1.stability?.pass ?? null,
    },
    ...(score ? { gate2: score.gate2, prereg: { section1: score.section1, section2: score.section2 } } : {}),
    ...(labDoc.e3 ? (() => {
      // 끝 카드 보완안 문장은 RULE+P7 고정(prereg/predictions_e3.md 3절, 결과 보기 전)
      const e = labDoc.e3.effects.find((x) => x.variant === "RULE+P7")!;
      const c = labDoc.e3.closure.find((x) => x.variant === "RULE+P7")!;
      return { e3: { n: labDoc.e3.source.n, variant: "RULE+P7", rel: r4(e.rel), effLo: r4(e.byEff.lo), effHi: r4(e.byEff.hi), robustBefore: c.robustBefore, closed: c.closed.length, ...(scoreE3 ? { prereg: { hit: scoreE3.hit, total: scoreE3.total } } : {}) } };
    })() : {}),
  };
  const detail = {
    format: "pl26-lab-ui/1", tag: labTag,
    e2: {
      n: e2.source.n,
      cells: e2.cells.map((c) => ({ cell: c.cell, n: c.n, pClass: c.pClass, cap: r4(c.oracleCapture), kr: slimCmp(c.compares.KR_BASELINE), b1: slimCmp(c.compares.B1_SHORTEST), b2: slimCmp(c.compares.B2_NEAREST) })),
      pooled: {
        totals: Object.fromEntries(Object.entries(e2.pooled.totals).map(([k, v]) => [k, { M1: v.M1, M2H: Math.round(v.M2H) }])),
        compares: Object.fromEntries(Object.entries(e2.pooled.compares).map(([k, v]) => [k, slimCmp(v)])),
        cap: r4(e2.pooled.oracleCapture),
      },
    },
    e1: {
      draws: e1.source.draws, falsifyDraws: e1.source.falsifyDraws,
      cells: e1.cells.map((c) => ({
        cls: c.cls, cause: c.cause, pol: c.policy, n: c.n, p: r4(c.p), lo: r4(c.ci.lo), hi: r4(c.ci.hi), label: c.label, raw: c.rawLabel, zero: c.physicalZero,
        ...(c.demotedByPEarly ? { demoted: true } : {}),
        ...(c.flips?.length ? { flips: c.flips.map((f) => ({ axis: f.axis, end: f.end, value: f.value, p: r4(f.p) })) } : {}),
        ...(c.boundaryH != null ? { boundaryH: c.boundaryH } : {}),
      })),
      stability: e1.stability ? { pass: e1.stability.pass, robustKept: e1.stability.robustKept, robustTotal: e1.stability.robustTotal, flipped: e1.stability.flipped } : null,
      e1b: e1.e1b,
    },
    prereg: score,
    ...(labDoc.e3 ? {
      e3: {
        n: labDoc.e3.source.n, draws: labDoc.e3.source.draws,
        effects: labDoc.e3.effects.map((e) => ({
          variant: e.variant, rel: r4(e.rel), relLo: r4(e.relCi?.lo), relHi: r4(e.relCi?.hi), w: e.win, t: e.tie, l: e.loss,
          effLo: r4(e.byEff.lo), effHi: r4(e.byEff.hi), byCause: Object.fromEntries(Object.entries(e.byCause).map(([k, v]) => [k, r4(v)])),
        })),
        closure: labDoc.e3.closure,
        prereg: scoreE3,
      },
    } : {}),
  };
  writeFileSync(path.join(__dirname, "..", "src", "data", "lab.json"), canonicalJson(detail) + "\n", "utf-8");
  console.log(`lab.json(${labTag}) 갱신`);
}

out.sources = sources;
writeFileSync(path.join(__dirname, "..", "src", "data", "evidence.json"), canonicalJson(out) + "\n", "utf-8");
console.log("evidence.json 키:", Object.keys(out).join(", "));
