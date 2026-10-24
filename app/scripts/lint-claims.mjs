#!/usr/bin/env node
// 문구 검사 (spec.md 9절 '문구 검사', 인수인계서 4.2절 E). 새 위반이 1건이라도 있으면 exit 1.
// 대상: 화면 코드의 문자열·JSX 글자(주석 제외), 빌드 HTML(있으면), 성과보고서 1부, 영상 콘티.
// 이미 있던 문장(18라운드 레드팀을 거친 단서·사실 문장)은 lint-claims.allow.json에 '문장 전체'로 등록한다.
// 클라이언트에서만 그려지는 글자(서랍·알림·업로드 뒤)는 E2E 고정장치(e2e/fixtures.ts)가 같은 목록으로 다시 본다.
//   node scripts/lint-claims.mjs            # 빌드 HTML이 없으면 HTML은 건너뜀(경고)
//   node scripts/lint-claims.mjs --require-build   # CI: 빌드 HTML이 없으면 실패
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(APP, "..");
const rel = (p) => path.relative(REPO, p).split(path.sep).join("/");
const args = new Set(process.argv.slice(2));
const norm = (t) => t.replace(/\s+/g, " ").trim();

// ---- 규칙 (spec.md 9절 '금지 표현', 공용 목록) ----
const { banned: BANNED } = JSON.parse(readFileSync(path.join(APP, "scripts", "claims-rules.json"), "utf-8"));
// 「봉인 측정」: 보호자 알림(S9) 실측도 봉인 시험셋 측정이라 같은 한정어로 인정(명세 9절 「봉인 시험셋」 대체 규칙의 취지)
const QUALIFIER = /모의|시뮬레이션|봉인 시험셋|봉인 측정/;
const MEASURED_OK = /실측 (정전|판독|분포)|실측 정전시간|실측 자료/;

// ---- 단위 수집 ----
/** @type {{file:string, where:string, text:string, scope:Set<string>}[]} */
const units = [];
const push = (file, where, text, scope = []) => {
  const t = norm(text);
  if (t) units.push({ file, where, text: t, scope: new Set(scope) });
};

function walk(dir, pred) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p, pred) : pred(p) ? [p] : [];
  });
}

/** 글자 흐름 안에 들어가는 인라인 요소. 이 요소들은 부모 문장에 이어 붙이고, 블록 요소는 따로 본다 */
const INLINE = new Set(["b", "strong", "em", "i", "u", "span", "a", "code", "mark", "small", "sup", "sub", "abbr", "s", "q", "time", "Link", "AiTag"]);
const tagName = (c) => (ts.isJsxElement(c) ? c.openingElement.tagName.getText() : null);
/** JSX 요소의 보이는 글자: 인라인 하위 요소까지 이어 붙인다(`생명을 <b>지</b>킵니다`처럼 쪼갠 문구도 한 덩어리로 본다) */
function jsxText(n) {
  let out = "";
  const add = (c) => {
    if (ts.isJsxText(c)) out += c.text.includes("\n") ? c.text.replace(/\s*\n\s*/g, " ") : c.text;
    else if (ts.isJsxFragment(c) || (ts.isJsxElement(c) && INLINE.has(tagName(c)))) c.children.forEach(add);
    else if (ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c)) out += " ";
    else if (ts.isJsxExpression(c) && c.expression) {
      const v = constString(c.expression);
      out += v ?? " ";
    }
  };
  (ts.isJsxElement(n) || ts.isJsxFragment(n) ? n.children : []).forEach(add);
  return out;
}
/** 같은 파일의 const 문자열 상수(이름 → 값). 상수를 이어 붙여 금지 구문을 만드는 우회를 푼다 */
let CONSTS = new Map();
/** 문자열 리터럴, 같은 파일 const 상수, 템플릿(값 자리도 상수면 풂), + 이어 붙이기를 값으로 푼다(나머지는 null) */
function constString(e, depth = 0) {
  if (depth > 8) return null;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) return constString(e.expression, depth + 1);
  if (ts.isIdentifier(e) && CONSTS.has(e.text)) return constString(CONSTS.get(e.text), depth + 1);
  if (ts.isTemplateExpression(e)) {
    let out = e.head.text;
    for (const sp of e.templateSpans) { const v = constString(sp.expression, depth + 1); if (v == null) return null; out += v + sp.literal.text; }
    return out;
  }
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const a = constString(e.left, depth + 1), b = constString(e.right, depth + 1);
    return a != null && b != null ? a + b : null;
  }
  // ["생명을 ", "지킵니다"].join("") 같은 배열 이어 붙이기
  if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && e.expression.name.text === "join") {
    let arr = e.expression.expression;
    if (ts.isIdentifier(arr) && CONSTS.has(arr.text)) arr = CONSTS.get(arr.text);
    if (!ts.isArrayLiteralExpression(arr)) return null;
    const sep = e.arguments.length ? constString(e.arguments[0], depth + 1) : ",";
    const parts = arr.elements.map((x) => constString(x, depth + 1));
    return sep != null && parts.every((x) => x != null) ? parts.join(sep) : null;
  }
  return null;
}

