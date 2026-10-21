// 저장된 생성 원시 응답(AI 문장·2차 판독 주장)을 지금 1차 규칙·2차 대조로 다시 판정한다. API 호출 없음.
// 1차(rules.ts)만 바뀌고 2차 지시문·프롬프트가 그대로일 때 생성 셋을 다시 돌리지 않고 확인하는 용도(통합 레드팀 17·18라운드)
// 실행(app/에서): npx tsx scripts/n1-rejudge.ts v24-r1 ext-v24 sw-v24 warn-v24
// 결과: seal/outputs/n1_regression/rejudge-<RULES_VERSION>.json (원시 응답은 out/n1/<tag>/, 저장소 밖)
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CHECK_VERSION, compareClaims } from "../src/lib/notice/check";
import { buildFacts } from "../src/lib/notice/facts";
import { RULES_VERSION, templateSentences, verify } from "../src/lib/notice/rules";

const repo = path.resolve(__dirname, "..", "..");
const out: Record<string, unknown> = { rulesVersion: RULES_VERSION, checkVersion: CHECK_VERSION, sets: {} };
for (const tag of process.argv.slice(2)) {
  const dir = path.join(repo, "out", "n1", tag);
  let n = 0, sentBefore = 0, sentNow = 0, templateGate1Fail = 0;
  const changed: { id: string; before: boolean; now: boolean; why: string[] }[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json") && x !== "summary.json" && !x.startsWith("corpus"))) {
    const d = JSON.parse(readFileSync(path.join(dir, f), "utf-8"));
    n++;
    const facts = buildFacts(d.input);
    const g1 = verify(facts, d.gate1.sentences);
    const claims = d.gate2?.check && "claims" in d.gate2.check ? d.gate2.check.claims : null;
    const g2 = claims ? compareClaims(facts, claims).length === 0 : false;
    const before = d.composed?.source === "ai", now = g1.ok && g2;
    if (before) sentBefore++;
    if (now) sentNow++;
    if (before !== now) changed.push({ id: d.id, before, now, why: g1.violations.map((v) => v.detail) });
    if (!verify(facts, templateSentences(facts)).ok) templateGate1Fail++;
  }
  (out.sets as Record<string, unknown>)[tag] = { n, aiSentBefore: sentBefore, aiSentNow: sentNow, templateGate1Fail, changed };
  console.log(`${tag}: AI 발송 ${sentBefore}/${n} → ${sentNow}/${n}, 고정 문안 1차 실패 ${templateGate1Fail}, 바뀐 항목 ${changed.length}`);
}
writeFileSync(path.join(repo, "seal", "outputs", "n1_regression", `rejudge-${RULES_VERSION}.json`), JSON.stringify(out, null, 1));
