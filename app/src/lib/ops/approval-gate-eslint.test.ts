// 결정 관문 함수의 import 허용 범위를 실제 ESLint 설정으로 확인한다(Codex 리뷰 10/30: lib·hooks·.js 확장자·재export가 빠져 있었음).
// 파일을 만들지 않고 lintText의 가상 경로로 돌린다.
import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const APP = path.resolve(__dirname, "..", "..", "..");
const eslint = new ESLint({ cwd: APP });
const RULE = "@typescript-eslint/no-restricted-imports";

async function blocked(file: string, code: string): Promise<boolean> {
  const [r] = await eslint.lintText(code, { filePath: path.join(APP, file) });
  return r.messages.some((m) => [RULE, "no-restricted-imports", "no-restricted-syntax"].includes(m.ruleId ?? "") && m.message.includes("결정 관문"));
}

describe("결정 관문 import 범위(ESLint)", () => {
  it("발급·소비·시험용 표를 허용 파일 밖에서 가져오면 막는다(상대 경로·확장자·재export·새 폴더 포함)", async () => {
    const cases: [string, string][] = [
      ["src/lib/ops/helper.ts", 'export { issueApproval, consumeApproval } from "./approvalGate";\n'],
      ["src/lib/engine/helper.ts", 'import { issueApproval } from "../ops/approvalGate";\nexport const f = issueApproval;\n'],
      ["src/hooks/helper.ts", 'import { issueApproval } from "@/lib/ops/approvalGate";\nexport const f = issueApproval;\n'],
      ["src/components/ops/Other.tsx", 'import { issueApproval } from "@/lib/ops/approvalGate.js";\nexport const f = issueApproval;\n'],
      ["src/components/ops/Other.tsx", 'import { consumeApproval } from "@/lib/ops/approvalGate";\nexport const f = consumeApproval;\n'],
      ["src/app/ops/x.tsx", 'import { ticketForTest } from "@/lib/ops/approvalGate.ts";\nexport const f = ticketForTest;\n'],
      ["src/components/ops/ApproveDrawer.tsx", 'import { consumeApproval } from "@/lib/ops/approvalGate";\nexport const f = consumeApproval;\n'],
      ["src/components/ops/ApproveDrawer.tsx", 'import { ticketForTest } from "@/lib/ops/approvalGate";\nexport const f = ticketForTest;\n'],
      ["src/lib/ops/session.ts", 'import { issueApproval } from "./approvalGate";\nexport const f = issueApproval;\n'],
      ["src/lib/alloc/x.ts", 'import { consumeApproval } from "../ops/approvalGate";\nexport const f = consumeApproval;\n'],
      // Codex 2라운드: JS 소스, 동적 import(문자열·템플릿)
      ["src/hooks/helper.js", 'import { issueApproval } from "@/lib/ops/approvalGate";\nexport const f = issueApproval;\n'],
      ["src/hooks/helper.ts", 'export async function f() { return (await import("@/lib/ops/approvalGate")).issueApproval; }\n'],
      ["src/components/ops/Other.tsx", "export async function f() { return (await import(`@/lib/ops/approvalGate`)).consumeApproval; }\n"],
    ];
    for (const [file, code] of cases) expect(await blocked(file, code), `${file}: ${code}`).toBe(true);
  }, 180_000);
  it("같은 페이지 안 변조 도구(내장 프로토타입 바꾸기·Proxy·Reflect)를 소스에서 막는다(Claude 3라운드 경미 5)", async () => {
    const cases: [string, string, string][] = [
      ["src/components/ops/ApproveDrawer.tsx", "export const f = () => { WeakMap.prototype.get = function (k: object) { return k; }; };\n", "no-extend-native"],
      ["src/components/ops/Other.tsx", "export const p = (x: object) => new Proxy(x, {});\n", "no-restricted-globals"],
      ["src/lib/ops/x.ts", "export const r = Reflect.get;\n", "no-restricted-globals"],
    ];
    for (const [file, code, rule] of cases) {
      const [r] = await eslint.lintText(code, { filePath: path.join(APP, file) });
      expect(r.messages.map((m) => m.ruleId), `${file}: ${code}`).toContain(rule);
    }
  }, 180_000);
  it("허용: ApproveDrawer의 발급, session.ts의 소비, 시험 파일의 시험용 표, 타입만 가져오기", async () => {
    const cases: [string, string][] = [
      ["src/components/ops/ApproveDrawer.tsx", 'import { issueApproval } from "@/lib/ops/approvalGate";\nexport const f = issueApproval;\n'],
      ["src/lib/ops/session.ts", 'import { consumeApproval } from "./approvalGate";\nexport const f = consumeApproval;\n'],
      ["src/lib/ops/x.test.ts", 'import { ticketForTest } from "./approvalGate";\nexport const f = ticketForTest;\n'],
      ["src/components/ops/Other.tsx", 'import type { ApprovalTicket } from "@/lib/ops/approvalGate";\nexport type T = ApprovalTicket;\n'],
    ];
    for (const [file, code] of cases) expect(await blocked(file, code), `${file}: ${code}`).toBe(false);
  }, 180_000);
});
