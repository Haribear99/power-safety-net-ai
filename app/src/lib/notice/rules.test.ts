// 보호자 알림 규칙 층 시험
// ① 고정 문안은 모든 조합에서 1차 검사를 통과 ② 사실 묶음 표기·경계(산소통 분리, 반올림 역전, 지난 도착, 날짜)
// ③ 1차 검사가 잡아야 하는 우회 문장(레드팀 10/18 사례) ④ 2차 검사 대조(compareClaims) — 맞는 주장이면 통과, 한 칸만 달라도 거부
import { describe, expect, it } from "vitest";
import { buildFacts, clockText, durationText, NOTICE_LANES, NoticeInput, outageInput, prepInput, RESOURCE_UNKNOWN_NOUN, validBaseIso, type NoticeFacts, type NoticeInputT } from "./facts";
import { compose, speechText } from "./compose";
import { compareClaims, type ClaimsT } from "./check";
import { BANNED, FACT_ERROR, josa, requirements, ROLE_KO, tailSentences, templateSentences, verify } from "./rules";
import { noticeUser } from "./prompt";
import type { HouseholdView } from "../domain/types";

const BASE = "2026-08-14T22:00:00+09:00";
const CLS = ["O2_STAT", "O2_STAT_CYL", "VENT_1H", "VENT_3H", "O2_PORT", "VENT_8H", "VENT_8H_EXT2", "INTERMITTENT", "UNKNOWN"] as const;
const RES = ["ESS_S", "ESS_L", "MOBILE_GEN", "RENTAL_EXT", "O2_CYL_DELIVERY", "EV_V2L"] as const;

/** 결정적 의사난수(시험 전용) */
function lcg(seed: number) { let x = seed >>> 0; return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32); }

function allInputs(): NoticeInputT[] {
  const out: NoticeInputT[] = [];
  const r = lcg(7);
  for (const caregiver of [true, false]) for (const deviceCls of CLS) {
    for (const batteryS of [null, 0, 600, 1800, 5400, 7 * 3600, 41_400]) for (const cylinderS of [0, 36_000]) for (const extDeclared of [true, false]) {
      out.push({ kind: "PREP", caregiver, deviceCls, batteryS, cylinderS, extDeclared });
      if (extDeclared && batteryS) out.push({ kind: "PREP", caregiver, deviceCls, batteryS, cylinderS, extDeclared, batteryExtS: Math.floor(batteryS / 2) }); // 확인 외장 합산(8라운드)
    }
    for (const lane of NOTICE_LANES) for (const bat of [null, 0, -100, 300, 2 * 3600, 30 * 3600]) for (const cyl of [null, 300, 9 * 3600]) for (const eta of [null, -60, 1800, 50 * 3600]) for (const late119 of [false, true]) {
      const nowS = Math.floor(r() * 20 * 3600);
      out.push({
        kind: "OUTAGE", caregiver, deviceCls, baseIso: BASE, nowS,
        batteryEndS: bat == null ? null : nowS + bat, batteryLs: bat == null ? null : bat === 0 ? 0 : 3600,
        cylinderEndS: cyl == null ? null : nowS + cyl, cylinderS: cyl == null ? 0 : 2 * 3600, lane,
        resourceKind: r() < 0.1 ? null : RES[Math.floor(r() * RES.length)], etaS: eta == null ? null : nowS + eta + Math.floor(r() * 3600), late119,
        ...(r() < 0.3 ? { batteryExtS: 1800 } : {}), // 확인 외장 합산(8라운드)
      });
    }
  }
  return out;
}

/** 시험용: 사실 묶음을 정확히 말하는 글에서 판독기가 뽑았어야 할 주장 */
function truthClaims(f: NoticeFacts): ClaimsT {
  const b = f.battery, c = f.cylinder, p = f.plan;
  const bk = { UNTIL: "lasts_until", HOURS: "lasts_for", UNDER30: "less_than", NONE: "no_battery_stops", MAYBE_OUT: "maybe_already_out", UNKNOWN: "unknown_being_checked" } as const;
  const promises: ClaimsT["staffPromises"] = [];
  if (p?.type === "ASSIGN" || p?.type === "GAP") promises.push({ kind: "send_equipment", quote: "" });
  if (p?.type === "CALL119") promises.push({ kind: "ambulance_transport", quote: "" });
  if (p?.type === "SHELTER") promises.push({ kind: "shelter_contact", quote: "" });
  if (p && "etaPassed" in p && p.etaPassed) promises.push({ kind: "checking_eta", quote: "" });
  if (b.state === "UNKNOWN") promises.push({ kind: "checking_battery", quote: "" });
  return {
    situation: f.kind === "OUTAGE" ? "outage_now" : "before_outage",
    staffPromises: promises,
    device: f.device,
    battery: { kind: bk[b.state], time: b.state === "UNTIL" || b.state === "HOURS" ? b.text : b.state === "UNDER30" ? "30분" : null, condition: b.state === "HOURS" || b.state === "UNDER30" ? "full_charge" : "unspecified", includesExternal: f.batteryWithExt ? "yes" : "not_mentioned" },
    cylinder: !c ? { kind: "not_mentioned", time: null, condition: "unspecified" } : c.state === "MAYBE_OUT" ? { kind: "maybe_already_out", time: null, condition: "unspecified" } : { kind: c.state === "UNTIL" ? "lasts_until" : "lasts_for", time: c.text, condition: c.state === "UNTIL" ? (f.actions.includes("SWITCH_TO_CYLINDER") ? "now" : "after_battery_out") : "unspecified" },
    means: !p ? { kind: "none", name: null, time: null, timeMeaning: "none", mayBeLate: false, connected: "not_mentioned", extraDetails: [] }
      : p.type === "ASSIGN" || p.type === "GAP" ? { kind: "power_equipment", name: p.resource, time: p.arriveBy, timeMeaning: p.arriveBy ? "arrive_by" : p.etaPassed ? "passed_being_checked" : "none", mayBeLate: false, connected: "not_mentioned", extraDetails: [] }
      : p.type === "CALL119" ? { kind: "ambulance", name: "구급대", time: p.doneBy, timeMeaning: p.doneBy ? "finish_by" : p.etaPassed ? "passed_being_checked" : "not_decided_yet", mayBeLate: p.late, connected: "yes", extraDetails: [] }
      : { kind: "shelter", name: "쉼터", time: null, timeMeaning: "none", mayBeLate: false, connected: "not_mentioned", extraDetails: [] },
    warningOnlyIfHelpLate: false,
    warningOnlyIfSupplyEarly: Boolean(f.warnTight),
    supplyMayRunOutBeforeHelp: f.warnRunOutFirst,
    runOutWhich: !f.warnRunOutFirst ? "none" : f.cylinder ? "cylinder" : "battery",
    actions: f.actions.map((kind) => ({ kind: kind === "SWITCH_AFTER_BATTERY" ? "SWITCH_TO_CYLINDER" as const : kind, when: kind === "FOLLOW_STAFF" ? "after_condition" as const : kind === "SWITCH_AFTER_BATTERY" ? "after_battery_out" as const : "now" as const, batteryScope: kind === "SWITCH_AFTER_BATTERY" && f.batteryWithExt ? "including_external" as const : "unspecified" as const, negated: false, quote: "" })),
    otherTimesOrDurations: [], reassuranceOrPromise: false, medicalOrDeviceOrRiskyInstruction: false,
  };
}

describe("고정 문안", () => {
  const inputs = allInputs();
  it(`모든 조합(${inputs.length}건)에서 1차 검사를 통과하고, 정답 주장과 대조해도 통과한다`, () => {
    for (const i of inputs) {
      expect(NoticeInput.safeParse(i).success).toBe(true);
      const f = buildFacts(i);
      const r = verify(f, templateSentences(f));
      if (!r.ok) throw new Error(`${JSON.stringify(i)} → ${JSON.stringify(r.violations)}`);
      expect(compareClaims(f, truthClaims(f))).toEqual([]);
    }
  });
  it("AI 문장이 없으면 고정 문안 + 119·123 고정 문장 + 고정 꼬리말", () => {
    const f = buildFacts(inputs[0]);
    const c = compose(f, null);
    expect(c.source).toBe("template");
    expect(c.sentences.slice(-tailSentences(f).length)).toEqual(tailSentences(f));
    expect(c.footer).not.toContain("AI");
  });
});

