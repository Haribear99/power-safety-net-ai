// 보호자 알림(쉬운 글·음성)의 사실 묶음 (원안 「이용자에게는 쉬운 글·음성·보호자 알림으로 완충, 대체장소, 119·123 연락 … 안내」).
// 비AI. 사실(시각·수단·경고)과 읽는 사람이 할 일은 이 파일이 결정 기록에서 정한다. AI는 이 묶음을 쉬운 문장으로 옮기기만 한다(prompt.ts).
// 119·123 문장은 AI가 쓰지 않고 코드가 붙인다(compose.ts).
// 입력(NoticeInput)은 숫자·열거값만 받는다. 클라이언트가 보낸 자유 문자열은 프롬프트에 들어가지 않는다.
// 반올림은 보수 쪽: 배터리·산소통 소진 시각은 10분 내림, 도착·이송 완료 시각은 10분 올림, 완충 시 하한은 30분 내림.
// 산소통(운영자 확인 실린더)은 배터리와 따로 둔다. 산소발생기 배터리가 0이면 정전 즉시 멈추고 산소통으로 바꿔 달아야 하기 때문이다.
import { z } from "zod";
import type { DeviceClass, HouseholdView, Lane, ResourceKind } from "../domain/types";
import { computeLowerBoundDetail, DEFAULT_DB, type EngineDb } from "../engine/lowerBound";
import { mockIso } from "../alloc/project119";
import { qT } from "../engine/quantize";

const DEVICE_CLASSES = ["O2_STAT", "O2_STAT_CYL", "VENT_1H", "VENT_3H", "O2_PORT", "VENT_8H", "VENT_8H_EXT2", "INTERMITTENT", "UNKNOWN"] as const;
const RESOURCE_KINDS = ["ESS_S", "ESS_L", "MOBILE_GEN", "RENTAL_EXT", "O2_CYL_DELIVERY", "EV_V2L"] as const;
export const NOTICE_LANES = ["PROPOSE_ASSIGN", "GAP_REDUCE", "FALLBACK_119", "FALLBACK_SHELTER"] as const;
export type NoticeLane = (typeof NOTICE_LANES)[number];

const BASE_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\+09:00$/;
/** 형식뿐 아니라 실제 있는 날짜·시각인지(2월 30일·25시 거부) */
export function validBaseIso(s: string): boolean {
  const m = BASE_ISO_RE.exec(s);
  if (!m) return false;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d && t.getUTCHours() === h && t.getUTCMinutes() === mi && t.getUTCSeconds() === se;
}
const S = z.number().int().min(-1_000_000).max(10_000_000); // 모의 시각 초(시나리오 시작 0 기준, 약 115일 이내)
const DUR = z.number().int().min(0).max(30 * 24 * 3600);

/** 알림 입력: 결정 기록·하한에서 뽑은 숫자와 열거값만 */
export const NoticeInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("PREP"), // 평시 대비(완충·외장배터리·산소통·연락처)
    caregiver: z.boolean(),
    deviceCls: z.enum(DEVICE_CLASSES),
    /** 완충(100%) 기준 배터리(내장+확인 외장) 하한 초. null = 수동검토(자동 계산 안 함) */
    batteryS: DUR.nullable(),
    /** 운영자 확인 산소통 하한 초. 0 = 없음 */
    cylinderS: DUR,
    extDeclared: z.boolean(),
  }).strict(),
  z.object({
    kind: z.literal("OUTAGE"), // 정전 중 담당자 결정 뒤
    caregiver: z.boolean(),
    deviceCls: z.enum(DEVICE_CLASSES),
    baseIso: z.string().refine(validBaseIso, "baseIso"),
    nowS: S,
    /** 배터리(내장+확인 외장) 소진 하한 절대 시각. null = 수동검토 */
    batteryEndS: S.nullable(),
    /** 배터리 하한 시간(0이면 배터리 없음). null = 수동검토 */
    batteryLs: DUR.nullable(),
    /** 산소통으로 바꿔 단 뒤의 소진 하한 절대 시각(배터리 다음 산소통 순서). null = 확인 산소통 없음 */
    cylinderEndS: S.nullable(),
    /** 확인 산소통 하한 시간(초). 0 = 없음. 배터리가 없거나 떨어졌으면 '지금 바꿔 쓰기' 기준 끝 = 지금 + 이 값 */
    cylinderS: DUR,
    lane: z.enum(NOTICE_LANES),
    resourceKind: z.enum(RESOURCE_KINDS).nullable(),
    /** 자원: 도착 절대 시각, 119: 이송 완료 예상 절대 시각. 없으면 null */
    etaS: S.nullable(),
    late119: z.boolean(),
  }).strict(),
]);
export type NoticeInputT = z.infer<typeof NoticeInput>;

