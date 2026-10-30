// 사후 집계(실패 가정 점검 10/30, 사전등록 밖): 봉인 E2 시드에서 남는 공백 가구·시간(M2S)이 어디서 나오는지 나눈다.
// 축: 정책 × 기기 분류(미등록은 UNREG) × 공백을 끝낸 주체(servedBy) × 서비스 전/후(전 = 실제 배터리가 끝난 뒤 도움이 닿기까지, 후 = 자원이 먼저 끝나 다시 생긴 공백).
// 같은 시드로 다시 돌려 M1·M2S가 봉인 값과 같은지 먼저 확인하고, 분해의 합이 M2S와 정확히 같은지(정수 초) 매 실행 확인한다.
//   npx tsx scripts/posthoc-decomp.ts   → seal/outputs/posthoc/e2_decomp.json
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { materialize } from "../src/lib/sim/materialize";
import { runScenario } from "../src/lib/sim/run";
import { e2Cells, e2Def, E2_SEEDS_PER_CELL, type E2Row } from "../src/lib/sim/sweep";

const repo = path.join(__dirname, "..", "..");
const sealed = JSON.parse(readFileSync(path.join(repo, "out", "sweeps", "E2_sealed.json"), "utf-8")) as { seedLo: number; rows: E2Row[] };
const bySeed = new Map(sealed.rows.map((r) => [r.seed, r]));
const POLS = ["RULE", "B1_SHORTEST", "B2_NEAREST", "KR_BASELINE", "NONE"] as const;
type Pol = (typeof POLS)[number];
type Acc = { runs: number; mismatch: number; sumMismatch: number; M2S: number; byClass: Record<string, number>; byServed: Record<string, number>; pre: number; post: number; byRatio: Record<string, number>; nByClass: Record<string, number> };
const acc = Object.fromEntries(POLS.map((p) => [p, { runs: 0, mismatch: 0, sumMismatch: 0, M2S: 0, byClass: {}, byServed: {}, pre: 0, post: 0, byRatio: {}, nByClass: {} }])) as Record<Pol, Acc>;
const add = (o: Record<string, number>, k: string, v: number) => { o[k] = (o[k] ?? 0) + v; };

for (const cell of e2Cells(27)) {
  for (let k = 0; k < E2_SEEDS_PER_CELL; k++) {
    const def = e2Def(cell, k, sealed.seedLo);
    const m = materialize(def).scenario;
    const ref = bySeed.get(Number(def.seed));
    if (!ref) throw new Error(`봉인 행 없음: ${def.seed}`);
    for (const p of POLS) {
      const o = runScenario(m, p).outcome;
      const a = acc[p];
      a.runs++;
      if (o.metrics.M1 !== ref.pol[p].M1 || o.metrics.M2S !== ref.pol[p].M2S) a.mismatch++;
      let sum = 0;
      for (const row of o.rows) {
        const cls = row.registered ? (m.labels[row.householdId] ?? "UNKNOWN") : "UNREG";
        const pre = Math.min(row.gapS, Math.max(0, row.tServeS - row.lTrueEndS));
        sum += row.gapS;
        add(a.nByClass, cls, 1);
        if (row.gapS === 0) continue;
        add(a.byClass, cls, row.gapS);
        add(a.byServed, row.servedBy, row.gapS);
        a.pre += pre;
        a.post += row.gapS - pre;
      }
      if (sum !== o.metrics.M2S) a.sumMismatch++;
      a.M2S += o.metrics.M2S;
      add(a.byRatio, `r${cell.hhPerResource}`, o.metrics.M2S);
    }
  }
}

const H = (s: number, runs: number) => Math.round((s / 3600 / runs) * 100) / 100; // 실행당 시간
const policies = Object.fromEntries(POLS.map((p) => {
  const a = acc[p];
  const per = (o: Record<string, number>, runs = a.runs) => Object.fromEntries(Object.entries(o).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, v]) => [k, H(v, runs)]));
  const share = Object.fromEntries(Object.entries(a.byClass).map(([k, v]) => [k, Math.round((v / a.M2S) * 1000) / 1000]));
  return [p, {
    runs: a.runs, mismatch: a.mismatch, sumMismatch: a.sumMismatch,
    gapHPerRun: H(a.M2S, a.runs),
    byClassHPerRun: per(a.byClass), byClassShare: share, householdsPerRun: per(Object.fromEntries(Object.entries(a.nByClass).map(([k, v]) => [k, v * 3600]))),
    byServedHPerRun: per(a.byServed),
    preServeHPerRun: H(a.pre, a.runs), postServeHPerRun: H(a.post, a.runs),
    byRatioHPerRun: per(a.byRatio, a.runs / 3),
  }];
}));
const out = {
  format: "pl26-e2-decomp-posthoc/1",
  note: "사후 집계(사전등록 밖, 실패 가정 점검 10/30). 봉인 E2 시드 재실행, M1·M2S 봉인 값 대조(mismatch), 분해 합 = M2S 대조(sumMismatch). 단위: 실행당 공백 가구·시간. pre = 실제 배터리 종료 뒤 도움 도달까지, post = 도움이 먼저 끝나 다시 생긴 공백",
  seedLo: sealed.seedLo, policies,
};
writeFileSync(path.join(repo, "seal", "outputs", "posthoc", "e2_decomp.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
