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
  BATTERY_T: ["도착", "산소통", "충전하면", "충전해도", "충전해 두면", ...FLIP], // 정전 중 시각은 지금 상태 기준(통합 레드팀 6라운드)
  CYL_T: ["도착", "배터리", ...FLIP],
  // 도착·이송 시각 문장에 '배터리'·'산소통'이 있으면(정해진 수단 이름 안의 낱말은 빼고 본다) 그 시각을 배터리 시각처럼 쓴 것으로 본다(통합 레드팀 4라운드)
  ARRIVAL_T: ["배터리", "산소통", ...FLIP],
  T119: ["배터리", "산소통", ...FLIP],
  CHARGE_H: ["도착", "산소통", "없이", "안 해도", "않아도", ...FLIP],
  CHARGE_LT: ["도착", "산소통", "않으면", "안 하면", "없으면", "없이"], // 「30분을 못 버팁니다」는 부정문이 맞다. 「충전하지 않으면」 전제 바꾸기는 막는다(6라운드)
  CYL_H: ["도착", "배터리", "충전", ...FLIP],
};
export const ROLE_KO: Record<Role, string> = {
  BATTERY_T: "배터리가 적어도 버티는 시각", CYL_T: "산소통으로 바꿔 쓰면 적어도 버티는 시각", ARRIVAL_T: "도착 시각",
  T119: "구급대 이송 완료 예상 시각", CHARGE_H: "완충 시 적어도 버티는 시간", CHARGE_LT: "완충해도 못 버티는 시간", CYL_H: "확인된 산소통이 적어도 버티는 시간",
};

export interface Allowed { text: string; roles: Role[] }
/** all = 한 문장에 함께 있어야 할 낱말, none = 그 문장에 있으면 안 되는 낱말(부정 등) */
export interface SentenceReq { all: string[]; hint: string; none?: string[] }
export interface Requirements { allowed: Allowed[]; mustInclude: { text: string; hint: string }[]; mustSentences: SentenceReq[]; forbidSentences: SentenceReq[] }

export const LIMITS = { minSentences: 3, maxSentences: 10, maxSentenceChars: 45, maxTotalChars: 380 } as const;

export function requirements(f: NoticeFacts): Requirements {
  const allowed: Allowed[] = [];
  const mustInclude: Requirements["mustInclude"] = [];
  const mustSentences: SentenceReq[] = [];
  const forbidSentences: SentenceReq[] = [];
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
  if (b.state === "MAYBE_OUT") sent(["배터리", "이미"], "배터리가 이미 떨어졌을 수 있다");
  if (b.state === "UNKNOWN") sent(["배터리", "담당자"], "배터리가 얼마나 가는지 담당자가 확인 중이다");
  if (b.state === "NONE") sent(["멈"], "배터리가 없어 정전되면 바로 멈춘다"); // 「배터리가 없습니다. 그래서 바로 멈춥니다」처럼 나눠 써도 된다(뜻은 2차 검사)
  const c = f.cylinder;
  if (c?.state === "UNTIL") must(c.text, "CYL_T");
  if (c?.state === "HOURS") must(c.text, "CYL_H");
  if (c?.state === "MAYBE_OUT") sent(["산소통", "이미"], "산소통도 이미 거의 다 썼을 수 있다");
  const p = f.plan;
  if (p?.type === "ASSIGN" || p?.type === "GAP") {
    if (p.arriveBy) must(p.arriveBy, "ARRIVAL_T");
    if (p.etaPassed) sent([p.resource, "지나"], `${p.resource} 도착 예정 시각이 지나 담당자가 확인 중이다`);
    else sent([p.resource, "도착"], `${josa(p.resource, "이가")} 집에 도착한다`);
  }
  const supplyW = f.cylinder ? "산소통" : "배터리";
  if (f.warnRunOutFirst && f.warnSameTime) sent([supplyW, "먼저", "늦어지면"], `도착이 늦어지면 ${supplyW}가 먼저 떨어질 수 있다(표시 시각이 같음)`);
  else if (f.warnRunOutFirst) sent([supplyW, "먼저"], `도움이 오기 전에 ${supplyW}가 먼저 떨어질 수 있다`);
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
    if (a === "SWITCH_TO_CYLINDER") sent(["산소통", "바꿔", "지금"], "지금 바로 확인된 산소통으로 바꿔 쓴다", NEG);
    if (a === "SWITCH_AFTER_BATTERY") sent(["산소통", "바꿔", "배터리"], "배터리가 떨어지면 확인된 산소통으로 바꿔 쓴다", NEG);
    if (a === "CHARGE_DEVICE") sent(["충전"], "평소에 배터리를 늘 충전해 둔다");
    if (a === "CHARGE_EXT") sent(["외장", "충전"], "외장 배터리도 충전해 둔다");
    if (a === "CHECK_CYLINDER") sent(["산소통", "확인"], "산소통을 미리 확인해 둔다");
    if (a === "PLAN_WITH_STAFF") sent(["담당자", "정해"], "정전 때 쓸 다른 방법을 담당자와 미리 정해 둔다");
  }
  return { allowed, mustInclude, mustSentences, forbidSentences };
}