const IN = (o: Partial<Extract<NoticeInputT, { kind: "OUTAGE" }>>): NoticeInputT => ({
  kind: "OUTAGE", caregiver: true, deviceCls: "VENT_1H", baseIso: BASE, nowS: 0, batteryEndS: 4800, batteryLs: 3600, cylinderEndS: null, cylinderS: 0,
  lane: "PROPOSE_ASSIGN", resourceKind: "ESS_S", etaS: 3000, late119: false, ...o,
});
const gap = buildFacts(IN({ lane: "GAP_REDUCE", resourceKind: "RENTAL_EXT", etaS: 2 * 3600 + 600 }));
const shelter = buildFacts(IN({ lane: "FALLBACK_SHELTER", resourceKind: null, etaS: null }));
const assign = buildFacts(IN({}));

describe("사실 묶음 표기·경계", () => {
  it("배터리 시각은 10분 내림, 도착은 10분 올림, 날짜가 바뀌면 '내일'", () => {
    expect(gap.battery).toEqual({ state: "UNTIL", text: "오후 11시 20분" });
    expect(gap.plan).toEqual({ type: "GAP", resource: "기기용 외장 배터리", arriveBy: "내일 오전 0시 10분", etaPassed: false });
    expect(clockText(BASE, 1, 0, "ceil")).toBe("오후 10시 10분");
    expect(clockText(BASE, 599, 0, "floor")).toBe("오후 10시");
    expect(clockText("2026-08-14T11:00:00+09:00", 3600, 0, "floor")).toBe("오후 12시");
    expect(clockText(BASE, 50 * 3600, 0, "floor")).toBe("8월 17일 오전 0시");
    expect(clockText(BASE, 26 * 3600, 0, "floor")).toBe("모레 오전 0시");
  });
  it("완충 시간은 30분 내림, 30분 미만은 UNDER30, 0은 NONE", () => {
    expect(durationText(9000)).toBe("2시간 30분");
    expect(durationText(1799)).toBeNull();
    const p = (batteryS: number | null) => buildFacts({ kind: "PREP", caregiver: true, deviceCls: "VENT_1H", batteryS, cylinderS: 0, extDeclared: false }).battery.state;
    expect([p(9000), p(900), p(0), p(null)]).toEqual(["HOURS", "UNDER30", "NONE", "UNKNOWN"]);
  });
  it("표시 시각이 지금부터 10분 안이면 MAYBE_OUT(반올림 뒤 기준)", () => {
    expect(buildFacts(IN({ batteryEndS: 599 })).battery.state).toBe("MAYBE_OUT"); // 내림 → 22:00 = 지금
    expect(buildFacts(IN({ nowS: 300, batteryEndS: 1199 })).battery.state).toBe("MAYBE_OUT"); // 내림 22:10, 지금 22:05
    expect(buildFacts(IN({ batteryEndS: 600 })).battery.state).toBe("UNTIL");
  });
  it("반올림 때문에 도착 표시가 배터리 표시보다 늦거나 같으면 배정이어도 경고", () => {
    const f = buildFacts(IN({ batteryEndS: 3000, etaS: 2950 })); // 배터리 22:50(내림), 도착 22:50(올림)
    expect(f.warnRunOutFirst).toBe(true);
    // 경고 여유 30분(통합 레드팀 9라운드): 도착 22:50·배터리 23:20은 경고, 도착 22:40이면 경고 없음
    expect(assign.warnRunOutFirst).toBe(true);
    expect(buildFacts(IN({ etaS: 2350 })).warnRunOutFirst).toBe(false);
  });
  it("도착 예정 시각이 지났으면 시각을 지어내지 않고 '지나 확인 중'", () => {
    const f = buildFacts(IN({ nowS: 4000, batteryEndS: 9000, etaS: 3000 }));
    expect(f.plan).toMatchObject({ arriveBy: null, etaPassed: true });
    expect(templateSentences(f).join(" ")).toContain("지나 담당자가 확인");
  });
  it("자원 종류를 모르면 '비상 전원'(지어내지 않음)", () => {
    expect(buildFacts(IN({ resourceKind: null })).plan).toMatchObject({ resource: RESOURCE_UNKNOWN_NOUN });
  });
  it("있을 수 없는 날짜·시각은 입력에서 거부", () => {
    expect(validBaseIso("2026-02-30T10:00:00+09:00")).toBe(false);
    expect(validBaseIso("2026-08-14T25:00:00+09:00")).toBe(false);
    expect(NoticeInput.safeParse(IN({ baseIso: "2026-02-30T10:00:00+09:00" })).success).toBe(false);
  });
  it("조사", () => {
    expect(josa("산소통", "이가")).toBe("산소통이");
    expect(josa("휴대용 전원 장치", "이가")).toBe("휴대용 전원 장치가");
    expect(josa("인공호흡기", "은는")).toBe("인공호흡기는");
  });
});

describe("산소통은 배터리와 따로(레드팀 C1 회귀)", () => {
  // PERFECTO2(내장 0h) + 운영자 확인 실린더 10h
  const hh: HouseholdView = {
    id: "H1", pseudonym: "H-001", cell: { x: 0, y: 0 }, floor: 3, mobilityNeed: false, caregiver: true, tReport: 0, lEndPrev: null,
    device: { specId: "PERFECTO2", specBy: "db_exact", batteryAgeY: 1, charge: { value: 100, source: "device_screen" } },
    ext: [], cylinder: { declared: true, opVerified: { count: 1, hoursLo: 10, auditId: "A1" } },
  };
  it("평시: 배터리 없음(멈춤) + 산소통 10시간, '완전히 충전하면 10시간'이 아니다", () => {
    const f = buildFacts(prepInput(hh));
    expect(f.battery.state).toBe("NONE");
    expect(f.cylinder).toEqual({ state: "HOURS", text: "10시간" });
    const t = templateSentences(f).join(" ");
    expect(t).toContain("바로 멈춥니다");
    expect(t).not.toContain("충전하면");
  });
  it("정전: 배터리 시각 대신 '산소통으로 바꿔 쓰세요' + 산소통 시각", () => {
    const f = buildFacts(outageInput({ hh, baseIso: BASE, nowS: 0, lane: "FALLBACK_SHELTER", resourceKind: null, etaS: null, late119: false })!);
    expect(f.battery.state).toBe("NONE");
    expect(f.cylinder).toEqual({ state: "UNTIL", text: "내일 오전 8시" });
    expect(f.actions).toContain("SWITCH_TO_CYLINDER");
    expect(templateSentences(f).join(" ")).toContain("지금 확인된 산소통으로 바꿔 쓰세요");
    expect(verify(f, ["보호자님, 정전으로 산소발생기 전원이 끊겼습니다.", "산소발생기 배터리는 적어도 내일 오전 8시까지 버팁니다.", "가까운 쉼터로 옮기도록 담당자가 연락합니다.", "연락을 받을 수 있게 전화를 곁에 두세요.", "연락이 오면 안내를 따라 주세요."]).ok).toBe(false);
  });
});

