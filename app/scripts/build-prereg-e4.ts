// E4 사전등록 prereg/e4.json을 쓴다(S6, prereg/predictions_e4.md). 비AI, 결정적.
// 실행: (app/에서) npx tsx scripts/build-prereg-e4.ts
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { E2_BOOT } from "../src/lib/sim/analyze";
import { canonicalJson, sha256Hex } from "../src/lib/sim/materialize";
import { PATCH_GLOBAL, PATCHES } from "../src/lib/sim/patches";
import { E1_N, E1_STRAT, E3_VARIANTS, E4_CAUSE, E4_LHS_MASTER } from "../src/lib/sim/sweep";

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
for (const f of ["app/scripts/e4-analyze.ts", "app/scripts/sweep.ts", "app/scripts/sweep-worker.ts", "tools/build_empirical_quantiles.py", "datasets/external/mcee_apt_outage_press_2026-05-20.pdf"]) code[f] = f.endsWith(".pdf") ? createHash("sha256").update(readFileSync(path.join(repo, f))).digest("hex") : lf(path.join(repo, f));

const doc = {
  format: "pl26-prereg-e4/1",
  status: "SEALED S6 (2026-10-17). 보류 시드 4,000,001~4,002,000을 쓰기 전에 커밋하고 OTS로 봉인했다",
  predictions: "prereg/predictions_e4.md",
  design: {
    seeds: { lo: 4_000_001, hi: 4_002_000 }, draws: 2000, lhsMaster: E4_LHS_MASTER, cause: E4_CAUSE, scaleMult: 1, scenarios: 2000,
    nHouseholds: E1_N, stratPerClass: E1_STRAT, variants: E3_VARIANTS, bootstrap: E2_BOOT,
    patches: Object.fromEntries([...PATCHES].map(([k, v]) => [k, v])), global: PATCH_GLOBAL,
    pilot: { lhsMaster: "E4-dev", seeds: { lo: 9001, hi: 9200 }, draws: 200 },
    usageRule: "보고서·랜딩에는 VENT_1H·VENT_3H 가구 공백률(현행 → 도구 → 도구+P7)과 RULE 대 KR_BASELINE 감소율만 쓴다. 4.1이 틀리면 '실측 분포에서는 도구 단독 효과가 확인되지 않았다'로 쓴다",
  },
  codeSha256: code,
  commands: [
    "python -I tools/build_empirical_quantiles.py",
    "cd app && npx tsx scripts/sweep.ts E4 --tag sealed --seedLo 4000001 --draws 2000 --master E4",
    "cd app && npx tsx scripts/e4-analyze.ts --tag sealed",
    "node tools/check-seal-order.mjs",
  ],
};
writeFileSync(path.join(repo, "prereg", "e4.json"), canonicalJson(doc) + "\n", "utf-8");
console.log("→ prereg/e4.json", Object.keys(code).length, "파일 sha256");
