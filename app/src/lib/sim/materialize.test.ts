import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CAUSES, type Cause } from "../domain/types";
import { computeLowerBoundDetail } from "../engine/lowerBound";
import { qT } from "../engine/quantize";
import { GEN_CLASSES } from "./labels";
import { lhsSample, standardTheta } from "./lhs";
import { canonicalJson, materialize, sha256Hex, type MaterializedScenario, type ScenarioDef } from "./materialize";
import { presetDefs, presetDoc, standard50Defs, standard50Doc, STD50_FOCUS } from "./scenarios";
import { SIM_PARAMS } from "./generator";
import { applyReentry } from "./reentry";

const REPO = path.resolve(__dirname, "..", "..", "..", "..");

function def(over: Partial<ScenarioDef> = {}): ScenarioDef {
  return { scenarioId: "T-1", seed: "42", cause: "APT_NIGHT_XFMR", theta: standardTheta(), nRegistered: 30, nResources: 10, ...over };
}

function intsOnly(o: Record<string, number>) {
  for (const v of Object.values(o)) expect(Number.isSafeInteger(v)).toBe(true);
}

describe("정본 JSON과 sha256 (5.1절 출력)", () => {
  it("sha256은 node:crypto와 같다(한글·긴 입력 포함)", () => {
    for (const s of ["", "abc", "전력안심망 AI · 시뮬레이션", "x".repeat(1000), "a".repeat(55), "a".repeat(56), "a".repeat(64)]) {
      expect(sha256Hex(s)).toBe(createHash("sha256").update(s, "utf8").digest("hex"));
    }
  });
  it("키 정렬, 1e-6 반올림, undefined 생략, −0 → 0, 비유한수는 예외", () => {
    expect(canonicalJson({ b: 1, a: { d: 0.1234567, c: [3.0000004, undefined] }, e: undefined, f: -0 }))
      .toBe('{"a":{"c":[3,null],"d":0.123457},"b":1,"f":0}');
    expect(() => canonicalJson({ x: NaN })).toThrow();
    expect(() => canonicalJson({ x: Infinity })).toThrow();
  });
});

describe("materialize 결정성 (5.1절)", () => {
  it("같은 정의 → 바이트 동일, 시드가 다르면 다름", () => {
    const a = materialize(def()), b = materialize(def());
    expect(b.json).toBe(a.json);
    expect(b.sha256).toBe(a.sha256);
    expect(materialize(def({ seed: "43" })).sha256).not.toBe(a.sha256);
    expect(materialize(def({ scenarioId: "T-2" })).sha256).not.toBe(a.sha256);
  });
  it("저장값 = 사용값: 정본 JSON은 다시 정본화해도 같다", () => {
    const m = materialize(def({ cause: "TYPHOON_STRONG" }));
    expect(canonicalJson(JSON.parse(m.json))).toBe(m.json);
  });
});