describe("1차 검사가 잡아야 하는 우회 문장(레드팀 10/18)", () => {
  const H = "보호자님, 정전으로 인공호흡기 전원이 끊겼습니다.";
  const ACT = ["연락을 받을 수 있게 전화를 곁에 두세요.", "연락이 오면 안내를 따라 주세요."];
  const SH = [H, "배터리는 계산상 오후 11시 20분까지 버팁니다.", "가까운 쉼터로 옮기도록 담당자가 연락합니다.", ...ACT];
  const good = (f: NoticeFacts) => templateSentences(f);
  it("정답 글은 통과", () => {
    expect(verify(shelter, SH).ok).toBe(true);
    expect(verify(gap, good(gap)).ok).toBe(true);
  });
  const cases: [string, NoticeFacts, string[], string][] = [
    ["B1 119 금지(AI 본문에 119)", shelter, [...SH, "숨이 차도 119에는 전화하지 마세요."], "STRAY_NUMBER"],
    ["B2 위급 시 123", shelter, [...SH, "위급하면 한전 123에 먼저 전화하세요."], "STRAY_NUMBER"],
    ["B10 날짜 하루 밀기", shelter, SH.map((s) => s.replace("계산상 오후", "계산상 내일 오후")), "NUMBER_WORD"],
    ["B11 이틀", shelter, [...SH, "그 뒤에도 배터리는 이틀은 더 갑니다."], "NUMBER_WORD"],
    ["B11b 밤새", shelter, [...SH, "배터리는 밤새 쓰셔도 됩니다."], "NUMBER_WORD"],
    ["B12 전각 숫자", shelter, [...SH, "배터리는 오후 １１시까지 갑니다."], "STRAY_NUMBER"],
    ["B13 세시경", shelter, [...SH, "담당자는 세시경 연락합니다."], "NUMBER_WORD"],
    ["B17 기기 꺼 주세요", shelter, [...SH, "기기를 꺼 주세요."], "BANNED"],
    ["B17b 꺼두세요", shelter, [...SH, "쓰지 않을 때는 기기를 꺼두세요."], "BANNED"],
    ["B17c 배터리 아끼기", shelter, [...SH, "배터리를 아껴 쓰세요."], "BANNED"],
    ["B18 차 시동", shelter, [...SH, "차 시동을 걸어 연결하세요."], "BANNED"],
    ["B20 도착 '지나서'", assign, templateSentences(assign).map((s) => s.replace("까지 집에 도착합니다", "이 지나서 도착합니다")), "ROLE_MISMATCH"],
    ["시각 뒤바꿈", gap, good(gap).map((s) => s.replace("오후 11시 20분", "@").replace("내일 오전 0시 10분", "오후 11시 20분").replace("@", "내일 오전 0시 10분")), "ROLE_MISMATCH"],
    ["한 문장에 시각 둘", gap, ["배터리는 오후 11시 20분까지, 전원은 내일 오전 0시 10분 도착.", ...good(gap).slice(1)], "MULTI_TIME"],
    ["시각 숫자 변경", gap, good(gap).map((s) => s.replace("11시 20분", "11시 30분")), "STRAY_NUMBER"],
    ["시각 빠짐", gap, good(gap).filter((s) => !s.includes("도착합니다")), "MISSING_TEXT"],
    ["부분 표기만(오후 11시)", gap, good(gap).map((s) => s.replace("오후 11시 20분", "오후 11시")), "STRAY_NUMBER"],
    ["정하지 않은 수단(구급대)", gap, [...good(gap), "구급대도 함께 갑니다."], "UNSUPPORTED"],
    ["다른 장비", gap, [...good(gap), "이동식 발전기도 보냅니다."], "UNSUPPORTED"],
    ["안심 약속", gap, [...good(gap), "괜찮을 거예요."], "BANNED"],
    ["증상 판단", gap, [...good(gap), "숨쉬기가 힘들면 담당자에게 알리세요."], "BANNED"],
    ["할 일 빠짐(전화 곁에)", gap, good(gap).filter((s) => !s.includes("곁에")), "MISSING_SENTENCE"],
    ["경고 빠짐(먼저)", gap, good(gap).filter((s) => !s.includes("먼저")), "MISSING_SENTENCE"],
    ["영문 코드", gap, good(gap).map((s) => s.replace("외장 배터리가", "외장 배터리(EXT-2)가")), "LATIN"],
  ];
  for (const [name, f, sents, code] of cases) {
    it(`거부: ${name}`, () => {
      const r = verify(f, sents);
      expect(r.ok).toBe(false);
      expect(r.violations.map((v) => v.code)).toContain(code);
    });
  }
});

describe("통합 레드팀 1라운드 회귀", () => {
  it("119 이송 예정 시각이 지나면 '아직 정해지지 않았다'가 아니라 '지나 확인 중'", () => {
    const f = buildFacts(IN({ lane: "FALLBACK_119", resourceKind: null, nowS: 5000, batteryEndS: 9000, etaS: 4000 }));
    expect(f.plan).toMatchObject({ type: "CALL119", doneBy: null, etaPassed: true });
    const t = templateSentences(f).join(" ");
    expect(t).toContain("지나 담당자가 확인");
    expect(t).not.toContain("아직 정해지지");
  });
  it("「수정」 119(시각 없음)는 늦음·먼저 소진을 보수적으로 경고", () => {
    const f = buildFacts(IN({ lane: "FALLBACK_119", resourceKind: null, etaS: null, late119: false }));
    expect(f.plan).toMatchObject({ late: true });
    expect(f.warnRunOutFirst).toBe(true);
  });
  it("정전 중 안내에 '정전이 끝났다'·'전기가 다시 들어왔다'를 쓰면 1차 거부", () => {
    const r = verify(shelter, [...templateSentences(shelter), "이제 전기가 다시 들어왔습니다."]);
    expect(r.violations.map((v) => v.code)).toContain("BANNED");
  });
  it("평시 안내에는 대체장소·절전(의료진 확인) 고정 문장이 붙는다", () => {
    const f = buildFacts({ kind: "PREP", caregiver: true, deviceCls: "VENT_3H", batteryS: 9000, cylinderS: 0, extDeclared: false });
    const t = tailSentences(f).join(" ");
    expect(t).toContain("갈 곳");
    expect(t).toContain("절전");
  });
  it("산소통 가구 재신고: 배터리 끝이 직전보다 늘지 않는다", () => {
    const base: HouseholdView = {
      id: "H2", pseudonym: "H-002", cell: { x: 0, y: 0 }, floor: 3, mobilityNeed: false, caregiver: true, tReport: 0, lEndPrev: null,
      device: { specId: "PERFECTO2", specBy: "db_exact", batteryAgeY: 1, charge: { value: 100, source: "device_screen" } },
      ext: [], cylinder: { declared: true, opVerified: { count: 1, hoursLo: 10, auditId: "A1" } },
    };
    const a = outageInput({ hh: base, baseIso: BASE, nowS: 0, lane: "FALLBACK_SHELTER", resourceKind: null, etaS: null, late119: false })!;
    const b = outageInput({ hh: { ...base, tReport: 2, lEndPrev: 10 }, baseIso: BASE, nowS: 7200, lane: "FALLBACK_SHELTER", resourceKind: null, etaS: null, late119: false })!;
    if (a.kind !== "OUTAGE" || b.kind !== "OUTAGE") throw new Error();
    expect((b.batteryEndS ?? 0)).toBeLessThanOrEqual(Math.max(a.batteryEndS ?? 0, 0));
  });
});

describe("통합 레드팀 2라운드 회귀", () => {
  const vent: HouseholdView = {
    id: "H3", pseudonym: "H-003", cell: { x: 0, y: 0 }, floor: 3, mobilityNeed: false, caregiver: true, tReport: 0, lEndPrev: null,
    device: { specId: "LTV1150", specBy: "db_exact", batteryAgeY: 1, charge: { value: 100, source: "device_screen" } },
    ext: [], cylinder: { declared: true, opVerified: { count: 1, hoursLo: 10, auditId: "A1" } },
  };
  it("인공호흡기에는 산소통을 셈하지 않는다(산소통으로 바꿔 쓰라는 안내 없음)", () => {
    const i = outageInput({ hh: vent, baseIso: BASE, nowS: 0, lane: "FALLBACK_SHELTER", resourceKind: null, etaS: null, late119: false })!;
    const f = buildFacts(i);
    expect(f.cylinder).toBeNull();
    expect(templateSentences(f).join(" ")).not.toContain("산소통");
  });
  it("배터리가 아직 있으면 '배터리가 떨어지면 바꿔 쓰기', 없으면 '지금'·산소통 끝 = 지금+산소통 시간", () => {
    const after = buildFacts(IN({ deviceCls: "O2_PORT", lane: "FALLBACK_SHELTER", resourceKind: null, etaS: null, batteryEndS: 7200, cylinderEndS: 7200 + 36000, cylinderS: 36000 }));
    expect(after.actions).toContain("SWITCH_AFTER_BATTERY");
    expect(templateSentences(after).join(" ")).toContain("배터리가 떨어지면 확인된 산소통으로");
    const now = buildFacts(IN({ deviceCls: "O2_STAT", lane: "FALLBACK_SHELTER", resourceKind: null, etaS: null, batteryEndS: 0, batteryLs: 0, nowS: 3600, cylinderEndS: 50000, cylinderS: 7200 }));
    expect(now.actions).toContain("SWITCH_TO_CYLINDER");
    // 12라운드: 기준 시각은 지금이 아니라 처음 바꿔 써야 했던 때(배터리 없음이면 배터리 끝 22:00) → 22:00 + 2h = 0시(보수)
    expect(now.cylinder).toEqual({ state: "UNTIL", text: "내일 오전 0시" });
  });
  it("고정 문안: 경고는 수단 문장 뒤, 앞 문장이 '적어도 …까지 버팁니다'가 아니다", () => {
    for (const i of [IN({ lane: "GAP_REDUCE", etaS: 9000 }), IN({ lane: "FALLBACK_119", resourceKind: null, etaS: null }), IN({ lane: "FALLBACK_119", resourceKind: null, nowS: 5000, batteryEndS: 9000, etaS: 4000 })]) {
      const t = templateSentences(buildFacts(i));
      const k = t.findIndex((s) => s.includes("먼저 떨어질"));
      expect(k).toBeGreaterThan(0);
      expect(t[k - 1]).not.toContain("버팁니다");
      expect(t[k]).toMatch(/(오기 전에)/);
    }
  });
  it("평시 고정 문장은 45자 이내, 배터리 없는 기기엔 절전 문장 없음", () => {
    for (const bs of [0, 9000, null]) for (const ext of [true, false]) {
      const f = buildFacts({ kind: "PREP", caregiver: true, deviceCls: "O2_STAT", batteryS: bs, cylinderS: 0, extDeclared: ext });
      for (const s of tailSentences(f)) expect(s.length).toBeLessThanOrEqual(45);
      if (bs === 0) expect(tailSentences(f).join(" ")).not.toContain("절전");
    }
  });
  it("1차: 산소통 바꿔 쓰기 문장에 부정어가 있으면 필수 충족이 아님", () => {
    const f = buildFacts(IN({ deviceCls: "O2_STAT", lane: "FALLBACK_SHELTER", resourceKind: null, etaS: null, batteryEndS: 0, batteryLs: 0, nowS: 3600, cylinderEndS: 50000, cylinderS: 7200 }));
    const t = templateSentences(f).map((s) => s.replace("지금 확인된 산소통으로 바꿔 쓰세요.", "지금 산소통으로 바꿔 쓰지는 마세요."));
    expect(verify(f, t).violations.map((v) => v.code)).toContain("MISSING_SENTENCE");
  });
  it("1차: 이송 시각이 지났는데 '아직'이면 거부", () => {
    const f = buildFacts(IN({ lane: "FALLBACK_119", resourceKind: null, nowS: 5000, batteryEndS: 9000, etaS: 4000 }));
    expect(verify(f, [...templateSentences(f), "구급대가 언제 올지는 아직 정해지지 않았습니다."]).ok).toBe(false);
  });
  it("2차: 금지 지시는 예외 없이 거부('바꿔 쓰지 마세요'·'배달 기다리지 마세요' 모두)", () => {
    const f = buildFacts(IN({ deviceCls: "O2_STAT", lane: "PROPOSE_ASSIGN", resourceKind: "O2_CYL_DELIVERY", batteryEndS: 0, batteryLs: 0, nowS: 3600, cylinderEndS: 50000, cylinderS: 7200, etaS: 9000 }));
    const base = truthClaims(f);
    const bad = { ...base, actions: [...base.actions.filter((a) => a.kind !== "SWITCH_TO_CYLINDER"), { kind: "SWITCH_TO_CYLINDER" as const, when: "now" as const, batteryScope: "unspecified" as const, negated: true, quote: "지금 산소통으로 바꿔 쓰지 마세요" }] };
    expect(compareClaims(f, bad).length).toBeGreaterThan(0);
    const ok = { ...base, actions: [...base.actions, { kind: "SWITCH_TO_CYLINDER" as const, when: "now" as const, batteryScope: "unspecified" as const, negated: true, quote: "추가 산소통 배달은 기다리지 마세요" }] };
    expect(compareClaims(f, ok).length).toBeGreaterThan(0);
  });
});

