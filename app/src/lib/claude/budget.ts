/**
 * 예산 풀 (spec.md 7.1·7.2·7.5절). 출처: 형제 저장소 `app/src/lib/claude/budget.ts`를 복사해 고쳤다.
 * 바꾼 점
 * - 풀: dev | sealed | public | judge | notice | reserve. notice = 보호자 알림 실시간 생성(10/18 추가, 라벨 판독 공개 풀과 분리). 키는 `pl26:budget:<pool>`로 **누적**(월 단위 아님).
 * - '검사 후 기록' 대신 **예약 후 실행**: 풀·일일·전체 키를 Lua 1회(EVAL)로 함께 검사·증가하고(원자적), 호출 뒤 차액을 Lua 1회로 되돌린다.
 *   시간 초과 등 과금 여부를 모르면 예약분을 그대로 둔다(hold).
 * - MemoryStore 폴백 없음: Upstash 환경변수가 없으면 budgetBackend()가 null → 라우트는 재생 모드, 스크립트는 즉시 종료.
 * - 중단 규칙: 전체 누적 $35 이상이면 sealed·public·judge 밖의 예약을 거부한다.
 */
import { PRICE_PER_MTOK, type ModelKey } from "./models";

export type Pool = "dev" | "sealed" | "public" | "judge" | "notice" | "notice_judge" | "reserve";
export const POOLS: readonly Pool[] = ["dev", "sealed", "public", "judge", "notice", "notice_judge", "reserve"];

export const MICRO = 1_000_000;
export const FREEZE_TOTAL_USD = 35;
const FREEZE_EXEMPT: readonly Pool[] = ["sealed", "public", "judge", "notice", "notice_judge"];

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function costUsd(model: ModelKey, u: Usage): number {
  const p = PRICE_PER_MTOK[model];
  const cr = u.cache_read_input_tokens ?? 0;
  const cw = u.cache_creation_input_tokens ?? 0;
  return (u.input_tokens * p.input + u.output_tokens * p.output + cr * p.cacheRead + cw * p.cacheWrite) / MICRO;
}

export function totalBudgetUsd(): number {
  return Number(process.env.CLAUDE_TOTAL_BUDGET_USD ?? 45);
}

/** 풀 상한(7.1절): dev 0.55, sealed 0.12, public 0.12, reserve 0.21 − judge $3.0 − notice $3.0 − notice_judge $1.5.
 *  10/18 통합 레드팀 9라운드 회귀 중 dev가 상한에 닿아, 봉인 실행이 끝나 남은 sealed 몫 0.10을 dev로 옮겼다(총액 그대로, sealed 사용 $2.77 < 새 상한 $5.40) */
export function poolLimitUsd(pool: Pool): number {
  const t = totalBudgetUsd();
  switch (pool) {
    case "dev": return t * 0.55;
    case "sealed": return t * 0.12;
    case "public": return t * 0.12;
    case "judge": return 3.0;
    case "notice": return 3.0;
    case "notice_judge": return 1.5; // 심사용 코드 알림 전용(라벨 판독 judge 몫과 분리, 통합 레드팀 3라운드)
    case "reserve": return t * 0.21 - 7.5;
  }
}

/** KST 날짜(YYYY-MM-DD) */
export function kstDate(now = new Date()): string {
  const k = new Date(now.getTime() + 9 * 3600_000);
  return k.toISOString().slice(0, 10);
}

/** 일일 상한(7.5절): public = min($0.30, 풀 잔액 ÷ 남은 일수), judge = $0.40, notice = $0.60, 나머지 없음(null) */
export function dayLimitUsd(pool: Pool, poolSpentUsd: number, now = new Date(), voteEnd = process.env.VOTE_END_KST ?? "2026-12-31"): number | null {
  if (pool === "judge") return 0.4;
  if (pool === "notice") return 0.6;
  if (pool === "notice_judge") return 0.4;
  if (pool !== "public") return null;
  const days = Math.max(1, Math.ceil((Date.parse(`${voteEnd}T23:59:59+09:00`) - now.getTime()) / 86_400_000));
  return Math.min(0.3, Math.max(0, poolLimitUsd("public") - poolSpentUsd) / days);
}

export const keys = {
  pool: (p: Pool) => `pl26:budget:${p}`,
  day: (p: Pool, d: string) => `pl26:budget:${p}:day:${d}`,
  total: "pl26:budget:total",
};

/**
 * 예약 Lua. KEYS = [풀, 일일(없으면 빈 문자열), 전체], ARGV = [금액, 풀 상한, 일일 상한(−1 = 없음), 전체 상한, 동결선(−1 = 면제), 일일 키 TTL초] (모두 마이크로달러 정수)
 * 모든 조건을 통과할 때만 세 키에 INCRBY하고 1, 아니면 아무것도 바꾸지 않고 0.
 */
export const RESERVE_LUA = `
local a = tonumber(ARGV[1])
local p = tonumber(redis.call('GET', KEYS[1]) or '0')
local t = tonumber(redis.call('GET', KEYS[3]) or '0')
if p + a > tonumber(ARGV[2]) then return 0 end
if t + a > tonumber(ARGV[4]) then return 0 end
if tonumber(ARGV[5]) >= 0 and t + a > tonumber(ARGV[5]) then return 0 end
if KEYS[2] ~= '' and tonumber(ARGV[3]) >= 0 then
  local d = tonumber(redis.call('GET', KEYS[2]) or '0')
  if d + a > tonumber(ARGV[3]) then return 0 end
  redis.call('INCRBY', KEYS[2], a)
  redis.call('EXPIRE', KEYS[2], tonumber(ARGV[6]))
end
redis.call('INCRBY', KEYS[1], a)
redis.call('INCRBY', KEYS[3], a)
return 1
`.trim();

