// 프리셋 3개(수원형·서산형·순환단전)를 spec/presets/*.json에 쓴다(spec.md 5.7절, 봉인 S2b). 비AI, 결정적.
// 실행: (app/에서) npx tsx scripts/build-presets.ts
// 파일 = 정본 JSON { meta, scenario }. scenario는 materialize 전체(PlannerView + WorldTruth). 화면은 planner만 읽는다(2장).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalJson } from "../src/lib/sim/materialize";
import { presetDefs, presetDoc } from "../src/lib/sim/scenarios";

const repo = path.resolve(__dirname, "..", "..");
const dir = path.join(repo, "spec", "presets");
mkdirSync(dir, { recursive: true });
for (const p of presetDefs()) {
  const out = path.join(dir, p.file);
  writeFileSync(out, canonicalJson(presetDoc(p)) + "\n", "utf-8");
  console.log(`${p.def.scenarioId} → ${out}`);
}