export const DEVICE_NOUN: Record<DeviceClass, string> = {
  O2_STAT: "산소발생기", O2_STAT_CYL: "산소발생기", VENT_1H: "인공호흡기", VENT_3H: "인공호흡기", O2_PORT: "휴대용 산소발생기",
  VENT_8H: "인공호흡기", VENT_8H_EXT2: "인공호흡기", INTERMITTENT: "가래 흡인기", UNKNOWN: "의료기기",
};
export const RESOURCE_NOUN: Record<ResourceKind, string> = {
  ESS_S: "휴대용 전원 장치", ESS_L: "대용량 전원 장치", MOBILE_GEN: "이동식 발전기", RENTAL_EXT: "기기용 외장 배터리",
  O2_CYL_DELIVERY: "추가 산소통", EV_V2L: "전기차 전원", // 집에 있는 「확인된 산소통」과 구분
};
/** 자원 종류를 모를 때(지어내지 않음) */
export const RESOURCE_UNKNOWN_NOUN = "비상 전원";

export type BatteryState =
  | { state: "UNTIL"; text: string }   // OUTAGE: 소진 시각
  | { state: "HOURS"; text: string }   // PREP: 완충 시 적어도 몇 시간
  | { state: "UNDER30" }               // PREP: 30분 미만(0 초과)
  | { state: "NONE" }                  // 배터리 없음(0): 정전되면 바로 멈춤
  | { state: "MAYBE_OUT" }             // OUTAGE: 표시 시각이 지금부터 10분 안이거나 지남
  | { state: "UNKNOWN" };              // 수동검토
export type Cylinder = { state: "UNTIL" | "HOURS"; text: string } | { state: "MAYBE_OUT" };
export type Plan =
  | { type: "ASSIGN" | "GAP"; resource: string; arriveBy: string | null; etaPassed: boolean }
  | { type: "CALL119"; doneBy: string | null; late: boolean; etaPassed: boolean }
  | { type: "SHELTER" };
/** 읽는 사람이 할 일(코드가 정한다. AI 글도 고정 문안도 정확히 이 목록만 말한다) */
export type Action = "KEEP_PHONE" | "FOLLOW_STAFF" | "SWITCH_TO_CYLINDER" | "SWITCH_AFTER_BATTERY" | "CHARGE_DEVICE" | "CHARGE_EXT" | "CHECK_CYLINDER" | "PLAN_WITH_STAFF";
export const ACTION_KO: Record<Action, string> = {
  KEEP_PHONE: "연락을 받을 수 있게 전화를 곁에 둔다",
  FOLLOW_STAFF: "연락이 오면 안내를 따른다",
  SWITCH_TO_CYLINDER: "지금 바로 집에 있는 확인된 산소통으로 바꿔 쓴다",
  SWITCH_AFTER_BATTERY: "배터리가 떨어지면 집에 있는 확인된 산소통으로 바꿔 쓴다",
  CHARGE_DEVICE: "평소에 기기 배터리를 늘 충전해 둔다",
  CHARGE_EXT: "외장 배터리도 충전해 둔다",
  CHECK_CYLINDER: "산소통을 미리 확인해 둔다",
  PLAN_WITH_STAFF: "정전 때 쓸 다른 방법과 갈 곳을 담당자와 미리 정해 둔다",
};

export interface NoticeFacts {
  kind: "PREP" | "OUTAGE";
  audience: "보호자" | "본인";
  device: string;
  battery: BatteryState;
  cylinder: Cylinder | null;
  plan: Plan | null;          // PREP은 null
  /** 도움(전원 도착·119 이송 완료, 표시 시각)이 보호 수단(산소통이 있으면 산소통, 없으면 배터리)의 끝(표시 시각)보다 늦거나 같거나, 공백 단축 배정이면 경고 */
  warnRunOutFirst: boolean;
  extDeclared: boolean;       // PREP만 의미
  actions: Action[];
}

