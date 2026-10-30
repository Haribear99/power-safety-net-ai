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
// evidence.json은 넣지 않는다: E7은 미확인 비율을 상수로 고정해 읽지 않고(e7.ts E7_ARMS), 봉인 뒤 sync가 다시 쓰는 출력이라 해시가 깨진다(레드팀 경미 7).
// 집계·분류를 결과 뒤에 바꾸지 못하게 sync-evidence.ts와 시드 계산 스크립트를 넣는다.
for (const f of ["app/scripts/e7-analyze.ts", "app/scripts/sweep.ts", "app/scripts/sweep-worker.ts", "app/scripts/sync-evidence.ts", "tools/s10-seed.mjs", "prereg/predictions_e7.md"]) code[f] = lf(path.join(repo, f));

const doc = {
  format: "pl26-prereg-e7/1",
  status: "S10 봉인 대상. 봉인 범위 시드(8,000,001~8,901,999)를 쓰기 전에 커밋하고 OTS로 봉인한다. 비트코인 확정을 확인한 뒤 그 블록 시각 뒤의 drand 라운드로 seedLo를 정한다",
  predictions: "prereg/predictions_e7.md",
  design: {
    seeds: { lo: 8_000_001, hi: 8_901_999, rule: "tools/s10-seed.mjs: B = seal/S10.txt.ots의 비트코인 증명 중 가장 낮은 높이 블록, t = max(B의 헤더 nTime, S10 태그 커밋 시각), R = t보다 엄격히 뒤의 첫 drand quicknet 라운드(라운드 시각 = 1692803367 + (R − 1) × 3), seedLo = 8,000,001 + (R 난수 앞 8자리 16진수 정수 mod 900,000)" },
    draws: 2000, lhsMaster: E7_LHS_MASTER, cause: E5_CAUSE, scaleMult: 1, scenarios: 2000,
    nHouseholds: E1_N, stratPerClass: E1_STRAT, arms: E7_ARMS, cylH: E7_CYL_H, variants: E7_VARIANTS, bootstrap: E2_BOOT,
    p7: PATCHES.get("P7"), global: PATCH_GLOBAL,
    pilot: { lhsMaster: "E7-dev", seeds: { lo: 9_600_001, hi: 9_600_200 }, draws: 200, purpose: "설계 확정·문턱 결정(결과를 predictions_e7.md 3절에 공개). 문턱 = 예비 95% CI 하한을 1%p 단위로 내림. 모든 예측은 '예비 실행 뒤 확인'이고 다른 봉인과 따로 센다" },
    usageRule: "헤드라인은 10.5(같은 자원에서 배터리를 산소통 받은 가구에 겹쳐 주지 않기)와 10.1(산소통만). 10.4는 '산소통이 더해진 비교' 표지 없이 싣지 않는다. E7 감소율은 비AI 평시 보급 효과(AI 성과로 쓰지 않음), AI 몫은 10.6과 10.7을 함께만. 모든 수치에 '합성 가구 위 모의 · 등급 층화 등록부(인공호흡기 과대표집) · 보급률·고장률은 가정' 표지와 층화 없는 결과(10.9·10.10)를 함께",
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
