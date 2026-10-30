// evidence.json 동기화 (spec.md 1.1절 '마지막 10초', 7.6절, 11.4절). 비AI, 결정적.
// 실행: (app/에서) npx tsx scripts/sync-evidence.ts
// 화면·보고서·ClosingCard가 읽는 숫자는 모두 이 파일에서 나온다. 손으로 적은 숫자는 0개다.
// 입력 파일이 없으면 그 키를 싣지 않는다 → 화면은 「측정 전」으로 대체한다(하드코딩 금지).
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalJson, sha256Hex } from "../src/lib/sim/materialize";
import { wilson } from "../src/lib/sim/analyze";
import { buildFacts, type NoticeInputT } from "../src/lib/notice/facts";
import { e7Evidence, type E7Out } from "./e7-evidence";

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
      // 합산 비교에서 원안 규칙 대 가까운 순(B2). 레드팀 10/18: '차이 없음'만 쓰지 말고 합산 열등도 밝힌다
      vsB2: slimCmp(e2.pooled.compares.B2_NEAREST),
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

// ---- E5: AI 판독 기여·표적 사전 배치(S7 봉인 실행, scripts/e5-analyze.ts) ----
type Cmp5 = { rel: number | null; lo: number | null; hi: number | null };
const e5 = take("out/e5_sealed.json") as {
  source: { n: number }; arms: Record<string, number>;
  compares: Record<"aiVsNo" | "perfVsNo" | "aiVsKr" | "noVsKr" | "p7tVsP7" | "p7VsRule" | "p7tVsRule", Cmp5>;
  hhRates: Record<string, Record<string, HhRate>>;
  prereg: { hit: number; total: number; items: { id: string; text: string; hit: boolean | null; value: string }[] };
} | null;
if (e5) {
  const c = (x: Cmp5) => ({ rel: x.rel, lo: x.lo, hi: x.hi });
  const pickV = (cls: string) => Object.fromEntries(["AI@RULE", "AI@RULE+P7", "AI@RULE+P7T"].map((v) => [v, e5.hhRates[cls]?.[v]?.rate ?? null]));
  out.e5 = {
    n: e5.source.n, unknownRateAI: e5.arms.AI,
    aiVsNo: c(e5.compares.aiVsNo), perfVsNo: c(e5.compares.perfVsNo), aiVsKr: c(e5.compares.aiVsKr), p7tVsP7: c(e5.compares.p7tVsP7),
    hhGap: { VENT_1H: pickV("VENT_1H"), VENT_3H: pickV("VENT_3H"), O2_STAT: pickV("O2_STAT") },
    prereg: {
      hit: e5.prereg.hit, total: e5.prereg.total,
      missed: e5.prereg.items.filter((x) => x.hit === false).map((x) => ({ id: x.id, text: x.text, value: x.value })),
      notScored: e5.prereg.items.filter((x) => x.hit == null).map((x) => ({ id: x.id, text: x.text, value: x.value })),
    },
  };
}

// ---- E6: 평시 정보 표적 사전 배치(S8 봉인 실행, scripts/e6-analyze.ts) ----
const e6 = take("out/e6_sealed.json") as {
  source: { n: number };
  compares: Record<"preVsRand" | "outVsRand" | "preVsOut" | "randVsRule" | "preVsRule", Cmp5>;
  hhRates: Record<string, Record<string, HhRate>>;
  prereg: { hit: number; total: number; items: { id: string; text: string; hit: boolean | null; value: string }[] };
} | null;
if (e6) {
  const c = (x: Cmp5) => ({ rel: x.rel, lo: x.lo, hi: x.hi });
  const rand = "AI@RULE+P7", pre = "AI@RULE+P7P";
  const rows = Object.entries(e6.hhRates).map(([cls, r]) => ({ cls, rand: r[rand]?.rate ?? null, pre: r[pre]?.rate ?? null }));
  out.e6 = {
    n: e6.source.n, preVsRand: c(e6.compares.preVsRand), outVsRand: c(e6.compares.outVsRand),
    hhGap: Object.fromEntries(rows.map((x) => [x.cls, { rand: x.rand, pre: x.pre }])),
    worse: rows.filter((x) => x.rand != null && x.pre != null && x.pre > x.rand).map((x) => x.cls),
    prereg: { hit: e6.prereg.hit, total: e6.prereg.total, missed: e6.prereg.items.filter((x) => x.hit === false).map((x) => ({ id: x.id, text: x.text, value: x.value })) },
  };
}