/** + 이어 붙이기·템플릿에서 풀 수 있는 조각만 잇고, 풀 수 없는 자리는 공백 한 칸으로 둔다 */
function partsJoin(e) {
  const v = constString(e);
  if (v != null) return v;
  if (ts.isParenthesizedExpression(e)) return partsJoin(e.expression);
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) return partsJoin(e.left) + partsJoin(e.right);
  if (ts.isTemplateExpression(e)) return e.head.text + e.templateSpans.map((sp) => (constString(sp.expression) ?? " ") + sp.literal.text).join("");
  return " ";
}

// 1) 화면 코드 문자열(주석 제외). 시험 파일은 뺀다.
const SRC_DIRS = ["src/app", "src/components", "src/lib/notice"].map((d) => path.join(APP, d));
for (const f of SRC_DIRS.flatMap((d) => walk(d, (p) => /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p)))) {
  const src = readFileSync(f, "utf-8");
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const isClosing = /components[\\/]ClosingCard\.tsx$/.test(f);
  const line = (n) => `L${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  CONSTS = new Map();
  const collect = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isVariableDeclarationList(n.parent) && (n.parent.flags & ts.NodeFlags.Const)) CONSTS.set(n.name.text, n.initializer);
    ts.forEachChild(n, collect);
  };
  collect(sf);
  const visit = (n) => {
    if (ts.isJsxElement(n) || ts.isJsxFragment(n)) {
      push(rel(f), line(n), jsxText(n), isClosing ? ["closing"] : []);
    } else if ((ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) || ts.isTemplateExpression(n)) {
      // 값을 모두 풀 수 있으면 그 값으로, 아니면 풀 수 없는 자리를 공백으로 둔 채 한 덩어리로 본다(`생명을 ${x}지킵니다` 대비)
      const v = constString(n) ?? partsJoin(n);
      push(rel(f), line(n), v, isClosing ? ["closing"] : []);
    } else if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "join") {
      const v = constString(n);
      if (v != null) push(rel(f), line(n), v, isClosing ? ["closing"] : []);
    } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      push(rel(f), line(n), n.text, isClosing ? ["closing"] : []);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

// 1-2) CSS의 content 글자(::before·::after로 화면에 그려지는 글자)
for (const f of walk(path.join(APP, "src"), (p) => p.endsWith(".css"))) {
  const css = readFileSync(f, "utf-8");
  for (const m of css.matchAll(/content\s*:\s*("[^"]*"|'[^']*')/g)) push(rel(f), "css content", m[1].slice(1, -1));
}

// 2) 빌드 HTML의 보이는 글자(서버에서 그린 것). 랜딩·랩·장부의 성과 문장은 한정어 규칙 대상.
const HTML_DIR = path.join(APP, ".next", "server", "app");
const htmlFiles = walk(HTML_DIR, (p) => p.endsWith(".html"));
if (htmlFiles.length === 0) {
  if (args.has("--require-build")) { console.error("✗ 빌드 HTML이 없습니다(.next/server/app/*.html). npm run build 뒤에 실행하세요"); process.exit(1); }
  console.warn("! 빌드 HTML 없음 — HTML 검사 건너뜀(npm run build 뒤에 다시 실행하면 포함)");
}
const toText = (h) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');
for (const f of htmlFiles) {
  const html = readFileSync(f, "utf-8").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ");
  const page = path.basename(f);
  const claimPage = ["index.html", "lab.html", "ledger.html"].includes(page);
  for (const s of sentences(toText(html))) push(rel(f), "html", s);
  // 랜딩·랩·장부의 % 문장은 동사와 상관없이 같은 문장에 한정어가 있어야 한다(표 안 숫자 칸은 절 제목·표지가 한정어를 맡으므로 제외)
  if (claimPage) for (const s of sentences(toText(html.replace(/<table[\s\S]*?<\/table>/g, " ")))) if (/\d\s*%/.test(s)) push(rel(f), "html:%", s, ["qualify"]);
  const closing = html.match(/data-testid="closing-card"[\s\S]*?<\/section>/);
  if (closing) for (const s of sentences(toText(closing[0]))) push(rel(f), "html:closing-card", s, ["closing"]);
}

// 3) 성과보고서 1부(기대효과 칸은 한정어 규칙 대상)
const report = readFileSync(path.join(REPO, "submission", "report_draft.md"), "utf-8");
const part1 = report.split("## 2부.")[0].split("## 1부.")[1] ?? "";
const [beforeEff, eff = ""] = part1.split("### 기대효과");
for (const s of sentences(beforeEff)) push("submission/report_draft.md", "1부", s);
for (const s of sentences(eff)) push("submission/report_draft.md", "1부 기대효과", s, ["qualify"]);

// 4) 영상 콘티: 표의 내레이션·자막 칸(한정어·'실측' 규칙 대상)
const board = readFileSync(path.join(REPO, "submission", "video_storyboard.md"), "utf-8");
for (const line of board.split("\n")) {
  const cells = line.split("|").map((c) => c.trim());
  if (cells.length < 5 || !/^\d:\d\d/.test(cells[1] ?? "")) continue;
  for (const s of sentences(cells.slice(3).join(" "))) push("submission/video_storyboard.md", cells[1], s, ["qualify", "board"]);
}

function sentences(text) {
  return text.split(/(?<=[.!?。」])\s+|(?<=다\.)|\n+|(?<=[」』])/).map((s) => s.trim()).filter((s) => s.length > 1);
}

// ---- 판정 ----
const findings = [];
for (const u of units) {
  for (const b of BANNED) if (u.text.includes(b)) findings.push({ rule: "banned", phrase: b, ...u });
  if (/정확도\s*\d+(\.\d+)?\s*%/.test(u.text) && !/[(\[~]|구간|CI/.test(u.text)) findings.push({ rule: "accuracy-no-range", phrase: "정확도 n%", ...u });
  const qualifyScope = u.scope.has("qualify") || u.scope.has("closing");
  if (qualifyScope && /\d\s*%/.test(u.text) && !QUALIFIER.test(u.text)) findings.push({ rule: "qualifier", phrase: "% 문장에 모의/시뮬레이션/봉인 시험셋 없음", ...u });
  if (u.scope.has("board") && u.text.includes("실측") && u.text.includes("모의") && !MEASURED_OK.test(u.text)) findings.push({ rule: "measured-on-sim", phrase: "모의 결과에 '실측'", ...u });
}

// ---- 예외: 규칙·파일·문장 전체가 같을 때만 ----
const allowPath = path.join(APP, "scripts", "lint-claims.allow.json");
const allow = JSON.parse(readFileSync(allowPath, "utf-8")).allow;
const used = new Set();
const fresh = findings.filter((f) => {
  const i = allow.findIndex((a) => a.rule === f.rule && (a.phrase == null || a.phrase === f.phrase) && a.file === f.file && norm(a.text) === f.text);
  if (i >= 0) { used.add(i); return false; }
  return true;
});

const uniq = new Map();
for (const f of fresh) uniq.set(`${f.rule}|${f.phrase}|${f.file}|${f.text}`, f);
console.log(`문구 검사: 단위 ${units.length}개(HTML ${htmlFiles.length}쪽), 발견 ${findings.length}건, 기존 예외 ${findings.length - fresh.length}건, 새 위반 ${uniq.size}건`);
for (const f of uniq.values()) console.log(`✗ [${f.rule}] ${f.file} ${f.where} 「${f.phrase}」: ${f.text.slice(0, 200)}`);
if (args.has("--print-allow")) console.log(JSON.stringify([...uniq.values()].map((f) => ({ rule: f.rule, phrase: f.phrase, file: f.file, text: f.text })), null, 2));
const stale = allow.filter((_, i) => !used.has(i));
for (const a of stale) console.warn(`! 쓰이지 않는 예외(해당 문장이 사라졌으면 지울 것): [${a.rule}] ${a.file} 「${a.text.slice(0, 60)}」`);
process.exit(uniq.size > 0 ? 1 : 0);
