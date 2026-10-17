/**
 * Claude 호출 래퍼 (spec.md 7.1절). 출처: 형제 저장소 `app/src/lib/claude/client.ts`를 복사해 고쳤다.
 * 바꾼 점
 * - 이미지 입력(user content = [image…, text]).
 * - 예약 후 실행(budget.ts Lua). 예약이 거부되면 호출하지 않는다. 지출 행(reserve·settle·hold)을 spendLog로 넘긴다.
 * - 재시도: max_tokens면 한도를 올려 1회만, parse_failed는 재시도 없음, 시간 초과는 재시도 없음 + 예약 유지(hold),
 *   5xx는 allow5xxRetry(C1 dev 스크립트)일 때만 1회. SDK 자동 재시도 끔.
 * - 단계별 timeout(models.ts). 본문(system·user·이미지)은 기록하지 않는다.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import { budgetBackend, costUsd, reserve, settle, type BudgetBackend, type Pool, type Reservation } from "./budget";
import { MODEL, STAGE, type ModelKey, type Stage } from "./models";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ maxRetries: 0 });
  return _client;
}

export type FailReason = "refusal" | "max_tokens" | "parse_failed" | "budget" | "no_budget_store" | "spend_limit" | "billing" | "rate_limit" | "timeout" | "error";
export type CallOutcome<T> =
  | { ok: true; data: T; meta: CallMeta }
  | { ok: false; reason: FailReason; meta: CallMeta; retryAfterSec?: number; message?: string };

export interface CallMeta {
  requestId: string;
  /** Anthropic 응답의 request id(있을 때) */
  apiRequestId?: string | null;
  stage: Stage;
  model: string;
  pool: Pool;
  latencyMs: number;
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  costUsd?: number;
  stopReason?: string | null;
  attempt: number;
  maxTokens: number;
}

export interface SpendRow { t: string; kind: "reserve" | "settle" | "hold"; pool: Pool; usd: number; requestId: string; stage: Stage }

export type ImageInput = { mediaType: "image/jpeg" | "image/png" | "image/webp"; base64: string };

export interface CallInput {
  stage: Stage;
  pool: Pool;
  system: string;
  /** 문서·이미지는 데이터 구획으로만 넘긴다(7.1절) */
  user: string;
  images?: ImageInput[];
  modelOverride?: ModelKey;
  backend?: BudgetBackend;
  spendLog?: (row: SpendRow) => void;
  allow5xxRetry?: boolean;
  /** 시험용 SDK 주입 */
  sdk?: Pick<Anthropic, "messages">;
}

export function buildUserContent(user: string, images?: ImageInput[]): Anthropic.ContentBlockParam[] | string {
  if (!images || images.length === 0) return user;
  return [
    ...images.map((im) => ({ type: "image" as const, source: { type: "base64" as const, media_type: im.mediaType, data: im.base64 } })),
    { type: "text" as const, text: user },
  ];
}

function thinkingParam(kind: "adaptive" | "between_tools" | "omit", modelKey: ModelKey) {
  if (kind === "omit") return {};
  if (kind === "between_tools") {
    if (modelKey !== "sonnet") return {};
    return { thinking: { type: "between_tools" } as unknown as Anthropic.ThinkingConfigParam };
  }
  return { thinking: { type: "adaptive" } as Anthropic.ThinkingConfigParam };
}

function logLine(meta: CallMeta, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), ...meta, ...extra }));
}

