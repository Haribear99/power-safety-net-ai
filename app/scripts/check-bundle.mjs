#!/usr/bin/env node
// 브라우저로 가는 번들에 비밀값·비밀 환경변수 이름이 없는지 (spec.md 9절 '보안·운영': 클라이언트 번들에 sk-ant·ANTHROPIC_API_KEY 0).
// npm run build 뒤 실행. 비밀값 자체를 몰라도 형태(sk-ant-)와 변수 이름으로 찾는다.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATIC = path.join(APP, ".next", "static");
if (!existsSync(STATIC)) { console.error("✗ .next/static 없음 — npm run build 뒤에 실행하세요"); process.exit(1); }

const PATTERNS = [/sk-ant-[A-Za-z0-9_-]{8,}/, /ANTHROPIC_API_KEY/, /UPSTASH_REDIS_REST_(URL|TOKEN)/, /KV_REST_API_(URL|TOKEN)/, /JUDGE_ACCESS_CODE/, /HEALTH_DEEP_TOKEN/, /CLAUDE_(TOTAL_BUDGET|DEV_TOPUP)_USD/];
const walk = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(STATIC).filter((p) => /\.(js|css|html|json|txt|map)$/.test(p));
let bad = 0;
for (const f of files) {
  const s = readFileSync(f, "utf-8");
  for (const re of PATTERNS) {
    const m = s.match(re);
    if (m) { bad++; console.log(`✗ ${path.relative(APP, f)}: ${re.source} (${m[0].slice(0, 12)}…)`); }
  }
}
console.log(`번들 비밀값 검사: 파일 ${files.length}개, 발견 ${bad}건`);
process.exit(bad ? 1 : 0);
