// 관문 1 '승인 우회 경로 0'(spec.md 9절, 라운드 3 #17 ③): status "APPROVED" 대입은 ApproveDrawer 한 곳에만 있어야 한다.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..", "..");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f) ? [p] : [];
  });
}

describe("승인 우회 경로 0", () => {
  it('status: "APPROVED" 대입은 components/ops/ApproveDrawer.tsx에만 1곳', () => {
    const hits = walk(SRC).flatMap((f) => {
      const n = (readFileSync(f, "utf-8").match(/status:\s*"APPROVED"\s*[,}]/g) ?? []).length;
      return n > 0 ? [{ f: path.relative(SRC, f).split(path.sep).join("/"), n }] : [];
    });
    expect(hits).toEqual([{ f: "components/ops/ApproveDrawer.tsx", n: 1 }]);
  });
});
