// 보호자 알림의 규칙 층 (비AI): ① 사실 묶음 → 요구사항(허용 표기·필수 문구), ② 1차 검사(글자 규칙), ③ 고정 문안, ④ 코드가 붙이는 119·123 문장.
// AI 문장은 1차 검사와 2차 검사(check.ts: 다른 모델이 사실표 없이 글만 읽고 뽑은 주장 ↔ 사실 묶음 대조)를 모두 통과할 때만 나간다.
// 하나라도 어기면 고정 문안으로 바꾼다(compose.ts). 1차 검사는 글자 규칙이라 뜻을 다 보지 못한다 — 뜻은 2차 검사가 본다.
// 1차 검사
// - 허용 표기 빼기: 사실 묶음의 표기(시각·시간)를 긴 것부터 지운 뒤 숫자가 남으면 '없는 숫자'. AI 본문에는 119·123도 허용하지 않는다(코드가 붙임).
//   숫자 없는 시간 낱말(「내일」「아침」「이틀」「세 시」「삼십 분」「몇 시간」)도 표기 밖이면 사실 오류로 본다.
// - 한 문장에 시각 하나. 시각이 든 문장에는 그 뜻 낱말이 있어야 하고, 뜻을 뒤집거나 다른 역할을 가리키는 낱말은 없어야 한다.
// - 필수 표기·필수 문장(낱말 묶음), 금지 표현(안심 약속·막연한 시간·의료·기기 조작·위험 행동·전문어), 정하지 않은 수단, 문장 길이·개수, 영문.
import { RESOURCE_NOUN, type NoticeFacts } from "./facts";

export type Role = "BATTERY_T" | "CYL_T" | "ARRIVAL_T" | "T119" | "CHARGE_H" | "CHARGE_LT" | "CYL_H";
const FLIP = ["못", "않", "이후", "지나", "넘어", "넘게", "넘는", "뒤에", "뒤로", "후에", "후로", "부터", "보다", "이상", "늦게", "전에", "안에"];
export const ROLE_WORDS: Record<Role, readonly string[]> = {
  BATTERY_T: ["배터리"], CYL_T: ["산소통"], ARRIVAL_T: ["도착"], T119: ["구급"], CHARGE_H: ["충전"], CHARGE_LT: ["충전"], CYL_H: ["산소통"],
};
/** 그 시각이 든 문장에 있으면 안 되는 낱말: 뜻 뒤집기(못·않·이후·지나…)와 다른 역할 낱말(뒤바뀜 차단) */
export const ROLE_FORBID: Record<Role, readonly string[]> = {
  BATTERY_T: ["도착", "산소통", "충전하면", "충전해도", "충전해 두면", "적어도", ...FLIP], // '적어도'는 하한 보장으로 읽힌다(통합 레드팀 9라운드) // 정전 중 시각은 지금 상태 기준(통합 레드팀 6라운드)
  CYL_T: ["도착", "배터리", "적어도", ...FLIP],
  // 도착·이송 시각 문장에 '배터리'·'산소통'이 있으면(정해진 수단 이름 안의 낱말은 빼고 본다) 그 시각을 배터리 시각처럼 쓴 것으로 본다(통합 레드팀 4라운드)
  ARRIVAL_T: ["배터리", "산소통", ...FLIP],
  T119: ["배터리", "산소통", ...FLIP],
  CHARGE_H: ["도착", "산소통", "없이", "안 해도", "않아도", "적어도", ...FLIP],
  CHARGE_LT: ["도착", "산소통", "않으면", "안 하면", "없으면", "없이"], // 「30분을 못 버팁니다」는 부정문이 맞다. 「충전하지 않으면」 전제 바꾸기는 막는다(6라운드)
  CYL_H: ["도착", "배터리", "충전", "적어도", ...FLIP],
};
export const ROLE_KO: Record<Role, string> = {
  BATTERY_T: "배터리가 계산상 버티는 시각", CYL_T: "산소통이 계산상 버티는 시각", ARRIVAL_T: "도착 시각",
  T119: "구급대 이송 완료 예상 시각", CHARGE_H: "완충 시 계산상 버티는 시간", CHARGE_LT: "완충해도 못 버티는 시간", CYL_H: "확인된 산소통이 계산상 쓰는 시간",
};

export interface Allowed { text: string; roles: Role[] }
/** all = 한 문장에 함께 있어야 할 낱말, none = 그 문장에 있으면 안 되는 낱말(부정 등) */
export interface SentenceReq { all: string[]; hint: string; none?: string[] }
/**
 * 범위 문장 검사(통합 레드팀 14·15라운드): 산소통(「산소 통」「실린더」 포함, 원문 기준)과 any 낱말 하나 이상(정해진 수단 이름 안 낱말은 빼고 본다)을 담은 문장은
 * need를 모두 담고 none은 담지 않아야 한다. skipNeedWith 표기가 든 문장(산소통 시각 문장)은 need를 묻지 않는다(그 문장의 뜻 낱말은 역할 규칙이 본다)
 */
