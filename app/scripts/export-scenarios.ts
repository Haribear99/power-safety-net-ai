// 오라클 차등 시험 입력을 펼쳐 쓴다(spec.md 8절, oracle/FORMAT.md `pl26-materialized/1`). 비AI, 결정적.
// 실행: (app/에서) npx tsx scripts/export-scenarios.ts [--ts-out]
//   out/oracle_input/<scenarioId>.json  표준 50건 + 프리셋 3개의 materialize JSON(키 정렬, 1e-6 반올림)
//   out/oracle_input_manifest.json      파일별 sha256(오라클이 디렉터리의 *.json을 모두 읽으므로 밖에 둔다)
//   --ts-out: out/ts_out/<scenarioId>.json에 TS RULE 결과를 오라클 출력 형식(`pl26-oracle-out/1`)으로도 쓴다
//             비교: python -I oracle/run.py out/oracle_input -o out/oracle_out && python -I oracle/diff.py out/oracle_out out/ts_out
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalJson, materialize, sha256Hex, type ScenarioDef } from "../src/lib/sim/materialize";
import { runScenario, toOracleOut } from "../src/lib/sim/run";
import { presetDefs, standard50Defs } from "../src/lib/sim/scenarios";

const repo = path.resolve(__dirname, "..", "..");
const inDir = path.join(repo, "out", "oracle_input");
const tsDir = path.join(repo, "out", "ts_out");
const withTs = process.argv.includes("--ts-out");

function resetJsonDir(dir: string) {
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) if (f.endsWith(".json")) rmSync(path.join(dir, f));
}
resetJsonDir(inDir);
if (withTs) resetJsonDir(tsDir);

const defs: ScenarioDef[] = [...standard50Defs().map((c) => c.def), ...presetDefs().map((p) => p.def)];
const manifest: Record<string, string> = {};
for (const def of defs) {
  const m = materialize(def);
  const file = `${def.scenarioId}.json`;
  writeFileSync(path.join(inDir, file), m.json + "\n", "utf-8");
  manifest[file] = m.sha256;
  if (withTs) {
    const out = canonicalJson(toOracleOut(runScenario(m.scenario, "RULE")));
    writeFileSync(path.join(tsDir, file), out + "\n", "utf-8");
  }
}
writeFileSync(path.join(repo, "out", "oracle_input_manifest.json"), canonicalJson({ format: "pl26-oracle-input-manifest/1", files: manifest, sha256OfFiles: sha256Hex(canonicalJson(manifest)) }) + "\n", "utf-8");
console.log(`${defs.length} scenarios → ${inDir}${withTs ? ` (+ TS RULE → ${tsDir})` : ""}`);