// ---- N1: 보호자 알림 AI 문장 + 두 단계 검사(S9 봉인 실행, scripts/n1-analyze.ts) ----
/** 표시 시각('내일 오전 4시 10분' 등)을 분으로(비교용) */
function n1Mins(t: string | null | undefined): number | null {
  if (!t) return null;
  const d = t.startsWith("내일") ? 1 : t.startsWith("모레") ? 2 : 0;
  const m = /(오전|오후) (\d+)시(?: (\d+)분)?/.exec(t);
  if (!m) return null;
  let h = Number(m[2]);
  if (m[1] === "오후" && h !== 12) h += 12;
  if (m[1] === "오전" && h === 12) h = 0;
  return d * 1440 + h * 60 + Number(m[3] ?? 0);
}
type N1Facts = Record<string, unknown> & { kind: string; plan: { type: string; arriveBy?: string | null; doneBy?: string | null } | null; battery: { text?: string }; cylinder: { text?: string } | null; warnRunOutFirst?: boolean };
/** 경고가 붙었는데 표시 도움 시각이 표시 보호 끝과 같음: 「X까지 / X까지 도착 / 먼저 떨어짐」(통합 레드팀 4·5라운드) */
function n1SameTimeWarn(F: N1Facts): boolean {
  const warn = Boolean(F.warnBatteryFirst ?? F.warnRunOutFirst);
  const sup = n1Mins(F.cylinder ? F.cylinder.text : F.battery.text);
  const p = F.plan;
  const help = p?.type === "CALL119" ? n1Mins(p.doneBy) : p?.type === "ASSIGN" || p?.type === "GAP" ? n1Mins(p.arriveBy) : null;
  return warn && sup != null && help != null && help === sup;
}
/** 봉인 당시 고정 문안이 스스로 모순이던 쌍(119 경고, 또는 경고가 붙었는데 표시 도착 ≤ 표시 보호 끝)을 빼고 본 쌍 비교(통합 레드팀 3·4라운드, 사후 분석).
 *  AI 글 쪽의 같은 시각 경고(봉인 당시 통과, 지금 규칙은 「도착이 늦어지면」)도 함께 센다(5라운드) */