export interface ScopedReq { any: string[]; need: string[]; none: string[]; hint: string; skipNeedWith?: string }
export interface Requirements { allowed: Allowed[]; mustInclude: { text: string; hint: string }[]; mustSentences: SentenceReq[]; forbidSentences: SentenceReq[]; scopedSentences: ScopedReq[] }

export const LIMITS = { minSentences: 3, maxSentences: 10, maxSentenceChars: 45, maxTotalChars: 380 } as const;

export function requirements(f: NoticeFacts): Requirements {
  const allowed: Allowed[] = [];
  const mustInclude: Requirements["mustInclude"] = [];
  const mustSentences: SentenceReq[] = [];
  const forbidSentences: SentenceReq[] = [];
  const scopedSentences: ScopedReq[] = [];
  // 바꿔 쓰기에 다른 조건을 겹치는 말('기다렸다가'·'닿은 뒤에'·'안내를 받고'·'허락을 받은 다음', 통합 레드팀 8라운드)
  const SWITCH_EXTRA = ["도착", "오면", "연락", "기다", "뒤에", "다음", "받고", "받은", "허락", "닿", "안내"];
  const NEG = ["않", "말고", "마세", "마십", "마시", "필요 없", "필요가 없", "안 되", "안 돼", "금지", "삼가", "아닙", "아니"];
  const must = (text: string, role: Role) => {
    const a = allowed.find((x) => x.text === text);
    if (a) { if (!a.roles.includes(role)) a.roles.push(role); } else allowed.push({ text, roles: [role] });
    if (!mustInclude.some((m) => m.text === text)) mustInclude.push({ text, hint: ROLE_KO[role] });
  };
  const sent = (all: string[], hint: string, none?: string[]) => mustSentences.push({ all, hint, ...(none ? { none } : {}) });
  const forbid = (all: string[], hint: string) => forbidSentences.push({ all, hint });

  const b = f.battery;
  if (b.state === "UNTIL") must(b.text, "BATTERY_T");
  if (b.state === "HOURS") must(b.text, "CHARGE_H");
  if (b.state === "UNDER30") must("30분", "CHARGE_LT");
  // 확인 외장 배터리가 합쳐진 시간·시각이면 그 문장에 '외장'을 쓴다(기기 배터리만의 시간처럼 쓰지 않게, 통합 레드팀 8라운드)
  if (f.batteryWithExt && (b.state === "HOURS" || b.state === "UNTIL")) sent([b.text, "외장"], "외장 배터리까지 합친 시간이다", ["없이", "말고", "따로", "제외", "빼고", "만으로", "내장"]);
  if (b.state === "MAYBE_OUT") sent(["배터리", "이미"], "배터리가 이미 떨어졌을 수 있다");
  if (b.state === "UNKNOWN") sent(["배터리", "담당자"], "배터리가 얼마나 가는지 담당자가 확인 중이다");
  if (b.state === "NONE") sent(["멈"], "배터리가 없어 정전되면 바로 멈춘다"); // 「배터리가 없습니다. 그래서 바로 멈춥니다」처럼 나눠 써도 된다(뜻은 2차 검사)
  const c = f.cylinder;
  if (c?.state === "UNTIL") {
    must(c.text, "CYL_T");
    // 산소통 시각의 조건은 사실과 같아야 한다: 배터리 다음이면 '지금·바로'로, 지금이면 '떨어지면·다 되면'으로 쓰지 않는다(통합 레드팀 12라운드)
    sent([c.text], "산소통 시각(바꿔 쓰는 때와 맞게)", f.actions.includes("SWITCH_AFTER_BATTERY") ? ["지금", "바로", "당장", "곧바로"] : ["떨어지면", "다 되면", "뒤에", "다음에"]);
  }
  if (c?.state === "HOURS") must(c.text, "CYL_H");
  if (c?.state === "MAYBE_OUT") sent(["산소통", "이미"], "산소통도 이미 거의 다 썼을 수 있다");
  const p = f.plan;
  if (p?.type === "ASSIGN" || p?.type === "GAP") {
    if (p.arriveBy) must(p.arriveBy, "ARRIVAL_T");
    if (p.etaPassed) sent([p.resource, "지나"], `${p.resource} 도착 예정 시각이 지나 담당자가 확인 중이다`);
    else sent([p.resource, "도착"], `${josa(p.resource, "이가")} 집에 도착한다`);
  }
  const supplyW = f.cylinder ? "산소통" : "배터리";
  // 경고는 '도움이 늦어지면'에 달지 않는다: '제때 오면 괜찮다'로 읽힌다(통합 레드팀 9·10라운드)
  const COND = ["늦어지면", "늦어질", "늦으면", "늦게", "지연", "못 오면", "미뤄", "제시간"];
  if (f.warnRunOutFirst && f.warnTight) sent([supplyW, "일찍"], `${supplyW}가 계산보다 일찍 떨어지면 도움이 오기 전에 멈출 수 있다(도착이 계산상 끝과 가까움)`, COND);
  // 도착이 계산상 끝보다 늦으면 계산대로여도 먼저 떨어진다: '계산보다 일찍 떨어지면'으로 조건을 달지 않는다(통합 레드팀 11라운드)
  else if (f.warnRunOutFirst) sent([supplyW, "먼저"], `도움이 오기 전에 ${supplyW}가 먼저 떨어질 수 있다`, [...COND, "일찍", "계산보다", "빨리", "떨어지면", "닳으면"]);
  if (p?.type === "CALL119") {
    sent(["구급", "연결"], "구급대와 연결했다");
    if (p.doneBy) must(p.doneBy, "T119");
    else if (p.etaPassed) sent(["구급", "지나"], "구급대 이송 예정 시각이 지나 담당자가 확인 중이다");
    else sent(["구급", "아직"], "구급대가 언제 올지는 아직 정해지지 않았다");
    // 사실과 반대 상태 말 금지(통합 레드팀 2라운드)
    if (p.etaPassed) forbid(["구급", "아직", "정해"], "이송 예정 시각이 지났는데 '아직 정해지지 않았다'");
    if (!p.etaPassed) forbid(["구급", "지나"], "이송 예정 시각이 지나지 않았는데 '지났다'");
    if (p.late) sent(["늦"], "구급대 출동이 늦어질 수 있다");
  }
  if (p?.type === "SHELTER") sent(["쉼터"], "가까운 쉼터로 옮기도록 담당자가 연락한다");
  if (f.kind === "OUTAGE") sent(["정전"], "정전으로 기기 전원이 끊겼다");
  for (const a of f.actions) {
    if (a === "KEEP_PHONE") sent(["전화"], "연락을 받을 수 있게 전화를 곁에 둔다");
    if (a === "FOLLOW_STAFF") sent(["안내", "따"], "연락이 오면 안내를 따른다");
    if (a === "SWITCH_TO_CYLINDER") sent(["산소통", "바꿔", "지금"], "지금 바로 확인된 산소통으로 바꿔 쓴다", [...NEG, ...SWITCH_EXTRA, "떨어지면"]);
    // 조건은 '배터리가 떨어지면'뿐('도착하면'·'연락이 오면'·'떨어지기 전에 미리' 차단, 통합 레드팀 7라운드)
    if (a === "SWITCH_AFTER_BATTERY") sent(["산소통", "바꿔", "배터리", "떨어지면", ...(f.batteryWithExt ? ["외장"] : [])], f.batteryWithExt ? "외장 배터리까지 다 떨어지면 산소통으로 바꿔 쓴다" : "배터리가 떨어지면 확인된 산소통으로 바꿔 쓴다", [...NEG, ...SWITCH_EXTRA, "전에", "기 전", "미리", ...(f.batteryWithExt ? ["내장"] : [])]);
    if (a === "CHARGE_DEVICE") sent(["충전"], "평소에 배터리를 늘 충전해 둔다");
    if (a === "CHARGE_EXT") sent(["외장", "충전"], "외장 배터리도 충전해 둔다");
    if (a === "CHECK_CYLINDER") sent(["산소통", "확인"], "산소통을 미리 확인해 둔다");
    if (a === "PLAN_WITH_STAFF") sent(["담당자", "정해"], "정전 때 쓸 다른 방법을 담당자와 미리 정해 둔다");
  }
  // 산소통을 쓰게 하는 동사(바꿔 쓰기·달기·허락형 '써도 됩니다'·'쓸 수 있습니다', 통합 레드팀 15라운드: '바꿔'만 보던 것을 넓힘)
  const USE = ["바꿔", "바꾸", "갈아", "교체", "달아", "달면", "달고", "대 주", "대세", "쓰세", "써", "쓰셔", "쓰시", "쓸 수", "쓰십", "쓰면", "사용", "이용", "이어", "넘어가", "연결", "꽂"];
  const WHEN_NOT_AFTER = ["지금", "바로", "당장", "곧바로", "미리", ...SWITCH_EXTRA, "전에", "전이", "기 전", "없이", ...NEG];
  // 깨끗한 문장이 하나 있어도 틀린 문장을 덧붙이면 막는다: 반대 조건 낱말이 든 모든 문장을 거부(통합 레드팀 13라운드)
  if (f.actions.includes("SWITCH_AFTER_BATTERY")) {
    for (const w of ["지금", "바로", "당장", "곧바로", "미리", ...SWITCH_EXTRA, "전에"]) forbid(["산소통", "바꿔", w], `산소통 바꿔 쓰기에 '${w}'(배터리가 떨어진 뒤가 아님)`);
    if (c?.state === "UNTIL") for (const w of ["지금", "바로", "당장", "곧바로"]) forbid([c.text, w], `산소통 시각에 '${w}'(배터리 다음 바꿔 쓰기의 끝)`);
    // 확인 외장 집: 산소통 바꿔 쓰기·배터리를 함께 말하는 모든 문장은 '외장 배터리까지'여야 한다. 맞는 문장 옆에 '내장 배터리가 떨어지면 …'을 덧붙이거나
    // '외장 배터리 대신·보다·두고'로 뜻을 뒤집으면 거부(통합 레드팀 14라운드: 13라운드의 '내장' 거부는 필수 문장 하나에만 걸렸다)
    // 15라운드: 동의어·허락형·'그 전이라도'까지 같은 기준(외장 없는 집도)
    if (f.batteryWithExt) {
      scopedSentences.push({ any: [...USE, "배터리", "전지"], need: ["외장 배터리까지"], none: [...WHEN_NOT_AFTER, "내장", "내부", "본체", "기기 배터리", "대신", "보다", "두고", "먼저", "남겨", "비상용", "첫", "끼운", "끼워", "아껴"], hint: "산소통 바꿔 쓰기는 외장 배터리까지 다 떨어진 뒤", ...(c?.state === "UNTIL" ? { skipNeedWith: c.text } : {}) });
      for (const w of ["내장", "내부", "본체"]) forbid([w], `확인 외장 집에서 '${w}' 배터리만 따로 말함`);
      for (const w of ["두세", "그대로", "남겨", "아껴", "나중"]) forbid(["외장", w], `확인 외장 배터리를 쓰지 말고 두라는 말('${w}')`);
    } else scopedSentences.push({ any: USE, need: [], none: WHEN_NOT_AFTER, hint: "산소통 바꿔 쓰기는 배터리가 떨어진 뒤" });
  }
  if (f.actions.includes("SWITCH_TO_CYLINDER")) {
    for (const w of ["떨어지면", "다 되면", "뒤에", "다음에", ...SWITCH_EXTRA]) forbid(["산소통", "바꿔", w], `지금 바꿔 쓰기에 '${w}'`);
    if (c?.state === "UNTIL") for (const w of ["떨어지면", "다 되면", "뒤에", "다음에"]) forbid([c.text, w], `산소통 시각에 '${w}'(지금 바꿔 쓰기의 끝)`);
    scopedSentences.push({ any: USE, need: [], none: ["떨어지면", "다 되면", "뒤에", "다음에", "나중", "기다", ...SWITCH_EXTRA, ...NEG], hint: "산소통은 지금 바꿔 쓴다(15라운드: 동의어·허락형)" });
  }
  if (f.warnRunOutFirst) {
    for (const w of COND) forbid([supplyW, "떨어", w], `경고에 '${w}' 조건`);
    if (!f.warnTight) for (const w of ["일찍", "계산보다", "빨리", "닳으면"]) forbid([supplyW, "먼저", w], `계산대로여도 먼저 떨어지는데 '${w}' 조건`);
  }
  return { allowed, mustInclude, mustSentences, forbidSentences, scopedSentences };
}

