// evidence.json 동기화 (spec.md 1.1절 '마지막 10초', 7.6절, 11.4절). 비AI, 결정적.
// 실행: (app/에서) npx tsx scripts/sync-evidence.ts
// 화면·보고서·ClosingCard가 읽는 숫자는 모두 이 파일에서 나온다. 손으로 적은 숫자는 0개다.
// 입력 파일이 없으면 그 키를 싣지 않는다 → 화면은 「측정 전」으로 대체한다(하드코딩 금지).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { canonicalJson, sha256Hex } from "../src/lib/sim/materialize";

const repo = path.resolve(__dirname, "..", "..");
const out: Record<string, unknown> = { format: "pl26-evidence/1" };
const sources: Record<string, string> = {};

function take(rel: string): unknown | null {
  const p = path.join(repo, rel);
  if (!existsSync(p)) return null;
  const text = readFileSync(p, "utf-8");
  sources[rel] = sha256Hex(text);
  return JSON.parse(text);
}

const ab = take("out/presets_ab.json") as { presets: unknown[] } | null;
if (ab) out.presetsAb = ab.presets;

const diff = take("out/diff_report.json") as { total: unknown; mismatchCounts: unknown; byGroup: unknown; inputManifestSha256: string } | null;
if (diff) out.diff = { total: diff.total, mismatchCounts: diff.mismatchCounts, byGroup: diff.byGroup, inputManifestSha256: diff.inputManifestSha256 };

out.sources = sources;
writeFileSync(path.join(__dirname, "..", "src", "data", "evidence.json"), canonicalJson(out) + "\n", "utf-8");
console.log("evidence.json 키:", Object.keys(out).join(", "));
