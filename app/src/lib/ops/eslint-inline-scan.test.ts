// ESLint 인라인 지시문(eslint-disable 등)으로 보호 규칙을 끄는 길을 막는다(레드팀 10/30 C2: 주석 한 줄로 승인 값·결정 쓰기 규칙을 끄고 통과).
// 허용 목록은 지금 있는 <img> 2곳뿐(라벨 사진 미리보기, next/image가 data URL 미리보기에 맞지 않음).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..", "..");
const ALLOWED = new Map<string, number>([["components/household/HouseholdScreen.tsx", 2]]);
const ALLOWED_TEXT = "eslint-disable-next-line @next/next/no-img-element";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|jsx?|mjs|cjs)$/.test(n) ? [p] : [];
  });
}

describe("ESLint 인라인 지시문", () => {
  it("src 안의 eslint 지시문(disable·enable·규칙 설정 주석)은 허용 목록뿐", () => {
    const bad: string[] = [];
    const counts = new Map<string, number>();
    for (const f of walk(SRC)) {
      const rel = path.relative(SRC, f).replace(/\\/g, "/");
      const text = readFileSync(f, "utf-8");
      // 주석 안의 eslint 지시문: eslint-disable*, eslint-enable, /* eslint rule: off */, /* global */, eslint-env
      for (const m of text.matchAll(/(?:\/\/|\/\*)\s*(eslint(?:-disable(?:-next-line|-line)?|-enable|-env)?\b[^\n]*|global\s[^\n]*)/g)) {
        const body = m[1].replace(/\s*\*\/[\s\S]*$/, "").trim(); // CRLF 줄 끝(\r)까지 함께 자름
        if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) continue;
        if (body === ALLOWED_TEXT && ALLOWED.has(rel)) { counts.set(rel, (counts.get(rel) ?? 0) + 1); continue; }
        bad.push(`${rel}: ${body.slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
    for (const [rel, n] of ALLOWED) expect(counts.get(rel) ?? 0, rel).toBeLessThanOrEqual(n);
  });
});