// ---------- 금지 표현 ----------
export const BANNED: Record<"GUARANTEE" | "VAGUE_TIME" | "MEDICAL" | "RISKY" | "JARGON" | "STATE", readonly string[]> = {
  GUARANTEE: ["안전합니다", "안전해요", "안전하", "안심", "걱정하지", "걱정 마", "걱정 없", "걱정은", "괜찮", "문제없", "문제 없", "반드시", "확실", "보장", "틀림없", "꼭 도착", "충분",
    // 하한 보장 동의어(통합 레드팀 10라운드)
    "최소", "넉넉", "거뜬", "족히", "든든", "무리 없이", "마음 놓", "일은 없", "멈추지 않", "끄떡없", "너끈"],
  VAGUE_TIME: ["곧", "금방", "잠시", "조금만", "한참", "머지않아", "얼마 뒤", "얼마 후", "언제든"],
  MEDICAL: ["설정", "유량", "산소량", "농도", "복용", "진단", "처방", "숨", "호흡이", "증상", "의식", "맥박", "심폐"],
  RISKY: ["시동", "발전", "연장선", "콘센트", "멀티탭", "이웃", "촛불", "가스", "차에", "차량", "엘리베이터", "직접 운전", "직접 모시"],
  JARGON: ["하한", "잔여", "배정", "레인", "슬랙", "분위", "수동검토", "알고리즘", "시뮬레이션", "모의", "인공지능", "보수적"],
  // 정전 상황을 뒤집는 말(정전 중 안내에서만 검사)
  STATE: ["복구", "다시 들어", "돌아왔", "정전이 끝", "전기가 들어", "전원이 들어", "풀렸", "풀리", "켜졌", "켜지", "해결", "끝났", "들어왔", "들어옵", "전기가 옵"],
};
/** 기기 조작(끄기·뽑기·조절·아끼기) 어간과 기기 낱말이 한 문장에 함께 있으면 의료·기기 지시로 본다 */
const DEVICE_OP = /(끄|꺼|끈|뽑|빼|멈추|조절|낮추|줄이|높이|아끼|아껴)/;
const DEVICE_WORD = /(기기|전원|플러그|산소|호흡기|발생기|흡인기|배터리|장치)/;