function n1JudgeSplit() {
  const dir = path.join(__dirname, "..", "..", "out", "sealed", "n1");
  if (!existsSync(dir)) return {};
  const split = { contradiction: { n: 0, judged: 0, ai: 0, template: 0, same: 0 }, rest: { ai: 0, template: 0, same: 0 }, aiSameTime: { n: 0, inContradiction: 0, ai: 0, template: 0, same: 0 } };
  const atLeast = { k: 0, n: 0 };
  const sameTimeIds: string[] = [], sentContradictionIds: string[] = [];
  for (const f of readdirSync(dir).filter((x) => /^test-\d+\.json$/.test(x))) {
    const r = JSON.parse(readFileSync(path.join(dir, f), "utf-8")) as { id: string; facts: N1Facts; composed: { source: string }; judged: { pick?: "ai" | "template" | "same" } | null };
    const F = r.facts;
    const warn = Boolean(F.warnBatteryFirst ?? F.warnRunOutFirst);
    const sup = F.cylinder ? F.cylinder.text : F.battery.text;
    const p = F.plan;
    const c = warn && (p?.type === "CALL119" || ((p?.type === "ASSIGN" || p?.type === "GAP") && p.arriveBy != null && sup != null && (n1Mins(p.arriveBy) ?? 0) <= (n1Mins(sup) ?? 0)));
    if (c) split.contradiction.n++;
    const pick = r.judged?.pick;
    if (pick) (c ? split.contradiction : split.rest)[pick]++;
    if (pick && c) split.contradiction.judged++;
    if (c && !pick) sentContradictionIds.push(r.id);
    if (r.composed.source === "ai" && n1SameTimeWarn(F)) {
      sameTimeIds.push(r.id);
      split.aiSameTime.n++;
      if (pick) split.aiSameTime[pick]++;
      if (c) split.aiSameTime.inContradiction++;
    }
    // 쌍 비교의 내용 차이: AI 글이 배터리·산소통 시각 문장에서 하한 표현 '적어도'를 뺐는가(고정 문안은 늘 씀)
    if (r.composed.source === "ai" && F.kind === "OUTAGE") for (const t of [F.battery.text, F.cylinder?.text]) {
      if (!t) continue;
      const s = (r as unknown as { composed: { sentences: string[] } }).composed.sentences.find((x) => x.includes(t) && !/도착|구급/.test(x));
      if (!s) continue;
      atLeast.n++;
      if (!s.includes("적어도")) atLeast.k++;
    }
  }
  // 쌍 비교 부호검정(같음 제외, 양측): AI 대 고정
  const a = split.contradiction.ai + split.rest.ai, b = split.contradiction.template + split.rest.template, m = a + b;
  let tail = 0, c = 1;
  for (let i = 0; i <= m; i++) { if (i > 0) c = (c * (m - i + 1)) / i; if (i <= Math.min(a, b)) tail += c; }
  const signP = Math.min(1, (2 * tail) / 2 ** m);
  // 나간 글 중 봉인 뒤 결함 판정: 모순 고정 문안 가운데 AI 글이 탈락해 실제로 나간 것(쌍 비교 없음), 외장 합산 미표기(사후 집계 scripts/n1-ext-sealed.ts)
  const extF = path.join(__dirname, "..", "..", "seal", "outputs", "posthoc", "n1_ext_sealed.json");
  const ext = existsSync(extF) ? (JSON.parse(readFileSync(extF, "utf-8")) as { undisclosed: { k: number; ai: number; ids: string[] } }).undisclosed : null;
  const sentContradiction = split.contradiction.n - split.contradiction.judged;
  // 지금 경고 기준(표시 도착이 보호 끝 30분 전 이내)이면 경고가 붙었을 텐데 봉인 때 경고 없이 나간 글(통합 레드팀 10라운드)
  const marginMissed: string[] = [];
  for (const f of readdirSync(dir).filter((x) => /^test-\d+\.json$/.test(x))) {
    const r = JSON.parse(readFileSync(path.join(dir, f), "utf-8")) as { id: string; input: NoticeInputT; facts: N1Facts };
    if (r.input.kind !== "OUTAGE" || r.facts.warnBatteryFirst || r.facts.warnRunOutFirst) continue;
    if (buildFacts(r.input).warnRunOutFirst) marginMissed.push(r.id);
  }
  // 사실에 없는 기관 약속(PREP에서 '다시 알려 드립니다' 등). 지금 프롬프트 규칙 1·2차 staffPromises가 거부한다(통합 레드팀 11라운드)
  const unsupportedPromise: string[] = [];
  for (const f of readdirSync(dir).filter((x) => /^test-\d+\.json$/.test(x))) {
    const r = JSON.parse(readFileSync(path.join(dir, f), "utf-8")) as { id: string; facts: N1Facts; composed: { source: string; sentences: string[] } };
    if (r.composed.source !== "ai") continue;
    if (r.facts.kind === "PREP" && r.composed.sentences.some((x) => /다시 알려|알려 드리겠|연락드리겠|안내해 드리겠/.test(x))) unsupportedPromise.push(r.id);
  }
  const defectIds = new Set([...sameTimeIds, ...sentContradictionIds, ...(ext?.ids ?? []), ...marginMissed, ...unsupportedPromise]);
  const sentDefects = defectIds.size;
  // '적어도' 보장 표현은 표현 기준 변경이라 결함에 넣지 않는다. 그런 나간 글 중 결함 판정 밖인 것(통합 레드팀 13라운드: 표기 명확화)
  const atLeastOnly: string[] = [];
  for (const f of readdirSync(dir).filter((x) => /^test-\d+\.json$/.test(x))) {
    const r = JSON.parse(readFileSync(path.join(dir, f), "utf-8")) as { id: string; composed: { sentences: string[] } };
    if (r.composed.sentences.some((x) => x.includes("적어도")) && !defectIds.has(r.id)) atLeastOnly.push(r.id);
  }
  return { judgeSplit: { ...split, atLeastDropped: atLeast, signP: Math.round(signP * 1000) / 1000, sentContradiction }, extUndisclosed: ext, marginMissed, unsupportedPromise, defectIds: [...defectIds].sort(), sentDefects, atLeastOnly };
}
/** 봉인 실행 건당 비용(생성 + 2차 검사, 운영과 같은 경로. 고정 문안 검사·쌍 비교 제외) */
function n1Cost() {
  const dir = path.join(__dirname, "..", "..", "out", "sealed", "n1");
  if (!existsSync(dir)) return null;
  const xs = readdirSync(dir).filter((x) => /^test-\d+\.json$/.test(x)).map((f) => {
    const r = JSON.parse(readFileSync(path.join(dir, f), "utf-8")) as { meta?: { costUsd?: number }; gate2?: { cost?: number } | null };
    return (r.meta?.costUsd ?? 0) + (r.gate2?.cost ?? 0);
  });
  return xs.length ? { mean: Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1e4) / 1e4, max: Math.round(Math.max(...xs) * 1e4) / 1e4 } : null;
}

