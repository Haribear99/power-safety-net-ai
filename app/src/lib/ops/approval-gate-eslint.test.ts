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
  return r.messages.some((m) => m.ruleId === RULE && m.message.includes("결정 관문"));
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
    ];
    for (const [file, code] of cases) expect(await blocked(file, code), `${file}: ${code}`).toBe(true);
  }, 60_000);
  it("허용: ApproveDrawer의 발급, session.ts의 소비, 시험 파일의 시험용 표, 타입만 가져오기", async () => {
    const cases: [string, string][] = [
      ["src/components/ops/ApproveDrawer.tsx", 'import { issueApproval } from "@/lib/ops/approvalGate";\nexport const f = issueApproval;\n'],
      ["src/lib/ops/session.ts", 'import { consumeApproval } from "./approvalGate";\nexport const f = consumeApproval;\n'],
      ["src/lib/ops/x.test.ts", 'import { ticketForTest } from "./approvalGate";\nexport const f = ticketForTest;\n'],
      ["src/components/ops/Other.tsx", 'import type { ApprovalTicket } from "@/lib/ops/approvalGate";\nexport type T = ApprovalTicket;\n'],
    ];
    for (const [file, code] of cases) expect(await blocked(file, code), `${file}: ${code}`).toBe(false);
  }, 60_000);
});