const NATIVE_TIME = /(?:두어|서너|너덧|네댓|대여섯|예닐곱|열댓|여남은|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|열한|열두|스무|반)\s?(?:시간|시(?=[\s,.에까부쯤반경]|$))/; // 어림 수사(통합 레드팀 9라운드)
const SINO_TIME = /(?:[일이삼사오육칠팔구]?십[일이삼사오육칠팔구]?|[삼사오육칠팔구])\s?(?:분|시간)(?![가-힣])/;
const TIME_WORD = /(오전|오후|새벽|아침|저녁|한밤|자정|정오|이틀|사흘|며칠|하루|하룻|반나절|밤새|내일|모레|다음\s?날|한동안|당분간|오랫동안|오래|수\s?시간|수십\s?분|오늘\s?밤|몇\s?(?:시|분)|한나절|점심|동틀|해\s?뜰|무렵|녘|오밤중)/;

export type ViolationCode =
  | "FORMAT_COUNT" | "FORMAT_LEN" | "FORMAT_TOTAL" | "LATIN" | "MULTI_TIME"                  // 형식
  | "STRAY_NUMBER" | "NUMBER_WORD" | "ROLE_MISMATCH" | "UNSUPPORTED" | "CLAIM_MISMATCH"      // 사실 오류(CLAIM_*는 2차 검사)
  | "MISSING_TEXT" | "MISSING_SENTENCE"                                                     // 빠짐
  | "BANNED" | "CLAIM_UNSAFE" | "CHECK_FAILED";                                             // 안전·검사 실패
