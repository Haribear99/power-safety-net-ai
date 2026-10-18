// 사후 집계(통합 레드팀 8라운드): 원안 KPI '과대예측 0건'에 해당하는 M4(표시 배터리 하한 > 실제 L)를 봉인 E2 시드로 다시 센다.
// 봉인 산출물(out/sweeps/E2_sealed.json)에는 M1·M2S만 남아 있어, 같은 시드로 다시 돌리고 M1·M2S가 봉인 값과 같은지 먼저 확인한다.
// 사전등록하지 않은 지표라 '사후 집계'로만 보고한다.
//   npx tsx scripts/e2-m4.ts   → seal/outputs/posthoc/e2_m4_posthoc.json
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { materialize } from "../src/lib/sim/materialize";
import { runScenario } from "../src/lib/sim/run";
import { e2Cells, e2Def, E2_SEEDS_PER_CELL, type E2Row } from "../src/lib/sim/sweep";
import { qT } from "../src/lib/engine/quantize";

const repo = path.join(__dirname, "..", "..");
const sealed = JSON.parse(readFileSync(path.join(repo, "out", "sweeps", "E2_sealed.json"), "utf-8")) as { seedLo: number; rows: E2Row[] };
const bySeed = new Map(sealed.rows.map((r) => [r.seed, r]));
const POLS = ["RULE", "KR_BASELINE"] as const;
const acc = Object.fromEntries(POLS.map((p) => [p, { M4: 0, registered: 0, shown: 0, runsWithM4: 0, mismatch: 0, overS: [] as number[], cause: { operatorLower: 0, extFailed: 0, charge100: 0, other: 0 } }])) as Record<(typeof POLS)[number], { M4: number; registered: number; shown: number; runsWithM4: number; mismatch: number; overS: number[]; cause: Record<"operatorLower" | "extFailed" | "charge100" | "other", number> }>;
let runs = 0;
for (const cell of e2Cells(27)) {
  for (let k = 0; k < E2_SEEDS_PER_CELL; k++) {
    const def = e2Def(cell, k, sealed.seedLo);
    const m = materialize(def).scenario;
    const ref = bySeed.get(Number(def.seed));
    if (!ref) throw new Error(`봉인 행 없음: ${def.seed}`);
    for (const p of POLS) {
      const res = runScenario(m, p);
      const o = res.outcome;
      const a = acc[p];
      if (o.metrics.M1 !== ref.pol[p].M1 || o.metrics.M2S !== ref.pol[p].M2S) a.mismatch++;
      a.M4 += o.metrics.M4;
      if (o.metrics.M4 > 0) a.runsWithM4++;
      // 분모: 등록 가구 수(표시 하한이 없는 수동검토 가구도 포함하므로 보수적 분모가 아니라 참고값)
      a.registered += o.rows.filter((r) => (r as { overPredicted: boolean; registered: boolean }).registered).length;
      // 표시 하한이 있는 등록 가구와 과대예측 폭(표시 − 실제, 초)
      for (const [id, h] of Object.entries(m.truth.hh)) {
        const L = res.households[id]?.L?.hoursS;
        if (L == null) continue;
        a.shown++;
        const d = qT(L / 3600) - h.LTrueS;
        if (d > 0) {
          a.overS.push(d);
          // 원인 분류(먼저 맞는 것 하나): 운영자 입력 하한(수동검토 재진입) → 확인 외장 고장 → 입력 충전량 100%(과대입력 주입 포함) → 그 밖(노후·설정 등)
          const v = m.planner.households.find((x) => x.id === id)!;
          const flags = res.households[id]?.L?.flags ?? [];
          if (flags.includes("OPERATOR_LOWER")) a.cause.operatorLower++;
          else if (v.ext.some((e) => (e.opVerified?.count ?? 0) > 0) && h.extWorks.includes(false)) a.cause.extFailed++;
          else if (v.device.charge.source !== "unknown" && v.device.charge.value === 100) a.cause.charge100++;
          else a.cause.other++;
        }
      }
    }
    runs++;
  }
}
const q = (xs: number[], f: number) => { const s = [...xs].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : null; };
const policies = Object.fromEntries(Object.entries(acc).map(([p, a]) => [p, { M4: a.M4, registered: a.registered, shown: a.shown, overCount: a.overS.length, cause: a.cause, runsWithM4: a.runsWithM4, mismatch: a.mismatch, overH: { p50: q(a.overS, 0.5)! / 3600, p90: q(a.overS, 0.9)! / 3600, max: q(a.overS, 1)! / 3600 } }]));
const out = { format: "pl26-e2-m4-posthoc/2", note: "사후 집계(사전등록 밖). 봉인 E2 시드 재실행, M1·M2S 봉인 값 대조. overH = 과대예측 폭(시간)", seedLo: sealed.seedLo, runs, policies };
writeFileSync(path.join(repo, "seal", "outputs", "posthoc", "e2_m4_posthoc.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