/** 봉인 실행에서 AI 글이 나간 항목 중 대표 예시(경고 있는 전원 배정·산소통·119·평시) — 실시간 생성 한도에 걸려도 AI 글을 볼 수 있게 */
function n1Examples(defectIds: readonly string[] = []) {
  const dir = path.join(__dirname, "..", "..", "out", "sealed", "n1");
  if (!existsSync(dir)) return [];
  type Row = { id: string; stratum: string; facts: N1Facts; composed: { source: string; sentences: string[]; footer: string } };
  const rows = readdirSync(dir).filter((f) => /^test-\d+\.json$/.test(f)).sort().map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf-8")) as Row).filter((r) => r.composed.source === "ai");
  // 봉인 뒤 결함 판정 글은 대표 예시로 고르지 않는다(통합 레드팀 5·11라운드)
  const pick = (label: string, ok: (r: Row) => boolean) => { const r = rows.find((x) => !defectIds.includes(x.id) && ok(x)); return r ? { label, id: r.id, sentences: r.composed.sentences } : null; };
  // 같은 시각 경고(4라운드에서 고친 모순)는 대표 예시로 고르지 않는다(통합 레드팀 5라운드)
  return [
    pick("전원 배정 · 먼저 떨어질 수 있음 경고", (r) => r.facts.kind === "OUTAGE" && (r.facts.plan?.type === "ASSIGN" || r.facts.plan?.type === "GAP") && Boolean(r.facts.warnRunOutFirst) && !r.facts.cylinder
      && (n1Mins(r.facts.plan.arriveBy) ?? -1) > (n1Mins(r.facts.battery.text) ?? Infinity)),
    pick("산소발생기 · 확인된 산소통", (r) => r.facts.kind === "OUTAGE" && r.facts.cylinder != null),
    pick("119 연계", (r) => r.facts.kind === "OUTAGE" && r.facts.plan?.type === "CALL119" && !r.facts.cylinder),
    // 외장 신고 집은 고르지 않는다: 봉인 당시 글은 확인 외장 합산을 밝히지 않았다(통합 레드팀 8라운드)
    pick("평시 대비", (r) => r.facts.kind === "PREP"), // 외장 합산 미표기·없는 약속 글은 defectIds로 빠진다(12라운드)
  ].filter(Boolean);
}
type RateN = { k: number; n: number; rate: number | null; wilson95: number[] | null };
const n1 = take("out/n1_sealed.json") as {
  notices: { aiSent: RateN; templateFalseReject: RateN; sentBodyGate1Violations: RateN; judge: { ai: number; template: number; same: number; fail: number }; latencyE2E: { p50: number | null; p95: number | null } };
  corpus: { badMissed: RateN; badCaught: RateN; badCaughtGate1: RateN; badCaughtGate2: RateN; goodFalseReject: RateN; byCategory: Record<string, { n: number; caught: number }> };
  costUsd: number;
  prereg: { hit: number; total: number; items: { id: string; text: string; hit: boolean | null; value: string }[] };
} | null;
if (n1) {
  const r = (x: RateN) => ({ k: x.k, n: x.n, lo: x.wilson95?.[0] ?? null, hi: x.wilson95?.[1] ?? null });
  const n1Scored = n1.prereg.items.filter((x) => x.id !== "9.5" && x.hit != null);
  out.n1 = {
    aiSent: r(n1.notices.aiSent), templateFalseReject: r(n1.notices.templateFalseReject),
    badMissed: r(n1.corpus.badMissed), badCaughtGate1: r(n1.corpus.badCaughtGate1), badCaughtGate2: r(n1.corpus.badCaughtGate2), goodFalseReject: r(n1.corpus.goodFalseReject),
    missedCategories: Object.entries(n1.corpus.byCategory).filter(([, v]) => v.caught < v.n).map(([k, v]) => ({ category: k, missed: v.n - v.caught, n: v.n })),
    judge: n1.notices.judge, latencyP50: n1.notices.latencyE2E.p50,
    // 9.5(보낸 글 1차 위반 0)는 구조상 보장되는 확인 항목이라 적중 집계에서 뺀다(통합 레드팀 1라운드)
    ...n1JudgeSplit(),
    examples: n1Examples(n1JudgeSplit().defectIds ?? []),
    costPerNotice: n1Cost(),
    prereg: { hit: n1Scored.filter((x) => x.hit).length, total: n1Scored.length, structural: n1.prereg.items.filter((x) => x.id === "9.5").map((x) => ({ id: x.id, text: x.text, value: x.value, hit: x.hit })), missed: n1Scored.filter((x) => x.hit === false).map((x) => ({ id: x.id, text: x.text, value: x.value })) },
  };
}

