// 사전등록 sweep.json 초안을 prereg/sweep.json에 쓴다(spec.md 5.5절, S4에서 확정·봉인). 비AI, 결정적.
// 실행: (app/에서) npx tsx scripts/build-prereg-stub.ts
// 축·표준 θ·시드 범위·배정기 상수는 코드와 장부(spec/params.json)에서 읽어 어긋나지 않게 한다.
// 명세에만 있는 관문 값(관문 3 10%, K-DSL 70%·5건, E2 비열등 5% 등)은 spec.md 절을 함께 적는다. 실험 실행기는 아직 없다.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pNum, pRange, pValue } from "../src/lib/engine/params";
import { AXES, axisBounds, SEED_RANGES, standardTheta } from "../src/lib/sim/lhs";
import { canonicalJson } from "../src/lib/sim/materialize";

const repo = path.resolve(__dirname, "..", "..");
const doc = {
  format: "pl26-prereg-sweep/1",
  status: "STUB — S4 봉인 전 확정할 초안. TASK C가 축·표준 θ·시드 범위·장부 상수만 채웠다. null 칸은 S4 전에 사람이 정한다",
  axes: Object.fromEntries(AXES.map(([k, a]) => [k, { kind: a.kind, paramKey: "paramKey" in a ? a.paramKey : null, bounds: axisBounds(a) }])),
  standardTheta: standardTheta(),
  seedRanges: SEED_RANGES,
  experiments: {
    E1: { spec: "5.4절", draws: 1000, causes: 8, nHouseholds: 60, policy: "KR_BASELINE", stratify: "7등급 각 5가구 이상 + 나머지 25가구 실제 구성", table: ["gamma", "lognormal(안정성 시험)"] },
    E2: {
      spec: "5.4절", cells: 9, hhPerResource: [1.5, 3, 6], travelProfile: ["fast", "standard", "slow"], sigmaE: 0.5,
      pairedSeedsPerCell: 200, nHouseholds: 30, causes: "시드마다 7종(ROTATING 제외)에서 균등",
      policies: ["RULE", "B1_SHORTEST", "B2_NEAREST", "R_L", "RULE_NO_R", "RULE_FEASIBLE_FIRST", "RULE_NO_RESERVE", "ORACLE_INFO"],
      bootstrap: 2000,
    },
  },
  thresholds: {
    gate2: { robustCountMin: null, e2SuperiorCells: "9칸 중 3칸(27칸으로 확장하면 27칸 중 9칸)", spec: "5.5절" },
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
};
mkdirSync(path.join(repo, "prereg"), { recursive: true });
const out = path.join(repo, "prereg", "sweep.json");
writeFileSync(out, canonicalJson(doc) + "\n", "utf-8");
console.log(`→ ${out}`);