// ---------- 금지 표현 ----------
export const BANNED: Record<"GUARANTEE" | "VAGUE_TIME" | "MEDICAL" | "RISKY" | "JARGON" | "STATE", readonly string[]> = {
  GUARANTEE: ["안전합니다", "안전해요", "안전하", "안심", "걱정하지", "걱정 마", "걱정 없", "걱정은", "괜찮", "문제없", "문제 없", "반드시", "확실", "보장", "틀림없", "꼭 도착", "충분"],
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

const NATIVE_TIME = /(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|열한|열두|스무|반)\s?(?:시간|시(?=[\s,.에까부쯤반경]|$))/;
const SINO_TIME = /(?:[일이삼사오육칠팔구]?십[일이삼사오육칠팔구]?|[삼사오육칠팔구])\s?(?:분|시간)(?![가-힣])/;
const TIME_WORD = /(오전|오후|새벽|아침|저녁|한밤|자정|정오|이틀|사흘|며칠|하루|하룻|반나절|밤새|내일|모레|다음\s?날|한동안|당분간|오랫동안|오래|수\s?시간|수십\s?분|오늘\s?밤|몇\s?(?:시|분))/;

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
  const extOk = f.kind === "PREP" ? f.extDeclared : res === RESOURCE_NOUN.RENTAL_EXT;
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
export function tailSentences(f: NoticeFacts): string[] {
  return f.kind === "OUTAGE"
    ? ["위급하면 바로 119에 전화하세요.", "정전 문의는 한전 123으로 하세요."]
    : [
      // 갈 곳: 늘 붙인다(원안 '대체장소', 통합 레드팀 4라운드). 절전: 배터리 없는 기기면 뺀다. 한 문장 45자 이내
      "정전이 길어질 때 갈 곳을 담당자와 미리 정해 두세요.",
      ...(f.battery.state === "NONE" ? [] : ["절전 기능이 있는지 담당 의료진에게 물어 두세요.", "기기 설정은 혼자 바꾸지 마세요."]),
      "위급하면 바로 119에 전화하세요.", "정전되면 한전 123에 알리세요.",
    ];
}

/** 고정 문안 본문(1차 검사를 늘 통과 — rules.test.ts에서 모든 조합 시험). 같은 사실·할 일을 AI 글과 똑같이 담는다 */
export function templateSentences(f: NoticeFacts): string[] {
  const out: string[] = [];
  const hi = f.audience === "보호자" ? "보호자님, " : "";
  const b = f.battery, c = f.cylinder;
  if (f.kind === "OUTAGE") {
    out.push(`${hi}정전으로 ${f.device} 전원이 끊겼습니다.`);
    if (b.state === "UNTIL") out.push(`배터리는 적어도 ${b.text}까지 버팁니다.`);
    if (b.state === "MAYBE_OUT") out.push("배터리가 거의 없거나 이미 다 떨어졌을 수 있습니다.");
    if (b.state === "UNKNOWN") out.push("배터리가 얼마나 갈지 담당자가 확인하고 있습니다.");
    if (b.state === "NONE") out.push(`${josa(f.device, "은는")} 배터리가 없어 정전되면 바로 멈춥니다.`);
    if (c) {
      out.push(f.actions.includes("SWITCH_AFTER_BATTERY") ? "배터리가 떨어지면 확인된 산소통으로 바꿔 쓰세요." : "지금 확인된 산소통으로 바꿔 쓰세요.");
      out.push(c.state === "UNTIL" ? `산소통은 적어도 ${c.text}까지 씁니다.` : "산소통도 이미 거의 다 썼을 수 있습니다.");
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
    if (f.warnRunOutFirst && (p?.type === "ASSIGN" || p?.type === "GAP")) out.push(f.warnSameTime ? `도착이 늦어지면 ${supplyJ} 먼저 떨어질 수 있습니다.` : `${josa(p.resource, "이가")} 오기 전에 ${supplyJ} 먼저 떨어질 수 있습니다.`);
    if (p?.type === "CALL119") {
      out.push("구급대와 연결했습니다.");
      out.push(p.doneBy ? `구급대가 ${p.doneBy}까지 옮겨 드릴 예정입니다.` : p.etaPassed ? "구급대 이송 예정 시각이 지나 담당자가 확인하고 있습니다." : "구급대가 언제 올지는 아직 정해지지 않았습니다.");
      if (p.late) out.push("구급대 출동이 늦어질 수 있습니다.");
      if (f.warnRunOutFirst) out.push(f.warnSameTime ? `구급대가 늦어지면 ${supplyJ} 먼저 떨어질 수 있습니다.` : `구급대가 오기 전에 ${supplyJ} 먼저 떨어질 수 있습니다.`);
    }
    if (p?.type === "SHELTER") out.push("가까운 쉼터로 옮기도록 담당자가 연락드립니다.");
    out.push("연락을 받을 수 있게 전화를 곁에 두세요.");
    out.push("연락이 오면 안내를 따라 주세요.");
    return out;
  }
  out.push(`${hi}정전에 미리 대비해 주세요.`);
  if (b.state === "HOURS") out.push(`${josa(f.device, "은는")} 완전히 충전하면 적어도 ${b.text} 버팁니다.`);
  if (b.state === "UNDER30") out.push(`${f.device} 배터리는 완전히 충전해도 30분을 못 버팁니다.`);
  if (b.state === "NONE") out.push(`${josa(f.device, "은는")} 배터리가 없어 정전되면 바로 멈춥니다.`);
  if (b.state === "UNKNOWN") out.push("배터리가 얼마나 가는지 담당자가 확인하고 있습니다.");
  if (c?.state === "HOURS") out.push(`확인된 산소통은 적어도 ${c.text} 씁니다.`);
  for (const a of f.actions) {
    if (a === "CHARGE_DEVICE") out.push("평소에 기기 배터리를 늘 충전해 두세요.");
    if (a === "CHARGE_EXT") out.push("외장 배터리도 늘 충전해 두세요.");
    if (a === "CHECK_CYLINDER") out.push("산소통을 미리 확인해 두세요.");
    if (a === "PLAN_WITH_STAFF") out.push("정전 때 쓸 다른 방법을 담당자와 미리 정해 두세요.");
  }
  return out;
}
