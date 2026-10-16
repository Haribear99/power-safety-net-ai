// 화면용 프리셋 (spec.md 2장 '화면은 planner만 읽는다'). 비AI, 결정적.
// 실행: (app/에서) npx tsx scripts/build-ui-presets.ts
// 봉인 spec/presets/*.json에서 meta와 scenario.planner만 꺼내 src/data/presets/<file>에 쓴다. truth·sim·labels는 싣지 않는다.
// baseIso(모의 시각 0의 벽시계)는 표시 전용 시연 값이다(1.5절 「모의시각」 표기). 계산에 쓰지 않는다.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalJson, sha256Hex, type MaterializedScenario } from "../src/lib/sim/materialize";
import { presetDefs } from "../src/lib/sim/scenarios";

const repo = path.resolve(__dirname, "..", "..");
const BASE_ISO: Record<string, string> = {
  "PRESET-SUWON": "2026-08-14T22:00:00+09:00",
  "PRESET-SEOSAN": "2026-08-20T19:00:00+09:00",
  "PRESET-ROTATING": "2026-08-07T15:00:00+09:00",
};
const index: { scenarioId: string; name: string; description: string; file: string }[] = [];
for (const p of presetDefs()) {
  const doc = JSON.parse(readFileSync(path.join(repo, "spec", "presets", p.file), "utf-8")) as {
    meta: { scenarioId: string; name: string; description: string; scenarioSha256: string; seed: string };
    scenario: MaterializedScenario;
  };
  if (sha256Hex(canonicalJson(doc.scenario)) !== doc.meta.scenarioSha256) throw new Error(`${p.file}: 봉인 sha256 불일치`);
  const ui = {
    format: "pl26-ui-preset/1",
    meta: { scenarioId: doc.meta.scenarioId, name: doc.meta.name, description: doc.meta.description, seed: doc.meta.seed, scenarioSha256: doc.meta.scenarioSha256, baseIso: BASE_ISO[doc.meta.scenarioId] },
    // 계획자 쪽 가정(이동시간 분포·119 지연 배수)은 시뮬레이션과 같은 값을 쓴다(sim/run.ts allocOpts). 진실값이 아니다
    allocOpts: { travel: doc.scenario.sim.travel, stress119: doc.scenario.sim.stress119 },
    planner: doc.scenario.planner,
  };
  if ("truth" in (ui.planner as object)) throw new Error("planner에 truth가 섞임");
  writeFileSync(path.join(__dirname, "..", "src", "data", "presets", p.file), canonicalJson(ui) + "\n", "utf-8");
  index.push({ scenarioId: doc.meta.scenarioId, name: doc.meta.name, description: doc.meta.description, file: p.file });
  console.log(`${doc.meta.scenarioId} → src/data/presets/${p.file}`);
}
