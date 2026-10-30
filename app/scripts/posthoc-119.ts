// 사후 민감도(실패 가정 점검 10/30, 사전등록 밖): 119 도착 가정(10~30분 × 지연 배수 1~4)을 소방청 「전국 구급 현황」 실측 분포로 바꾸면
// 봉인 E2 시드의 공백(M2S)과 도구 대 현행·단순 규칙 비교가 어떻게 바뀌는가.
// - 진실 A_119: 같은 가구의 원래 균등값 u(= (A/배수 − lo)/(hi − lo))를 실측 분위 격자(1%)에 넣어 공통 난수를 유지한다. 배수는 1(평시).
// - 계획 A_119: lanes.a119H = {실측 10%, 실측 90%}, 배수 1.
// - 119 처리 용량(k119PerH)·이송 시간(0.33h)은 그대로(실측 자료에 없음).
// 실측은 평시 값이라 대규모 정전의 수요 폭증을 담지 않는다 — 이 결과는 '가정이 실측 평시보다 얼마나 비관적인가'의 크기만 보여 준다.
//   npx tsx scripts/posthoc-119.ts [연도=2025] [묶음=ALL]   → seal/outputs/posthoc/e2_119_empirical.json
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { qT } from "../src/lib/engine/quantize";
import { materialize, type MaterializedScenario } from "../src/lib/sim/materialize";
import { runScenario } from "../src/lib/sim/run";
import { e2Cells, e2Def, E2_SEEDS_PER_CELL, type E2Row } from "../src/lib/sim/sweep";

const repo = path.join(__dirname, "..", "..");
const year = process.argv[2] ?? "2025", group = process.argv[3] ?? "ALL";
const emp = JSON.parse(readFileSync(path.join(repo, "spec", "arrival_119_empirical.json"), "utf-8")) as { years: Record<string, { sha256: string; groups: Record<string, { callToScene: { n: number; grid1pct: number[] } }> }> };
const grid = emp.years[year].groups[group].callToScene.grid1pct;
if (grid.length !== 101) throw new Error("grid1pct 101칸 필요(tools/build_119_arrival.py 다시 실행)");
/** 실측 분위(분): u ∈ [0,1], 1% 격자 선형 보간 */
const Q = (u: number) => { const x = Math.min(100, Math.max(0, u * 100)), i = Math.min(99, Math.floor(x)); return grid[i] + (grid[i + 1] - grid[i]) * (x - i); };

const sealed = JSON.parse(readFileSync(path.join(repo, "out", "sweeps", "E2_sealed.json"), "utf-8")) as { seedLo: number; rows: E2Row[] };
const bySeed = new Map(sealed.rows.map((r) => [r.seed, r]));
const POLS = ["RULE", "B2_NEAREST", "KR_BASELINE"] as const;

function withEmpirical119(m: MaterializedScenario): MaterializedScenario {
  const { lo, hi } = m.planner.lanes.a119H, s = m.sim.stress119;
  const a119TrueS: Record<string, number> = {};
  for (const [id, a] of Object.entries(m.truth.a119TrueS)) {
    const u = hi > lo ? Math.min(1, Math.max(0, (a / 3600 / s - lo) / (hi - lo))) : 0.5;
    a119TrueS[id] = qT(Q(u) / 60);
  }
  return {
    ...m,
    sim: { ...m.sim, stress119: 1 },
    planner: { ...m.planner, lanes: { ...m.planner.lanes, a119H: { lo: Math.round((Q(0.1) / 60) * 1e6) / 1e6, hi: Math.round((Q(0.9) / 60) * 1e6) / 1e6 } } },
    truth: { ...m.truth, a119TrueS },
  };
}

type Acc = { M2S: number; M1: number; hr: number; mismatch: number; served: Record<string, number>; per: number[] };
const acc: Record<string, Acc> = {};
for (const v of ["assumed", "empirical"]) for (const p of POLS) acc[`${v}:${p}`] = { M2S: 0, M1: 0, hr: 0, mismatch: 0, served: {}, per: [] };
let runs = 0;
for (const cell of e2Cells(27)) {
  for (let k = 0; k < E2_SEEDS_PER_CELL; k++) {
    const def = e2Def(cell, k, sealed.seedLo);
    const m0 = materialize(def).scenario;
    const ref = bySeed.get(Number(def.seed));
    if (!ref) throw new Error(`봉인 행 없음: ${def.seed}`);
    const m1 = withEmpirical119(m0);
    for (const [v, m] of [["assumed", m0], ["empirical", m1]] as const) {
      for (const p of POLS) {
        const o = runScenario(m, p).outcome;
        const a = acc[`${v}:${p}`];
        if (v === "assumed" && (o.metrics.M1 !== ref.pol[p].M1 || o.metrics.M2S !== ref.pol[p].M2S)) a.mismatch++;
        a.M2S += o.metrics.M2S; a.M1 += o.metrics.M1; a.per.push(o.metrics.M2S);
        a.hr += o.rows.filter((r) => r.highRisk).length;
        for (const r of o.rows) if (r.gapS > 0) a.served[r.servedBy] = (a.served[r.servedBy] ?? 0) + r.gapS;
      }
    }
    runs++;
  }
}
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const H = (s: number) => r3(s / 3600 / runs);
const rel = (b: string, v: string) => r3(1 - acc[v].M2S / acc[b].M2S);
const out = {
  format: "pl26-e2-119-empirical-posthoc/1",
  note: "사후 민감도(사전등록 밖). 봉인 E2 시드, 119 도착만 소방청 실측(평시, 배수 1)으로 바꿈. 공통 난수(같은 u). 처리 용량·이송은 그대로. 실측은 대규모 정전의 수요 폭증을 담지 않는다",
  source: { file: "spec/arrival_119_empirical.json", year, group, rawSha256: emp.years[year].sha256, n: emp.years[year].groups[group].callToScene.n, p50Min: Q(0.5), p90Min: Q(0.9) },
  runs,
  rows: Object.fromEntries(Object.entries(acc).map(([k, a]) => [k, { gapHPerRun: H(a.M2S), M1Rate: r3(a.M1 / a.hr), mismatch: a.mismatch, byServedHPerRun: Object.fromEntries(Object.entries(a.served).map(([s, x]) => [s, H(x)])) }])),
  compare: {
    assumed: { toolVsKr: rel("assumed:KR_BASELINE", "assumed:RULE"), toolVsNearest: rel("assumed:B2_NEAREST", "assumed:RULE") },
    empirical: { toolVsKr: rel("empirical:KR_BASELINE", "empirical:RULE"), toolVsNearest: rel("empirical:B2_NEAREST", "empirical:RULE") },
  },
};
writeFileSync(path.join(repo, "seal", "outputs", "posthoc", "e2_119_empirical.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
