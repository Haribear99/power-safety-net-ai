import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CAUSES } from "../domain/types";
import { transport119S } from "../engine/arrival";
import { computeLowerBoundDetail } from "../engine/lowerBound";
import { qT } from "../engine/quantize";
import { makePlanner119 } from "../alloc/fallback";
import { lhsSample } from "./lhs";
import { canonicalJson, materialize, type MaterializedScenario } from "./materialize";
import { applyReentry } from "./reentry";
import { runScenario, SIM_POLICIES, toOracleOut, type RunResult, type SimPolicy } from "./run";
import { presetDefs } from "./scenarios";

const TOOL_POLICIES = SIM_POLICIES.filter((p) => p !== "NONE" && p !== "KR_BASELINE" && p !== "ORACLE_INFO");

function randomScenarios(n: number, tag: string): MaterializedScenario[] {
  const thetas = lhsSample(n, "run-test", tag);
  return thetas.map((th, i) => materialize({
    scenarioId: `R-${tag}-${i}`, seed: String(500 + i), cause: CAUSES[i % CAUSES.length], theta: th,
    nRegistered: 8 + ((i * 7) % 30), nResources: 2 + ((i * 5) % 12),
  }).scenario);
}

const SCEN = randomScenarios(24, "inv");

function noneGap(m: MaterializedScenario, id: string): number {
  const r = qT(m.planner.tOutage) + m.truth.restorationS;
  const h = m.planner.households.find((x) => x.id === id);
  const lEnd = h ? qT(h.tReport) + m.truth.hh[id].LTrueS : qT(m.planner.tOutage) + m.truth.unregistered.find((u) => u.id === id)!.LTrueS;
  return Math.max(0, r - lEnd);
}

describe("시뮬레이터 결정성 (9절 결정성)", () => {
  it("같은 시나리오·정책 → 결과 JSON 바이트 동일(모든 정책)", () => {
    const m = SCEN[3];
    for (const p of SIM_POLICIES) {
      expect(canonicalJson(runScenario(m, p))).toBe(canonicalJson(runScenario(m, p)));
    }
  });
  it("같은 시드로 materialize부터 다시 해도 결과 동일", () => {
    const a = presetDefs()[0].def;
    const r1 = canonicalJson(runScenario(materialize(a).scenario, "RULE"));
    const r2 = canonicalJson(runScenario(materialize(a).scenario, "RULE"));
    expect(r2).toBe(r1);
  });
});

