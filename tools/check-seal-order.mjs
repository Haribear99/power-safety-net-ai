// 봉인 순서 검사 (spec.md 5.4절 '시드', 5.5절, 라운드 5). 실행: node tools/check-seal-order.mjs
// 범위마다 봉인 태그가 있다: E1·E2 전용(2,000,001~2,004,000 / 3,000,001~3,005,400) → S4, E3 보류(1,000,001~1,001,000) → S5(라운드 6), E4 실측 분포(4,000,001~4,002,000) → S6
// ① 그 범위 시드가 봉인 태그 커밋까지의 git 이력에 0개
// ② 로컬 out/ 아래 JSON에 그 시드가 있으면, 파일 수정 시각이 봉인 태그 커밋 시각보다 뒤
// ③ 봉인 태그가 없으면(봉인 전) out/에도 그 범위 시드가 0개
// 시드는 출력 JSON의 "seed" 키로만 센다(scripts/sweep.ts가 행마다 기록).
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RANGES = [
  { name: "E1", lo: 2_000_001, hi: 2_004_000, tag: "S4" },
  { name: "E2", lo: 3_000_001, hi: 3_005_400, tag: "S4" },
  { name: "E3", lo: 1_000_001, hi: 1_001_000, tag: "S5" },
  { name: "E4", lo: 4_000_001, hi: 4_002_000, tag: "S6" },
];
const SEED_RE = /"seed":"?(\d+)"?/g;
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf-8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] }).trim();

function sealedSeeds(text, tag) {
  const hits = new Set();
  for (const m of text.matchAll(SEED_RE)) {
    const v = Number(m[1]);
    if (RANGES.some((r) => r.tag === tag && v >= r.lo && v <= r.hi)) hits.add(v);
  }
  return hits;
}

function* jsonFiles(dir) {
  let ents = [];
  try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* jsonFiles(p);
    else if (e.name.endsWith(".json")) yield p;
  }
}

const problems = [];
const files = [...jsonFiles(path.join(repo, "out"))].map((f) => ({ f, text: readFileSync(f, "utf-8"), mtime: statSync(f).mtimeMs }));
for (const tag of [...new Set(RANGES.map((r) => r.tag))]) {
  let commit = null, time = null;
  try {
    commit = git("rev-list", "-n", "1", tag);
    time = Number(git("log", "-1", "--format=%ct", commit)) * 1000;
  } catch { /* 봉인 전 */ }
  // ① git 이력(봉인 커밋 자체 포함 — 봉인 커밋에도 결과가 없어야 한다)
  const revs = git("rev-list", commit ?? "HEAD").split(/\r?\n/).filter(Boolean);
  for (const rev of revs) {
    let out = "";
    try { out = git("grep", "-I", "-h", "-o", "-E", '"seed":"?[0-9]{7}"?', rev); } catch { continue; } // 일치 없음 = 종료 코드 1
    const hits = sealedSeeds(out, tag);
    if (hits.size) problems.push(`[${tag}] 커밋 ${rev.slice(0, 8)}에 봉인 시드 ${hits.size}개(예: ${[...hits][0]})`);
  }
  // ②③ 로컬 out/
  for (const { f, text, mtime } of files) {
    const hits = sealedSeeds(text, tag);
    if (!hits.size) continue;
    const rel = path.relative(repo, f);
    if (time == null) problems.push(`[${tag}] 봉인 전인데 ${rel}에 봉인 시드 ${hits.size}개`);
    else if (mtime <= time) problems.push(`[${tag}] ${rel}(수정 ${new Date(mtime).toISOString()})가 봉인 커밋보다 먼저인데 봉인 시드 ${hits.size}개`);
  }
  console.log(commit ? `${tag} = ${commit.slice(0, 8)} (${new Date(time).toISOString()}), 검사한 커밋 ${revs.length}개` : `${tag} 태그 없음(봉인 전), 검사한 커밋 ${revs.length}개`);
}
if (problems.length) {
  for (const p of problems) console.error("✗ " + p);
  process.exit(1);
}
console.log("✓ 봉인 순서 위반 0건");
