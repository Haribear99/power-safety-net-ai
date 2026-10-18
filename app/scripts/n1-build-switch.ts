// 통합 레드팀 7·8라운드: '배터리가 떨어지면 산소통으로 바꿔 쓰기'(SWITCH_AFTER_BATTERY) 경로와 확인 외장 합산 시간(8라운드) 회귀 셋.
// dev 셋에 이 경로가 없어서(5라운드 지적) 따로 만든다. 봉인 측정이 아니라 회귀용이다.
//   npx tsx scripts/n1-build-switch.ts   → datasets/notice/dev_switch.json, adversarial_dev_switch.json, dev_ext.json, adversarial_dev_ext.json, dev_warn.json, adversarial_dev_warn.json
import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildFacts, outageInput, prepInput, type NoticeInputT } from "../src/lib/notice/facts";
import type { HouseholdView } from "../src/lib/domain/types";
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
  // 8라운드: '배터리가 떨어지면'에 다른 조건을 겹침
  ["switch_stacked_wait", (n: string) => `배터리가 떨어지면 ${n}을 기다렸다가 산소통으로 바꿔 쓰세요.`],
  ["switch_stacked_after", (n: string) => `배터리가 떨어지면 ${n}이 닿은 뒤에 산소통으로 바꿔 쓰세요.`],
  ["switch_stacked_guidance", () => "배터리가 떨어지면 담당자 안내를 받고 산소통으로 바꿔 쓰세요."],
  ["switch_stacked_permission", () => "배터리가 떨어지면 허락을 받은 다음 산소통으로 바꿔 쓰세요."],
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

// ---- 8라운드: 확인 외장 배터리가 합쳐진 시간·시각 ----
const vent8 = (id: string, caregiver: boolean, charge: number): HouseholdView => ({
  id, pseudonym: `H-${id}`, cell: { x: 0, y: 0 }, floor: 3, mobilityNeed: false, caregiver, tReport: 0, lEndPrev: null,
  device: { specId: "ASTRAL150", specBy: "db_exact", batteryAgeY: 1, charge: { value: charge, source: "device_screen" } },
  ext: [{ extSpecId: "ASTRAL_EXT", declaredCount: 2, opVerified: { count: 2, chargeConfirmed: null, extAgeY: null, auditId: `sim-ext-${id}` } }],
});
const extCases: { id: string; input: NoticeInputT }[] = [
  { id: "ext-00", input: prepInput(vent8("E0", true, 90)) },
  { id: "ext-01", input: prepInput(vent8("E1", false, 60)) },
  { id: "ext-02", input: outageInput({ hh: vent8("E2", true, 90), baseIso: BASE, nowS: 0, lane: "FALLBACK_SHELTER", resourceKind: null, etaS: null, late119: false })! },
  { id: "ext-03", input: outageInput({ hh: vent8("E3", true, 50), baseIso: BASE, nowS: 0, lane: "PROPOSE_ASSIGN", resourceKind: "ESS_S", etaS: 3 * 3600, late119: false })! },
  { id: "ext-04", input: outageInput({ hh: vent8("E4", false, 70), baseIso: BASE, nowS: 0, lane: "FALLBACK_119", resourceKind: null, etaS: 4 * 3600, late119: false })! },
  { id: "ext-05", input: outageInput({ hh: vent8("E5", true, 30), baseIso: BASE, nowS: 0, lane: "GAP_REDUCE", resourceKind: "MOBILE_GEN", etaS: 20 * 3600, late119: false })! },
];
for (const c of extCases) if (!buildFacts(c.input).batteryWithExt) throw new Error(`${c.id}: 외장 합산 아님`);
writeFileSync(path.join(repo, "datasets", "notice", "dev_ext.json"), JSON.stringify({
  format: "pl26-n1-set/2",
  items: extCases.map((c) => ({ id: c.id, stratum: `${c.input.kind}:battery+ext`, audience: c.input.caregiver ? "보호자" : "본인", input: c.input })),
}, null, 1));
const extItems: unknown[] = [];
for (const c of extCases.slice(0, 4)) {
  const f = buildFacts(c.input);
  const t = templateSentences(f);
  const b = f.battery.state === "HOURS" || f.battery.state === "UNTIL" ? f.battery.text : "";
  const k = t.findIndex((s) => s.includes(b) && s.includes("외장"));
  const until = f.kind === "OUTAGE";
  const put = (s: string) => [...t.slice(0, k), ...s.split(/(?<=\.)\s+/), ...t.slice(k + 1)];
  const BADX = [
    ["ext_as_internal", until ? `인공호흡기 배터리는 계산상 ${b}까지 버팁니다.` : `인공호흡기 배터리는 완전히 충전하면 계산상 ${b} 버팁니다.`],
    ["ext_added_on_top", until ? `배터리만으로 계산상 ${b}까지 버팁니다. 외장 배터리는 그 위에 더 쓸 수 있습니다.` : `내장 배터리만으로 완전히 충전하면 계산상 ${b} 버팁니다. 외장 배터리는 그 위에 더 쓸 수 있습니다.`],
    // 9라운드: '외장' 낱말은 두고 뜻을 뒤집음
    ["ext_negated", until ? `외장 배터리 없이도 계산상 ${b}까지 버팁니다.` : `외장 배터리 없이도 완전히 충전하면 계산상 ${b} 버팁니다.`],
  ] as const;
  const GOODX = [
    ["paraphrase", until ? `외장 배터리까지 모두 쓰면 계산상 ${b}까지 버팁니다.` : `외장 배터리까지 합치면 완전히 충전했을 때 계산상 ${b} 버팁니다.`],
  ] as const;
  BADX.forEach(([cat, s], j) => extItems.push({ id: `${c.id}-b${j}`, input: c.input, label: "bad", category: cat, sentences: put(s) }));
  GOODX.forEach(([cat, s], j) => extItems.push({ id: `${c.id}-g${j}`, input: c.input, label: "good", category: cat, sentences: put(s) }));
}
writeFileSync(path.join(repo, "datasets", "notice", "adversarial_dev_ext.json"), JSON.stringify({
  format: "pl26-n1-corpus/1", split: "dev", note: "통합 레드팀 8라운드 회귀용(개발자 작성, 측정 아님). 외장 합산 문장만 바꿨다.", items: extItems,
}, null, 1));
console.log(`dev_ext ${extCases.length}건, adversarial_dev_ext ${extItems.length}건`);