export const FACT_ERROR: readonly ViolationCode[] = ["STRAY_NUMBER", "NUMBER_WORD", "ROLE_MISMATCH", "UNSUPPORTED", "CLAIM_MISMATCH"];
export interface Violation { code: ViolationCode; detail: string; sentence?: string }
export interface VerifyResult { ok: boolean; violations: Violation[]; sentences: string[] }

/** 정규화(NFKC: 전각 숫자 → ASCII) 뒤 문장 단위로 나눈다 */
export function splitSentences(parts: readonly string[]): string[] {
  return parts.flatMap((p) => p.normalize("NFKC").replace(/\s+/g, " ").trim().split(/(?<=[.!?。])\s+/)).map((s) => s.trim()).filter(Boolean);
}

/** 허용 표기를 긴 것부터 찾아 지우고, 남은 글자와 찾은 표기를 돌려준다 */
function strip(sentence: string, allowed: readonly Allowed[]): { rest: string; hits: Allowed[] } {
  let rest = sentence;
  const hits: Allowed[] = [];
  for (const a of [...allowed].sort((x, y) => y.text.length - x.text.length)) {
    let i = rest.indexOf(a.text);
    while (i >= 0) {
      hits.push(a);
      rest = `${rest.slice(0, i)}\u0000${rest.slice(i + a.text.length)}`;
      i = rest.indexOf(a.text);
    }
  }
  return { rest, hits };
}

/** 담당자가 정하지 않은 수단·물건을 말하면 사실 오류: 쉼터·구급대·다른 장비·신고하지 않은 외장 배터리·확인 안 된 산소통 */
export function unsupportedWords(f: NoticeFacts): string[] {
  const p = f.plan;
  const res = p?.type === "ASSIGN" || p?.type === "GAP" ? p.resource : null;
  const out: string[] = [];
  if (p?.type !== "SHELTER") out.push("쉼터", "대피");
  if (p?.type !== "CALL119") out.push("구급", "병원", "이송");
  for (const n of Object.values(RESOURCE_NOUN)) if (n !== res) out.push(n);
  out.push("발전기", "전원 장치", "비상 전원");
  if (!f.cylinder) out.push("산소통", "실린더");
  const extOk = f.kind === "PREP" ? f.extDeclared : res === RESOURCE_NOUN.RENTAL_EXT || f.batteryWithExt === true;
  if (!extOk) out.push("외장");
  // 정해진 수단·확인된 산소통의 낱말 자체는 허용
  return [...new Set(out)].filter((w) => !(res && res.includes(w)) && !(f.cylinder && (w === "산소통" || w === "실린더")));
}