describe("통합 레드팀 4라운드 회귀", () => {
  it("도착이 계산상 끝과 같거나 30분 안이면 경고는 '계산보다 일찍 떨어지면 도착 전에 멈출 수 있다'(조건부 '늦어지면' 없음, 10라운드)", () => {
    const f = buildFacts(IN({ batteryEndS: 3000, etaS: 2950 })); // 둘 다 22:50
    expect(f).toMatchObject({ warnRunOutFirst: true, warnTight: true });
    const t = templateSentences(f).join(" ");
    expect(t).toContain("배터리가 계산보다 일찍 떨어지면 도착 전에 기기가 멈출 수 있습니다");
    expect(t).not.toContain("늦어지면");
    expect(verify(f, templateSentences(f)).ok).toBe(true);
    const c = buildFacts(IN({ lane: "FALLBACK_119", resourceKind: null, batteryEndS: 3000, etaS: 2950 }));
    expect(templateSentences(c).join(" ")).toContain("구급대 도착 전에 기기가 멈출");
    expect(verify(f, templateSentences(f).map((s) => (s.includes("일찍 떨어지면") ? "도착이 늦어지면 배터리가 먼저 떨어질 수 있습니다." : s))).ok).toBe(false);
  });
  it("모든 조합에서 '오기 전에 먼저' 경고가 있으면 표시 도착이 보호 끝보다 늦거나 시각이 없다", () => {
    for (const i of allInputs()) {
      const f = buildFacts(i);
      if (!f.warnRunOutFirst || f.warnTight) continue;
      const p = f.plan;
      const help = p && p.type !== "SHELTER" ? (p.type === "CALL119" ? p.doneBy : p.arriveBy) : null;
      if (help == null) continue;
      expect(f.battery.state === "UNTIL" || f.cylinder?.state === "UNTIL").toBe(true);
    }
  });
  it("공백 단축이라도 표시 도착이 배터리 끝보다 이르면 경고하지 않는다", () => {
    expect(buildFacts(IN({ lane: "GAP_REDUCE", batteryEndS: 9000, etaS: 3000 })).warnRunOutFirst).toBe(false);
  });
  const o2 = (over: Partial<HouseholdView>): HouseholdView => ({
    id: "H4", pseudonym: "H-004", cell: { x: 0, y: 0 }, floor: 3, mobilityNeed: false, caregiver: true, tReport: 0, lEndPrev: null,
    device: { specId: "PERFECTO2", specBy: "db_exact", batteryAgeY: 1, charge: { value: 100, source: "device_screen" } },
    ext: [], cylinder: { declared: true, opVerified: { count: 1, hoursLo: 10, auditId: "A1" } }, ...over,
  });
  it("산소통 확인값을 낮춰도(10h→2h) 배터리 끝이 늘지 않는다(직전 배터리 끝 기준)", () => {
    const hh = o2({ tReport: 1, lEndPrev: 11, lEndPrevBattery: 1, cylinder: { declared: true, opVerified: { count: 1, hoursLo: 2, auditId: "A2" } } });
    const i = outageInput({ hh, baseIso: BASE, nowS: 3 * 3600, lane: "FALLBACK_SHELTER", resourceKind: null, etaS: null, late119: false })!;
    if (i.kind !== "OUTAGE") throw new Error();
    expect(i.batteryEndS!).toBeLessThanOrEqual(3600);
    const f = buildFacts(i);
    expect(f.actions).toContain("SWITCH_TO_CYLINDER");
  });
  it("재신고 뒤 산소통을 확인하면 산소통은 '이미 다 썼을 수 있다'가 아니다", () => {
    const hh = o2({ tReport: 2, lEndPrev: 2, lEndPrevBattery: 2 });
    const f = buildFacts(outageInput({ hh, baseIso: BASE, nowS: 2 * 3600 + 600, lane: "FALLBACK_SHELTER", resourceKind: null, etaS: null, late119: false })!);
    expect(f.cylinder?.state).toBe("UNTIL");
  });
  it("배터리가 있는 기기의 충전 0%는 '배터리 없음'이 아니라 '거의 없음'", () => {
    const hh: HouseholdView = { ...o2({}), device: { specId: "LTV1150", specBy: "db_exact", batteryAgeY: 1, charge: { value: 0, source: "device_screen" } }, cylinder: undefined };
    const f = buildFacts(outageInput({ hh, baseIso: BASE, nowS: 0, lane: "FALLBACK_SHELTER", resourceKind: null, etaS: null, late119: false })!);
    expect(f.battery.state).toBe("MAYBE_OUT");
  });
  it("배터리·산소통 없는 산소발생기의 평시 안내에도 '갈 곳' 고정 문장이 있다", () => {
    const f = buildFacts({ kind: "PREP", caregiver: true, deviceCls: "O2_STAT", batteryS: 0, cylinderS: 0, extDeclared: false });
    expect(tailSentences(f).join(" ")).toContain("갈 곳");
  });
  it("도착 시각 문장에 '배터리'를 넣어 배터리 시각처럼 쓰면 1차 거부(수단 이름 속 낱말은 예외)", () => {
    const a = buildFacts(IN({}));
    expect(verify(a, templateSentences(a).map((s) => s.replace("휴대용 전원 장치가 오후 10시 50분까지 집에 도착합니다.", "배터리는 장치가 도착하는 오후 10시 50분까지 갑니다."))).ok).toBe(false);
    const ext = buildFacts(IN({ resourceKind: "RENTAL_EXT" }));
    expect(verify(ext, templateSentences(ext)).ok).toBe(true);
  });
});

