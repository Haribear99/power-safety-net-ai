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
  const issues: string[] = [];
  const forging: string[] = [];
  const visit = (n: ts.Node) => {
    // 결정을 감사 행 없이 직접 써넣는 길(레드팀 10/24 R4-2): decisions 속성 만들기·대입
    if (ts.isPropertyAssignment(n) && n.name.getText(sf) === "decisions") decisionWrites.push(n.getText(sf).slice(0, 60));
    if (ts.isShorthandPropertyAssignment(n) && n.name.text === "decisions") decisionWrites.push(n.getText(sf));
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && /decisions/.test(n.left.getText(sf))) decisionWrites.push(n.getText(sf).slice(0, 60));
    // commitDecision을 호출 말고 다른 식으로 쓰기(별칭·인자로 넘기기)
    if (ts.isIdentifier(n) && (n.text === "commitDecision" || n.text === "issueApproval") && !ts.isImportSpecifier(n.parent) && !(ts.isCallExpression(n.parent) && n.parent.expression === n)) commitRefs.push(n.parent.getText(sf).slice(0, 60)); // 재export·별칭 금지(3라운드 경미 6)
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      const p = n.parent;
      const isType = ts.isLiteralTypeNode(p);
      const isAttr = ts.isJsxAttribute(p); // data-testid="approve" 같은 표지는 값이 아님
      const isCompare = ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(p.operatorToken.kind);
      const isModule = ts.isImportDeclaration(p); // import 경로("@/lib/ops/approvalGate")는 값이 아님
      if (!isType && !isCompare && !isAttr && !isModule && /approv/i.test(n.text)) literals[n.text] = (literals[n.text] ?? 0) + 1;
    }
    if (ts.isTemplateExpression(n) && /approv/i.test(n.getText())) literals["<template>"] = (literals["<template>"] ?? 0) + 1;
    // 결정 관문 표는 각 핸들러가 받은 이벤트(e.nativeEvent)로만 발급(10/30 런타임 승인 토큰)
    if (ts.isCallExpression(n) && n.expression.getText(sf) === "issueApproval") {
      let f: ts.Node | undefined = n;
      while (f && !(ts.isFunctionDeclaration(f) && f.name)) f = f.parent;
      const fn = f && ts.isFunctionDeclaration(f) ? f : undefined;
      // e는 그 핸들러의 첫 매개변수여야 하고, 핸들러 안에서 같은 이름을 다시 선언해 가리면 안 된다(Claude 3라운드: 안쪽 블록의 const e = { nativeEvent: Proxy })
      const param = fn?.parameters[0]?.name.getText(sf);
      let shadowed = false;
      const scan = (m: ts.Node) => {
        if ((ts.isVariableDeclaration(m) || ts.isParameter(m) || ts.isBindingElement(m)) && m !== fn?.parameters[0] && m.name.getText(sf) === param) shadowed = true;
        ts.forEachChild(m, scan);
      };
      if (fn?.body) scan(fn.body);
      issues.push(`${fn ? fn.name!.text : "?"}:${n.arguments[0]?.getText(sf)}${param === "e" && !shadowed ? "" : " (e가 핸들러 매개변수가 아님)"}`);
    }
    // 이벤트를 꾸미거나 만들어 내는 도구는 승인 서랍에서 쓰지 않는다
    if (ts.isIdentifier(n) && ["Proxy", "Reflect", "dispatchEvent", "cloneNode", "createElement", "setAttribute", "defineProperty", "MouseEvent", "PointerEvent", "KeyboardEvent", "CustomEvent", "Event"].includes(n.text) && !ts.isQualifiedName(n.parent) && !ts.isTypeReferenceNode(n.parent)) forging.push(n.parent.getText(sf).slice(0, 60));
    if (ts.isCallExpression(n) && n.expression.getText(sf) === "commitDecision") {
      let f: ts.Node | undefined = n;
      while (f && !(ts.isFunctionDeclaration(f) && f.name)) f = f.parent;
      commits.push(f && ts.isFunctionDeclaration(f) ? f.name!.text : "?");
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { literals, commits, decisionWrites, commitRefs, issues, forging };
}

describe("ApproveDrawer 안 승인 경로 고정", () => {
  const { literals, commits, decisionWrites, commitRefs, issues, forging } = collect();
  it("결정 관문 표는 세 핸들러가 각자 받은 이벤트로만 발급한다", () => {
    expect(issues.sort()).toEqual(["onApprove:e.nativeEvent", "onApproveAlternative:e.nativeEvent", "onSubmitClick:e.nativeEvent"]);
  });
  it("이벤트를 꾸미거나 만들어 내는 도구(Proxy·Reflect·dispatchEvent·new *Event 등)를 쓰지 않는다", () => {
    expect(forging).toEqual([]);
  });
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
