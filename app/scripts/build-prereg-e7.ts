// E7 사전등록 prereg/e7.json을 쓴다(S10, prereg/predictions_e7.md). 비AI, 결정적.
// 실행: (app/에서) npx tsx scripts/build-prereg-e7.ts
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { E2_BOOT } from "../src/lib/sim/analyze";
import { E5_CAUSE } from "../src/lib/sim/e5";
import { E7_ARMS, E7_CYL_H, E7_LHS_MASTER, E7_VARIANTS } from "../src/lib/sim/e7";
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
for (const f of ["app/scripts/e7-analyze.ts", "app/scripts/sweep.ts", "app/scripts/sweep-worker.ts", "app/src/data/evidence.json", "prereg/predictions_e7.md"]) code[f] = lf(path.join(repo, f));

const doc = {
  format: "pl26-prereg-e7/1",
  status: "S10 봉인 대상. 봉인 범위 시드(8,000,001~8,901,999)를 쓰기 전에 커밋하고 OTS로 봉인한다. 비트코인 확정을 확인한 뒤 그 블록 시각 뒤의 drand 라운드로 seedLo를 정한다",
  predictions: "prereg/predictions_e7.md",
  design: {
    seeds: { lo: 8_000_001, hi: 8_901_999, rule: "seedLo = 8,000,001 + (drand quicknet 라운드 R 난수 앞 8자리 16진수 정수 mod 900,000), R = S10 스탬프를 담은 첫 비트코인 블록 시각 뒤의 첫 라운드" },
    draws: 2000, lhsMaster: E7_LHS_MASTER, cause: E5_CAUSE, scaleMult: 1, scenarios: 2000,
    nHouseholds: E1_N, stratPerClass: E1_STRAT, arms: E7_ARMS, cylH: E7_CYL_H, variants: E7_VARIANTS, bootstrap: E2_BOOT,
    p7: PATCHES.get("P7"), global: PATCH_GLOBAL,
    pilot: { lhsMaster: "E7-dev", seeds: { lo: 9_600_001, hi: 9_600_200 }, draws: 200, purpose: "설계 확정·문턱 결정(결과를 predictions_e7.md 3절에 공개). 그래서 모든 예측은 '예비·사전 분석 뒤 확인'으로 센다" },
    usageRule: "헤드라인은 10.5(같은 자원 맞춤)와 10.1(산소통만). 10.4는 '산소통이 더해진 비교' 표지 없이 싣지 않는다. AI 몫은 10.6과 10.7을 함께만 싣는다. 모든 수치에 '합성 가구 위 모의, 보급률·고장률은 가정' 표지",
  },
  codeSha256: code,
  commands: [
    "cd app && npx tsx scripts/sweep.ts E7 --tag sealed --seedLo <drand로 정한 값> --draws 2000 --master E7",
    "cd app && npx tsx scripts/e7-analyze.ts --tag sealed",
    "node tools/check-seal-order.mjs",
  ],
};
writeFileSync(path.join(repo, "prereg", "e7.json"), canonicalJson(doc) + "\n", "utf-8");
console.log("→ prereg/e7.json", Object.keys(code).length, "파일 sha256");