// ---- 원안 KPI '과대예측 0건' 사후 집계(통합 레드팀 8라운드, scripts/e2-m4.ts): 봉인 E2 시드 재실행 ----
{
  const f = path.join(__dirname, "..", "..", "seal", "outputs", "posthoc", "e2_m4_posthoc.json");
  if (existsSync(f)) {
    const d = JSON.parse(readFileSync(f, "utf-8")) as { runs: number; policies: Record<string, { M4: number; shown: number; mismatch: number; runsWithM4: number; cause: Record<string, number>; overH: { p50: number; p90: number; max: number } }> };
    const p = d.policies.RULE, k = d.policies.KR_BASELINE;
    out.kpiOverPredict = {
      posthoc: true, runs: d.runs, mismatch: p.mismatch + k.mismatch,
      rule: { k: p.M4, n: p.shown, runsWithAny: p.runsWithM4, cause: p.cause, overH: p.overH },
      baseline: { k: k.M4, n: k.shown },
    };
  }
}

// ---- 실패 가정 점검(10/30) 사후 집계: 남는 공백 분해(scripts/posthoc-decomp.ts), 하한 v2(scripts/posthoc-lb-v2.ts) ----
{
  const f = path.join(__dirname, "..", "..", "seal", "outputs", "posthoc", "e2_decomp.json");
  if (existsSync(f)) {
    const d = JSON.parse(readFileSync(f, "utf-8")) as { policies: Record<string, { runs: number; mismatch: number; sumMismatch: number; gapHPerRun: number; byClassShare: Record<string, number>; byClassHPerRun: Record<string, number>; byServedHPerRun: Record<string, number>; householdsPerRun: Record<string, number> }> };
    const p = d.policies.RULE;
    out.gapDecomp = {
      posthoc: true, runs: p.runs, mismatch: Object.values(d.policies).reduce((s, x) => s + x.mismatch + x.sumMismatch, 0),
      ruleGapHPerRun: p.gapHPerRun, byClassShare: p.byClassShare, byClassHPerRun: p.byClassHPerRun, byServedHPerRun: p.byServedHPerRun, householdsPerRun: p.householdsPerRun,
      gapHPerRun: Object.fromEntries(Object.entries(d.policies).map(([k, x]) => [k, x.gapHPerRun])),
    };
  }
  const g = path.join(__dirname, "..", "..", "seal", "outputs", "posthoc", "e2_lb_v2.json");
  if (existsSync(g)) {
    const d = JSON.parse(readFileSync(g, "utf-8")) as { rows: Record<string, { mismatch: number; overCount: number; shown: number; overRate: number; gapHPerRun: number; overH: { p50: number; p90: number; max: number } | null }>; paired: Record<string, { meanDiffHPerRun: number; se: number }> };
    const v1 = d.rows["v1:RULE"], v2 = d.rows["v2:RULE"];
    out.lbV2 = {
      posthoc: true, mismatch: Object.values(d.rows).reduce((s, x) => s + x.mismatch, 0),
      v1: { k: v1.overCount, n: v1.shown, overH: v1.overH, gapHPerRun: v1.gapHPerRun },
      v2: { k: v2.overCount, n: v2.shown, overH: v2.overH, gapHPerRun: v2.gapHPerRun },
      gapDiffHPerRun: d.paired.RULE.meanDiffHPerRun, gapDiffSe: d.paired.RULE.se,
    };
  }
}