/** 정산 Lua. KEYS = 예약과 같음, ARGV = [되돌릴 금액(≥0)]. 세 키에서 함께 뺀다 */
export const SETTLE_LUA = `
local r = tonumber(ARGV[1])
if r <= 0 then return 0 end
redis.call('DECRBY', KEYS[1], r)
redis.call('DECRBY', KEYS[3], r)
if KEYS[2] ~= '' then redis.call('DECRBY', KEYS[2], r) end
return 1
`.trim();

export interface BudgetBackend {
  get(key: string): Promise<number>;
  /** 예약 Lua 실행(성공 1, 거부 0) */
  reserve(k: string[], argv: number[]): Promise<number>;
  settle(k: string[], refundMicro: number): Promise<void>;
}

export class UpstashBackend implements BudgetBackend {
  constructor(private url: string, private token: string) {}
  private async cmd(args: (string | number)[]): Promise<unknown> {
    const r = await fetch(this.url, {
      method: "POST",
      signal: AbortSignal.timeout(3000),
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!r.ok) throw new Error(`upstash ${r.status}`);
    return ((await r.json()) as { result: unknown }).result;
  }
  async get(key: string) {
    const v = (await this.cmd(["GET", key])) as string | null;
    return v ? Number(v) : 0;
  }
  async reserve(k: string[], argv: number[]) {
    return Number(await this.cmd(["EVAL", RESERVE_LUA, 3, ...k, ...argv]));
  }
  async settle(k: string[], refundMicro: number) {
    await this.cmd(["EVAL", SETTLE_LUA, 3, ...k, refundMicro]);
  }
  /** 임의 명령(ratelimit 등 공용) */
  async raw(args: (string | number)[]): Promise<unknown> {
    return this.cmd(args);
  }
}

/** 시험용: Lua와 같은 규칙을 JS로(원자성은 단일 스레드라 자명) */
export class MemoryBackend implements BudgetBackend {
  m = new Map<string, number>();
  async get(key: string) { return this.m.get(key) ?? 0; }
  async reserve(k: string[], a: number[]) {
    const [amt, pl, dl, tl, fz] = a;
    const p = this.m.get(k[0]) ?? 0, t = this.m.get(k[2]) ?? 0;
    if (p + amt > pl || t + amt > tl || (fz >= 0 && t + amt > fz)) return 0;
    if (k[1] !== "" && dl >= 0) {
      const d = this.m.get(k[1]) ?? 0;
      if (d + amt > dl) return 0;
      this.m.set(k[1], d + amt);
    }
    this.m.set(k[0], p + amt); this.m.set(k[2], t + amt);
    return 1;
  }
  async settle(k: string[], r: number) {
    if (r <= 0) return;
    for (const key of [k[0], k[2], k[1]]) if (key) this.m.set(key, (this.m.get(key) ?? 0) - r);
  }
}

let _backend: UpstashBackend | null | undefined;
/** Upstash(Vercel 마켓플레이스 KV는 KV_REST_API_*). 없으면 null — 폴백 없음 */
export function budgetBackend(): UpstashBackend | null {
  if (_backend !== undefined) return _backend;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  _backend = url && token ? new UpstashBackend(url, token) : null;
  return _backend;
}

export interface Reservation { pool: Pool; keys: string[]; micro: number }

/** 예약. 거부면 null(호출하지 않는다) */
export async function reserve(be: BudgetBackend, pool: Pool, usd: number, now = new Date()): Promise<Reservation | null> {
  const micro = Math.ceil(usd * MICRO);
  const poolSpent = (await be.get(keys.pool(pool))) / MICRO;
  const dl = dayLimitUsd(pool, poolSpent, now);
  const k = [keys.pool(pool), dl == null ? "" : keys.day(pool, kstDate(now)), keys.total];
  const ok = await be.reserve(k, [
    micro, Math.floor(poolLimitUsd(pool) * MICRO), dl == null ? -1 : Math.floor(dl * MICRO),
    Math.floor(totalBudgetUsd() * MICRO), FREEZE_EXEMPT.includes(pool) ? -1 : FREEZE_TOTAL_USD * MICRO, 48 * 3600,
  ]);
  return ok === 1 ? { pool, keys: k, micro } : null;
}

/** 정산: 실제 비용이 예약보다 작으면 차액을 되돌린다. 실제가 더 크면 차액을 더 쌓는다(음수 되돌림) */
export async function settle(be: BudgetBackend, r: Reservation, actualUsd: number): Promise<{ refundMicro: number }> {
  const actual = Math.ceil(actualUsd * MICRO);
  const refund = r.micro - actual;
  if (refund > 0) await be.settle(r.keys, refund);
  else if (refund < 0) await be.reserve(r.keys, [-refund, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, -1, 48 * 3600]);
  return { refundMicro: refund };
}

export async function budgetSnapshot(be: BudgetBackend): Promise<Record<string, { spent: number; limit: number }>> {
  const out: Record<string, { spent: number; limit: number }> = {};
  for (const p of POOLS) out[p] = { spent: (await be.get(keys.pool(p))) / MICRO, limit: poolLimitUsd(p) };
  out.total = { spent: (await be.get(keys.total)) / MICRO, limit: totalBudgetUsd() };
  return out;
}
