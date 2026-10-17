// 봉인 순서 검사 (spec.md 5.4절 '시드', 5.5절, 라운드 5). 실행: node tools/check-seal-order.mjs
// ① E1·E2 전용 범위 시드(2,000,001~2,004,000 / 3,000,001~3,005,400)가 S4 태그 커밋 이전 git 이력에 0개
// ② 로컬 out/ 아래 JSON에 그 시드가 있으면, 파일 수정 시각이 S4 커밋 시각보다 뒤
// ③ S4 태그가 없으면(봉인 전) out/에도 그 시드가 0개
// 시드는 출력 JSON의 "seed" 키로만 센다(scripts/sweep.ts가 행마다 기록).
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RANGES = [
  { name: "E1", lo: 2_000_001, hi: 2_004_000 },
  { name: "E2", lo: 3_000_001, hi: 3_005_400 },
];
const SEED_RE = /"seed":"?(\d+)"?/g;
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf-8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] }).trim();

function sealedSeeds(text) {
  const hits = new Set();
  for (const m of text.matchAll(SEED_RE)) {
    const s = Number(m[1]);
    if (RANGES.some((r) => s >= r.lo && s <= r.hi)) hits.add(s);
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

let s4Time = null, s4Commit = null;
try {
  s4Commit = git("rev-list", "-n", "1", "S4");
  s4Time = Number(git("log", "-1", "--format=%ct", s4Commit)) * 1000;
} catch { /* 봉인 전 */ }

const problems = [];
// ① git 이력(S4 이전 커밋 전부, S4 커밋 자체 포함 — 봉인 커밋에도 결과가 없어야 한다)
const revs = s4Commit ? git("rev-list", s4Commit).split("\n").filter(Boolean) : git("rev-list", "HEAD").split("\n").filter(Boolean);
for (const rev of revs) {
  let out = "";
  try { out = git("grep", "-I", "-h", "-o", "-E", '"seed":"?[0-9]{7}"?', rev); } catch { continue; } // 일치 없음 = 종료 코드 1
  const hits = sealedSeeds(out);
  if (hits.size) problems.push(`커밋 ${rev.slice(0, 8)}에 봉인 시드 ${hits.size}개(예: ${[...hits][0]})`);
}
// ②③ 로컬 out/
for (const f of jsonFiles(path.join(repo, "out"))) {
  const hits = sealedSeeds(readFileSync(f, "utf-8"));
  if (!hits.size) continue;
  const rel = path.relative(repo, f);
  if (s4Time == null) problems.push(`S4 전인데 ${rel}에 봉인 시드 ${hits.size}개`);
  else if (statSync(f).mtimeMs <= s4Time) problems.push(`${rel}(수정 ${new Date(statSync(f).mtimeMs).toISOString()})가 S4 커밋보다 먼저인데 봉인 시드 ${hits.size}개`);
}

console.log(s4Commit ? `S4 = ${s4Commit.slice(0, 8)} (${new Date(s4Time).toISOString()})` : "S4 태그 없음(봉인 전)");
console.log(`검사한 커밋 ${revs.length}개`);
if (problems.length) {
  for (const p of problems) console.error("✗ " + p);
  process.exit(1);
}
console.log("✓ 봉인 순서 위반 0건");