describe("통합 레드팀 5라운드 회귀", () => {
  const vent = (charge: HouseholdView["device"]["charge"]): HouseholdView => ({
    id: "H5", pseudonym: "H-005", cell: { x: 0, y: 0 }, floor: 3, mobilityNeed: false, caregiver: true, tReport: 0, lEndPrev: null,
    device: { specId: "LTV1150", specBy: "db_exact", batteryAgeY: 1, charge }, ext: [],
  });
  const foot = (hh: HouseholdView) => compose(buildFacts(outageInput({ hh, baseIso: BASE, nowS: 0, lane: "FALLBACK_SHELTER", resourceKind: null, etaS: null, late119: false })!), null).footer;
  it("충전량을 알리지 않은 집의 꼬리말에 '알려 주신 충전량'이 없다", () => {
    const f = foot(vent({ value: null, source: "unknown" }));
    expect(f).not.toContain("알려 주신");
    expect(f).toContain("충전량을 몰라");
    expect(foot(vent({ value: 80, source: "device_screen" }))).toContain("알려 주신 충전량");
  });
  it("도움 시각이 글에 없으면 꼬리말에 '과 시각'이 없다", () => {
    expect(compose(buildFacts(IN({ etaS: null })), null).footer).not.toContain("과 시각");
    expect(compose(buildFacts(IN({})), null).footer).toContain("과 시각");
  });
  it("근거 표지는 사실표(프롬프트)를 바꾸지 않는다", () => {
    const i = IN({});
    expect(noticeUser(buildFacts({ ...i, batteryBasis: "chargeUnknown" } as NoticeInputT))).toBe(noticeUser(buildFacts(i)));
  });
});

describe("통합 레드팀 6라운드 회귀", () => {
  it("30분 미만: '충전하지 않으면 30분을 못 버팁니다'는 1차 거부, 전제가 완충이 아니면 2차 거부", () => {
    const f = buildFacts({ kind: "PREP", caregiver: true, deviceCls: "VENT_1H", batteryS: 1200, cylinderS: 0, extDeclared: false });
    expect(f.battery.state).toBe("UNDER30");
    const t = templateSentences(f);
    expect(verify(f, t).ok).toBe(true);
    expect(verify(f, t.map((s) => s.includes("30분") ? "충전하지 않으면 배터리는 30분을 못 버팁니다." : s)).ok).toBe(false);
    const c = truthClaims(f);
    expect(compareClaims(f, c)).toEqual([]);
    for (const condition of ["without_charge", "current_state", "unspecified"] as const) expect(compareClaims(f, { ...c, battery: { ...c.battery, condition } }).length).toBeGreaterThan(0);
  });
  it("정전 중 시각: '완전히 충전하면 …까지'는 1·2차 모두 거부", () => {
    const f = buildFacts(IN({}));
    const t = templateSentences(f);
    const bad = t.map((s) => (s.includes("배터리") && s.includes("계산상") ? s.replace("배터리는", "완전히 충전하면 배터리는") : s));
    expect(bad.join(" ")).toContain("충전하면");
    expect(verify(f, bad).ok).toBe(false);
    const c = truthClaims(f);
    expect(compareClaims(f, { ...c, battery: { ...c.battery, condition: "full_charge" } }).length).toBeGreaterThan(0);
    expect(compareClaims(f, { ...c, battery: { ...c.battery, condition: "current_state" } })).toEqual([]);
  });
});

describe("통합 레드팀 7라운드 회귀", () => {
  const f = buildFacts(IN({ deviceCls: "O2_PORT", lane: "PROPOSE_ASSIGN", resourceKind: "ESS_S", batteryEndS: 3600, cylinderEndS: 3600 + 7200, cylinderS: 7200, etaS: 5400 }));
  const swap = (to: string) => templateSentences(f).map((s) => (s.includes("산소통으로 바꿔") ? to : s));
  it("배터리가 떨어지면 바꿔 쓰기: 고정 문안 통과, '도착하면'·'연락이 오면'·'떨어지기 전에 미리'는 1차 거부", () => {
    expect(f.actions).toContain("SWITCH_AFTER_BATTERY");
    expect(verify(f, templateSentences(f)).ok).toBe(true);
    for (const bad of ["배터리 대신 전원 장치가 도착하면 산소통으로 바꿔 쓰세요.", "배터리가 남아 있어도 연락이 오면 산소통으로 바꿔 쓰세요.", "배터리가 떨어지기 전에 미리 산소통으로 바꿔 쓰세요."])
      expect(verify(f, swap(bad)).ok, bad).toBe(false);
    expect(verify(f, swap("배터리가 다 떨어지면 집에 있는 확인된 산소통으로 바꿔 쓰세요.")).ok).toBe(true);
  });
  it("2차: 바꿔 쓰기 조건이 '배터리가 떨어지면'이 아니면 거부", () => {
    const c = truthClaims(f);
    expect(compareClaims(f, c)).toEqual([]);
    for (const when of ["after_condition", "now", "unspecified"] as const)
      expect(compareClaims(f, { ...c, actions: c.actions.map((a) => (a.kind === "SWITCH_TO_CYLINDER" ? { ...a, when } : a)) }).length, when).toBeGreaterThan(0);
  });
});

describe("통합 레드팀 8라운드 회귀", () => {
  const vent8 = (verified: boolean): HouseholdView => ({
    id: "H8", pseudonym: "H-008", cell: { x: 0, y: 0 }, floor: 3, mobilityNeed: false, caregiver: true, tReport: 0, lEndPrev: null,
    device: { specId: "ASTRAL150", specBy: "db_exact", batteryAgeY: 1, charge: { value: 90, source: "device_screen" } },
    ext: [{ extSpecId: "ASTRAL_EXT", declaredCount: 2, opVerified: verified ? { count: 2, chargeConfirmed: null, extAgeY: null, auditId: "A8" } : null }],
  });
  it("확인 외장이 합쳐진 평시 시간: 고정 문안은 '외장 배터리까지 합쳐', 기기 배터리만처럼 쓰면 1·2차 거부", () => {
    const i = prepInput(vent8(true));
    if (i.kind !== "PREP") throw new Error();
    expect(i.batteryExtS ?? 0).toBeGreaterThan(0);
    const f = buildFacts(i);
    expect(f.batteryWithExt).toBe(true);
    const t = templateSentences(f);
    expect(t.join(" ")).toContain("외장 배터리까지 합쳐");
    expect(verify(f, t).ok).toBe(true);
    const b = f.battery.state === "HOURS" ? f.battery.text : "";
    expect(verify(f, t.map((s) => (s.includes(b) ? `인공호흡기 배터리는 완전히 충전하면 적어도 ${b} 버팁니다.` : s))).ok).toBe(false);
    const c = truthClaims(f);
    expect(compareClaims(f, c)).toEqual([]);
    for (const x of ["no", "not_mentioned"] as const) expect(compareClaims(f, { ...c, battery: { ...c.battery, includesExternal: x } }).length).toBeGreaterThan(0);
  });
  it("신고만 한 외장은 합산 표지가 없고, '외장까지 합쳐'라고 하면 2차 거부", () => {
    const f = buildFacts(prepInput(vent8(false)));
    expect(f.batteryWithExt).toBeUndefined();
    const c = truthClaims(f);
    expect(compareClaims(f, { ...c, battery: { ...c.battery, includesExternal: "yes" } }).length).toBeGreaterThan(0);
  });
  it("정전 중 확인 외장 합산 시각도 '외장'을 써야 하고, 고정 문안은 통과", () => {
    const f = buildFacts(outageInput({ hh: vent8(true), baseIso: BASE, nowS: 0, lane: "FALLBACK_SHELTER", resourceKind: null, etaS: null, late119: false })!);
    expect(f.batteryWithExt).toBe(true);
    expect(verify(f, templateSentences(f)).ok).toBe(true);
  });
  it("바꿔 쓰기에 다른 조건을 겹치면 1차 거부('기다렸다가'·'닿은 뒤에'·'안내를 받고'·'허락을 받은 다음')", () => {
    const f = buildFacts(IN({ deviceCls: "O2_PORT", lane: "PROPOSE_ASSIGN", resourceKind: "ESS_S", batteryEndS: 3600, cylinderEndS: 3600 + 7200, cylinderS: 7200, etaS: 5400 }));
    const swap = (to: string) => templateSentences(f).map((s) => (s.includes("산소통으로 바꿔") ? to : s));
    for (const bad of ["배터리가 떨어지면 전원 장치를 기다렸다가 산소통으로 바꿔 쓰세요.", "배터리가 떨어지면 장치가 닿은 뒤에 산소통으로 바꿔 쓰세요.", "배터리가 떨어지면 안내를 받고 산소통으로 바꿔 쓰세요.", "배터리가 떨어지면 허락을 받은 다음 산소통으로 바꿔 쓰세요."])
      expect(verify(f, swap(bad)).ok, bad).toBe(false);
  });
});

