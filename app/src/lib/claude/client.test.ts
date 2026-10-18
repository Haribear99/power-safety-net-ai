import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { keys, MemoryBackend, MICRO, poolLimitUsd, reserve, type Pool } from "./budget";
import { buildUserContent, callStructured, type SpendRow } from "./client";

const schema = z.object({ a: z.string() });
const okRes = (stop = "end_turn", parsed: unknown = { a: "x" }) => ({
  stop_reason: stop, content: [{ type: "text", text: parsed == null ? "{not json" : JSON.stringify(parsed) }],
  usage: { input_tokens: 2000, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
});
function fakeSdk(seq: (() => unknown)[]) {
  const calls: { max_tokens: number; timeout?: number }[] = [];
  return {
    calls,
    sdk: { messages: { create: async (body: { max_tokens: number }, opts?: { timeout?: number }) => { calls.push({ max_tokens: body.max_tokens, timeout: opts?.timeout }); return seq.shift()!(); } } } as never,
  };
}
const base = (be: MemoryBackend, sdk: never, log: SpendRow[], pool: Pool = "dev") => ({
  stage: "PW_C1_label" as const, pool, system: "s", user: "u", backend: be, sdk, spendLog: (r: SpendRow) => log.push(r),
});

describe("이미지 입력 블록(7.1절)", () => {
  it("이미지가 있으면 [image…, text] 순서, 없으면 기존처럼 문자열", () => {
    const c = buildUserContent("읽어", [{ mediaType: "image/png", base64: "AAA" }]) as { type: string; source?: { media_type: string } }[];
    expect(c.map((b) => b.type)).toEqual(["image", "text"]);
    expect(c[0].source!.media_type).toBe("image/png");
    expect(buildUserContent("읽어")).toBe("읽어");
  });
});

describe("호출 규칙(7.1절)", () => {
  it("성공: 예약 → 실제 비용으로 정산, 풀 키에는 실제 비용만 남는다", async () => {
    const be = new MemoryBackend(); const log: SpendRow[] = [];
    const f = fakeSdk([() => okRes()]);
    const r = await callStructured(base(be, f.sdk, log), schema);
    expect(r.ok).toBe(true);
    expect(f.calls).toEqual([{ max_tokens: 1500, timeout: 20_000 }]);
    expect(await be.get(keys.pool("dev"))).toBe(Math.ceil(((2000 * 2 + 300 * 10) / MICRO) * MICRO));
    expect(log.map((x) => x.kind)).toEqual(["reserve", "settle"]);
  });
  it("시간 초과 → 재시도 0회, hold 1행, 예약 유지", async () => {
    const be = new MemoryBackend(); const log: SpendRow[] = [];
    const f = fakeSdk([() => { throw new Anthropic.APIConnectionTimeoutError(); }]);
    const r = await callStructured(base(be, f.sdk, log), schema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("timeout");
    expect(f.calls).toHaveLength(1);
    expect(log.map((x) => x.kind)).toEqual(["reserve", "hold"]);
    expect(await be.get(keys.pool("dev"))).toBe(0.03 * MICRO);
  });
  it("max_tokens → 한도를 올려 1회만 재시도", async () => {
    const be = new MemoryBackend(); const log: SpendRow[] = [];
    const f = fakeSdk([() => okRes("max_tokens", null), () => okRes()]);
    const r = await callStructured(base(be, f.sdk, log), schema);
    expect(r.ok).toBe(true);
    expect(f.calls.map((c) => c.max_tokens)).toEqual([1500, 3000]);
  });
  it("parse_failed → 재시도 없음", async () => {
    const be = new MemoryBackend(); const log: SpendRow[] = [];
    const f = fakeSdk([() => okRes("end_turn", null)]);
    const r = await callStructured(base(be, f.sdk, log), schema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("parse_failed");
    expect(f.calls).toHaveLength(1);
  });
  it("예산 거부면 SDK를 부르지 않는다", async () => {
    const be = new MemoryBackend(); const log: SpendRow[] = [];
    be.m.set(keys.pool("dev"), poolLimitUsd("dev") * MICRO);
    const f = fakeSdk([() => okRes()]);
    const r = await callStructured(base(be, f.sdk, log), schema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("budget");
    expect(f.calls).toHaveLength(0);
  });
});

describe("예약(7.2절)", () => {
  it("동시 20요청에서도 judge 일일 상한($0.40)을 넘지 않는다", async () => {
    const be = new MemoryBackend();
    const rs = await Promise.all(Array.from({ length: 20 }, () => reserve(be, "judge", 0.03)));
    expect(rs.filter(Boolean)).toHaveLength(13); // 13 × 0.03 = 0.39 ≤ 0.40
    expect(await be.get(keys.pool("judge"))).toBeLessThanOrEqual(0.4 * MICRO);
  });
  it("누적 $35 이상이면 dev는 거부, sealed는 허용(중단 규칙)", async () => {
    const be = new MemoryBackend();
    be.m.set(keys.total, 35 * MICRO);
    expect(await reserve(be, "dev", 0.03)).toBeNull();
    expect(await reserve(be, "sealed", 0.03)).not.toBeNull();
  });
});
