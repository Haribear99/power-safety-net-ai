// 사후 집계(실패 가정 점검 10/30, 사전등록 밖): 하한 v2(설정표 없는 기기·외장 정격 × 제조사 최악/최상 ½)가
// 과대예측(M4: 표시 하한 > 모의 실제)과 공백(M1·M2S)을 어떻게 바꾸는지 봉인 E2 시드로 v1과 나란히 잰다.
// 모의 실제(진실)는 그대로다(sweep.kSetTrue U[0.5,1]: 하한이 제조사 최악 조건 비율 ½이라 설정 소모로는 과대예측이 생길 수 없다 — 구성상 결과임을 보고에 밝힌다).
// v1 실행은 봉인 M1·M2S와 같은지 대조한다(mismatch).
//   npx tsx scripts/posthoc-lb-v2.ts   → seal/outputs/posthoc/e2_lb_v2.json
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { APP_DB, DEFAULT_DB, type EngineDb } from "../src/lib/engine/lowerBound";
import { qT } from "../src/lib/engine/quantize";
import { materialize } from "../src/lib/sim/materialize";
import { runScenario } from "../src/lib/sim/run";
import { e2Cells, e2Def, E2_SEEDS_PER_CELL, type E2Row } from "../src/lib/sim/sweep";

const repo = path.join(__dirname, "..", "..");
const sealed = JSON.parse(readFileSync(path.join(repo, "out", "sweeps", "E2_sealed.json"), "utf-8")) as { seedLo: number; rows: E2Row[] };
const bySeed = new Map(sealed.rows.map((r) => [r.seed, r]));
const POLS = ["RULE", "B2_NEAREST", "KR_BASELINE"] as const;
const DBS: Record<"v1" | "v2", EngineDb> = { v1: DEFAULT_DB, v2: APP_DB };
type Acc = { runs: number; mismatch: number; M1: number; M2S: number; hr: number; shown: number; over: number; overS: number[]; cause: Record<string, number>; perRunM2S: number[] };
const acc: Record<string, Acc> = {};
for (const v of ["v1", "v2"]) for (const p of POLS) acc[`${v}:${p}`] = { runs: 0, mismatch: 0, M1: 0, M2S: 0, hr: 0, shown: 0, over: 0, overS: [], cause: {}, perRunM2S: [] };

for (const cell of e2Cells(27)) {
  for (let k = 0; k < E2_SEEDS_PER_CELL; k++) {
    const def = e2Def(cell, k, sealed.seedLo);
    const m = materialize(def).scenario;
    const ref = bySeed.get(Number(def.seed));
    if (!ref) throw new Error(`봉인 행 없음: ${def.seed}`);
    for (const v of ["v1", "v2"] as const) {
      for (const p of POLS) {
        const res = runScenario(m, p, { db: DBS[v] });
        const o = res.outcome;
        const a = acc[`${v}:${p}`];
        a.runs++;
        if (v === "v1" && (o.metrics.M1 !== ref.pol[p].M1 || o.metrics.M2S !== ref.pol[p].M2S)) a.mismatch++;
        a.M1 += o.metrics.M1;
        a.M2S += o.metrics.M2S;
        a.perRunM2S.push(o.metrics.M2S);
        a.hr += o.rows.filter((r) => r.highRisk).length;
        for (const [id, h] of Object.entries(m.truth.hh)) {
          const L = res.households[id]?.L?.hoursS;
          if (L == null) continue;
          a.shown++;
          const d = qT(L / 3600) - h.LTrueS;
          if (d <= 0) continue;
          a.over++;
          a.overS.push(d);
          const view = m.planner.households.find((x) => x.id === id)!;
          const flags = res.households[id]?.L?.flags ?? [];
          const c = flags.includes("OPERATOR_LOWER") ? "operatorLower"
            : view.ext.some((e) => (e.opVerified?.count ?? 0) > 0) && h.extWorks.includes(false) ? "extFailed"
            : view.device.charge.source !== "unknown" && view.device.charge.value === 100 ? "charge100" : "other";
          a.cause[c] = (a.cause[c] ?? 0) + 1;
        }
      }
    }
  }
}

const q = (xs: number[], f: number) => { const s = [...xs].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : null; };
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const rows = Object.fromEntries(Object.entries(acc).map(([k, a]) => [k, {
  runs: a.runs, mismatch: a.mismatch, M1: a.M1, highRisk: a.hr, M1Rate: r3(a.M1 / a.hr), gapHPerRun: r3(a.M2S / 3600 / a.runs),
  shown: a.shown, overCount: a.over, overRate: r3(a.over / a.shown), cause: a.cause,
  overH: a.over ? { p50: r3(q(a.overS, 0.5)! / 3600), p90: r3(q(a.overS, 0.9)! / 3600), max: r3(q(a.overS, 1)! / 3600) } : null,
}]));
// 같은 시드 짝 차이(v2 − v1, 공백 시간/실행)와 부트스트랩 없이 단순 표준오차
const paired = Object.fromEntries(POLS.map((p) => {
  const d = acc[`v2:${p}`].perRunM2S.map((x, i) => (x - acc[`v1:${p}`].perRunM2S[i]) / 3600);
  const mean = d.reduce((s, x) => s + x, 0) / d.length;
  const sd = Math.sqrt(d.reduce((s, x) => s + (x - mean) ** 2, 0) / (d.length - 1));
  return [p, { meanDiffHPerRun: r3(mean), se: r3(sd / Math.sqrt(d.length)), relToV1: r3(mean / (acc[`v1:${p}`].M2S / 3600 / d.length)) }];
}));
const out = {
  format: "pl26-e2-lb-v2-posthoc/1",
  note: "사후 집계(사전등록 밖, 실패 가정 점검 10/30). 봉인 E2 시드, 진실은 그대로. v2 = lb.load.worstOverBest ½(설정표 없는 기기·외장). 진실 kSetTrue 하한이 0.5라 설정 소모 과대예측은 구성상 0 — 남는 과대예측은 노후·외장 고장·충전 입력",
  seedLo: sealed.seedLo, rows, paired,
};
writeFileSync(path.join(repo, "seal", "outputs", "posthoc", "e2_lb_v2.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
