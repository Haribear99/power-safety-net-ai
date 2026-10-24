#!/usr/bin/env node
// 문구 검사 (spec.md 9절 '문구 검사', 인수인계서 4.2절 E). 새 위반이 1건이라도 있으면 exit 1.
// 대상: 화면 코드의 문자열·JSX 글자(주석 제외), 빌드 HTML(있으면), 성과보고서 1부, 영상 콘티.
// 이미 있던 문장(18라운드 레드팀을 거친 단서·사실 문장)은 lint-claims.allow.json에 위치·문장 단위로 등록한다.
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

// ---- 규칙 (spec.md 9절 '금지 표현') ----
const BANNED = [
  // 생명·안전 과장
  "생명을 구", "생명을 지킵", "안전을 보장", "안전 보장", "사망을 막", "사망 예방", "인명 구조", "구조합니다",
  "끊겼", "살렸", "골든타임을 지키", "골든타임을 확보", "골든타임 확보", "막았",
  // 개인정보 고지
  "저장되지 않습니다",
  // 단정
  "예측합니다", "정확히 예측", "검증됨", "검증된 안전",
  // 의료 오인
  "환자 상태 모니터링", "실시간 모니터링",
  // 성과 단정
  "KPI 달성",
  // JEONJO 문법
  "세계 수", "1만 개 세계", "페르소나", "검토 지수", "취약점 카드",
];
const QUALIFIER = /모의|시뮬레이션|봉인 시험셋/;
const MEASURED_OK = /실측 (정전|판독|분포)|실측 정전시간|실측 자료/;

// ---- 단위 수집 ----
/** @type {{file:string, where:string, text:string, scope:Set<string>}[]} */
const units = [];
const push = (file, where, text, scope = []) => {
  const t = text.replace(/\s+/g, " ").trim();
  if (t) units.push({ file, where, text: t, scope: new Set(scope) });
};

function walk(dir, pred) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p, pred) : pred(p) ? [p] : [];
  });
}

// 1) 화면 코드 문자열(주석 제외). 시험 파일은 뺀다.
const SRC_DIRS = ["src/app", "src/components", "src/lib/notice"].map((d) => path.join(APP, d));
for (const f of SRC_DIRS.flatMap((d) => walk(d, (p) => /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p)))) {
  const src = readFileSync(f, "utf-8");
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const isClosing = /components[\\/]ClosingCard\.tsx$/.test(f);
  // JSX 한 요소 안의 글자 조각은 이어 붙여 문장 단위로 본다
  const visit = (n) => {
    if (ts.isJsxElement(n) || ts.isJsxFragment(n)) {
      const text = n.children.filter(ts.isJsxText).map((c) => c.text).join(" ");
      if (text.trim()) push(rel(f), `L${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`, text, isClosing ? ["closing"] : []);
    } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      push(rel(f), `L${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`, n.text, isClosing ? ["closing"] : []);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

// 2) 빌드 HTML의 보이는 글자(서버에서 그린 것). 클라이언트에서만 그리는 글자는 1)과 E2E가 맡는다.
const HTML_DIR = path.join(APP, ".next", "server", "app");
const htmlFiles = walk(HTML_DIR, (p) => p.endsWith(".html"));
if (htmlFiles.length === 0) {
  if (args.has("--require-build")) { console.error("✗ 빌드 HTML이 없습니다(.next/server/app/*.html). npm run build 뒤에 실행하세요"); process.exit(1); }
  console.warn("! 빌드 HTML 없음 — HTML 검사 건너뜀(npm run build 뒤에 다시 실행하면 포함)");
}
for (const f of htmlFiles) {
  const html = readFileSync(f, "utf-8").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ");
  // 끝 카드 구간은 한정어 규칙 대상
  const closing = html.match(/data-testid="closing-card"[\s\S]*?<\/section>/);
  const toText = (h) => h.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"');
  for (const s of sentences(toText(html))) push(rel(f), "html", s);
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

// ---- 예외 ----
const allowPath = path.join(APP, "scripts", "lint-claims.allow.json");
const allow = JSON.parse(readFileSync(allowPath, "utf-8")).allow;
const used = new Set();
const fresh = findings.filter((f) => {
  const i = allow.findIndex((a) => a.rule === f.rule && (a.phrase == null || a.phrase === f.phrase) && new RegExp(a.file).test(f.file) && f.text.includes(a.contains));
  if (i >= 0) { used.add(i); return false; }
  return true;
});

const uniq = new Map();
for (const f of fresh) uniq.set(`${f.rule}|${f.phrase}|${f.file}|${f.where}|${f.text}`, f);
console.log(`문구 검사: 단위 ${units.length}개(HTML ${htmlFiles.length}쪽), 발견 ${findings.length}건, 기존 예외 ${findings.length - fresh.length}건, 새 위반 ${uniq.size}건`);
for (const f of uniq.values()) console.log(`✗ [${f.rule}] ${f.file} ${f.where} 「${f.phrase}」: ${f.text.slice(0, 160)}`);
const stale = allow.filter((_, i) => !used.has(i));
for (const a of stale) console.warn(`! 쓰이지 않는 예외(해당 문장이 사라졌으면 지울 것): [${a.rule}] ${a.file} 「${a.contains}」`);
process.exit(uniq.size > 0 ? 1 : 0);
