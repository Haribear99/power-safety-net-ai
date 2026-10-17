// E6 사전등록 prereg/e6.json을 쓴다(S8, prereg/predictions_e6.md). 비AI, 결정적.
// 실행: (app/에서) npx tsx scripts/build-prereg-e6.ts
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { E2_BOOT } from "../src/lib/sim/analyze";
import { E5_ARMS, E5_CAUSE } from "../src/lib/sim/e5";
import { E6_LHS_MASTER, E6_VARIANTS } from "../src/lib/sim/e6";
import { canonicalJson, sha256Hex } from "../src/lib/sim/materialize";
import { PATCH_GLOBAL, PATCHES } from "../src/lib/sim/patches";
import { E1_N, E1_STRAT } from "../src/lib/sim/sweep";

const repo = path.resolve(__dirname, "..", "..");
const lf = (p: string) => sha256Hex(readFileSync(p, "utf-8").split("\r\n").join("\n"));
const code: Record<string, string> = {};
for (const dir of ["alloc", "engine", "sim"]) {
  const d = path.join(repo, "app", "src", "lib", dir);
  for (const f of readdirSync(d).sort()) {
    if ((f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.startsWith("test-")) || f.endsWith(".json")) code[`app/src/lib/${dir}/${f}`] = lf(path.join(d, f));
  }
}
for (const f of ["device_db.json", "ext_db.json", "params.json", "resources_mock.json", "restoration_quantiles.json", "restoration_empirical.json", "patches.json"]) code[`spec/${f}`] = lf(path.join(repo, "spec", f));
for (const f of ["app/scripts/e6-analyze.ts", "app/scripts/sweep.ts", "app/scripts/sweep-worker.ts", "app/src/data/evidence.json"]) code[f] = lf(path.join(repo, f));

const doc = {
  format: "pl26-prereg-e6/1",
  status: "SEALED S8 (2026-10-18). 보류 시드 6,000,001~6,002,000을 쓰기 전에 커밋하고 OTS로 봉인한다",
  predictions: "prereg/predictions_e6.md",
  design: {
    seeds: { lo: 6_000_001, hi: 6_002_000 }, draws: 2000, lhsMaster: E6_LHS_MASTER, cause: E5_CAUSE, scaleMult: 1, scenarios: 2000,
    nHouseholds: E1_N, stratPerClass: E1_STRAT, arms: { AI: E5_ARMS.AI }, variants: E6_VARIANTS, bootstrap: E2_BOOT,
    p7: PATCHES.get("P7"), global: PATCH_GLOBAL,
    pilot: { lhsMaster: "E6-dev", seeds: { lo: 9801, hi: 10000 }, draws: 200, purpose: "버그 확인만. 예비 실행 뒤 예측을 더하지 않는다" },
    usageRule: "보고서·랜딩에는 7.1 감소율(P7P 대 P7), P7→P7P의 VENT_1H 비율, 공백 비율이 나빠진 등급 목록만 싣는다. P7T 값은 낙관 상한 표지 없이 싣지 않는다. 7.1이 틀리면 평시 정보로는 이득이 확인되지 않음으로 쓴다",
  },
  codeSha256: code,
  commands: [
    "cd app && npx tsx scripts/sweep.ts E6 --tag sealed --seedLo 6000001 --draws 2000 --master E6",
    "cd app && npx tsx scripts/e6-analyze.ts --tag sealed",
    "node tools/check-seal-order.mjs",
  ],
};
writeFileSync(path.join(repo, "prereg", "e6.json"), canonicalJson(doc) + "\n", "utf-8");
console.log("→ prereg/e6.json", Object.keys(code).length, "파일 sha256");
