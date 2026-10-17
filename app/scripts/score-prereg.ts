// 사전등록 예측 채점 (prereg/predictions.md 1·2·4절). out/lab_<tag>.json → out/prereg_score_<tag>.json. 비AI, 결정적.
// 실행 (app/에서): npx tsx scripts/score-prereg.ts --tag sealed
// 규칙은 predictions.md 표의 '맞힘 규칙'·'예측' 열을 그대로 코드로 옮겼다. 결과는 맞힘·틀림을 모두 싣는다.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { E1Cell, E2CellResult } from "../src/lib/sim/analyze";
import { canonicalJson } from "../src/lib/sim/materialize";

const repo = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const tag = argv[argv.indexOf("--tag") + 1] ?? "sealed";
const lab = JSON.parse(readFileSync(path.join(repo, "out", `lab_${tag}.json`), "utf-8")) as {
  e1: { cells: E1Cell[]; stability: { pass: boolean; flipped: unknown[] } };
  e2: { cells: E2CellResult[]; pooled: E2CellResult };
};

const CAUSES = ["KEPCO_DIST", "APT_SHORT", "APT_NIGHT_XFMR", "APT_PARTS", "APT_FIRE", "TYPHOON_WEAK", "TYPHOON_STRONG", "ROTATING"];
const NON_ROT = CAUSES.filter((c) => c !== "ROTATING");
const APT_LONG = ["APT_NIGHT_XFMR", "APT_PARTS", "APT_FIRE"];
const lab1 = (pol: string, cls: string, cause: string) => lab.e1.cells.find((c) => c.policy === pol && c.cls === cls && c.cause === cause)?.label;
const kr = (cls: string, cause: string) => lab1("KR_BASELINE", cls, cause);
const countKr = (cls: string, causes: string[], label: string) => causes.filter((c) => kr(cls, c) === label).length;
const robustSet = (pol: string) => lab.e1.cells.filter((c) => c.policy === pol && c.label === "ROBUST" && !c.physicalZero);
const SIX = ["VENT_1H", "VENT_3H"].flatMap((cls) => APT_LONG.map((cause) => ({ cls, cause })));
const has = (set: E1Cell[], x: { cls: string; cause: string }) => set.some((c) => c.cls === x.cls && c.cause === x.cause);

const e2 = lab.e2.cells;
const vsKr = e2.map((c) => c.compares.KR_BASELINE);
const rel = vsKr.map((c) => c.relReduction ?? NaN);
const ratioOf = (id: string) => Number(/-r([\d.]+)-/.exec(id)![1]);
const meanRel = (r: number) => {
  const xs = e2.filter((c) => ratioOf(c.cell) === r).map((c) => c.compares.KR_BASELINE.relReduction ?? NaN);
  return xs.reduce((s, v) => s + v, 0) / xs.length;
};
const P = (k: string) => e2.filter((c) => c.pClass === k).length;
const pooled = lab.e2.pooled.compares;
const superior = vsKr.filter((c) => c.verdict === "SUPERIOR").length;