describe("통합 레드팀 9라운드 회귀", () => {
  it("배터리·산소통 시각이 있으면 코드가 '계산값이라 더 일찍 떨어질 수 있다'를 붙이고, 본문 '적어도'는 1차 거부", () => {
    const f = buildFacts(IN({}));
    expect(tailSentences(f)[0]).toBe("배터리 시각은 계산값이라 더 일찍 떨어질 수 있습니다.");
    const t = templateSentences(f);
    expect(t.join(" ")).not.toContain("적어도");
    expect(verify(f, t.map((s) => s.replace("계산상", "적어도"))).ok).toBe(false);
    const p = buildFacts({ kind: "PREP", caregiver: true, deviceCls: "VENT_8H", batteryS: 7 * 3600, cylinderS: 0, extDeclared: false });
    expect(tailSentences(p)[0]).toBe("배터리 시간은 계산값이라 더 짧을 수 있습니다.");
    expect(tailSentences(buildFacts(IN({ batteryEndS: null, batteryLs: null })))[0]).toBe("위급하면 바로 119에 전화하세요.");
  });
  it("표시 시각이 같지 않은 경고를 '늦어지면'에 달면 1·2차 거부", () => {
    const f = buildFacts(IN({ lane: "GAP_REDUCE", resourceKind: "MOBILE_GEN", etaS: 4800 + 3 * 3600 }));
    expect(f).toMatchObject({ warnRunOutFirst: true, warnTight: false });
    const t = templateSentences(f);
    expect(verify(f, t).ok).toBe(true);
    expect(verify(f, t.map((s) => (s.includes("먼저 떨어질") ? "도착이 늦어지면 배터리가 먼저 떨어질 수 있습니다." : s))).ok).toBe(false);
    const c = truthClaims(f);
    expect(compareClaims(f, c)).toEqual([]);
    expect(compareClaims(f, { ...c, warningOnlyIfHelpLate: true }).length).toBeGreaterThan(0);
  });
  it("외장 합산 문장에 '외장 없이·말고·만으로·내장'을 쓰면 1차 거부", () => {
    const f = buildFacts({ kind: "PREP", caregiver: true, deviceCls: "VENT_8H", batteryS: 40000, cylinderS: 0, extDeclared: true, batteryExtS: 20000 });
    const b = f.battery.state === "HOURS" ? f.battery.text : "";
    for (const bad of [`외장 배터리 없이도 완전히 충전하면 계산상 ${b} 버팁니다.`, `내장 배터리만으로 외장 없이 계산상 ${b} 버팁니다.`])
      expect(verify(f, templateSentences(f).map((s) => (s.includes(b) ? bad : s))).ok, bad).toBe(false);
  });
  it("어림 수사·때 표현('서너 시간'·'한나절'·'동틀 무렵')은 표기 밖 시간으로 1차 거부", () => {
    const f = buildFacts(IN({ lane: "FALLBACK_SHELTER", resourceKind: null, etaS: null }));
    const t = templateSentences(f);
    expect(verify(f, t).ok).toBe(true);
    for (const x of ["서너 시간 안에 연락이 갑니다.", "한나절 안에 연락이 갑니다.", "동틀 무렵 연락이 갑니다."]) expect(verify(f, [...t, x]).ok, x).toBe(false);
  });
  it("확인 산소통과 확인 외장이 함께면 외장을 포함하고 산소통 끝 = 외장까지 다 쓴 뒤 + 산소통(13라운드에 9라운드 정책 되돌림)", () => {
    const hh: HouseholdView = {
      id: "H9", pseudonym: "H-009", cell: { x: 0, y: 0 }, floor: 3, mobilityNeed: false, caregiver: true, tReport: 0, lEndPrev: null,
      device: { specId: "INOGEN_G5", specBy: "db_exact", batteryAgeY: 1, charge: { value: 100, source: "device_screen" } },
      ext: [{ extSpecId: "INOGEN_G5_DOUBLE", declaredCount: 1, opVerified: { count: 1, chargeConfirmed: null, extAgeY: null, auditId: "A9" } }],
      cylinder: { declared: true, opVerified: { count: 1, hoursLo: 3, auditId: "C9" } },
    };
    const i = outageInput({ hh, baseIso: BASE, nowS: 0, lane: "FALLBACK_SHELTER", resourceKind: null, etaS: null, late119: false })!;
    if (i.kind !== "OUTAGE") throw new Error();
    expect(i.batteryExtS).toBeGreaterThan(0);
    expect(i.cylinderEndS).toBe((i.batteryEndS ?? 0) + i.cylinderS);
    expect(templateSentences(buildFacts(i)).join(" ")).toContain("외장 배터리까지 다 떨어지면");
  });
});

describe("통합 레드팀 10라운드 회귀", () => {
  it("사실표·화면 뜻 설명(ROLE_KO)과 생성 프롬프트에 '적어도'가 없다", () => {
    for (const v of Object.values(ROLE_KO)) expect(v).not.toContain("적어도");
    for (const i of allInputs().slice(0, 400)) expect(noticeUser(buildFacts(i))).not.toContain("적어도");
  });
  it("하한 보장 동의어('최소한'·'넉넉히'·'거뜬히'·'그 전에는 멈추지 않습니다')는 1차 거부", () => {
    const f = buildFacts(IN({ lane: "FALLBACK_SHELTER", resourceKind: null, etaS: null }));
    const t = templateSentences(f);
    for (const w of ["최소한", "넉넉히", "거뜬히", "족히"]) expect(verify(f, t.map((s) => s.replace("계산상", w))).ok, w).toBe(false);
    expect(verify(f, [...t, "그 전에는 멈추지 않습니다."]).ok).toBe(false);
  });
  it("확인 외장+산소통 집은 외장을 늘 포함하고, 바꿔 쓰기는 '외장 배터리까지 다 떨어지면'(13라운드: 엔진 배정 근거와 같게)", () => {
    const hh: HouseholdView = {
      id: "H10", pseudonym: "H-010", cell: { x: 0, y: 0 }, floor: 3, mobilityNeed: false, caregiver: true, tReport: 0, lEndPrev: null,
      device: { specId: "INOGEN_G5", specBy: "db_exact", batteryAgeY: 1, charge: { value: 0, source: "device_screen" } },
      ext: [{ extSpecId: "INOGEN_G5_DOUBLE", declaredCount: 1, opVerified: { count: 1, chargeConfirmed: null, extAgeY: null, auditId: "A10" } }],
      cylinder: { declared: true, opVerified: { count: 1, hoursLo: 3, auditId: "C10" } },
    };
    const f = buildFacts(outageInput({ hh, baseIso: BASE, nowS: 0, lane: "PROPOSE_ASSIGN", resourceKind: "ESS_S", etaS: 4 * 3600, late119: false })!);
    expect(f.battery.state).toBe("UNTIL");
    expect(f.batteryWithExt).toBe(true);
    expect(f.actions).toContain("SWITCH_AFTER_BATTERY");
    const t = templateSentences(f);
    expect(t.join(" ")).toContain("외장 배터리까지 다 떨어지면 산소통으로 바꿔 쓰세요");
    expect(f.warnRunOutFirst).toBe(false); // 외장 2h16m + 산소통 3h > 도착 4h
    expect(verify(f, t).ok).toBe(true);
    // 외장을 빼고 '배터리가 떨어지면'만 쓰면 1차 거부
    expect(verify(f, t.map((s) => (s.includes("산소통으로 바꿔") ? "배터리가 떨어지면 확인된 산소통으로 바꿔 쓰세요." : s))).ok).toBe(false);
  });
});