describe("materialize 내용 (5.2절, 8절 형식)", () => {
  const scen: MaterializedScenario[] = [];
  const thetas = lhsSample(16, "test", "mat-content");
  thetas.forEach((th, i) => {
    scen.push(materialize(def({ scenarioId: `C-${i}`, seed: String(1000 + i), cause: CAUSES[i % CAUSES.length], theta: th, nRegistered: 12 + i, nResources: 3 + (i % 7) })).scenario);
  });

  it("초월함수가 들어간 진실 값은 모두 정수 초로 저장", () => {
    for (const m of scen) {
      expect(m.format).toBe("pl26-materialized/1");
      expect(Number.isSafeInteger(m.truth.restorationS)).toBe(true);
      intsOnly(m.truth.arrivalTrueS);
      intsOnly(m.truth.a119TrueS);
      intsOnly(m.truth.shelterTrueS);
      for (const h of Object.values(m.truth.hh)) {
        for (const v of [h.LTrueS, h.mrDelayS, h.kr07CallS]) expect(Number.isSafeInteger(v) && v >= 0).toBe(true);
      }
      for (const u of m.truth.unregistered) expect(Number.isSafeInteger(u.LTrueS) && Number.isSafeInteger(u.callS)).toBe(true);
      const c = m.planner.restoration.confirmed;
      if (c) {
        expect(m.planner.restoration.status).toBe("CONFIRMED");
        expect(Number.isSafeInteger(c.rEstEndS)).toBe(true);
        expect(c.multPpm.p10 <= 1_000_000 && 1_000_000 <= c.multPpm.p80 && c.multPpm.p80 <= c.multPpm.p90).toBe(true);
      }
    }
  });

  it("진실 도착은 등록 가구 × 자원 전부, 119 진실은 등록·미등록 전부", () => {
    for (const m of scen) {
      const hh = m.planner.households, res = m.planner.resources;
      expect(Object.keys(m.truth.arrivalTrueS).length).toBe(hh.length * res.length);
      for (const h of hh) for (const r of res) expect(m.truth.arrivalTrueS[`${h.id}|${r.id}`]).toBeGreaterThanOrEqual(0);
      expect(Object.keys(m.truth.a119TrueS).sort()).toEqual([...hh.map((h) => h.id), ...m.truth.unregistered.map((u) => u.id)].sort());
      expect(Object.keys(m.truth.hh).sort()).toEqual(hh.map((h) => h.id).sort());
    }
  });

  it("가구 필드: 신고 시각 [0, 0.5]h, 충전 정수 %, 좌표 격자 안, 자원은 mock", () => {
    for (const m of scen) {
      for (const h of m.planner.households) {
        expect(h.tReport >= 0 && h.tReport <= 0.5).toBe(true);
        expect(qT(h.tReport) / 3600).toBeCloseTo(h.tReport, 6);
        const ch = h.device.charge;
        if (ch.source === "unknown") expect(ch.value).toBeNull();
        else expect(Number.isInteger(ch.value) && (ch.value as number) >= 0 && (ch.value as number) <= 100).toBe(true);
        expect(h.cell.x >= 0 && h.cell.x <= 10 && h.cell.y >= 0 && h.cell.y <= 10).toBe(true);
        expect(h.device.specBy === null || h.device.specBy === "db_exact").toBe(true);
        for (const e of h.ext) if (e.opVerified) expect(e.opVerified.count).toBeLessThanOrEqual(e.declaredCount);
        if (h.cylinder?.opVerified) expect(h.cylinder.opVerified.hoursLo).toBeLessThanOrEqual(10 * h.cylinder.opVerified.count);
        // 판단·진실 분리: PlannerView 가구에 진실 키 없음
        expect(Object.keys(h).some((k) => /true|LTrue|works|refuse|fail/i.test(k))).toBe(false);
      }
      for (const r of m.planner.resources) expect(r.mock).toBe(true);
      expect(Object.keys(m.labels).length).toBe(m.planner.households.length + m.truth.unregistered.length);
    }
  });

  it("미확인 모델 가구는 MANUAL_REVIEW이고, 재진입 값으로 사양 기반 L을 받는다", () => {
    let seen = 0;
    for (const m of scen) {
      for (const h of m.planner.households) {
        if (h.device.specId !== null) continue;
        seen++;
        expect(computeLowerBoundDetail(h).lb.status).toBe("MANUAL_REVIEW");
        expect(h.reentry?.specId).toBeTruthy();
        expect(computeLowerBoundDetail(applyReentry(h, h.reentry)).lb.status).toBe("AUTO");
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("순환단전: R_true = 1h 고정(배율 미적용), NEAR_CERTAIN", () => {
    const m = materialize(def({ cause: "ROTATING", theta: { ...standardTheta(), scaleMult: 2 } })).scenario;
    expect(m.truth.restorationS).toBe(3600);
    expect(m.planner.restoration.status).toBe("NEAR_CERTAIN");
  });

  it("σ_e = 0이고 p_confirm 최대면 CONFIRMED 배수는 모두 10⁶", () => {
    let n = 0;
    for (let s = 0; s < 20; s++) {
      const m = materialize(def({ seed: String(s), cause: "APT_PARTS", theta: { ...standardTheta(), sigmaE: 0, pConfirm: 0.8 } })).scenario;
      const c = m.planner.restoration.confirmed;
      if (!c) continue;
      n++;
      expect(c.multPpm).toEqual({ p10: 1_000_000, p80: 1_000_000, p90: 1_000_000 });
      expect(c.rEstEndS).toBe(m.truth.restorationS);
    }
    expect(n).toBeGreaterThan(10);
  });

  it("초점 등급은 12가구 이상, 미등록 수 = round(N·r/(1−r))", () => {
    for (const cls of GEN_CLASSES) {
      const m = materialize(def({ scenarioId: `F-${cls}`, focusClass: cls, nFocus: STD50_FOCUS })).scenario;
      const n = m.planner.households.filter((h) => m.labels[h.id] === cls).length;
      expect(n).toBeGreaterThanOrEqual(STD50_FOCUS);
      const r = m.theta.unregisteredRate;
      expect(m.truth.unregistered.length).toBe(Math.round((30 * r) / (1 - r)));
    }
  });
});

describe("봉인 파일 (5.6·5.7절, S2b)", () => {
  it("표준 50건: 구성 49 + ROTATING 1, 비 1.5/3/6 = 17/16/16, 시드 20261017+idx", () => {
    const cases = standard50Defs();
    expect(cases.length).toBe(50);
    const main = cases.slice(0, 49);
    const count = (r: number) => main.filter((c) => c.def.theta.hhPerResource === r).length;
    expect([count(1.5), count(3), count(6)]).toEqual([17, 16, 16]);
    expect(new Set(main.map((c) => `${c.def.focusClass}|${c.def.cause}`)).size).toBe(49);
    expect(main.every((c) => c.def.cause !== "ROTATING" && c.def.nRegistered === 30 && c.def.nFocus === 12)).toBe(true);
    expect(cases[49].def.cause).toBe("ROTATING");
    expect(cases[49].def.nRegistered).toBe(60);
    cases.forEach((c, i) => expect(c.def.seed).toBe(String(20261017 + i)));
  });
  it("spec/standard50.json은 현재 코드·장부로 다시 만든 것과 바이트 동일", () => {
    const file = readFileSync(path.join(REPO, "spec", "standard50.json"), "utf-8");
    const doc = standard50Doc((d) => materialize(d).sha256);
    expect(file).toBe(canonicalJson(doc) + "\n");
  });
  it("spec/presets/*.json 3개는 다시 만든 것과 바이트 동일, 30가구·자원 10개", () => {
    for (const p of presetDefs()) {
      const file = readFileSync(path.join(REPO, "spec", "presets", p.file), "utf-8");
      const doc = presetDoc(p);
      expect(file).toBe(canonicalJson(doc) + "\n");
      expect(doc.scenario.planner.households.length).toBe(30);
      expect(doc.scenario.planner.resources.length).toBe(10);
      expect(doc.meta.scenarioSha256).toBe(sha256Hex(canonicalJson(doc.scenario)));
    }
    expect(presetDefs().map((p) => p.def.cause)).toEqual(["APT_NIGHT_XFMR", "APT_PARTS", "ROTATING"] satisfies Cause[]);
  });
});

describe("보조 장부 sim_params.json (9절 장부 층)", () => {
  it("모든 행에 type·note가 있고 spec·measured·event·policy 행은 sourceIds가 있다", () => {
    expect(SIM_PARAMS.size).toBeGreaterThan(0);
    for (const r of SIM_PARAMS.values()) {
      expect(r.note.length).toBeGreaterThan(0);
      if (["spec", "measured", "event", "policy"].includes(r.type)) expect(r.sourceIds.length).toBeGreaterThan(0);
    }
  });
});