type Item = { id: string; claim: string; observed: string; hit: boolean };
const items: Item[] = [
  { id: "1.1", claim: "O2_STAT 8개 원인 중 7개 이상 ROBUST", observed: `${countKr("O2_STAT", CAUSES, "ROBUST")}/8`, hit: countKr("O2_STAT", CAUSES, "ROBUST") >= 7 },
  {
    id: "1.2", claim: "O2_STAT_CYL ROBUST 0개, ROTATING 밖 7개 중 4개 이상 CONDITIONAL",
    observed: `ROBUST ${countKr("O2_STAT_CYL", CAUSES, "ROBUST")}, CONDITIONAL ${countKr("O2_STAT_CYL", NON_ROT, "CONDITIONAL")}/7`,
    hit: countKr("O2_STAT_CYL", CAUSES, "ROBUST") === 0 && countKr("O2_STAT_CYL", NON_ROT, "CONDITIONAL") >= 4,
  },
  { id: "1.3", claim: "VENT_1H 8개 원인 중 5개 이상 ROBUST", observed: `${countKr("VENT_1H", CAUSES, "ROBUST")}/8`, hit: countKr("VENT_1H", CAUSES, "ROBUST") >= 5 },
  { id: "1.4", claim: "VENT_3H 아파트 장기 3원인 모두 ROBUST", observed: `${countKr("VENT_3H", APT_LONG, "ROBUST")}/3`, hit: countKr("VENT_3H", APT_LONG, "ROBUST") === 3 },
  { id: "1.5", claim: "O2_PORT ROTATING 밖 7개 중 4개 이상 CONDITIONAL", observed: `${countKr("O2_PORT", NON_ROT, "CONDITIONAL")}/7`, hit: countKr("O2_PORT", NON_ROT, "CONDITIONAL") >= 4 },
  {
    id: "1.6", claim: "VENT_8H APT_PARTS·APT_FIRE ROBUST, KEPCO_DIST·APT_SHORT ROBUST 아님",
    observed: ["APT_PARTS", "APT_FIRE", "KEPCO_DIST", "APT_SHORT"].map((c) => `${c} ${kr("VENT_8H", c)}`).join(", "),
    hit: kr("VENT_8H", "APT_PARTS") === "ROBUST" && kr("VENT_8H", "APT_FIRE") === "ROBUST" && kr("VENT_8H", "KEPCO_DIST") !== "ROBUST" && kr("VENT_8H", "APT_SHORT") !== "ROBUST",
  },
  {
    id: "1.7", claim: "VENT_8H_EXT2 ROBUST 0개, 8개 중 4개 이상 FRAGILE",
    observed: `ROBUST ${countKr("VENT_8H_EXT2", CAUSES, "ROBUST")}, FRAGILE ${countKr("VENT_8H_EXT2", CAUSES, "FRAGILE")}/8`,
    hit: countKr("VENT_8H_EXT2", CAUSES, "ROBUST") === 0 && countKr("VENT_8H_EXT2", CAUSES, "FRAGILE") >= 4,
  },
  { id: "2.1", claim: "KR보다 우세 칸 27칸 중 25칸 이상", observed: `${superior}/27`, hit: superior >= 25 },
  {
    id: "2.2", claim: "합산 M2 상대 감소율 12~18%", observed: `${(100 * (pooled.KR_BASELINE.relReduction ?? NaN)).toFixed(2)}%`,
    hit: (pooled.KR_BASELINE.relReduction ?? -1) >= 0.12 && (pooled.KR_BASELINE.relReduction ?? 1) <= 0.18,
  },
  {
    id: "2.3", claim: "칸별 감소율 최소 ≥3%, 최대 ≤30%, 비 1.5 평균 > 비 6 평균",
    observed: `${(100 * Math.min(...rel)).toFixed(1)}%~${(100 * Math.max(...rel)).toFixed(1)}%, 비1.5 ${(100 * meanRel(1.5)).toFixed(1)}% · 비6 ${(100 * meanRel(6)).toFixed(1)}%`,
    hit: Math.min(...rel) >= 0.03 && Math.max(...rel) <= 0.3 && meanRel(1.5) > meanRel(6),
  },
  { id: "2.4", claim: "[P1] ≤2, [P2] ≤4, [P0] ≥21", observed: `P1 ${P("P1")} · P0 ${P("P0")} · P2 ${P("P2")}`, hit: P("P1") <= 2 && P("P2") <= 4 && P("P0") >= 21 },
  {
    id: "2.5", claim: "합산 M1에서 RULE 패 > RULE 승(대 B2_NEAREST)", observed: `${pooled.B2_NEAREST.win}승 ${pooled.B2_NEAREST.loss}패`,
    hit: pooled.B2_NEAREST.loss > pooled.B2_NEAREST.win,
  },
  {
    id: "2.6", claim: "RULE_NO_R와 합산 M2 차이 ±0.5% 안", observed: `${(100 * (pooled.RULE_NO_R.relReduction ?? NaN)).toFixed(2)}%`,
    hit: Math.abs(pooled.RULE_NO_R.relReduction ?? 1) <= 0.005,
  },
  {
    id: "2.7", claim: "정보 상한 몫 ≥85%", observed: `${(100 * (lab.e2.pooled.oracleCapture ?? NaN)).toFixed(1)}%`,
    hit: (lab.e2.pooled.oracleCapture ?? 0) >= 0.85,
  },
  {
    id: "2.8", claim: "KR ROBUST(O2_STAT 밖) 8~16칸, VENT_1H·VENT_3H × 아파트 장기 6칸 포함",
    observed: `${robustSet("KR_BASELINE").length}칸, 6칸 중 ${SIX.filter((x) => has(robustSet("KR_BASELINE"), x)).length}칸 포함`,
    hit: robustSet("KR_BASELINE").length >= 8 && robustSet("KR_BASELINE").length <= 16 && SIX.every((x) => has(robustSet("KR_BASELINE"), x)),
  },
  {
    id: "2.9", claim: "RULE 표지에서도 6칸 모두 ROBUST", observed: `6칸 중 ${SIX.filter((x) => has(robustSet("RULE"), x)).length}칸`,
    hit: SIX.every((x) => has(robustSet("RULE"), x)),
  },
  {
    id: "2.10", claim: "KR: KEPCO_DIST·APT_SHORT 열에 O2_STAT 밖 ROBUST 없음",
    observed: robustSet("KR_BASELINE").filter((c) => c.cause === "KEPCO_DIST" || c.cause === "APT_SHORT").map((c) => `${c.cls}×${c.cause}`).join(", ") || "없음",
    hit: !robustSet("KR_BASELINE").some((c) => c.cause === "KEPCO_DIST" || c.cause === "APT_SHORT"),
  },
  {
    id: "2.11", claim: "안정성 통과, 바뀐 칸 ≤12", observed: `${lab.e1.stability.pass ? "통과" : "실패"}, ${lab.e1.stability.flipped.length}칸`,
    hit: lab.e1.stability.pass && lab.e1.stability.flipped.length <= 12,
  },
  {
    id: "2.12", claim: "RULE ROBUST 칸 수 ≤ KR ROBUST 칸 수(O2_STAT 밖)", observed: `${robustSet("RULE").length} ≤ ${robustSet("KR_BASELINE").length}`,
    hit: robustSet("RULE").length <= robustSet("KR_BASELINE").length,
  },
];

const gateA = robustSet("KR_BASELINE").length >= 1;
const gateB = superior >= 18;
const sec = (p: string) => items.filter((i) => i.id.startsWith(p));
const doc = {
  format: "pl26-prereg-score/1", tag,
  section1: { hit: sec("1.").filter((i) => i.hit).length, total: sec("1.").length },
  section2: { hit: sec("2.").filter((i) => i.hit).length, total: sec("2.").length },
  items,
  gate2: { a: gateA, b: gateB, pass: gateA && gateB, superiorVsKr: superior, robustKr: robustSet("KR_BASELINE").length },
};
writeFileSync(path.join(repo, "out", `prereg_score_${tag}.json`), canonicalJson(doc) + "\n", "utf-8");
for (const i of items) console.log(`${i.hit ? "○" : "×"} ${i.id} ${i.claim} — ${i.observed}`);
console.log(`1절 ${doc.section1.hit}/${doc.section1.total}, 2절 ${doc.section2.hit}/${doc.section2.total}, 관문 2 ${doc.gate2.pass ? "통과" : "실패"}(a ${gateA}, b ${gateB})`);
