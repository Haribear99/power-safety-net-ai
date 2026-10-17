// evidence.json 동기화 (spec.md 1.1절 '마지막 10초', 7.6절, 11.4절). 비AI, 결정적.
// 실행: (app/에서) npx tsx scripts/sync-evidence.ts
// 화면·보고서·ClosingCard가 읽는 숫자는 모두 이 파일에서 나온다. 손으로 적은 숫자는 0개다.
// 입력 파일이 없으면 그 키를 싣지 않는다 → 화면은 「측정 전」으로 대체한다(하드코딩 금지).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalJson, sha256Hex } from "../src/lib/sim/materialize";
import { wilson } from "../src/lib/sim/analyze";

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

// ---- C1 라벨 판독 봉인 측정(S3, 1회) + tesseract 기준선 + dev 회차 간 일치 ----
type Rate = { k: number; n: number };
type C1Sum = { n: number; costPerImage?: number; latencyP50?: number; latencyP95?: number; metrics: Record<string, unknown> & {
  degradedModelConfidentWrong: Rate; degradedAllFieldsConfidentWrong: Rate; unflaggedMismatch: Rate; dbMatchRate: Rate; unregisteredToReview: Rate;
  supplementViolations: number; personalInfo: Rate; fieldExact: Record<string, Rate>; byTemplateGroup: { testOnly: Rate; shared: Rate } };
  items: { fields: Record<string, { verdict: string; confident: boolean }> }[] };
const c1 = take("out/sealed/c1/summary.json") as C1Sum | null;
const tess = take("out/sealed/c1-tesseract/summary.json") as C1Sum | null;
const devCons = take("out/sealed/c1-dev/v1-r2-vs-r1.json") as { consistency: { n: number; modelSame: number } } | null;
const withCi = (r: Rate) => ({ ...r, ciHi: r4(wilson(r.k, r.n).hi), ciLo: r4(wilson(r.k, r.n).lo) });
const slimC1 = (s: C1Sum) => ({
  n: s.n,
  degradedModelConfidentWrong: withCi(s.metrics.degradedModelConfidentWrong),
  degradedAllFieldsConfidentWrong: withCi(s.metrics.degradedAllFieldsConfidentWrong),
  unflaggedMismatch: withCi(s.metrics.unflaggedMismatch),
  dbMatchRate: withCi(s.metrics.dbMatchRate),
  unregisteredToReview: withCi(s.metrics.unregisteredToReview),
  modelExact: withCi(s.metrics.fieldExact.model),
  fieldExact: s.metrics.fieldExact,
  supplementViolations: s.metrics.supplementViolations,
  supplementConfident: s.items.reduce((a, it) => a + Object.values(it.fields).filter((f) => f.verdict === "SUPPLEMENT" && f.confident).length, 0),
  personalInfo: s.metrics.personalInfo,
  byTemplateGroup: s.metrics.byTemplateGroup,
  ...(s.costPerImage != null ? { costPerImage: r4(s.costPerImage), latencyP50: s.latencyP50, latencyP95: s.latencyP95 } : {}),
});
if (c1) {
  const h = c1.metrics.degradedModelConfidentWrong;
  out.c1 = {
    sonnet: slimC1(c1), ...(tess ? { tesseract: slimC1(tess) } : {}),
    gate3: { pointEstimate: r4(h.k / h.n), threshold: 0.1, pass: h.k / h.n <= 0.1 },
    ...(devCons ? { devRunConsistency: { n: devCons.consistency.n, modelSame: devCons.consistency.modelSame } } : {}),
  };
}

// ---- 사후 외부 대조(봉인 아님): 아파트 복구시간 가정 분포 대 정부 3년 7구간 분포(tools/check_apt_calibration.py) ----
type FamCal = { consistent: boolean; G: number; p: number; expected: number[] };
const cal = take("out/calib/apt_calibration.json") as {
  source: { url: string; date: string }; capH: number; families: Record<string, FamCal>;
  observed: { n: number; years: number; binsUpperH: number[]; counts: number[]; gt12h: number; gt24h: number; perYear: number; gt12hPerYear: number; gt24hPerYear: number };
} | null;
if (cal) {
  const g = cal.families.gamma;
  out.calib = {
    apt: {
      n: cal.observed.n, years: cal.observed.years, binsUpperH: cal.observed.binsUpperH, counts: cal.observed.counts,
      gt12h: cal.observed.gt12h, gt24h: cal.observed.gt24h, perYear: cal.observed.perYear,
      sourceUrl: cal.source.url, sourceDate: cal.source.date, capH: cal.capH,
      consistent: Object.values(cal.families).every((f) => f.consistent), G: g.G, p: g.p, expected: g.expected,
    },
  };
}

// ---- E4: 실측 정전시간 분포 재시뮬레이션(S6 봉인 실행, scripts/e4-analyze.ts) ----
type HhRate = { k: number; n: number; rate: number };
const e4 = take("out/e4_sealed.json") as {
  source: { n: number; draws: number; seedLo: number; sha256: string };
  ruleVsKr: { rel: number; lo: number; hi: number; w: number; t: number; l: number };
  patches: { variant: string; rel: number; lo: number; hi: number }[];
  hhRates: Record<string, Record<string, HhRate>>;
  prereg: { hit: number; total: number; items: { id: string; text: string; hit: boolean | null; value: string }[] };
} | null;
if (e4) {
  // 비율은 반올림하지 않고 싣는다(r4 뒤 toFixed(1)의 이중 반올림으로 76.4% → 76.3%가 되던 것)
  const pick = (cls: string) => Object.fromEntries(["KR_BASELINE", "RULE", "RULE+P7"].map((v) => [v, e4.hhRates[cls]?.[v]?.rate ?? null]));
  const p7 = e4.patches.find((x) => x.variant === "RULE+P7")!;
  out.e4 = {
    n: e4.source.n, ruleVsKr: { rel: e4.ruleVsKr.rel, lo: e4.ruleVsKr.lo, hi: e4.ruleVsKr.hi },
    p7: { rel: p7.rel, lo: p7.lo, hi: p7.hi },
    hhGap: { VENT_1H: pick("VENT_1H"), VENT_3H: pick("VENT_3H") },
    prereg: { hit: e4.prereg.hit, total: e4.prereg.total, missed: e4.prereg.items.filter((x) => x.hit === false).map((x) => ({ id: x.id, text: x.text, value: x.value })) },
  };
}

out.sources = sources;
writeFileSync(path.join(__dirname, "..", "src", "data", "evidence.json"), canonicalJson(out) + "\n", "utf-8");
console.log("evidence.json 키:", Object.keys(out).join(", "));