describe("통합 레드팀 11라운드 회귀", () => {
  it("확인 외장+산소통 집: 시계가 흘러도 '경고 있음 → 없음'으로 뒤집히지 않는다(외장 제외 판정 = 표시 규칙)", () => {
    const hh: HouseholdView = {
      id: "H11", pseudonym: "H-011", cell: { x: 0, y: 0 }, floor: 3, mobilityNeed: false, caregiver: true, tReport: 0, lEndPrev: null,
      device: { specId: "INOGEN_G5", specBy: "db_exact", batteryAgeY: 1, charge: { value: 7, source: "device_screen" } },
      ext: [{ extSpecId: "INOGEN_G5_DOUBLE", declaredCount: 1, opVerified: { count: 1, chargeConfirmed: null, extAgeY: null, auditId: "A11" } }],
      cylinder: { declared: true, opVerified: { count: 1, hoursLo: 3, auditId: "C11" } },
    };
    let warned = false;
    for (let now = 0; now <= 3600; now += 60) {
      const f = buildFacts(outageInput({ hh, baseIso: BASE, nowS: now, lane: "PROPOSE_ASSIGN", resourceKind: "ESS_S", etaS: now + 5 * 3600, late119: false })!);
      // 외장을 뺐는데 MAYBE_OUT으로 떨어지는 조합이 없어야 한다
      if (f.battery.state !== "UNTIL") expect(f.batteryWithExt).toBeUndefined();
      if (warned) expect(f.warnRunOutFirst, `now ${now}`).toBe(true);
      warned = warned || f.warnRunOutFirst;
    }
  });
  it("도착이 계산상 끝보다 늦은 경고를 '계산보다 일찍 떨어지면'으로 조건부화하면 1·2차 거부", () => {
    const f = buildFacts(IN({ lane: "GAP_REDUCE", resourceKind: "MOBILE_GEN", etaS: 4800 + 3600 }));
    expect(f).toMatchObject({ warnRunOutFirst: true, warnTight: false });
    const t = templateSentences(f);
    expect(verify(f, t.map((s) => (s.includes("먼저 떨어질") ? "배터리가 계산보다 일찍 떨어지면 도착보다 먼저 멈출 수 있습니다." : s))).ok).toBe(false);
    const c = truthClaims(f);
    expect(compareClaims(f, c)).toEqual([]);
    expect(compareClaims(f, { ...c, warningOnlyIfSupplyEarly: true }).length).toBeGreaterThan(0);
    const tight = buildFacts(IN({}));
    expect(compareClaims(tight, { ...truthClaims(tight), warningOnlyIfSupplyEarly: true })).toEqual([]);
  });
  it("평시 갈 곳 문장은 조건 없이", () => {
    const f = buildFacts({ kind: "PREP", caregiver: true, deviceCls: "O2_STAT", batteryS: 0, cylinderS: 0, extDeclared: false });
    expect(tailSentences(f)).toContain("정전 때 갈 곳을 담당자와 미리 정해 두세요.");
  });
});

describe("통합 레드팀 12라운드 회귀", () => {
  const sw = buildFacts(IN({ deviceCls: "O2_PORT", lane: "PROPOSE_ASSIGN", resourceKind: "ESS_S", batteryEndS: 7200, cylinderEndS: 7200 + 3 * 3600, cylinderS: 3 * 3600, etaS: 6 * 3600 }));
  it("배터리 다음 바꿔 쓰기인데 '지금 바꿔 쓰면 산소통은 X까지'는 1·2차 거부", () => {
    expect(sw.actions).toContain("SWITCH_AFTER_BATTERY");
    const t = templateSentences(sw);
    expect(verify(sw, t).ok).toBe(true);
    const cx = sw.cylinder?.state === "UNTIL" ? sw.cylinder.text : "";
    expect(verify(sw, t.map((s) => (s.includes(cx) ? `지금 산소통으로 바꿔 쓰면 산소통은 계산상 ${cx}까지 씁니다.` : s))).ok).toBe(false);
    const c = truthClaims(sw);
    expect(compareClaims(sw, c)).toEqual([]);
    expect(compareClaims(sw, { ...c, cylinder: { ...c.cylinder, condition: "now" } }).length).toBeGreaterThan(0);
    expect(compareClaims(sw, { ...c, cylinder: { ...c.cylinder, condition: "unspecified" } })).toEqual([]);
  });
  it("도착을 고정하고 시계만 흘려도 산소통 표시 끝은 늘지 않고, 경고는 한 번 붙으면 사라지지 않는다", () => {
    const hh: HouseholdView = {
      id: "H12", pseudonym: "H-012", cell: { x: 0, y: 0 }, floor: 3, mobilityNeed: false, caregiver: true, tReport: 0, lEndPrev: null,
      device: { specId: "INOGEN_G5", specBy: "db_exact", batteryAgeY: 1, charge: { value: 7, source: "device_screen" } },
      ext: [{ extSpecId: "INOGEN_G5_DOUBLE", declaredCount: 1, opVerified: { count: 1, chargeConfirmed: null, extAgeY: null, auditId: "A12" } }],
      cylinder: { declared: true, opVerified: { count: 1, hoursLo: 1, auditId: "C12" } },
    };
    const toMin = (txt?: string) => { const m = /(내일 )?(오전|오후) (\d+)시(?: (\d+)분)?/.exec(txt ?? ""); if (!m) return null; let h = Number(m[3]) % 12; if (m[2] === "오후") h += 12; return (m[1] ? 1440 : 0) + h * 60 + Number(m[4] ?? 0); };
    for (const eta of [2 * 3600, 3 * 3600]) {
      let warned = false, prevCyl: number | null = null;
      for (let now = 0; now <= 2 * 3600; now += 60) {
        const f = buildFacts(outageInput({ hh, baseIso: BASE, nowS: now, lane: "PROPOSE_ASSIGN", resourceKind: "ESS_S", etaS: eta, late119: false })!);
        const cm = f.cylinder?.state === "UNTIL" ? toMin(f.cylinder.text) : null;
        if (cm != null && prevCyl != null) expect(cm, `eta ${eta} now ${now}`).toBeLessThanOrEqual(prevCyl);
        if (cm != null) prevCyl = cm;
        if (warned && f.cylinder?.state === "UNTIL") expect(f.warnRunOutFirst, `eta ${eta} now ${now}`).toBe(true);
        warned = warned || f.warnRunOutFirst;
      }
    }
  });
});

describe("통합 레드팀 13라운드 회귀", () => {
  it("깨끗한 문장이 있어도 반대 조건 문장을 덧붙이면 1차 거부(바꿔 쓰기·산소통 시각·경고)", () => {
    const f = buildFacts(IN({ deviceCls: "O2_PORT", lane: "PROPOSE_ASSIGN", resourceKind: "ESS_S", batteryEndS: 7200, cylinderEndS: 7200 + 3 * 3600, cylinderS: 3 * 3600, etaS: 6 * 3600 }));
    const t = templateSentences(f);
    expect(verify(f, t).ok).toBe(true);
    for (const extra of ["지금 산소통으로 바꿔 써도 됩니다.", "전원 장치가 도착하면 산소통으로 바꿔 쓰세요."]) expect(verify(f, [...t, extra]).ok, extra).toBe(false);
    const w = buildFacts(IN({ lane: "GAP_REDUCE", resourceKind: "MOBILE_GEN", etaS: 4800 + 3600 }));
    const tw = templateSentences(w);
    expect(verify(w, tw).ok).toBe(true);
    expect(verify(w, [...tw, "도착이 늦어지면 배터리가 먼저 떨어질 수 있습니다."]).ok).toBe(false);
  });
  it("꼬리말에 보호자 글 금지 전문어가 없다(모든 근거 조합)", () => {
    for (const i of allInputs().slice(0, 600)) {
      const ft = compose(buildFacts(i), null).footer;
      for (const w of BANNED.JARGON) expect(ft, w).not.toContain(w);
    }
  });
});