/** 1차 검사: AI 본문(119·123 문장 제외) */
export function verify(f: NoticeFacts, parts: readonly string[]): VerifyResult {
  const req = requirements(f);
  const sentences = splitSentences(parts);
  const unsup = unsupportedWords(f);
  // 정해진 수단 이름에 든 낱말(예: 「이동식 발전기」의 「발전」)은 금지어에서 뺀다
  const res = f.plan?.type === "ASSIGN" || f.plan?.type === "GAP" ? f.plan.resource : null;
  const v: Violation[] = [];
  const all = sentences.join(" ");
  if (sentences.length < LIMITS.minSentences || sentences.length > LIMITS.maxSentences) v.push({ code: "FORMAT_COUNT", detail: `문장 ${sentences.length}개` });
  if (all.length > LIMITS.maxTotalChars) v.push({ code: "FORMAT_TOTAL", detail: `전체 ${all.length}자` });
  const found = new Map<string, number>();
  for (const s of sentences) {
    if (s.length > LIMITS.maxSentenceChars) v.push({ code: "FORMAT_LEN", detail: `${s.length}자`, sentence: s });
    if (/[A-Za-z]/.test(s)) v.push({ code: "LATIN", detail: "영문·코드", sentence: s });
    const { rest, hits } = strip(s, req.allowed);
    for (const h of hits) found.set(h.text, (found.get(h.text) ?? 0) + 1);
    const stray = rest.match(/\p{Nd}+/gu);
    if (stray) v.push({ code: "STRAY_NUMBER", detail: `사실표에 없는 숫자 ${stray.join(",")}`, sentence: s });
    const nw = rest.match(NATIVE_TIME) ?? rest.match(SINO_TIME) ?? rest.match(TIME_WORD);
    if (nw) v.push({ code: "NUMBER_WORD", detail: `표기 밖 시간 낱말 「${nw[0]}」`, sentence: s });
    if (hits.length > 1) v.push({ code: "MULTI_TIME", detail: `시각·시간 ${hits.length}개`, sentence: s });
    for (const h of hits) {
      // 「정전에」「집 안에」 같은 말의 '전에'·'안에'는 뜻 뒤집기가 아니다
      const r0 = strip(s, [h]).rest.replace(/정전\s?(전)?에|집\s?안에/g, "").split(res ?? "\u0001").join("");
      const roleOk = (r: Role) => ROLE_WORDS[r].some((w) => r0.includes(w)) && !ROLE_FORBID[r].some((w) => r0.includes(w));
      if (!h.roles.some(roleOk)) v.push({ code: "ROLE_MISMATCH", detail: `「${h.text}」(${h.roles.map((r) => ROLE_KO[r]).join("/")})의 뜻 낱말이 맞지 않음`, sentence: s });
    }
    for (const [cat, list] of Object.entries(BANNED)) {
      if (cat === "STATE" && f.kind !== "OUTAGE") continue;
      for (const w of list) if (s.includes(w) && !(res && res.includes(w))) v.push({ code: "BANNED", detail: `${cat}: 「${w}」`, sentence: s });
    }
    if (DEVICE_OP.test(s) && DEVICE_WORD.test(s)) v.push({ code: "BANNED", detail: `MEDICAL: 기기 조작 「${s.match(DEVICE_OP)![0]}」`, sentence: s });
    for (const w of unsup) if (s.includes(w)) v.push({ code: "UNSUPPORTED", detail: `정하지 않은 수단 「${w}」`, sentence: s });
  }
  for (const m of req.mustInclude) if (!found.get(m.text)) v.push({ code: "MISSING_TEXT", detail: `「${m.text}」(${m.hint}) 없음` });
  for (const m of req.mustSentences) if (!sentences.some((s) => m.all.every((w) => s.includes(w)) && !(m.none ?? []).some((w) => s.includes(w)))) v.push({ code: "MISSING_SENTENCE", detail: `${m.all.join("+")} 한 문장 없음(${m.hint})` });
  for (const m of req.forbidSentences) for (const s of sentences) if (m.all.every((w) => s.includes(w))) v.push({ code: "UNSUPPORTED", detail: `사실과 반대: ${m.hint}`, sentence: s });
  for (const m of req.scopedSentences) for (const s0 of sentences) {
    // 산소통은 원문에서 찾는다(수단 「추가 산소통」을 지우면 범위가 빠지던 15라운드 결함). 다른 낱말은 정해진 수단 이름(「기기용 외장 배터리」)을 빼고 본다
    if (!/산소\s*통|실린더/.test(s0)) continue;
    const s = res ? s0.split(res).join("") : s0;
    if (!m.any.some((w) => s.includes(w))) continue;
    const needOk = (m.skipNeedWith != null && s.includes(m.skipNeedWith)) || m.need.every((w) => s.includes(w));
    if (!needOk || m.none.some((w) => s.includes(w))) v.push({ code: "UNSUPPORTED", detail: `사실과 반대: ${m.hint}`, sentence: s0 });
  }
  return { ok: v.length === 0, violations: v, sentences };
}

