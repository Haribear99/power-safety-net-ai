// POST /api/vision — 라벨 이미지 1장 판독 (spec.md 7.2절). 이미지는 메모리에서만 쓰고 저장·기록하지 않는다.
// 순서: 본문 검사(zod·크기·매직바이트) → IP(/64) 시간 10회 → 접근 코드(맞으면 judge 풀, 틀리면 시간 5회 뒤 1시간 차단)
//       → 예약 후 호출(public·judge 일일 상한, Lua) → DB 대조. 예산·저장소가 없으면 503이 아니라 재생 모드.
import { ipAddress } from "@vercel/functions";
import { NextResponse } from "next/server";
import { z } from "zod";
import { budgetBackend } from "@/lib/claude/budget";
import { callStructured } from "@/lib/claude/client";
import { LabelOut, matchLabel, PROMPT_VERSION, SYSTEM_PROMPT, USER_TEXT } from "@/lib/vision/label";
import { accessCodeOk, hit, hourKey, ipBucket, sniffImage } from "@/lib/vision/server";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const Body = z.object({
  imageBase64: z.string().min(100).max(2 * 1024 * 1024),
  accessCode: z.string().max(200).optional(),
});

const replay = (reason: string) => NextResponse.json({ mode: "replay", reason, message: "오늘 실시간 판독 한도에 도달했습니다. 기록된 판독을 보여 드립니다" });

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const buf = Buffer.from(body.imageBase64, "base64");
  const mediaType = sniffImage(buf);
  if (!mediaType) return NextResponse.json({ error: "unsupported_image" }, { status: 400 });

  const be = budgetBackend();
  if (!be) return replay("no_store");
  const ip = ipBucket(ipAddress(req) ?? req.headers.get("x-forwarded-for")?.split(",")[0]);
  try {
    if (await be.raw(["GET", `pl26:rl:badcode-block:${ip}`])) return NextResponse.json({ error: "code_blocked" }, { status: 429 });
    let pool: "public" | "judge" = "public";
    if (body.accessCode) {
      if (accessCodeOk(body.accessCode)) {
        pool = "judge";
        if (!(await hit(be, `pl26:rl:judge:${hourKey()}:${ip}`, 30, 7200))) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
      } else {
        if (!(await hit(be, `pl26:rl:badcode:${hourKey()}:${ip}`, 5, 7200))) await be.raw(["SET", `pl26:rl:badcode-block:${ip}`, "1", "EX", 3600]);
        return NextResponse.json({ error: "bad_code" }, { status: 403 });
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