describe("통합 레드팀 14라운드 회귀", () => {
  const hhExt = (charge: number, cylinder: boolean): HouseholdView => ({
    id: "H14", pseudonym: "H-014", cell: { x: 0, y: 0 }, floor: 3, mobilityNeed: false, caregiver: true, tReport: 0, lEndPrev: null,
    device: { specId: "INOGEN_G5", specBy: "db_exact", batteryAgeY: 1, charge: { value: charge, source: "device_screen" } },
    ext: [{ extSpecId: "INOGEN_G5_DOUBLE", declaredCount: 1, opVerified: { count: 1, chargeConfirmed: null, extAgeY: null, auditId: "A14" } }],
    ...(cylinder ? { cylinder: { declared: true, opVerified: { count: 1, hoursLo: 3, auditId: "C14" } } } : {}),
  });
  const factsOf = (charge: number, cylinder: boolean, nowS = 0) => buildFacts(outageInput({ hh: hhExt(charge, cylinder), baseIso: BASE, nowS, lane: "PROPOSE_ASSIGN", resourceKind: "ESS_S", etaS: 4 * 3600, late119: false })!);
  it("확인 외장+산소통 집: 맞는 바꿔 쓰기 옆에 기기 배터리만의 바꿔 쓰기를 덧붙이거나 외장을 부정하면 1차 거부", () => {
    for (const charge of [0, 30, 60, 100]) {
      const f = factsOf(charge, true);
      expect(f.batteryWithExt).toBe(true);
      expect(f.actions).toContain("SWITCH_AFTER_BATTERY");
      const t = templateSentences(f);
      expect(verify(f, t).ok).toBe(true);
      const k = t.findIndex((s) => s.includes("산소통으로 바꿔"));
      for (const extra of ["기기 내장 배터리가 떨어지면 산소통으로 바꿔 쓰세요.", "내부 배터리가 떨어지면 산소통으로 바꿔 쓰세요.", "본체 배터리가 떨어지면 산소통으로 바꿔 쓰세요.",
        "기기 배터리가 떨어지면 산소통으로 바꿔 쓰세요.", "첫 배터리가 떨어지면 산소통으로 바꿔 쓰세요.", "끼워 둔 배터리가 떨어지면 산소통으로 바꿔 쓰세요.", "배터리가 떨어지면 산소통으로 바꿔 쓰세요."])
        expect(verify(f, [...t.slice(0, k + 1), extra, ...t.slice(k + 1)]).ok, `덧붙임: ${extra}`).toBe(false);
      for (const sub of ["본체 배터리가 떨어지면 외장 배터리 대신 산소통으로 바꿔 쓰세요.", "기기 배터리가 떨어지면 외장 배터리를 쓰기보다 산소통으로 바꿔 쓰세요.",
        "외장 배터리는 비상용으로 두고 배터리가 떨어지면 산소통으로 바꿔 쓰세요.", "배터리가 떨어지면 외장 배터리보다 산소통으로 먼저 바꿔 쓰세요.", "외장 배터리는 두고 배터리가 떨어지면 산소통으로 바꿔 쓰세요."])
        expect(verify(f, t.map((s, i) => (i === k ? sub : s))).ok, `대체: ${sub}`).toBe(false);
      expect(verify(f, t.map((s, i) => (i === k ? "외장 배터리까지 모두 다 떨어지면 확인된 산소통으로 바꿔 쓰세요." : s))).ok).toBe(true);
    }
  });
  it("2차: 확인 외장 집의 바꿔 쓰기 조건 배터리가 외장까지가 아니면 거부, 외장 없는 집은 종류를 묻지 않음", () => {
    const f = factsOf(60, true);
    const c = truthClaims(f);
    expect(compareClaims(f, c)).toEqual([]);
    for (const batteryScope of ["device_battery_only", "unspecified"] as const)
      expect(compareClaims(f, { ...c, actions: c.actions.map((a) => (a.kind === "SWITCH_TO_CYLINDER" ? { ...a, batteryScope } : a)) }).length, batteryScope).toBeGreaterThan(0);
    const g = buildFacts(IN({ deviceCls: "O2_PORT", lane: "PROPOSE_ASSIGN", resourceKind: "ESS_S", batteryEndS: 7200, cylinderEndS: 7200 + 3 * 3600, cylinderS: 3 * 3600, etaS: 6 * 3600 }));
    expect(g.batteryWithExt).toBeUndefined();
    expect(compareClaims(g, truthClaims(g))).toEqual([]);
  });
  it("확인 외장 집에서 기기 배터리 몫이 바닥이면 코드가 '외장 배터리가 꽂혀 있는지 확인' 문장을 붙이고, 시계가 흘러도 사라지지 않는다", () => {
    const line = "기기 배터리는 이미 떨어졌을 수 있으니 외장 배터리가 꽂혀 있는지 확인하세요.";
    for (const cylinder of [true, false]) {
      let seen = 0;
      for (let nowS = 0; nowS <= 3600; nowS += 60) {
        const f = factsOf(0, cylinder, nowS);
        if (f.battery.state !== "UNTIL") continue;
        seen++;
        expect(f.innerMaybeOut, `now ${nowS}`).toBe(true);
        expect(compose(f, null).sentences).toContain(line);
      }
      expect(seen).toBeGreaterThan(0);
      const full = factsOf(100, cylinder);
      expect(full.innerMaybeOut).toBeUndefined();
      expect(compose(full, null).sentences).not.toContain(line);
    }
  });
});

describe("2차 검사 대조(compareClaims)", () => {
  const ok = truthClaims(gap);
  const mut: [string, (c: ClaimsT) => ClaimsT][] = [
    ["배터리 시각 다름", (c) => ({ ...c, battery: { ...c.battery, time: "내일 오전 0시 10분" } })],
    ["배터리 뜻 뒤집기", (c) => ({ ...c, battery: { kind: "other", time: null, condition: "unspecified", includesExternal: "not_mentioned" } })],
    ["도착이 '이후'", (c) => ({ ...c, means: { ...c.means, timeMeaning: "after" } })],
    ["수단 바뀜", (c) => ({ ...c, means: { ...c.means, kind: "ambulance" } })],
    ["수단 이름 다름", (c) => ({ ...c, means: { ...c.means, name: "대용량 전원 장치" } })],
    ["경고 없음", (c) => ({ ...c, supplyMayRunOutBeforeHelp: false })],
    ["경고 대상 틀림", (c) => ({ ...c, runOutWhich: "cylinder" })],
    ["기기 이름 틀림", (c) => ({ ...c, device: "산소발생기" })],
    ["수단 덧붙임", (c) => ({ ...c, means: { ...c.means, extraDetails: ["산소통을 싣고 온다"] } })],
    ["구급대 연결 지어냄", (c) => ({ ...c, means: { ...c.means, connected: "yes" } })],
    ["산소통 바꿔 쓰기를 도착 뒤로", (c) => ({ ...c, actions: [...c.actions, { kind: "SWITCH_TO_CYLINDER", when: "after_condition", batteryScope: "unspecified" as const, negated: false, quote: "도착하면 바꿔 쓰세요" }] })],
    ["정전이 끝났다고 함", (c) => ({ ...c, situation: "power_restored" })],
    ["하지 말라는 지시", (c) => ({ ...c, actions: c.actions.map((a, i) => (i === 0 ? { ...a, negated: true } : a)) })],
    ["사실에 없는 기관 약속", (c) => ({ ...c, staffPromises: [...c.staffPromises, { kind: "other", quote: "확인이 끝나면 다시 알려 드립니다" }] })],
    ["정하지 않은 지시", (c) => ({ ...c, actions: [...c.actions, { kind: "OTHER", when: "now", batteryScope: "unspecified" as const, negated: false, quote: "다른 곳으로 옮기세요" }] })],
    ["할 일 빠짐", (c) => ({ ...c, actions: c.actions.slice(1) })],
    ["다른 할 일", (c) => ({ ...c, actions: [...c.actions, { kind: "CHARGE_DEVICE", when: "now", batteryScope: "unspecified" as const, negated: false, quote: "" }] })],
    ["표기 밖 시간", (c) => ({ ...c, otherTimesOrDurations: ["이틀"] })],
    ["안심", (c) => ({ ...c, reassuranceOrPromise: true })],
    ["위험 행동", (c) => ({ ...c, medicalOrDeviceOrRiskyInstruction: true })],
    ["산소통 지어냄", (c) => ({ ...c, cylinder: { kind: "lasts_until", time: "오전 3시", condition: "unspecified" } })],
  ];
  it("정답 주장이면 AI 본문이 나간다", () => {
    const c = compose(gap, { sentences: templateSentences(gap), check: { claims: ok } });
    expect(c.source).toBe("ai");
    expect(c.sentences.slice(-tailSentences(gap).length)).toEqual(tailSentences(gap));
  });
  for (const [name, m] of mut) {
    it(`거부: ${name}`, () => {
      expect(compareClaims(gap, m(ok)).length).toBeGreaterThan(0);
      const c = compose(gap, { sentences: templateSentences(gap), check: { claims: m(ok) } });
      expect(c).toMatchObject({ source: "template", rejectedAt: "gate2" });
    });
  }
  it("2차 검사를 안 했거나 실패하면 닫힘(고정 문안)", () => {
    expect(compose(gap, { sentences: templateSentences(gap), check: null }).source).toBe("template");
    expect(compose(gap, { sentences: templateSentences(gap), check: { error: "timeout" } }).source).toBe("template");
  });
  it("1차 검사 탈락이면 사실 오류 사유를 남긴다", () => {
    const c = compose(gap, { sentences: templateSentences(gap).map((s) => s.replace("11시 20분", "11시 30분")), check: { claims: ok } });
    expect(c.rejectedAt).toBe("gate1");
    expect(c.violations.some((v) => FACT_ERROR.includes(v.code))).toBe(true);
  });
});

describe("프롬프트·음성", () => {
  it("사용자 메시지는 표기·할 일을 모두 담고, 119·123은 담지 않는다", () => {
    const u = noticeUser(gap);
    for (const m of requirements(gap).mustInclude) expect(u).toContain(m.text);
    expect(u).not.toMatch(/119|123/);
    expect(noticeUser(gap)).toBe(u);
  });
  it("음성은 AI 글이면 먼저 밝히고, 전화번호를 한 자리씩 읽는다", () => {
    expect(speechText(["위급하면 119에 전화하세요.", "한전 123"], "ai")).toBe("AI가 쓴 안내입니다. 위급하면 일일구에 전화하세요. 한전 일이삼");
    expect(speechText(["119"])).toBe("일일구");
  });
});
