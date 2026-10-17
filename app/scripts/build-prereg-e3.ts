// E3 사전등록 prereg/e3.json을 쓴다(S5, spec.md 끝 '반영 기록 (라운드 6)'). 비AI, 결정적.
// 실행: (app/에서) npx tsx scripts/build-prereg-e3.ts
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { E2_BOOT } from "../src/lib/sim/analyze";
import { canonicalJson, sha256Hex } from "../src/lib/sim/materialize";
import { PATCH_GLOBAL, PATCHES } from "../src/lib/sim/patches";
import { E1_N, E1_STRAT, E3_LHS_MASTER, E3_VARIANTS } from "../src/lib/sim/sweep";

const repo = path.resolve(__dirname, "..", "..");
const lf = (p: string) => sha256Hex(readFileSync(p, "utf-8").split("\r\n").join("\n"));
const code: Record<string, string> = {};
for (const dir of ["alloc", "engine", "sim"]) {
  const d = path.join(repo, "app", "src", "lib", dir);
  for (const f of readdirSync(d).sort()) {
    if ((f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.startsWith("test-")) || f.endsWith(".json")) code[`app/src/lib/${dir}/${f}`] = lf(path.join(d, f));
  }
}
for (const f of ["device_db.json", "ext_db.json", "params.json", "resources_mock.json", "restoration_quantiles.json", "patches.json"]) code[`spec/${f}`] = lf(path.join(repo, "spec", f));

const doc = {
  format: "pl26-prereg-e3/1",
  status: "SEALED S5 (라운드 6, 2026-10-17). 보류 시드 1,000,001~1,001,000을 쓰기 전에 커밋하고 OTS로 봉인했다",
  predictions: "prereg/predictions_e3.md",
  design: {
    seeds: { lo: 1_000_001, hi: 1_001_000 }, draws: 1000, lhsMaster: E3_LHS_MASTER, causes: 8, scenarios: 8000,
    nHouseholds: E1_N, stratPerClass: E1_STRAT, variants: E3_VARIANTS, bootstrap: E2_BOOT,
    patches: Object.fromEntries([...PATCHES].map(([k, v]) => [k, v])), global: PATCH_GLOBAL,
    closingRule: "끝 카드는 RULE+P7만, [lo]·[hi] = 실효 보급률 최하위·최상위 10분위 감소율, [lo] ≤ 0이면 문장 없음",
  },
  codeSha256: code,
  commands: [
    "cd app && npx tsx scripts/sweep.ts E3 --tag sealed --seedLo 1000001 --draws 1000 --master E3",
    "cd app && npx tsx scripts/lab-analyze.ts --tag sealed",
    "cd app && npx tsx scripts/score-prereg-e3.ts --tag sealed",
    "node tools/check-seal-order.mjs",
  ],
};
writeFileSync(path.join(repo, "prereg", "e3.json"), canonicalJson(doc) + "\n", "utf-8");
console.log("→ prereg/e3.json", Object.keys(code).length, "파일 sha256");