export async function callStructured<S extends z.ZodTypeAny>(input: CallInput, schema: S): Promise<CallOutcome<z.infer<S>>> {
  const cfg = STAGE[input.stage];
  const modelKey = input.modelOverride ?? cfg.model;
  const model = MODEL[modelKey];
  const be = input.backend ?? budgetBackend();
  const requestId = crypto.randomUUID();
  const base: CallMeta = { requestId, stage: input.stage, model, pool: input.pool, latencyMs: 0, attempt: 0, maxTokens: cfg.maxTokens };
  const spend = (kind: SpendRow["kind"], usd: number) => input.spendLog?.({ t: new Date().toISOString(), kind, pool: input.pool, usd, requestId, stage: input.stage });
  if (!be) return { ok: false, reason: "no_budget_store", meta: base, message: "Upstash 환경변수 없음(폴백 없음)" };
  const sdk = input.sdk ?? client();

  let maxTokens = cfg.maxTokens;
  let tried5xx = false;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const meta: CallMeta = { ...base, attempt, maxTokens };
    const reserveUsd = cfg.reserveUsd * (maxTokens / cfg.maxTokens);
    let r: Reservation | null;
    try {
      r = await reserve(be, input.pool, reserveUsd);
    } catch (e) {
      logLine(meta, { event: "budget_store_error" });
      return { ok: false, reason: "no_budget_store", meta, message: (e as Error).message };
    }
    if (!r) { logLine(meta, { event: "budget_denied" }); return { ok: false, reason: "budget", meta }; }
    spend("reserve", r.micro / 1e6);
    const t0 = Date.now();
    try {
      // parse()는 create()를 then으로 감싸 request id가 사라지므로 create().withResponse()로 받고 zod로 직접 검사한다
      const pending = sdk.messages.create({
        model,
        max_tokens: maxTokens,
        ...thinkingParam(cfg.thinking, modelKey),
        output_config: { effort: cfg.effort, format: zodOutputFormat(schema) },
        system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: buildUserContent(input.user, input.images) }],
        stream: false,
      }, { timeout: cfg.timeoutMs });
      const wr = pending as unknown as { withResponse?: () => Promise<{ data: Anthropic.Message; request_id: string | null }> };
      const { data: msg, request_id } = wr.withResponse ? await wr.withResponse() : { data: (await pending) as Anthropic.Message, request_id: null };
      const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
      let parsed: unknown = null;
      try { const j = schema.safeParse(JSON.parse(text)); parsed = j.success ? j.data : null; } catch { parsed = null; }
      const res = { ...msg, parsed_output: parsed };
      meta.latencyMs = Date.now() - t0;
      meta.stopReason = res.stop_reason;
      meta.apiRequestId = request_id;
      meta.usage = { input: res.usage.input_tokens, output: res.usage.output_tokens, cacheRead: res.usage.cache_read_input_tokens ?? 0, cacheWrite: res.usage.cache_creation_input_tokens ?? 0 };
      meta.costUsd = costUsd(modelKey, res.usage);
      const { refundMicro } = await settle(be, r, meta.costUsd);
      spend("settle", refundMicro / 1e6);
      logLine(meta, { event: "ok" });
      if (res.stop_reason === "refusal") return { ok: false, reason: "refusal", meta };
      if (res.stop_reason === "max_tokens") {
        if (attempt === 1) { maxTokens = cfg.retryMaxTokens; continue; }
        return { ok: false, reason: "max_tokens", meta };
      }
      if (res.parsed_output == null) return { ok: false, reason: "parse_failed", meta };
      return { ok: true, data: res.parsed_output as z.infer<S>, meta };
    } catch (err) {
      meta.latencyMs = Date.now() - t0;
      if (err instanceof Anthropic.APIConnectionTimeoutError) {
        spend("hold", r.micro / 1e6); // 과금 여부 불명 → 예약 유지
        logLine(meta, { event: "timeout_hold" });
        return { ok: false, reason: "timeout", meta };
      }
      // 아래 오류는 응답이 없어 과금되지 않은 것으로 보고 예약을 전부 되돌린다
      const release = async () => { const { refundMicro } = await settle(be, r!, 0); spend("settle", refundMicro / 1e6); };
      if (err instanceof Anthropic.RateLimitError) {
        await release();
        const ra = err.headers?.get?.("retry-after");
        if (!ra) { logLine(meta, { event: "spend_limit" }); return { ok: false, reason: "spend_limit", meta, message: err.message }; }
        logLine(meta, { event: "rate_limit", retryAfter: ra });
        return { ok: false, reason: "rate_limit", meta, retryAfterSec: Number(ra) };
      }
      if (err instanceof Anthropic.APIError && err.status === 402) {
        await release();
        return { ok: false, reason: "billing", meta, message: err.message };
      }
      if (err instanceof Anthropic.APIError && (err.status === undefined || err.status >= 500)) {
        await release();
        logLine(meta, { event: "api_5xx", status: err.status });
        if (input.allow5xxRetry && !tried5xx) { tried5xx = true; attempt--; continue; }
        return { ok: false, reason: "error", meta, message: `${err.status}` };
      }
      await release();
      logLine(meta, { event: "error", name: (err as Error).name });
      return { ok: false, reason: "error", meta, message: (err as Error).message };
    }
  }
  return { ok: false, reason: "error", meta: base };
}