const TEN_MIN = 600;

/** 24시 → "오전 0시"~"오후 11시"(분이 0이면 생략) */
function hm(h: number, m: number): string {
  const ap = h < 12 ? "오전" : "오후";
  const h12 = h === 0 ? 0 : h > 12 ? h - 12 : h;
  return `${ap} ${h12}시${m ? ` ${m}분` : ""}`;
}
function ymd(iso: string): [number, number, number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso)!;
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
}
function baseClockS(baseIso: string): number {
  const [, , , bh, bm] = ymd(baseIso);
  return bh * 3600 + bm * 60 + Number(baseIso.slice(17, 19));
}
/** 벽시계 10분 단위로 반올림한 모의 시각(초) */
export function round10(baseIso: string, absS: number, dir: "floor" | "ceil"): number {
  const b = baseClockS(baseIso);
  const t = b + absS;
  return (dir === "floor" ? Math.floor(t / TEN_MIN) : Math.ceil(t / TEN_MIN)) * TEN_MIN - b;
}

/**
 * 모의 시각(초, 이미 반올림된 값) → 쉬운 시각 표기. 날짜가 다르면 "내일"·"모레"·"M월 D일".
 * 예: "오후 3시 20분", "내일 오전 1시"
 */
export function clockLabel(baseIso: string, absS: number, nowS: number): string {
  const [y, mo, d, h, mi] = ymd(mockIso(baseIso, absS));
  const [ny, nmo, nd] = ymd(mockIso(baseIso, nowS));
  const days = Math.round((Date.UTC(y, mo - 1, d) - Date.UTC(ny, nmo - 1, nd)) / 86_400_000);
  const day = days === 0 ? "" : days === 1 ? "내일 " : days === 2 ? "모레 " : `${mo}월 ${d}일 `;
  return `${day}${hm(h, mi)}`;
}
/** 반올림 + 표기 */
export function clockText(baseIso: string, absS: number, nowS: number, dir: "floor" | "ceil"): string {
  return clockLabel(baseIso, round10(baseIso, absS, dir), nowS);
}

/** 초 → "2시간 30분"(30분 내림). 30분 미만은 null */
export function durationText(s: number): string | null {
  const half = Math.floor(s / 1800);
  if (half <= 0) return null;
  const h = Math.floor(half / 2), m = half % 2 ? 30 : 0;
  return h === 0 ? "30분" : `${h}시간${m ? " 30분" : ""}`;
}

