// POST /api/notice — 보호자 알림 쉬운 글 1건. 입력은 숫자·열거값만(NoticeInput, strict). 사실 묶음은 서버가 다시 만든다.
// 순서: 본문 검사(JSON·zod) → 사실 묶음(코드) → 접근 코드(맞으면 코드당 시간 60회, 틀리면 /api/vision과 같은 차단 규칙)
//       → 코드 없으면 IP(/64) 시간 5회 → 생성(PW_N1_notice) → 1차 검사(글자 규칙) → 통과하면 2차 검사(PW_N1_check: 다른 모델이 글만 읽고 주장 추출 → 사실 대조)
//       → 둘 다 통과하면 AI 본문, 아니면 고정 문안. 119·123 문장과 꼬리말은 늘 코드가 붙인다.
// 예산은 알림 전용 풀(notice, 일 $0.60)이라 라벨 판독 공개 예산을 쓰지 않는다. 예산·저장소가 없으면 고정 문안(재생 모드).
import { ipAddress } from "@vercel/functions";
import { NextResponse } from "next/server";
import { z } from "zod";
import { budgetBackend } from "@/lib/claude/budget";
import { callStructured } from "@/lib/claude/client";
import { Claims, CHECK_SYSTEM, CHECK_VERSION, checkUser } from "@/lib/notice/check";
import { compose, type Check2 } from "@/lib/notice/compose";
import { buildFacts, NoticeInput } from "@/lib/notice/facts";
import { NOTICE_PROMPT_VERSION, NOTICE_SYSTEM, NoticeOut, noticeUser } from "@/lib/notice/prompt";
import { verify } from "@/lib/notice/rules";
import { accessCodeOk, codeKey, hit, hourKey, ipBucket } from "@/lib/vision/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const Body = z.object({ input: NoticeInput, accessCode: z.string().max(200).optional() }).strict();

const FALLBACK_MSG: Record<string, string> = {
  budget: "오늘 실시간 생성 한도에 도달해 고정 문안을 보여 드립니다",
  spend_limit: "오늘 실시간 생성 한도에 도달해 고정 문안을 보여 드립니다",
  no_budget_store: "실시간 생성을 쓸 수 없는 환경이라 고정 문안을 보여 드립니다",
  no_store: "실시간 생성을 쓸 수 없는 환경이라 고정 문안을 보여 드립니다",
  store_error: "일시 장애로 고정 문안을 보여 드립니다",
};

export async function POST(req: Request) {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "unsupported_media_type" }, { status: 415 });
  }
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "bad_request", message: "요청 형식이 맞지 않습니다. 화면을 새로고침한 뒤 다시 시도해 주세요" }, { status: 400 });
  }
  const facts = buildFacts(body.input);
  const replay = (reason: string) => NextResponse.json({ mode: "replay", reason, message: FALLBACK_MSG[reason] ?? FALLBACK_MSG.store_error, composed: compose(facts, null) });

  const be = budgetBackend();
  if (!be) return replay("no_store");
  const ip = ipBucket(ipAddress(req) ?? req.headers.get("x-forwarded-for")?.split(",")[0]);
  try {
    const code = (body.accessCode ?? "").replace(/\s+/g, "");
    if (code) {
      if (await be.raw(["GET", `pl26:rl:badcode-block:${ip}`])) {
        return NextResponse.json({ error: "code_blocked", message: "접근 코드를 여러 번 틀려 이 주소의 코드 입력이 1시간 막혔습니다. 코드 칸을 비우면 공개 생성은 쓸 수 있습니다" }, { status: 429 });
      }
      if (accessCodeOk(code)) {
        if (!(await hit(be, `pl26:rl:judge:notice:${hourKey()}:${codeKey(code)}`, 60, 7200))) {
          return NextResponse.json({ error: "rate_limited", message: "심사용 코드의 시간당 한도(60회)를 넘었습니다. 다음 정시 이후 다시 시도해 주세요" }, { status: 429 });
        }
      } else {
        if (!(await hit(be, `pl26:rl:badcode:${hourKey()}:${ip}`, 5, 7200))) await be.raw(["SET", `pl26:rl:badcode-block:${ip}`, "1", "EX", 3600]);
        return NextResponse.json({ error: "bad_code", message: "접근 코드가 맞지 않습니다" }, { status: 403 });
      }
    } else if (!(await hit(be, `pl26:rl:ip:notice:${hourKey()}:${ip}`, 5, 7200))) {
      return NextResponse.json({ error: "rate_limited", message: "이 주소에서 시간당 5회를 넘었습니다" }, { status: 429 });
    }
    const t0 = Date.now();
    const r = await callStructured({ stage: "PW_N1_notice", pool: "notice", system: NOTICE_SYSTEM, user: noticeUser(facts), backend: be }, NoticeOut);
    if (!r.ok) {
      if (r.reason === "budget" || r.reason === "no_budget_store" || r.reason === "spend_limit") return replay(r.reason);
      // 생성 실패도 알림은 나가야 한다: 고정 문안 + 실패 이유
      return NextResponse.json({ mode: "live", ok: false, reason: r.reason, composed: compose(facts, null) });
    }
    // 1차 검사를 통과한 글만 2차 검사(비용 절약). 2차 검사 실패는 닫힘(고정 문안)
    let check: Check2 | null = null;
    let checkCost = 0;
    if (verify(facts, r.data.sentences).ok) {
      const c = await callStructured({ stage: "PW_N1_check", pool: "notice", system: CHECK_SYSTEM, user: checkUser(r.data.sentences), backend: be }, Claims);
      checkCost = c.meta.costUsd ?? 0;
      check = c.ok ? { claims: c.data } : { error: c.reason };
    }
    const composed = compose(facts, { sentences: r.data.sentences, check });
    return NextResponse.json({
      mode: "live", ok: true, promptVersion: NOTICE_PROMPT_VERSION, checkVersion: CHECK_VERSION, composed,
      // 검사에서 떨어진 AI 원문은 보내지 않고 화면에 '보내지 않은 글'로만 보여 준다(투명성)
      ...(composed.source === "template" ? { rejected: r.data.sentences } : {}),
      meta: { latencyMs: Date.now() - t0, costUsd: (r.meta.costUsd ?? 0) + checkCost, model: r.meta.model },
    });
  } catch {
    return replay("store_error");
  }
}
