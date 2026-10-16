// 봉인 프리셋 A/B 카운터 (spec.md 1.4절 'A/B 카운터 띠', 5.7절). 비AI, 결정적, 네트워크 없음.
// 실행: (app/에서) npx tsx scripts/presets-ab.ts
// 봉인된 spec/presets/*.json을 그대로 읽어(다시 만들지 않음) RULE·B1_SHORTEST·B2_NEAREST를 같은 시드로 돌리고
// WorldTruth로 채점한 M1·M2를 out/presets_ab.json에 쓴다. 화면은 이 값을 sync-evidence → evidence.json 경유로만 읽는다(2장).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { canonicalJson, sha256Hex, type MaterializedScenario } from "../src/lib/sim/materialize";
import { runScenario, type SimPolicy } from "../src/lib/sim/run";
import { presetDefs } from "../src/lib/sim/scenarios";

const repo = path.resolve(__dirname, "..", "..");
const POLICIES: readonly SimPolicy[] = ["RULE", "B1_SHORTEST", "B2_NEAREST"];

const presets = presetDefs().map((p) => {
  const file = path.join(repo, "spec", "presets", p.file);
  const doc = JSON.parse(readFileSync(file, "utf-8")) as { meta: { scenarioId: string; scenarioSha256: string; seed: string; name: string }; scenario: MaterializedScenario };
  const sha = sha256Hex(canonicalJson(doc.scenario));
  if (sha !== doc.meta.scenarioSha256) throw new Error(`${p.file}: 봉인 sha256 불일치 (${sha} ≠ ${doc.meta.scenarioSha256})`);
  const byPolicy: Record<string, { M1: number; M2S: number; M2H: number; highRisk: number }> = {};
  for (const pol of POLICIES) {
    const r = runScenario(doc.scenario, pol, { unservedSelfCall: true });
    byPolicy[pol] = { M1: r.outcome.metrics.M1, M2S: r.outcome.metrics.M2S, M2H: Math.round(r.outcome.metrics.M2S / 36) / 100, highRisk: r.outcome.metrics.highRiskCount };
  }
  return { scenarioId: doc.meta.scenarioId, name: doc.meta.name, seed: doc.meta.seed, scenarioSha256: sha, policies: byPolicy };
});

const out = { format: "pl26-presets-ab/1", note: "봉인 프리셋 1건씩의 모의 결과(WorldTruth 채점). 전체 9칸 승/무/패는 /lab", presets };
mkdirSync(path.join(repo, "out"), { recursive: true });
writeFileSync(path.join(repo, "out", "presets_ab.json"), canonicalJson(out) + "\n", "utf-8");
for (const p of presets) {
  console.log(p.scenarioId, POLICIES.map((k) => `${k} M1=${p.policies[k].M1} M2=${p.policies[k].M2H}h`).join(" | "), `고위험 ${p.policies.RULE.highRisk}`);
}
