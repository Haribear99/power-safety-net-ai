// 사전등록 prereg/sweep.json을 쓴다(spec.md 5.5절, S4 봉인본은 라운드 5). 비AI, 결정적.
// 실행: (app/에서) npx tsx scripts/build-prereg.ts
// 축·표준 θ·시드 범위·배정기 상수는 코드와 장부(spec/params.json)에서 읽어 어긋나지 않게 한다.
// 명세에만 있는 관문 값(관문 3 10%, K-DSL 70%·5건, E2 비열등 5% 등)은 spec.md 절을 함께 적는다.
// 실행할 코드(alloc·engine·sim의 시험 아닌 .ts)와 장부 JSON의 sha256도 함께 넣는다(라운드 5 #10).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pNum, pRange, pValue } from "../src/lib/engine/params";
import { AXES, axisBounds, SEED_RANGES, standardTheta } from "../src/lib/sim/lhs";
import { canonicalJson, sha256Hex } from "../src/lib/sim/materialize";
import { E1_FALSIFY_DRAWS, E1_LHS_MASTER, E1_N, E1_POLICIES, E1_STRAT, e2Cells, E2_N, E2_POLICIES, E2_SEEDS_PER_CELL } from "../src/lib/sim/sweep";
import { E2_BOOT } from "../src/lib/sim/analyze";

const repo = path.resolve(__dirname, "..", "..");
const app = path.join(repo, "app");
/** 봉인할 코드·장부: 경로(저장소 기준, / 구분) → sha256(줄바꿈 LF로 맞춘 UTF-8) */
function codeHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (abs: string) => {
    const rel = path.relative(repo, abs).split(path.sep).join("/");
    out[rel] = sha256Hex(readFileSync(abs, "utf-8").split("\r\n").join("\n"));
  };
  for (const dir of ["alloc", "engine", "sim"]) {
    const d = path.join(app, "src", "lib", dir);
    for (const f of readdirSync(d).sort()) if ((f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.startsWith("test-")) || f.endsWith(".json")) add(path.join(d, f));
  }
  for (const f of ["device_db.json", "ext_db.json", "params.json", "resources_mock.json", "restoration_quantiles.json"]) add(path.join(repo, "spec", f));
  return out;
}
const doc = {
  format: "pl26-prereg-sweep/2",
  status: "SEALED S4 (라운드 5, 2026-10-17). 이 파일과 prereg/predictions.md는 E1·E2 전용 시드를 쓰기 전에 커밋하고 OTS로 봉인했다",
  headline: "RULE 대 KR_BASELINE(현행 공개 절차) + E1 ROBUST 빈틈(spec.md 끝 '반영 기록 (라운드 5)')",
  axes: Object.fromEntries(AXES.map(([k, a]) => [k, { kind: a.kind, paramKey: "paramKey" in a ? a.paramKey : null, bounds: axisBounds(a) }])),
  standardTheta: standardTheta(),
  seedRanges: SEED_RANGES,
  experiments: {
    E1: {
      spec: "5.4절 + 라운드 5 #5·#6", draws: 4000, lhsMaster: E1_LHS_MASTER, seedRule: "seed = 2000001 + d, scenarioId = E1-<d>-<원인>", causes: 8,
      nHouseholds: E1_N, stratPerClass: E1_STRAT, labelPolicy: "KR_BASELINE", policies: E1_POLICIES,
      indicator: "추첨마다 그 등급 등록 가구의 과반(> n/2)이 G>0", falsifyDraws: E1_FALSIFY_DRAWS, falsifyVariants: "19축 × {lo, hi}, 같은 시나리오 id·시드",
      table: ["gamma", "lognormal(안정성 시험, 강등 전 표지끼리 비교)"], physicalZero: ["O2_STAT"],
    },
    E2: {
      spec: "5.4절 + 라운드 5 #1·#3·#4", cells: e2Cells(27), pairedSeedsPerCell: E2_SEEDS_PER_CELL, nHouseholds: E2_N,
      seedRule: "seed = 3000001 + 칸 번호 × 200 + k", otherAxes: "표준 θ", causes: "rngFor(seed, 'E2-cause', LHS)로 7종(ROTATING 제외) 균등",
      policies: E2_POLICIES, headlineComparator: "KR_BASELINE", bootstrap: { reps: E2_BOOT, stat: "M2 짝 차이(RULE − 비교) 평균, 백분위 95% CI", stream: "BOOT=10" },
      relReduction: "1 − ΣM2(RULE)/ΣM2(비교), 같은 재표본의 CI",
    },
  },
  thresholds: {
    gate2: { robustCountMin: 1, robustExcludes: ["O2_STAT"], superiorVsKrMinCells: 18, ofCells: 27, spec: "라운드 5 #7", fallback: "12.3절 대체안" },
    gate3: { value: 0.10, spec: "5.5절" },
    kDeg: { fail: "필요 가구가 있는 등급 중 PROPOSE_ASSIGN+GAP_REDUCE 비율이 0인 등급이 1개 이상", standardTheta: "params standardTheta", spec: "9절" },
    kDsl: { machineReadableProbeAgreement: 0.7, minDocs: 5, spec: "7.3절" },
    kPatch: { rule: "보류 시드 주 지표가 무작위 기준선 비율보다 높지 않거나 20% 미만이면 강등", spec: "7.4절" },
    e2: { nonInferiorLossRate: 0.05, superior: "승률 > 패배율 ∧ M2 짝 차이 95% CI 상한 < 0", P1: "B1·B2 둘 다 우세", P2: "하나에라도 열등", P0: "나머지", spec: "5.4절" },
    e1Labels: { robustWilsonLo: 0.9, conditional: "CI ⊂ [0.3, 0.9]", fragileWilsonHi: 0.3, robustRequiresPEarlyHi: true, spec: "5.4절" },
    stabilityFail: "원래 ROBUST 칸(무배터리 산소 제외)이 로그정규 대안 표에서 전부 뒤집힘",
    primaryMetrics: ["M1", "M2"],
    orderKey: ["tier", "slack"],
    allocator: {
      sigmaEMax: pNum("alloc.hold.sigmaEMax"),
      hNeedH: pRange("alloc.hNeedH"),
      deltaMinH: pNum("alloc.deltaMinH"),
      arrivalFactor: pNum("alloc.arrivalFactor"),
      outputFactor: pNum("alloc.outputFactor"),
      mrHoldH: pNum("alloc.mrHoldH"),
      mrReserveCap: pNum("alloc.mrReserveCap"),
      reserveConstraint2: "tier 0 ∧ slack < mrHoldH 가구의 유일한 phys 자원은 예약하지 않는다(4.1절)",
    },
    sim: {
      operatorLowerRangeH: pRange("sim.operatorLowerRangeH"),
      reportDelayH: pRange("sim.reportDelayH"),
      pEarly: pRange("sweep.pEarly"),
      standardTheta: pValue("standardTheta"),
    },
  },
  codeSha256: codeHashes(),
  commands: [
    "cd app && npx tsx scripts/sweep.ts E1 --tag sealed --seedLo 2000001 --draws 4000 --master E1 --falsify 500 --lognormal",
    "cd app && npx tsx scripts/sweep.ts E2 --tag sealed --seedLo 3000001 --cells 27",
    "cd app && npx tsx scripts/lab-analyze.ts --tag sealed",
    "node tools/check-seal-order.mjs",
  ],
};
mkdirSync(path.join(repo, "prereg"), { recursive: true });
const out = path.join(repo, "prereg", "sweep.json");
writeFileSync(out, canonicalJson(doc) + "\n", "utf-8");
console.log(`→ ${out}`);