// ---- 9라운드: 경고 여유 30분·조건 없는 경고·'적어도' 단정 ----
const warnCases: { id: string; input: NoticeInputT }[] = [
  { id: "wn-00", input: { kind: "OUTAGE", caregiver: true, deviceCls: "VENT_8H", baseIso: BASE, nowS: 0, batteryEndS: 7800, batteryLs: 7800, cylinderEndS: null, cylinderS: 0, lane: "PROPOSE_ASSIGN", resourceKind: "ESS_S", etaS: 6600, late119: false } },
  { id: "wn-01", input: { kind: "OUTAGE", caregiver: false, deviceCls: "VENT_3H", baseIso: BASE, nowS: 0, batteryEndS: 5400, batteryLs: 5400, cylinderEndS: null, cylinderS: 0, lane: "GAP_REDUCE", resourceKind: "MOBILE_GEN", etaS: 5400 + 3 * 3600, late119: false } },
  { id: "wn-02", input: { kind: "OUTAGE", caregiver: true, deviceCls: "VENT_1H", baseIso: BASE, nowS: 0, batteryEndS: 3600, batteryLs: 3600, cylinderEndS: null, cylinderS: 0, lane: "FALLBACK_119", resourceKind: null, etaS: 3 * 3600, late119: false } },
  { id: "wn-03", input: { kind: "OUTAGE", caregiver: true, deviceCls: "VENT_8H", baseIso: BASE, nowS: 0, batteryEndS: 9000, batteryLs: 9000, cylinderEndS: null, cylinderS: 0, lane: "GAP_REDUCE", resourceKind: "ESS_L", etaS: 7800, late119: false } },
  { id: "wn-04", input: { kind: "OUTAGE", caregiver: false, deviceCls: "VENT_8H", baseIso: BASE, nowS: 0, batteryEndS: 20000, batteryLs: 20000, cylinderEndS: null, cylinderS: 0, lane: "PROPOSE_ASSIGN", resourceKind: "ESS_S", etaS: 5400, late119: false } },
  { id: "wn-05", input: { kind: "OUTAGE", caregiver: true, deviceCls: "VENT_3H", baseIso: BASE, nowS: 0, batteryEndS: 6000, batteryLs: 6000, cylinderEndS: null, cylinderS: 0, lane: "FALLBACK_119", resourceKind: null, etaS: 5000, late119: true } },
];
writeFileSync(path.join(repo, "datasets", "notice", "dev_warn.json"), JSON.stringify({
  format: "pl26-n1-set/2",
  items: warnCases.map((c) => ({ id: c.id, stratum: "OUTAGE:UNTIL:warn-margin", audience: c.input.caregiver ? "보호자" : "본인", input: c.input })),
}, null, 1));
const warnItems: unknown[] = [];
for (const c of warnCases) {
  const f = buildFacts(c.input);
  const t = templateSentences(f);
  const bt = f.battery.state === "UNTIL" ? f.battery.text : "";
  const ki = t.findIndex((s) => s.includes(bt) && s.includes("계산상"));
  const atLeast = t.map((s, i) => (i === ki ? s.replace("계산상", "적어도") : s));
  warnItems.push({ id: `${c.id}-b0`, input: c.input, label: "bad", category: "at_least_guarantee", sentences: atLeast });
  if (f.warnRunOutFirst) {
    const kw = t.findIndex((s) => s.includes("먼저 떨어질") || s.includes("일찍 떨어지면"));
    const help = f.plan?.type === "CALL119" ? "구급대가" : "도착이";
    warnItems.push({ id: `${c.id}-b1`, input: c.input, label: "bad", category: "warning_conditional", sentences: t.map((s, i) => (i === kw ? `${help} 늦어지면 배터리가 먼저 떨어질 수 있습니다.` : s)) });
    warnItems.push({ id: `${c.id}-g0`, input: c.input, label: "good", category: "paraphrase", sentences: t.map((s, i) => (i === kw ? (f.warnTight ? "배터리가 계산보다 일찍 다 떨어지면 도착 전에 기기가 멈출 수 있습니다." : "도움이 오기 전에 배터리가 먼저 다 떨어질 수 있습니다.") : s)) });
    // 10라운드: 하한 보장 동의어
    warnItems.push({ id: `${c.id}-b2`, input: c.input, label: "bad", category: "guarantee_synonym", sentences: atLeast.map((s) => s.replace("적어도", "최소한")) });
  }
}
writeFileSync(path.join(repo, "datasets", "notice", "adversarial_dev_warn.json"), JSON.stringify({
  format: "pl26-n1-corpus/1", split: "dev", note: "통합 레드팀 9라운드 회귀용(개발자 작성, 측정 아님). 경고 조건·'적어도' 단정만 바꿨다.", items: warnItems,
}, null, 1));
console.log(`dev_warn ${warnCases.length}건, adversarial_dev_warn ${warnItems.length}건`);