/** NoticeInput → 표기가 정해진 사실 묶음 */
export function buildFacts(input: NoticeInputT): NoticeFacts {
  const audience = input.caregiver ? "보호자" : "본인";
  const device = DEVICE_NOUN[input.deviceCls];
  if (input.kind === "PREP") {
    let battery: BatteryState;
    if (input.batteryS == null) battery = { state: "UNKNOWN" };
    else if (input.batteryS === 0) battery = { state: "NONE" };
    else {
      const t = durationText(input.batteryS);
      battery = t ? { state: "HOURS", text: t } : { state: "UNDER30" };
    }
    const ct = input.cylinderS > 0 ? durationText(input.cylinderS) : null;
    const cylinder: Cylinder | null = ct ? { state: "HOURS", text: ct } : null;
    const actions: Action[] = [];
    if (battery.state !== "NONE") actions.push("CHARGE_DEVICE");
    if (input.extDeclared) actions.push("CHARGE_EXT");
    if (cylinder) actions.push("CHECK_CYLINDER");
    if (battery.state === "NONE" && !cylinder) actions.push("PLAN_WITH_STAFF");
    return { kind: "PREP", audience, device, battery, cylinder, plan: null, warnRunOutFirst: false, extDeclared: input.extDeclared, actions };
  }
  const { baseIso, nowS } = input;
  // 표시 시각(내림)이 지금부터 10분 안이면 '이미 떨어졌을 수 있음'
  const endState = (endS: number) => {
    const r = round10(baseIso, endS, "floor");
    return r - nowS < TEN_MIN ? null : r;
  };
  let battery: BatteryState;
  let batteryShownS: number | null = null;
  if (input.batteryEndS == null || input.batteryLs == null) battery = { state: "UNKNOWN" };
  else if (input.batteryLs === 0) battery = { state: "NONE" };
  else {
    batteryShownS = endState(input.batteryEndS);
    battery = batteryShownS == null ? { state: "MAYBE_OUT" } : { state: "UNTIL", text: clockLabel(baseIso, batteryShownS, nowS) };
  }
  let cylinder: Cylinder | null = null;
  let cylShownS: number | null = null;
  // 배터리가 아직 버티면(UNTIL) 배터리 다음에 산소통(끝 = 입력값), 아니면 지금 바꿔 달므로 끝 = min(입력값, 지금 + 산소통 시간)
  const switchNow = battery.state !== "UNTIL";
  if (input.cylinderEndS != null) {
    // 예전 형식 입력(cylinderS 없음, S9 봉인 파일 등)은 예전처럼 입력 끝을 그대로 쓴다
    const cs = (input as { cylinderS?: number }).cylinderS;
    cylShownS = endState(switchNow && cs != null ? Math.min(input.cylinderEndS, nowS + cs) : input.cylinderEndS);
    cylinder = cylShownS == null ? { state: "MAYBE_OUT" } : { state: "UNTIL", text: clockLabel(baseIso, cylShownS, nowS) };
  }
  // 보호 수단의 끝(표시): 산소통이 있으면 산소통, 없으면 배터리. 이미 떨어졌을 수 있거나(MAYBE_OUT) 배터리 없음이면 null
  const supplyShownS = cylinder ? cylShownS : batteryShownS;
  const etaShownS = input.etaS == null || input.etaS <= nowS ? null : round10(baseIso, input.etaS, "ceil");
  const eta = etaShownS == null ? null : clockLabel(baseIso, etaShownS, nowS);
  let plan: Plan;
  const helpLate = etaShownS != null && supplyShownS != null && etaShownS >= supplyShownS;
  let warnRunOutFirst = false;
  switch (input.lane) {
    case "PROPOSE_ASSIGN":
    case "GAP_REDUCE": {
      const resource = input.resourceKind ? RESOURCE_NOUN[input.resourceKind] : RESOURCE_UNKNOWN_NOUN;
      const passed = input.etaS != null && input.etaS <= nowS;
      plan = { type: input.lane === "PROPOSE_ASSIGN" ? "ASSIGN" : "GAP", resource, arriveBy: eta, etaPassed: passed };
      // 보호 수단 끝이 보이는 경우만: 공백 단축 배정, 표시 도착 ≥ 표시 보호 끝(반올림 역전 포함), 도착 예정이 지남(보수)
      warnRunOutFirst = supplyShownS != null && (input.lane === "GAP_REDUCE" || helpLate || passed);
      break;
    }
    case "FALLBACK_119":
      // 이송 완료 예상 시각이 없으면(「수정」으로 119를 고른 경우 등) 늦음·먼저 소진을 보수적으로 경고한다
      // 이송 예정 시각이 지났어도 같은 보수 규칙(통합 레드팀 2라운드)
      const passed = input.etaS != null && input.etaS <= nowS;
      plan = { type: "CALL119", doneBy: eta, late: input.late119 || input.etaS == null || passed, etaPassed: passed };
      warnRunOutFirst = helpLate || ((input.etaS == null || passed) && supplyShownS != null);
      break;
    case "FALLBACK_SHELTER":
      plan = { type: "SHELTER" };
      break;
  }
  const actions: Action[] = [];
  if (cylinder) actions.push(switchNow ? "SWITCH_TO_CYLINDER" : "SWITCH_AFTER_BATTERY");
  actions.push("KEEP_PHONE", "FOLLOW_STAFF");
  return { kind: "OUTAGE", audience, device, battery, cylinder, plan, warnRunOutFirst, extDeclared: false, actions };
}

// ---------- 화면·스크립트에서 입력 만들기 ----------