// ---------- 고정 문안 ----------
function batchim(word: string): number | null {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  return c >= 0 && c < 11172 ? c % 28 : null;
}
/** 조사: 이/가, 은/는 */
export function josa(word: string, pair: "이가" | "은는"): string {
  const b = batchim(word);
  const has = b != null && b !== 0;
  return word + (pair === "이가" ? (has ? "이" : "가") : (has ? "은" : "는"));
}

/**
 * 코드가 늘 붙이는 고정 문장(AI가 쓰지 않는다): 119·123 연락, 평시에는 원안의 「대체장소」「절전 가능 여부」.
 * 절전(기기 설정)은 의료 판단이라 안내하지 않고 담당 의료진·대여업체 확인으로 넘긴다.
 */
/** 계산값 단서(코드 고정 문장): 표시 하한은 넘칠 수 있다(봉인 E2 사후 집계 14.9%, 통합 레드팀 9라운드). 시각·시간이 글에 있을 때만 */
export function caveatSentence(f: NoticeFacts): string[] {
  const bat = f.battery.state === "UNTIL" || f.battery.state === "HOURS";
  const cyl = f.cylinder != null && (f.cylinder.state === "UNTIL" || f.cylinder.state === "HOURS");
  if (!bat && !cyl) return [];
  const what = bat && cyl ? "배터리·산소통" : bat ? "배터리" : "산소통";
  return [f.kind === "OUTAGE" ? `${what} 시각은 계산값이라 더 일찍 떨어질 수 있습니다.` : `${what} 시간은 계산값이라 더 짧을 수 있습니다.`];
}

export function tailSentences(f: NoticeFacts): string[] {
  const caveat = caveatSentence(f);
  return f.kind === "OUTAGE"
    ? [
      // 외장을 합친 시각은 남아도 기기 배터리는 이미 바닥일 수 있다: 외장으로 이어 쓰는지 확인(통합 레드팀 14라운드)
      // 배달 오는 외장 배터리(RENTAL_EXT)와 헷갈리지 않게 '집에 있는'(15라운드)
      ...(f.innerMaybeOut ? ["기기 배터리는 이미 떨어졌을 수 있습니다.", "집에 있는 외장 배터리가 꽂혀 있는지 확인하세요."] : []),
      ...caveat, "위급하면 바로 119에 전화하세요.", "정전 문의는 한전 123으로 하세요."]
    : [
      ...caveat,
      // 갈 곳: 늘 붙인다(원안 '대체장소', 통합 레드팀 4라운드). 절전: 배터리 없는 기기면 뺀다. 한 문장 45자 이내
      "정전 때 갈 곳을 담당자와 미리 정해 두세요.", // 조건 없이(짧은 정전은 괜찮다로 읽히지 않게, 11라운드)
      ...(f.battery.state === "NONE" ? [] : ["절전 기능이 있는지 담당 의료진에게 물어 두세요.", "기기 설정은 혼자 바꾸지 마세요."]),
      "위급하면 바로 119에 전화하세요.", "정전되면 한전 123에 알리세요.",
    ];
}

/** 도착이 계산상 끝과 가까울 때의 경고(표시 도착 ≤ 표시 보호 끝, 30분 여유 안). 조건은 '계산보다 일찍 떨어지면'뿐(통합 레드팀 10라운드) */
function tightWarn(f: NoticeFacts): string {
  const sup = f.cylinder ? "산소통" : "배터리";
  const at = f.plan?.type === "CALL119" ? "구급대 도착 전에" : "도착 전에";
  return `${josa(sup, "이가")} 계산보다 일찍 떨어지면 ${at} ${f.cylinder ? "산소가 끊길" : "기기가 멈출"} 수 있습니다.`;
}

