// POST /api/vision — 라벨 이미지 1장 판독 (spec.md 7.2절). 이미지는 메모리에서만 쓰고 저장·기록하지 않는다.
// 순서: 본문 검사(JSON 형식·동의·zod·크기·매직바이트) → 접근 코드(공백 제거 후 비교. 맞으면 judge 풀, 틀리면 시간 5회 뒤
//       그 IP의 '코드 입력'만 1시간 차단 — 코드 없는 공개 판독은 막지 않는다) → 공개 풀은 IP(/64) 시간 10회
//       → 예약 후 호출(public·judge 일일 상한, Lua) → DB 대조. 예산·저장소가 없으면 503이 아니라 재생 모드.
import { ipAddress } from "@vercel/functions";
import { NextResponse } from "next/server";
import { z } from "zod";
import { budgetBackend } from "@/lib/claude/budget";
import { callStructured } from "@/lib/claude/client";
import { LabelOut, matchLabel, PROMPT_VERSION, SYSTEM_PROMPT, USER_TEXT } from "@/lib/vision/label";
import { accessCodeOk, codeKey, hit, hourKey, ipBucket, sniffImage } from "@/lib/vision/server";

export const maxDuration = 60; // 판독 20초 + max_tokens 재시도 20초가 30초를 넘을 수 있다
export const dynamic = "force-dynamic";

const Body = z.object({
  imageBase64: z.string().min(100).max(2 * 1024 * 1024),
  accessCode: z.string().max(200).optional(),
  // 화면의 두 동의(합성·본인 라벨, 국외 전송)를 서버에서도 요구한다
  consent: z.object({ synthetic: z.literal(true), overseas: z.literal(true) }),
});

const REPLAY_MSG: Record<string, string> = {
  budget: "오늘 실시간 판독 한도에 도달했습니다. 기록된 판독을 보여 드립니다",
  spend_limit: "오늘 실시간 판독 한도에 도달했습니다. 기록된 판독을 보여 드립니다",
  no_budget_store: "실시간 판독을 쓸 수 없는 환경입니다. 기록된 판독을 보여 드립니다",
  no_store: "실시간 판독을 쓸 수 없는 환경입니다. 기록된 판독을 보여 드립니다",
  store_error: "일시 장애로 실시간 판독을 못 했습니다. 기록된 판독을 보여 드립니다",
};
const replay = (reason: string) => NextResponse.json({ mode: "replay", reason, message: REPLAY_MSG[reason] ?? REPLAY_MSG.store_error });

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
  const buf = Buffer.from(body.imageBase64, "base64");
  const mediaType = sniffImage(buf);
  if (!mediaType) return NextResponse.json({ error: "unsupported_image" }, { status: 400 });

  const be = budgetBackend();
  if (!be) return replay("no_store");
  const ip = ipBucket(ipAddress(req) ?? req.headers.get("x-forwarded-for")?.split(",")[0]);
  try {
    let pool: "public" | "judge" = "public";
    const code = (body.accessCode ?? "").replace(/\s+/g, "");
    if (code) {
      if (await be.raw(["GET", `pl26:rl:badcode-block:${ip}`])) {
        return NextResponse.json({ error: "code_blocked", message: "접근 코드를 여러 번 틀려 이 주소의 코드 입력이 1시간 막혔습니다. 코드 칸을 비우면 공개 판독은 쓸 수 있습니다" }, { status: 429 });
      }
      if (accessCodeOk(code)) {
        pool = "judge";
        // 코드당 시간 60회(spec 7.2절 30회에서 10/18 상향: 심사위원 여럿이 한 코드를 나눠 씀). IP를 바꿔도 같은 코드면 같은 창
        if (!(await hit(be, `pl26:rl:judge:${hourKey()}:${codeKey(code)}`, 60, 7200))) {
          return NextResponse.json({ error: "rate_limited", message: "심사용 코드의 시간당 한도(60회)를 넘었습니다. 다음 정시 이후 다시 시도해 주세요" }, { status: 429 });
        }
      } else {
        if (!(await hit(be, `pl26:rl:badcode:${hourKey()}:${ip}`, 5, 7200))) await be.raw(["SET", `pl26:rl:badcode-block:${ip}`, "1", "EX", 3600]);
        return NextResponse.json({ error: "bad_code", message: "접근 코드가 맞지 않습니다" }, { status: 403 });
      }
    }
    if (pool === "public" && !(await hit(be, `pl26:rl:ip:vision:${hourKey()}:${ip}`, 10, 7200))) {
      return NextResponse.json({ error: "rate_limited", message: "이 주소에서 시간당 10회를 넘었습니다" }, { status: 429 });
    }
    const r = await callStructured({
      stage: "PW_C1_label", pool, system: SYSTEM_PROMPT, user: USER_TEXT, images: [{ mediaType, base64: body.imageBase64 }], backend: be,
    }, LabelOut);
    if (!r.ok) {
      if (r.reason === "budget" || r.reason === "no_budget_store" || r.reason === "spend_limit") return replay(r.reason);
      return NextResponse.json({ mode: "live", ok: false, reason: r.reason }, { status: 502 });
    }
    return NextResponse.json({
      mode: "live", ok: true, pool, promptVersion: PROMPT_VERSION, label: r.data, match: matchLabel(r.data),
      meta: { latencyMs: r.meta.latencyMs, costUsd: r.meta.costUsd, model: r.meta.model },
    });
  } catch {
    return replay("store_error");
  }
}
