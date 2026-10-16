// 표준 50건 정의와 materialize sha256을 spec/standard50.json에 쓴다(spec.md 5.6절, 봉인 S2b). 비AI, 결정적.
// 실행: (app/에서) npx tsx scripts/build-standard50.ts
// 시나리오 본문은 저장하지 않는다. 같은 코드·같은 장부면 sim/scenarios.ts 정의 → materialize가 같은 sha256을 낸다(시험이 확인).
// 펼친 시나리오는 scripts/export-scenarios.ts가 out/oracle_input/에 쓴다.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalJson, materialize } from "../src/lib/sim/materialize";
import { standard50Doc } from "../src/lib/sim/scenarios";

const repo = path.resolve(__dirname, "..", "..");
const doc = standard50Doc((def) => materialize(def).sha256);
const out = path.join(repo, "spec", "standard50.json");
writeFileSync(out, canonicalJson(doc) + "\n", "utf-8");
console.log(`${doc.cases.length} cases → ${out}`);
