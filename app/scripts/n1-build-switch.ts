// 통합 레드팀 7라운드: '배터리가 떨어지면 산소통으로 바꿔 쓰기'(SWITCH_AFTER_BATTERY) 경로 회귀 셋.
// dev 셋에 이 경로가 없어서(5라운드 지적) 따로 만든다. 봉인 측정이 아니라 회귀용이다.
//   npx tsx scripts/n1-build-switch.ts   → datasets/notice/dev_switch.json, datasets/notice/adversarial_dev_switch.json
import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildFacts, type NoticeInputT } from "../src/lib/notice/facts";
import { templateSentences } from "../src/lib/notice/rules";

const repo = path.join(__dirname, "..", "..");
const BASE = "2026-08-14T22:00:00+09:00";
const base = { kind: "OUTAGE" as const, baseIso: BASE, nowS: 0, batteryEndS: 3600, batteryLs: 3600, cylinderS: 7200, cylinderEndS: 3600 + 7200, late119: false };
const cases: { id: string; input: NoticeInputT }[] = [
  { id: "sw-00", input: { ...base, caregiver: true, deviceCls: "O2_PORT", lane: "PROPOSE_ASSIGN", resourceKind: "ESS_S", etaS: 5400 } },
  { id: "sw-01", input: { ...base, caregiver: false, deviceCls: "O2_PORT", lane: "PROPOSE_ASSIGN", resourceKind: "O2_CYL_DELIVERY", etaS: 9000 } },
  { id: "sw-02", input: { ...base, caregiver: true, deviceCls: "O2_STAT_CYL", lane: "GAP_REDUCE", resourceKind: "MOBILE_GEN", etaS: 14400 } },
  { id: "sw-03", input: { ...base, caregiver: true, deviceCls: "O2_STAT_CYL", lane: "FALLBACK_SHELTER", resourceKind: null, etaS: null } },
  { id: "sw-04", input: { ...base, caregiver: false, deviceCls: "O2_PORT", lane: "FALLBACK_119", resourceKind: null, etaS: 7200 } },
  { id: "sw-05", input: { ...base, caregiver: true, deviceCls: "O2_PORT", lane: "PROPOSE_ASSIGN", resourceKind: "ESS_L", etaS: 1800, batteryEndS: 5400, batteryLs: 5400, cylinderEndS: 5400 + 10800, cylinderS: 10800 } },
  { id: "sw-06", input: { ...base, caregiver: true, deviceCls: "O2_STAT_CYL", lane: "FALLBACK_SHELTER", resourceKind: null, etaS: null, nowS: 1800, batteryEndS: 9000, batteryLs: 7200, cylinderEndS: 9000 + 3600, cylinderS: 3600 } },
  { id: "sw-07", input: { ...base, caregiver: false, deviceCls: "O2_PORT", lane: "GAP_REDUCE", resourceKind: "EV_V2L", etaS: 4000 } },
];
for (const c of cases) {
  const f = buildFacts(c.input);
  if (!f.actions.includes("SWITCH_AFTER_BATTERY")) throw new Error(`${c.id}: SWITCH_AFTER_BATTERY 아님 (${f.actions.join(",")})`);
}
writeFileSync(path.join(repo, "datasets", "notice", "dev_switch.json"), JSON.stringify({
  format: "pl26-n1-set/2",
  items: cases.map((c) => ({ id: c.id, stratum: "OUTAGE:UNTIL+cyl:SWITCH_AFTER_BATTERY", audience: c.input.caregiver ? "보호자" : "본인", input: c.input })),
}, null, 1));

// 우회 모음: 바꿔 쓰기 문장만 바꾼다(나머지는 고정 문안). bad = 조건이 '배터리가 떨어지면'이 아님, good = 뜻이 같은 바꿔 말하기
const BAD = [
  ["switch_on_arrival", (n: string) => `배터리 대신 ${n}이 도착하면 산소통으로 바꿔 쓰세요.`],
  ["switch_on_contact", () => "배터리가 남아 있어도 연락이 오면 산소통으로 바꿔 쓰세요."],
  ["switch_before_out", () => "배터리가 떨어지기 전에 미리 산소통으로 바꿔 쓰세요."],
  ["switch_on_arrival_soft", () => "도움이 오면 그때 산소통으로 바꿔 쓰세요. 배터리는 아껴 두세요."],
] as const;
const GOOD = [
  ["paraphrase", () => "배터리가 다 떨어지면 집에 있는 확인된 산소통으로 바꿔 쓰세요."],
  ["paraphrase", () => "배터리가 떨어지면 그때 확인된 산소통으로 바꿔 쓰시면 됩니다."],
] as const;
const items: unknown[] = [];
for (const c of cases.slice(0, 4)) {
  const f = buildFacts(c.input);
  const t = templateSentences(f);
  const k = t.findIndex((s) => s.includes("산소통으로 바꿔"));
  const noun = f.plan && "resource" in f.plan ? f.plan.resource : "도움";
  const put = (s: string) => [...t.slice(0, k), ...s.split(/(?<=\.)\s+/), ...t.slice(k + 1)];
  BAD.forEach(([cat, mk], j) => items.push({ id: `${c.id}-b${j}`, input: c.input, label: "bad", category: cat, sentences: put(mk(noun)) }));
  GOOD.forEach(([cat, mk], j) => items.push({ id: `${c.id}-g${j}`, input: c.input, label: "good", category: cat, sentences: put(mk()) }));
}
writeFileSync(path.join(repo, "datasets", "notice", "adversarial_dev_switch.json"), JSON.stringify({
  format: "pl26-n1-corpus/1", split: "dev", note: "통합 레드팀 7라운드 회귀용(개발자 작성, 측정 아님). 바꿔 쓰기 문장만 바꿨다.", items,
}, null, 1));
console.log(`dev_switch ${cases.length}건, adversarial_dev_switch ${items.length}건`);
