// E3 사전등록 채점 (prereg/predictions_e3.md 1·2절). out/lab_<tag>.json → out/prereg_e3_score_<tag>.json. 비AI, 결정적.
// 실행 (app/에서): npx tsx scripts/score-prereg-e3.ts --tag sealed
// S5 봉인 커밋에 함께 넣었다(결과를 보기 전).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { E3Effect } from "../src/lib/sim/analyze";
import { canonicalJson } from "../src/lib/sim/materialize";

const repo = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const tag = argv[argv.indexOf("--tag") + 1] ?? "sealed";
type Label = { variant: string; cls: string; cause: string; p: number; label: string };
const lab = JSON.parse(readFileSync(path.join(repo, "out", `lab_${tag}.json`), "utf-8")) as {
  e3: { effects: E3Effect[]; labels: Label[]; closure: { variant: string; robustAfter: number }[] };
};
const eff = (v: string) => lab.e3.effects.find((e) => e.variant === v)!;
const p = (v: string, cls: string, cause: string) => lab.e3.labels.find((l) => l.variant === v && l.cls === cls && l.cause === cause)?.p ?? NaN;
const pc = (x: number | null | undefined) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
const PRE = ["P2", "P3", "P7"], BASES = ["KR_BASELINE", "RULE"];
const SIX = ["VENT_1H", "VENT_3H"].flatMap((cls) => ["APT_NIGHT_XFMR", "APT_PARTS", "APT_FIRE"].map((cause) => ({ cls, cause })));

type Item = { id: string; claim: string; observed: string; hit: boolean };
const h1 = BASES.flatMap((b) => PRE.map((x) => eff(`${b}+${x}`)));
const h1min = Math.min(...h1.flatMap((e) => Object.values(e.byCause).map((v) => v ?? -1)));
const h3pairs = PRE.flatMap((x) => SIX.map((c) => ({ x, ...c, before: p("RULE", c.cls, c.cause), after: p(`RULE+${x}`, c.cls, c.cause) })));
const h3ok = h3pairs.filter((q) => q.after < q.before).length;
const robustAfter = (v: string) => lab.e3.closure.find((c) => c.variant === v)!.robustAfter;
const rel = (v: string) => eff(v).rel ?? NaN;

const items: Item[] = [
  { id: "H1", claim: "두 바탕 × P2·P3·P7 원인별 감소율 8개 원인 전부 > 0", observed: `최솟값 ${pc(h1min)}`, hit: h1min > 0 },
  { id: "H3", claim: "6칸 × P2·P3·P7 = 18쌍 모두 p(RULE+P) < p(RULE)", observed: `${h3ok}/18`, hit: h3ok === 18 },
  {
    id: "3.1", claim: "RULE+P2·RULE+P7·KR+P2·KR+P7 감소율 CI 하한 > 0",
    observed: ["RULE+P2", "RULE+P7", "KR_BASELINE+P2", "KR_BASELINE+P7"].map((v) => `${v} ${pc(eff(v).relCi?.lo)}`).join(", "),
    hit: ["RULE+P2", "RULE+P7", "KR_BASELINE+P2", "KR_BASELINE+P7"].every((v) => (eff(v).relCi?.lo ?? -1) > 0),
  },
  {
    id: "3.2", claim: "RULE 바탕 감소율 P2 > P7 > P3 > P1",
    observed: ["P2", "P7", "P3", "P1"].map((x) => `${x} ${pc(rel(`RULE+${x}`))}`).join(" · "),
    hit: rel("RULE+P2") > rel("RULE+P7") && rel("RULE+P7") > rel("RULE+P3") && rel("RULE+P3") > rel("RULE+P1"),
  },
  { id: "3.3", claim: "RULE+P1 감소율 −1%~+1%", observed: pc(rel("RULE+P1")), hit: Math.abs(rel("RULE+P1")) <= 0.01 },
  { id: "3.4", claim: "KR+P1 감소율 ≤ 0", observed: pc(rel("KR_BASELINE+P1")), hit: rel("KR_BASELINE+P1") <= 0 },
  {
    id: "3.5", claim: "RULE ROBUST(O2_STAT 밖): RULE+P2 ≤ 2, RULE+P7 ≤ 3", observed: `${robustAfter("RULE+P2")}, ${robustAfter("RULE+P7")}`,
    hit: robustAfter("RULE+P2") <= 2 && robustAfter("RULE+P7") <= 3,
  },
  {
    id: "3.6", claim: "두 바탕 × P2·P3·P7 최상위 10분위 감소율 > 최하위", observed: h1.map((e) => `${e.variant} ${pc(e.byEff.lo)}→${pc(e.byEff.hi)}`).join(", "),
    hit: h1.every((e) => (e.byEff.hi ?? -1) > (e.byEff.lo ?? 1)),
  },
  {
    id: "3.7", claim: "RULE+P7 최하위 10분위 ≥ 2%, 최상위 ≤ 40%", observed: `${pc(eff("RULE+P7").byEff.lo)}, ${pc(eff("RULE+P7").byEff.hi)}`,
    hit: (eff("RULE+P7").byEff.lo ?? -1) >= 0.02 && (eff("RULE+P7").byEff.hi ?? 1) <= 0.4,
  },
];
const doc = { format: "pl26-prereg-e3-score/1", tag, hit: items.filter((i) => i.hit).length, total: items.length, notTested: ["H2(P6·P8)"], items };
writeFileSync(path.join(repo, "out", `prereg_e3_score_${tag}.json`), canonicalJson(doc) + "\n", "utf-8");
for (const i of items) console.log(`${i.hit ? "○" : "×"} ${i.id} ${i.claim} — ${i.observed}`);
console.log(`E3 예측 ${doc.hit}/${doc.total} (H2 검증 안 함)`);