describe("이산 사건 규약 불변식 (4.3절)", () => {
  const results: { m: MaterializedScenario; p: SimPolicy; r: RunResult }[] = [];
  for (const m of SCEN) for (const p of SIM_POLICIES) results.push({ m, p, r: runScenario(m, p) });

  it("모든 등록 가구가 최종 레인을 갖고, 끝난 뒤 HOLD는 남지 않는다", () => {
    for (const { m, r } of results) {
      for (const h of m.planner.households) {
        const t = r.households[h.id];
        expect(t.lane).not.toBeNull();
        expect(t.lane).not.toBe("HOLD");
        if (t.lane === "MANUAL_REVIEW") expect(h.reentry).toBeUndefined();
      }
    }
  });

  it("결정 시점: 오름차순·중복 없음, 첫 시점 = max tReport, 결정 시각 ≥ 신고 시각", () => {
    for (const { m, p, r } of results) {
      if (p === "NONE" || p === "KR_BASELINE") { expect(r.decisions.length).toBe(0); continue; }
      const t0 = Math.max(...m.planner.households.map((h) => qT(h.tReport)));
      expect(r.decisions[0].tS).toBe(t0);
      for (let i = 1; i < r.decisions.length; i++) expect(r.decisions[i].tS).toBeGreaterThan(r.decisions[i - 1].tS);
      for (const h of m.planner.households) {
        const t = r.households[h.id];
        if (t.decidedAtS != null) expect(t.decidedAtS).toBeGreaterThanOrEqual(qT(h.tReport));
      }
    }
  });

  it("자원은 한 가구에만, 실제 있는 가용 자원만 배정", () => {
    for (const { m, r } of results) {
      const ids = new Set(m.planner.resources.filter((x) => x.available).map((x) => x.id));
      const used = Object.values(r.households).filter((t) => t.resourceId != null && (t.lane === "PROPOSE_ASSIGN" || t.lane === "GAP_REDUCE"))
        .map((t) => t.resourceId as string);
      expect(new Set(used).size).toBe(used.length);
      for (const u of used) expect(ids.has(u)).toBe(true);
    }
  });

  it("전역 순번은 레인을 받은 가구에만 1부터 증가, MANUAL_REVIEW·HOLD는 null", () => {
    for (const { r } of results) {
      const all = r.decisions.flatMap((d) => d.assigned.map((a) => a[0]));
      all.forEach((o, i) => expect(o).toBe(i + 1));
      for (const t of Object.values(r.households)) if (t.lane === "MANUAL_REVIEW") expect(t.order).toBeNull();
    }
  });

  it("진실 119 대기열: (호출, id) 순, 슬롯 시작 ≥ 호출, 앞 슬롯 종료 이후", () => {
    for (const { m, p, r } of results) {
      const svc = makePlanner119(m.planner.lanes.k119PerH).svcS;
      for (let i = 0; i < r.true119.length; i++) {
        const q = r.true119[i];
        expect(q.startS).toBeGreaterThanOrEqual(q.callS);
        if (i > 0) {
          const pr = r.true119[i - 1];
          expect(q.callS > pr.callS || (q.callS === pr.callS && q.id > pr.id)).toBe(true);
          expect(q.startS).toBeGreaterThanOrEqual(pr.startS + svc);
        }
      }
      const unregCalls = r.true119.filter((q) => q.id.startsWith("U")).length;
      expect(unregCalls).toBe(p === "NONE" ? 0 : m.truth.unregistered.length);
      if (p === "KR_BASELINE") {
        for (const h of m.planner.households) {
          expect(r.true119.find((q) => q.id === h.id)?.callS).toBe(m.truth.hh[h.id].kr07CallS);
        }
      }
    }
  });

  it("채점: M2 = Σ 정수 초 공백, M1 ≤ 고위험 수, 가구 공백 ≤ 도움 없음 공백, NONE은 max(0, R − L)", () => {
    for (const { m, p, r } of results) {
      const met = r.outcome.metrics;
      expect(met.M2S).toBe(r.outcome.rows.reduce((s, x) => s + x.gapS, 0));
      expect(met.M1).toBeLessThanOrEqual(met.highRiskCount);
      expect(met.M3.den).toBe(Object.values(r.households).filter((t) => t.everHold).length);
      for (const row of r.outcome.rows) {
        expect(Number.isSafeInteger(row.gapS) && row.gapS >= 0).toBe(true);
        const ng = noneGap(m, row.householdId);
        expect(row.gapS).toBeLessThanOrEqual(ng);
        if (p === "NONE") expect(row.gapS).toBe(ng);
      }
    }
  });

  it("공급 시각 = min(R_true, 결정 시각 + 실제 도착, 119 슬롯 시작 + A_119 진실 + 0.33h, 쉼터 실제 도착)", () => {
    const tr119 = transport119S();
    for (const { m, r } of results) {
      const rEnd = qT(m.planner.tOutage) + m.truth.restorationS;
      for (const row of r.outcome.rows) {
        let exp = rEnd;
        const t = r.households[row.householdId];
        const q = r.true119.find((x) => x.id === row.householdId);
        if (q) exp = Math.min(exp, q.startS + m.truth.a119TrueS[row.householdId] + tr119);
        if (t && (t.lane === "PROPOSE_ASSIGN" || t.lane === "GAP_REDUCE")) {
          exp = Math.min(exp, (t.decidedAtS as number) + m.truth.arrivalTrueS[`${t.id}|${t.resourceId}`]);
        }
        if (t && t.lane === "FALLBACK_SHELTER" && !m.truth.hh[t.id].shelterRefuses) {
          exp = Math.min(exp, (t.decidedAtS as number) + m.truth.shelterTrueS[t.id]);
        }
        expect(row.tServeS).toBe(exp);
      }
    }
  });

  it("판단·진실 분리: 진실(L_true·R_true·실제 도착·고장·거부)을 바꿔도 도구 정책의 결정은 같다(재진입 L 포함)", () => {
    for (const m of SCEN.slice(0, 12)) {
      const t = structuredClone(m);
      for (const [id, h] of Object.entries(t.truth.hh)) {
        h.LTrueS = (h.LTrueS * 7 + id.length * 3600) % (40 * 3600);
        h.backupFails = !h.backupFails;
        h.shelterRefuses = !h.shelterRefuses;
      }
      t.truth.restorationS = t.truth.restorationS * 3 + 1234;
      for (const k of Object.keys(t.truth.arrivalTrueS)) t.truth.arrivalTrueS[k] = 17 + (t.truth.arrivalTrueS[k] % 5000);
      for (const p of TOOL_POLICIES) {
        const a = runScenario(m, p), b = runScenario(t, p);
        const strip = (r: RunResult) => Object.fromEntries(Object.entries(r.households).map(([id, x]) =>
          [id, { lane: x.lane, res: x.resourceId, order: x.order, at: x.decidedAtS, L: x.L }]));
        expect(strip(b)).toEqual(strip(a));
        expect(b.decisions).toEqual(a.decisions);
      }
    }
  });

  it("수동검토 가구는 검토 완료(tReport + mrDelayH, t₀ 이후) 전에는 자원·119 레인을 받지 않는다", () => {
    for (const { m, p, r } of results) {
      if (p === "NONE" || p === "KR_BASELINE") continue;
      const t0 = Math.max(...m.planner.households.map((h) => qT(h.tReport)));
      for (const h of m.planner.households) {
        if (computeLowerBoundDetail(h).lb.status !== "MANUAL_REVIEW") continue;
        const t = r.households[h.id];
        const review = Math.max(t0, qT(h.tReport) + m.truth.hh[h.id].mrDelayS);
        if (t.lane !== "MANUAL_REVIEW" && t.decidedAtS != null) expect(t.decidedAtS).toBeGreaterThanOrEqual(review);
        if (t.L) expect(t.L.status).toBe("AUTO");
        expect(t.L).toEqual(expect.objectContaining({ hoursS: computeLowerBoundDetail(applyReentry(h, h.reentry)).Ls }));
      }
    }
  });

  it("검토 예약은 검토 완료 전 다른 결정 시점에서도 유지된다(예약 자원이 남에게 가지 않음)", () => {
    let checked = 0;
    for (const { m, p, r } of results) {
      if (p !== "RULE") continue;
      const t0 = Math.max(...m.planner.households.map((h) => qT(h.tReport)));
      for (const h of m.planner.households) {
        const rid = r.households[h.id].reservedResourceId;
        if (!rid) continue;
        const review = Math.max(t0, qT(h.tReport) + m.truth.hh[h.id].mrDelayS);
        for (const d of r.decisions) {
          if (d.tS >= review) continue;
          checked++;
          for (const a of d.assigned) if (a[3] === rid) expect(a[1]).toBe(h.id);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("unservedSelfCall: 끝까지 미배정인 등록 가구가 진실 119 대기열에 들어간다", () => {
    let seen = 0;
    for (const m of SCEN) {
      const r = runScenario(m, "RULE", { unservedSelfCall: true });
      for (const t of Object.values(r.households)) {
        if (t.lane === "UNSERVED_VISIBLE") {
          seen++;
          expect(t.call119S).toBe(m.truth.hh[t.id].kr07CallS);
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("오라클 출력 형식: 가구별 lane·resourceId·order와 M1·M2S", () => {
    const r = runScenario(SCEN[0], "RULE");
    const o = toOracleOut(r) as { format: string; households: Record<string, { lane: string }>; metrics: { M1: number; M2S: number } };
    expect(o.format).toBe("pl26-oracle-out/1");
    expect(Object.keys(o.households).sort()).toEqual(SCEN[0].planner.households.map((h) => h.id).sort());
    expect(o.metrics.M2S).toBe(r.outcome.metrics.M2S);
  });
});

describe("소스 규칙 (3장·2장)", () => {
  const dir = __dirname;
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  it("sim/ 본 코드에 Math.random·Date 없음", () => {
    for (const f of files) {
      const src = strip(readFileSync(path.join(dir, f), "utf-8"));
      expect(src, f).not.toMatch(/Math\.random|\bDate\b/);
    }
  });
  it("reentry.ts는 진실(WorldTruth·LTrue·truth)을 참조하지 않는다", () => {
    const src = strip(readFileSync(path.join(dir, "reentry.ts"), "utf-8"));
    expect(src).not.toMatch(/WorldTruth|LTrue|truth/i);
  });
  it("reentry: DB 기종은 사양 기반 L(operator), DB 밖·비연속은 operatorLowerH, 값 없으면 수동검토 유지", () => {
    const h = SCEN.flatMap((m) => m.planner.households).find((x) => x.device.specId === null)!;
    const { reentry: _r, ...base } = h;
    void _r;
    expect(computeLowerBoundDetail(applyReentry(base, undefined)).lb.status).toBe("MANUAL_REVIEW");
    const a = applyReentry(base, { specId: "TRILOGY100" });
    expect(a.device.specBy).toBe("operator");
    expect(computeLowerBoundDetail(a).lb.status).toBe("AUTO");
    const b = applyReentry({ ...base, device: { ...base.device, specId: "COUGH_E70" } }, { operatorLowerH: 1.5 });
    const d = computeLowerBoundDetail(b);
    expect(d.lb.flags).toContain("OPERATOR_LOWER");
    expect(d.Ls).toBe(5400);
    expect(() => applyReentry(base, { operatorLowerH: -1 })).toThrow();
  });
});
