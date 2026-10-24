// 승인 서랍 안에서도 승인 경로를 늘리지 않는다(I6, 레드팀 10/24 R3-2). ESLint의 승인 값 금지 규칙은 이 파일에서 꺼져 있으므로,
// 구문 트리로 '값 "APPROVED" 1회, 값 "APPROVE" 1회, commitDecision 호출 3곳(승인·대안 승인·수정)'을 고정한다.
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const FILE = path.resolve(__dirname, "..", "..", "components", "ops", "ApproveDrawer.tsx");
const sf = ts.createSourceFile(FILE, readFileSync(FILE, "utf-8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function collect() {
  const literals: Record<string, number> = {};
  const commits: string[] = [];
  const decisionWrites: string[] = [];
  const commitRefs: string[] = [];
  const visit = (n: ts.Node) => {
    // 결정을 감사 행 없이 직접 써넣는 길(레드팀 10/24 R4-2): decisions 속성 만들기·대입
    if (ts.isPropertyAssignment(n) && n.name.getText(sf) === "decisions") decisionWrites.push(n.getText(sf).slice(0, 60));
    if (ts.isShorthandPropertyAssignment(n) && n.name.text === "decisions") decisionWrites.push(n.getText(sf));
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && /decisions/.test(n.left.getText(sf))) decisionWrites.push(n.getText(sf).slice(0, 60));
    // commitDecision을 호출 말고 다른 식으로 쓰기(별칭·인자로 넘기기)
    if (ts.isIdentifier(n) && n.text === "commitDecision" && !ts.isImportSpecifier(n.parent) && !(ts.isCallExpression(n.parent) && n.parent.expression === n)) commitRefs.push(n.parent.getText(sf).slice(0, 60));
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      const p = n.parent;
      const isType = ts.isLiteralTypeNode(p);
      const isAttr = ts.isJsxAttribute(p); // data-testid="approve" 같은 표지는 값이 아님
      const isCompare = ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(p.operatorToken.kind);
      if (!isType && !isCompare && !isAttr && /approv/i.test(n.text)) literals[n.text] = (literals[n.text] ?? 0) + 1;
    }
    if (ts.isTemplateExpression(n) && /approv/i.test(n.getText())) literals["<template>"] = (literals["<template>"] ?? 0) + 1;
    if (ts.isCallExpression(n) && n.expression.getText(sf) === "commitDecision") {
      let f: ts.Node | undefined = n;
      while (f && !(ts.isFunctionDeclaration(f) && f.name)) f = f.parent;
      commits.push(f && ts.isFunctionDeclaration(f) ? f.name!.text : "?");
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { literals, commits, decisionWrites, commitRefs };
}

describe("ApproveDrawer 안 승인 경로 고정", () => {
  const { literals, commits, decisionWrites, commitRefs } = collect();
  it('값 "APPROVED"는 한 번(onApprove), 감사 값 "APPROVE"도 한 번, 그 밖의 승인 비슷한 값 없음', () => {
    expect(literals).toEqual({ APPROVED: 1, APPROVE: 1 });
  });
  it("commitDecision 호출은 승인·대안 승인·수정 세 곳뿐", () => {
    // onApprove(승인), onApproveAlternative(재검토 대안 승인 → MODIFIED), submit(ModifyForm 수정 저장 → MODIFIED)
    expect(commits.sort()).toEqual(["onApprove", "onApproveAlternative", "submit"]);
  });
  it("결정을 직접 써넣지 않고(decisions 쓰기 0), commitDecision을 호출 말고 다른 식으로 쓰지 않는다", () => {
    expect(decisionWrites).toEqual([]);
    expect(commitRefs).toEqual([]);
  });
});