/** 고정 문안 본문(1차 검사를 늘 통과 — rules.test.ts에서 모든 조합 시험). 같은 사실·할 일을 AI 글과 똑같이 담는다 */
export function templateSentences(f: NoticeFacts): string[] {
  const out: string[] = [];
  const hi = f.audience === "보호자" ? "보호자님, " : "";
  const b = f.battery, c = f.cylinder;
  if (f.kind === "OUTAGE") {
    out.push(`${hi}정전으로 ${f.device} 전원이 끊겼습니다.`);
    if (b.state === "UNTIL") out.push(f.batteryWithExt ? `외장 배터리까지 합쳐 계산상 ${b.text}까지 버팁니다.` : `배터리는 계산상 ${b.text}까지 버팁니다.`);
    if (b.state === "MAYBE_OUT") out.push("배터리가 거의 없거나 이미 다 떨어졌을 수 있습니다.");
    if (b.state === "UNKNOWN") out.push("배터리가 얼마나 갈지 담당자가 확인하고 있습니다.");
    if (b.state === "NONE") out.push(`${josa(f.device, "은는")} 배터리가 없어 정전되면 바로 멈춥니다.`);
    if (c) {
      out.push(f.actions.includes("SWITCH_AFTER_BATTERY") ? (f.batteryWithExt ? "외장 배터리까지 다 떨어지면 산소통으로 바꿔 쓰세요." : "배터리가 떨어지면 확인된 산소통으로 바꿔 쓰세요.") : "지금 확인된 산소통으로 바꿔 쓰세요.");
      out.push(c.state === "UNTIL" ? `산소통은 계산상 ${c.text}까지 씁니다.` : "산소통도 이미 거의 다 썼을 수 있습니다.");
    }
    const p = f.plan;
    if (p?.type === "ASSIGN" || p?.type === "GAP") {
      if (p.arriveBy) out.push(`${josa(p.resource, "이가")} ${p.arriveBy}까지 집에 도착합니다.`);
      else if (p.etaPassed) out.push(`${p.resource} 도착 예정 시각이 지나 담당자가 확인하고 있습니다.`);
      else out.push(`${josa(p.resource, "이가")} 집에 도착하도록 보내고 있습니다.`);
    }
    // 경고는 수단 문장 뒤에, 무엇이 오기 전인지 주어를 밝혀 쓴다(앞 문장의 '적어도 …까지'와 모순되지 않게)
    const supply = f.cylinder ? "산소통" : "배터리";
    const supplyJ = josa(supply, "이가");
    if (f.warnRunOutFirst && (p?.type === "ASSIGN" || p?.type === "GAP")) out.push(f.warnTight ? tightWarn(f) : `${josa(p.resource, "이가")} 오기 전에 ${supplyJ} 먼저 떨어질 수 있습니다.`);
    if (p?.type === "CALL119") {
      out.push("구급대와 연결했습니다.");
      out.push(p.doneBy ? `구급대가 ${p.doneBy}까지 옮겨 드릴 예정입니다.` : p.etaPassed ? "구급대 이송 예정 시각이 지나 담당자가 확인하고 있습니다." : "구급대가 언제 올지는 아직 정해지지 않았습니다.");
      if (p.late) out.push("구급대 출동이 늦어질 수 있습니다.");
      if (f.warnRunOutFirst) out.push(f.warnTight ? tightWarn(f) : `구급대가 오기 전에 ${supplyJ} 먼저 떨어질 수 있습니다.`);
    }
    if (p?.type === "SHELTER") out.push("가까운 쉼터로 옮기도록 담당자가 연락드립니다.");
    out.push("연락을 받을 수 있게 전화를 곁에 두세요.");
    out.push("연락이 오면 안내를 따라 주세요.");
    return out;
  }
  out.push(`${hi}정전에 미리 대비해 주세요.`);
  if (b.state === "HOURS") out.push(f.batteryWithExt ? `외장 배터리까지 합쳐 완전히 충전하면 계산상 ${b.text} 버팁니다.` : `${josa(f.device, "은는")} 완전히 충전하면 계산상 ${b.text} 버팁니다.`);
  if (b.state === "UNDER30") out.push(`${f.device} 배터리는 완전히 충전해도 30분을 못 버팁니다.`);
  if (b.state === "NONE") out.push(`${josa(f.device, "은는")} 배터리가 없어 정전되면 바로 멈춥니다.`);
  if (b.state === "UNKNOWN") out.push("배터리가 얼마나 가는지 담당자가 확인하고 있습니다.");
  if (c?.state === "HOURS") out.push(`확인된 산소통은 계산상 ${c.text} 씁니다.`);
  for (const a of f.actions) {
    if (a === "CHARGE_DEVICE") out.push("평소에 기기 배터리를 늘 충전해 두세요.");
    if (a === "CHARGE_EXT") out.push("외장 배터리도 늘 충전해 두세요.");
    if (a === "CHECK_CYLINDER") out.push("산소통을 미리 확인해 두세요.");
    if (a === "PLAN_WITH_STAFF") out.push("정전 때 쓸 다른 방법을 담당자와 미리 정해 두세요.");
  }
  return out;
}
