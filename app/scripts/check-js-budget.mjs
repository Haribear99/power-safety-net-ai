#!/usr/bin/env node
// 랜딩(/) 초기 JS 예산 (spec.md 1.3절 품질 예산, 인수인계서 4.2절 33번).
// /의 빌드 HTML에 실린 <script src>만 더한다(링크 미리 받기로 따라오는 다른 페이지 청크는 제외).
// gzip은 디스크 파일을 zlib 기본 수준으로 압축해 잰다(서버 응답 크기와 수백 바이트 안쪽 차이).
// 기준선: 10/24 Next 16.4.2에서 179,753B(서버 gzip). 예산은 약 3% 여유를 둔 185,000B.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const BUDGET = Number(process.env.JS_BUDGET_BYTES ?? 185_000);
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = path.join(APP, ".next", "server", "app", "index.html");
if (!existsSync(html)) { console.error("✗ .next/server/app/index.html 없음 — npm run build 뒤에 실행하세요"); process.exit(1); }

const srcs = [...new Set([...readFileSync(html, "utf-8").matchAll(/<script[^>]*\ssrc="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]))];
let total = 0;
for (const s of srcs) {
  const f = path.join(APP, ".next", s.replace(/^\/_next\//, ""));
  if (!existsSync(f)) { console.error(`✗ 스크립트 파일 없음: ${s}`); process.exit(1); }
  const n = gzipSync(readFileSync(f)).length;
  total += n;
  console.log(`  ${String(n).padStart(7)}B  ${s}`);
}
const ok = total <= BUDGET;
console.log(`${ok ? "✓" : "✗"} 랜딩 초기 JS ${srcs.length}개 gzip 합 ${total.toLocaleString()}B / 예산 ${BUDGET.toLocaleString()}B`);
process.exit(ok ? 0 : 1);