// ---- 실패 가정 점검(10/30) 사후 민감도: 119 도착을 소방청 실측(평시)으로(scripts/posthoc-119.ts) ----
{
  const f = path.join(__dirname, "..", "..", "seal", "outputs", "posthoc", "e2_119_empirical.json");
  if (existsSync(f)) {
    const d = JSON.parse(readFileSync(f, "utf-8")) as { source: { year: string; n: number; p50Min: number; p90Min: number }; runs: number; rows: Record<string, { gapHPerRun: number; mismatch: number; byServedHPerRun: Record<string, number> }>; compare: Record<"assumed" | "empirical", { toolVsKr: number; toolVsNearest: number }> };
    out.e119 = {
      posthoc: true, year: d.source.year, n: d.source.n, p50Min: d.source.p50Min, p90Min: d.source.p90Min, runs: d.runs,
      mismatch: Object.values(d.rows).reduce((s, x) => s + x.mismatch, 0),
      assumed: { ruleGapHPerRun: d.rows["assumed:RULE"].gapHPerRun, rule119H: d.rows["assumed:RULE"].byServedHPerRun.LANE_119 ?? 0, ...d.compare.assumed },
      empirical: { ruleGapHPerRun: d.rows["empirical:RULE"].gapHPerRun, rule119H: d.rows["empirical:RULE"].byServedHPerRun.LANE_119 ?? 0, ...d.compare.empirical },
    };
  }
}

// ---- E7: 평시 산소통·기기 맞춤 사전 배치(S10 봉인 실행, scripts/e7-analyze.ts → scripts/e7-evidence.ts) ----
{
  const e7v = e7Evidence(take("out/e7_sealed.json") as E7Out | null);
  if (e7v) out.e7 = e7v;
}

// ---- 사전등록 나눔(레드팀 10/18): 실행 전 예측(1.x·H*·4.x·6.x)과 예비 실행·사전 분석 뒤 확인(2.x·3.x·5.x·7.x)을 따로 센다 ----
// 7.x(E6)는 레드팀 3라운드가 봉인 E5 시드 400추첨으로 같은 평시 순위의 효과를 먼저 보고한 뒤 쓴 예측이라 '확인' 쪽에 넣는다(레드팀 4라운드)
{
  const items = [
    ...(((score?.items ?? []) as { id: string; hit: boolean | null }[])),
    ...(((scoreE3?.items ?? []) as { id: string; hit: boolean | null }[])),
    ...(e4?.prereg.items ?? []),
    ...(e5?.prereg.items ?? []),
    ...(e6?.prereg.items ?? []),
    ...(n1?.prereg.items ?? []).filter((x) => x.id !== "9.5"),
  ];
  const pre = items.filter((x) => /^(1\.|H|4\.|6\.)/.test(x.id) && x.hit != null);
  // 9.x(N1)는 dev를 보고 문턱을 정했으므로 '확인' 쪽(predictions_n1.md에 공개)
  const post = items.filter((x) => /^(2\.|3\.|5\.|7\.|9\.)/.test(x.id) && x.hit != null);
  if (items.length) {
    out.preregSplit = {
      before: { hit: pre.filter((x) => x.hit).length, total: pre.length, untested: items.filter((x) => /^(1\.|H|4\.|6\.)/.test(x.id) && x.hit == null).length + (scoreE3?.notTested?.length ?? 0) },
      afterPilot: { hit: post.filter((x) => x.hit).length, total: post.length },
    };
  }
}

out.sources = sources;
writeFileSync(path.join(__dirname, "..", "src", "data", "evidence.json"), canonicalJson(out) + "\n", "utf-8");
console.log("evidence.json 키:", Object.keys(out).join(", "));
