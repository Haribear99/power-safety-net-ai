import { describe, expect, it } from "vitest";
import { materialize } from "./materialize";
import { applyPatch, classDrawHiW, patchAxes, PATCH_GLOBAL } from "./patches";
import { e1Thetas, e3Def } from "./sweep";

const m = materialize(e3Def(0, "APT_PARTS", e1Thetas(1, "E3-test")[0], 50)).scenario;
const ids = Object.keys(m.truth.hh).sort();
const changed = (a: typeof m, b: typeof m) => ids.filter((id) => a.truth.hh[id].LTrueS !== b.truth.hh[id].LTrueS);

describe("보완안 내장판(라운드 6)", () => {
  it("입력 시나리오를 바꾸지 않는다", () => {
    const before = JSON.stringify(m);
    applyPatch(m, "P2", { covMult: 1, failProb: 0, planRate: 1 });
    applyPatch(m, "P1", { covMult: 1, failProb: 0, planRate: 1 });
    expect(JSON.stringify(m)).toBe(before);
  });
  it("보급 0이면 변화 없음, 고장 0·보급 최대면 약 80% 가구에 추가 가동시간", () => {
    expect(changed(m, applyPatch(m, "P2", { covMult: 0, failProb: 0, planRate: 1 }))).toHaveLength(0);
    const n = changed(m, applyPatch(m, "P2", { covMult: 1, failProb: 0, planRate: 1 })).length;
    expect(n / ids.length).toBeGreaterThan(0.6);
    expect(n / ids.length).toBeLessThan(0.95);
  });
  it("추가 가동시간 = 1,000Wh × 효율 ÷ 등급 소비전력 상한", () => {
    const p = applyPatch(m, "P2", { covMult: 1, failProb: 0, planRate: 1 });
    const id = changed(m, p).find((x) => m.labels[x] === "VENT_3H")!;
    const extra = p.truth.hh[id].LTrueS - m.truth.hh[id].LTrueS;
    expect(extra).toBe(Math.floor((3600 * 1000 * PATCH_GLOBAL.inverterEff.value) / classDrawHiW("VENT_3H")));
    expect(classDrawHiW("O2_STAT")).toBe(280);
  });
  it("P3(계획 요건) 대상은 P2 대상의 부분집합이고, P7(보급 0.6)은 P2보다 적다", () => {
    const ax = { covMult: 1, failProb: 0, planRate: 0.5 };
    const p2 = new Set(changed(m, applyPatch(m, "P2", ax)));
    const p3 = changed(m, applyPatch(m, "P3", ax));
    expect(p3.every((x) => p2.has(x))).toBe(true);
    expect(changed(m, applyPatch(m, "P7", ax)).length).toBeLessThanOrEqual(p2.size);
  });
  it("P1은 119 호출을 늦추지 않고 정전 시작보다 앞당기지 않는다", () => {
    const p = applyPatch(m, "P1", { covMult: 1, failProb: 0, planRate: 1 });
    const t0 = Math.round(m.planner.tOutage * 3600);
    for (const id of ids) {
      expect(p.truth.hh[id].kr07CallS).toBeLessThanOrEqual(m.truth.hh[id].kr07CallS);
      expect(p.truth.hh[id].kr07CallS).toBeGreaterThanOrEqual(t0);
      expect(p.truth.hh[id].LTrueS).toBe(m.truth.hh[id].LTrueS);
    }
  });
  it("축 값은 시드로 정해지고 범위 안", () => {
    const a = patchAxes("1000001");
    expect(a).toEqual(patchAxes("1000001"));
    expect(a.covMult).toBeGreaterThanOrEqual(0.5); expect(a.covMult).toBeLessThanOrEqual(1);
    expect(a.failProb).toBeGreaterThanOrEqual(0.1); expect(a.failProb).toBeLessThanOrEqual(0.8);
  });
});