/** 표시 등급(실린더 신고 거치형은 O2_STAT_CYL) */
export function deviceClassOf(hh: HouseholdView, db: EngineDb = DEFAULT_DB): DeviceClass {
  const cls = (hh.device.specId != null ? db.devices.get(hh.device.specId)?.cls : undefined) ?? "UNKNOWN";
  return cls === "O2_STAT" && hh.cylinder?.declared ? "O2_STAT_CYL" : cls;
}

/** 산소통을 대체 수단으로 쓰는 기기(산소발생기 계열)만 산소통을 셈한다. 인공호흡기에 '산소통으로 바꿔 쓰세요'를 내지 않는다 */
const CYL_DEVICES: readonly DeviceClass[] = ["O2_STAT", "O2_STAT_CYL", "O2_PORT"];

/** 배터리만(실린더 제외) 하한과, 확인 실린더를 더한 하한 */
function split(hh: HouseholdView, db: EngineDb) {
  if (hh.cylinder && !CYL_DEVICES.includes(deviceClassOf(hh, db))) {
    const nc = computeLowerBoundDetail({ ...hh, cylinder: undefined }, db);
    return { all: nc, noCyl: nc, cylS: 0 };
  }
  const all = computeLowerBoundDetail(hh, db);
  const noCyl = hh.cylinder ? computeLowerBoundDetail({ ...hh, cylinder: undefined }, db) : all;
  const cylS = all.Ls != null && noCyl.Ls != null ? all.Ls - noCyl.Ls : 0;
  return { all, noCyl, cylS };
}

/** 평시 대비 입력: 완충(기기 화면 100%) 기준. 신고 시각·직전 소진 시각은 쓰지 않는다 */
export function prepInput(hh: HouseholdView, db: EngineDb = DEFAULT_DB): NoticeInputT {
  const full: HouseholdView = { ...hh, tReport: 0, lEndPrev: null, device: { ...hh.device, charge: { value: 100, source: "device_screen" }, screenRemainingH: undefined } };
  const { noCyl, cylS } = split(full, db);
  return {
    kind: "PREP", caregiver: hh.caregiver, deviceCls: deviceClassOf(hh, db), batteryS: noCyl.Ls, cylinderS: cylS,
    extDeclared: hh.ext.some((e) => e.declaredCount > 0),
  };
}

/** 정전 중 결정 입력. lane이 알림 대상(자원·119·쉼터)이 아니면 null */
export function outageInput(args: {
  hh: HouseholdView; baseIso: string; nowS: number; lane: Lane; resourceKind: ResourceKind | null; etaS: number | null; late119: boolean; db?: EngineDb;
}): NoticeInputT | null {
  if (!(NOTICE_LANES as readonly string[]).includes(args.lane)) return null;
  const { all, noCyl, cylS } = split(args.hh, args.db ?? DEFAULT_DB);
  // 배터리 끝은 직전 신고 단조 규칙(lEndPrev)을 반영한 전체 끝을 넘지 않는다
  let batteryEndS = all.endS == null || noCyl.endS == null ? null : Math.min(all.endS, noCyl.endS);
  // 재신고 단조(정전 중 비증가): 직전 끝(lEndPrev)은 산소통을 포함하므로, 산소통 몫을 뺀 값을 배터리 끝의 상한으로 둔다(늘어나지 않게)
  if (batteryEndS != null && args.hh.lEndPrev != null && cylS > 0) batteryEndS = Math.min(batteryEndS, qT(args.hh.lEndPrev) - cylS);
  return {
    kind: "OUTAGE", caregiver: args.hh.caregiver, deviceCls: deviceClassOf(args.hh, args.db), baseIso: args.baseIso, nowS: args.nowS,
    batteryEndS, batteryLs: noCyl.Ls, cylinderEndS: cylS > 0 ? all.endS : null, cylinderS: cylS,
    lane: args.lane as NoticeLane, resourceKind: args.resourceKind, etaS: args.etaS, late119: args.late119,
  };
}

/** 시험·기록용: 사실 묶음의 짧은 열쇠 */
export function factsKey(f: NoticeFacts): string {
  return `${f.kind}:${f.battery.state}${f.cylinder ? "+cyl" : ""}:${f.plan?.type ?? "-"}${f.plan?.type === "CALL119" && f.plan.late ? "+late" : ""}${f.warnRunOutFirst ? "+warn" : ""}`;
}
