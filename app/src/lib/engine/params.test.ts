// 장부 층 시험(spec.md 9절): 엔진 상수가 전부 params 키로 해결되고, 모든 행에 type과 sourceIds가 있다.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PARAMS, paramRow, pNum, pRatio } from "./params";

const ENGINE_DIR = __dirname;
const SIM_OUTCOME = path.join(__dirname, "..", "sim", "outcome.ts");
const REPO = path.resolve(__dirname, "..", "..", "..", "..");
const VAULT = path.resolve(REPO, "..", "AI 라이프 솔루션 챌린지", "research", "notes");

function engineSources(): { file: string; src: string }[] {
  const files = readdirSync(ENGINE_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "test-rng.ts")
    .map((f) => path.join(ENGINE_DIR, f));
  files.push(SIM_OUTCOME);
  return files.map((file) => ({ file, src: readFileSync(file, "utf8") }));
}

/** 주석·문자열을 지운 코드(숫자 리터럴 검사용) */
function stripCommentsAndStrings(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, '""');
}

describe("params.json 장부", () => {
  it("모든 행에 type·sourceIds·unit·note가 있고 키가 유일하다", () => {
    expect(PARAMS.size).toBeGreaterThan(40);
    for (const r of PARAMS.values()) {
      expect(r.type, r.key).toBeTruthy();
      expect(Array.isArray(r.sourceIds), r.key).toBe(true);
      expect(r.unit.length, r.key).toBeGreaterThan(0);
      expect(r.note.length, r.key).toBeGreaterThan(0);
    }
  });

  it("결정 경로 계수는 정수 유리수와 값이 같다(3.1절 규칙 2)", () => {
    expect(pRatio("alloc.arrivalFactor")).toEqual([4, 5]);
    expect(pRatio("alloc.holdRecheckFactor")).toEqual([5, 4]);
    expect(pRatio("alloc.resourceEfficiency")).toEqual([17, 20]);
    expect(pRatio("lb.fAge.lt1")).toEqual([9, 10]);
    expect(pRatio("lb.fAge.lt2")).toEqual([8, 10]);
    expect(pRatio("lb.fAge.default")).toEqual([7, 10]);
    expect(pRatio("lb.charge.unknown")).toEqual([1, 2]);
    for (const r of PARAMS.values()) if (r.ratio) expect(r.ratio[0] / r.ratio[1], r.key).toBe(r.value);
  });

  it.runIf(existsSync(VAULT))("모든 sourceId가 hyperresearch vault의 노트로 해결된다", () => {
    const missing: string[] = [];
    const check = (id: string) => { if (!existsSync(path.join(VAULT, `${id}.md`))) missing.push(id); };
    for (const r of PARAMS.values()) r.sourceIds.forEach(check);
    for (const f of ["device_db.json", "ext_db.json", "resources_mock.json"]) {
      const txt = readFileSync(path.join(REPO, "spec", f), "utf8");
      for (const m of txt.matchAll(/"sourceIds":\s*\[([^\]]*)\]/g)) {
        for (const id of m[1].matchAll(/"([^"]+)"/g)) check(id[1]);
      }
    }
    expect(missing).toEqual([]);
  });

  it("엔진 소스가 조회하는 params 키는 모두 장부에 있다", () => {
    const keys = new Set<string>();
    for (const { src } of engineSources()) {
      for (const m of src.matchAll(/\bp(?:Num|Ratio|Range|Value|aramRow)(?:<[^>]*>)?\("([^"]+)"\)/g)) keys.add(m[1]);
    }
    expect(keys.size).toBeGreaterThan(25);
    for (const k of keys) expect(() => paramRow(k), k).not.toThrow();
  });

  it("엔진 결정 파일에 장부 밖 숫자 상수가 없다(단위 변환·인덱스·감시값만 허용)", () => {
    // 허용: 0, 1, 0.5(qT·qE 반올림 정의, 3.1절), 2(보간 표 최소 점 수), 60(분→시), 100(퍼센트), 1000(k→m),
    // 3600(h→s), 2147483647(감시값)
    const allowed = new Set(["0", "1", "0.5", "2", "60", "100", "1000", "3600", "2147483647"]);
    const decisionFiles = ["lowerBound.ts", "margin.ts", "quantize.ts", "arrival.ts", "restoration.ts"];
    const bad: string[] = [];
    for (const { file, src } of engineSources()) {
      if (!decisionFiles.includes(path.basename(file)) && path.basename(file) !== "outcome.ts") continue;
      const code = stripCommentsAndStrings(src);
      for (const m of code.matchAll(/(?<![\w.$])(\d+(?:\.\d+)?)(?![\w.])/g)) {
        if (!allowed.has(m[1])) bad.push(`${path.basename(file)}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("주요 값 대조(3장)", () => {
    expect(pNum("lb.cyl.hoursLoPerUnitH")).toBe(10);
    expect(pNum("restoration.capH")).toBe(72);
    expect(pNum("restoration.gridPoints")).toBe(1001);
    expect(pNum("landingGapBarH")).toBe(21);
    expect(paramRow("landingGapBarH").type).toBe("inferred");
  });
});
