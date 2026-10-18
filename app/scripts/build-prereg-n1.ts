// N1(보호자 알림) 사전등록 prereg/n1.json을 쓴다(S9, prereg/predictions_n1.md). 비AI, 결정적.
// 실행: (app/에서) npx tsx scripts/build-prereg-n1.ts
// 봉인 대상: 알림 코드·프롬프트·검사 프롬프트·실행 스크립트·dev 셋·독립 우회 모음(test)의 sha256. 시험셋(test.json)은 봉인 뒤 drand 난수로 만든다.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CHECK_SYSTEM, CHECK_VERSION } from "../src/lib/notice/check";
import { LIMITS } from "../src/lib/notice/rules";
import { NOTICE_PROMPT_VERSION, NOTICE_SYSTEM } from "../src/lib/notice/prompt";
import { STAGE } from "../src/lib/claude/models";
import { canonicalJson, sha256Hex } from "../src/lib/sim/materialize";
import { JUDGE_SYSTEM, JUDGE_VERSION } from "./n1-run";

const repo = path.resolve(__dirname, "..", "..");
const lf = (p: string) => sha256Hex(readFileSync(path.join(repo, p), "utf-8").split("\r\n").join("\n"));
const files = [
  "app/src/lib/notice/facts.ts", "app/src/lib/notice/rules.ts", "app/src/lib/notice/check.ts", "app/src/lib/notice/compose.ts", "app/src/lib/notice/prompt.ts",
  "app/src/lib/claude/client.ts", "app/src/lib/claude/models.ts", "app/src/lib/claude/budget.ts",
  "app/scripts/n1-build-set.ts", "app/scripts/n1-run.ts", "tools/notice_check.py",
  "datasets/notice/dev.json", "datasets/notice/adversarial_dev.json", "datasets/notice/adversarial_test.json",
];
const code: Record<string, string> = {};
for (const f of files) code[f] = lf(f);

const doc = {
  format: "pl26-prereg-n1/1",
  status: "SEALED S9 (2026-10-18). 시험셋은 S9 태그 커밋 시각 + 15분 이후 첫 drand quicknet 라운드의 난수로 만든 뒤 1회만 실행한다",
  predictions: "prereg/predictions_n1.md",
  design: {
    feature: "보호자 알림(쉬운 글·음성): 코드가 사실·할 일을 정하고, AI(생성)가 본문을 쓰고, 1차(글자 규칙)·2차(다른 모델이 글만 읽고 역추출 → 사실 대조) 검사를 모두 통과할 때만 발송. 아니면 고정 문안. 119·123 문장은 늘 코드가 붙임",
    stages: { generate: { ...STAGE.PW_N1_notice, promptVersion: NOTICE_PROMPT_VERSION, systemSha256: sha256Hex(NOTICE_SYSTEM) }, check: { ...STAGE.PW_N1_check, checkVersion: CHECK_VERSION, systemSha256: sha256Hex(CHECK_SYSTEM) }, judge: { ...STAGE.PW_N1_judge, judgeVersion: JUDGE_VERSION, systemSha256: sha256Hex(JUDGE_SYSTEM) } },
    limits: LIMITS,
    testSet: {
      n: 60, scenarios: 24, lhsMaster: "N1", dedupeAgainst: "datasets/notice/dev.json(같은 사실 묶음 제외)",
      seedRule: "seedLo = 7,000,000 + (parseInt(randomness[0:8], 16) mod 900,000); randomness = drand quicknet(chain 52db9ba7…e971) 라운드 R, R = 시각이 T 이상인 첫 라운드 = ceil((T − 1692803367)/3) + 1, T = S9 태그 커밋 시각(유닉스 초) + 900",
      build: "cd app && npx tsx scripts/n1-build-set.ts --round <R> --salt <randomness>",
    },
    corpus: { file: "datasets/notice/adversarial_test.json", author: "독립 레드팀 에이전트(개발자 미열람, 해시만 봉인)", use: "항목마다 1차·2차 검사를 모두 돌려 bad 놓침률·good 오거부율" },
    dev: { set: "datasets/notice/dev.json(시드 9,701~9,712, 40건)", corpus: "datasets/notice/adversarial_dev.json(레드팀 10/18 사례, 21건)", runs: "out/n1/v1-r1 … v6-r1, adv-dev-r1 … r4(프롬프트·검사 기준 개정 이력)" },
    usageRule: "보고서·랜딩에는 9.1(놓침)·9.2(오거부)·9.3(발송률)을 Wilson 95% CI와 함께 싣는다. '사실 오류 0 보장'이라고 쓰지 않는다. 9.5(AI 심사)는 '탐색, AI가 판정' 표지 없이 싣지 않는다. 9.1이 틀리면 놓친 글의 수와 범주를 그대로 쓴다",
  },
  codeSha256: code,
  commands: [
    "git tag S9 && ots stamp seal/S9.txt",
    "curl https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971/public/<R>",
    "cd app && npx tsx scripts/n1-build-set.ts --round <R> --salt <randomness>",
    "cd app && npx tsx scripts/n1-run.ts --sealed",
    "python tools/notice_check.py out/sealed/n1",
    "node tools/check-seal-order.mjs",
  ],
};
writeFileSync(path.join(repo, "prereg", "n1.json"), canonicalJson(doc) + "\n", "utf-8");
console.log("→ prereg/n1.json", Object.keys(code).length, "파일 sha256");
