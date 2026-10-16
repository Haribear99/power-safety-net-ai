import { describe, expect, it } from "vitest";
import { CAUSES, RESTORATION_LABEL, type Cause } from "../domain/types";
import {
  cdfExact, computeRestoration, conditionalQuantileEndS, defaultStatus, makeRestorationSampler, quantileExactS,
  quantileFloatS, quantileTable, sampleRestorationS, type QuantileFamily,
} from "./restoration";
import { qT } from "./quantize";
import { Gen, PROPERTY_RUNS } from "./test-rng";

const GAMMA_TARGETS: Partial<Record<Cause, [number, number]>> = {
  KEPCO_DIST: [0.5, 2.0], APT_SHORT: [0.5, 3.0], APT_NIGHT_XFMR: [5, 12], APT_PARTS: [8, 20], APT_FIRE: [12, 48],
};

function empiricalQuantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(q * (s.length - 1))];
}

describe("분위 표 (3.4절)", () => {
  it("모든 원인·두 계열에 1,001점 단조 표, u=1은 72h 이하", () => {
    for (const fam of ["gamma", "lognormal"] as QuantileFamily[]) {
      for (const c of CAUSES) {
        const t = quantileTable(c, fam);
        expect(t.length).toBe(1001);
        expect(t[1000]).toBeLessThanOrEqual(qT(72));
      }
    }
  });
  it("감마·로그정규 표의 P10·P90이 원인 표 목표와 같다(±2%)", () => {
    for (const fam of ["gamma", "lognormal"] as QuantileFamily[]) {
      for (const [c, [p10, p90]] of Object.entries(GAMMA_TARGETS) as [Cause, [number, number]][]) {
        const t = quantileTable(c, fam);
        expect(Math.abs(t[100] / qT(p10) - 1), `${fam} ${c} P10`).toBeLessThan(0.02);
        expect(Math.abs(t[900] / qT(p90) - 1), `${fam} ${c} P90`).toBeLessThan(0.02);
      }
    }
  });
  it("표본기 분위: n = 10⁵에서 P10·P90 ±2% (9절 단위 시험)", () => {
    for (const fam of ["gamma", "lognormal"] as QuantileFamily[]) {
      for (const [c, [p10, p90]] of Object.entries(GAMMA_TARGETS) as [Cause, [number, number]][]) {
        const g = new Gen(101);
        const sample = makeRestorationSampler(g.next, fam);
        const xs = Array.from({ length: 100_000 }, () => sample(c));
        expect(Math.abs(empiricalQuantile(xs, 0.1) / qT(p10) - 1), `${fam} ${c} P10`).toBeLessThan(0.02);
        expect(Math.abs(empiricalQuantile(xs, 0.9) / qT(p90) - 1), `${fam} ${c} P90`).toBeLessThan(0.02);
      }
    }
  });
  it("TYPHOON_WEAK 혼합: D+1(24h) 누적 ≥ 99.5% 근처, TYPHOON_STRONG: F(12) = 0.65", () => {
    const w = quantileTable("TYPHOON_WEAK");
    expect(w[995]).toBeLessThanOrEqual(qT(24));
    const s = quantileTable("TYPHOON_STRONG");
    expect(s[650]).toBe(qT(12));
    expect(s[300]).toBe(qT(6));
    expect(s[992]).toBe(qT(36));
  });
  it("ROTATING은 1.0h 고정, scaleMult는 표본에 곱해진다", () => {
    expect(sampleRestorationS("ROTATING", 0.37)).toBe(3600);
    expect(sampleRestorationS("ROTATING", 0.37, { scaleMult: 2 })).toBe(7200);
  });
});

describe("역분위 F(e)와 조건부 분위 (3.1절 규칙 5, 3.9절)", () => {
  it("e = 0이면 무조건부 분위와 같다", () => {
    for (const c of CAUSES) {
      if (c === "ROTATING") continue;
      const t = quantileTable(c);
      expect(conditionalQuantileEndS(c, 0, 0, [4, 5]).endS).toBe(t[800]);
      expect(conditionalQuantileEndS(c, 0, 0, [9, 10]).endS).toBe(t[900]);
      expect(conditionalQuantileEndS(c, 3600, 3600, [1, 10]).endS).toBe(3600 + t[100]);
    }
  });
  it("F(e) = max{u : Q(u) ≤ e}: 평탄 구간(72h 절단)에서 최대 u, Q(F(e)) = e", () => {
    const t = quantileTable("APT_FIRE");
    const F = cdfExact(t, qT(72));
    expect(F.num).toBe(F.den); // u = 1
    const g = new Gen(3);
    for (let i = 0; i < 2000; i++) {
      const e = g.int(t[0], t[1000] - 1);
      const f = cdfExact(t, e);
      expect(quantileExactS(t, f)).toBe(e); // 선형 보간 역함수
    }
  });
  it("경과가 모형 상한을 넘으면(F(e) = 1) R_q_end = now, 「가정 범위 초과 경과」", () => {
    const r = conditionalQuantileEndS("APT_SHORT", 0, qT(80), [4, 5]);
    expect(r).toEqual({ endS: qT(80), beyond: true });
    const rot = conditionalQuantileEndS("ROTATING", 0, 3600, [4, 5]);
    expect(rot.beyond).toBe(true);
    expect(conditionalQuantileEndS("ROTATING", 0, 3599, [4, 5])).toEqual({ endS: 3600, beyond: false });
  });
  it("속성: 조건부 분위 끝 시각 ≥ now, 경과에 대해 비감소, q에 대해 비감소, 정확값과 부동소수 근사 차 ≤ 2초", () => {
    const g = new Gen(5);
    const qs: [number, number][] = [[1, 10], [1, 2], [4, 5], [9, 10]];
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const c = g.pick(CAUSES);
      const fam = g.pick(["gamma", "lognormal"] as const);
      const t0 = g.int(0, 7200);
      const e1 = g.int(0, qT(80));
      const e2 = e1 + g.int(0, 7200);
      const ends = qs.map((q) => conditionalQuantileEndS(c, t0, t0 + e1, q, fam));
      for (let k = 0; k < ends.length; k++) {
        if (!ends[k].beyond) expect(ends[k].endS).toBeGreaterThanOrEqual(t0 + e1);
        if (k > 0) expect(ends[k].endS).toBeGreaterThanOrEqual(ends[k - 1].endS);
      }
      const later = conditionalQuantileEndS(c, t0, t0 + e2, [4, 5], fam);
      expect(later.endS).toBeGreaterThanOrEqual(ends[2].endS);
      // 부동소수 근사와 대조
      if (!ends[2].beyond) {
        const t = quantileTable(c, fam);
        const f = cdfExact(t, e1);
        const Ff = Number(f.num) / Number(f.den);
        const approx = t0 + quantileFloatS(t, Ff + 0.8 * (1 - Ff));
        expect(Math.abs(ends[2].endS - approx)).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe("운영자가 보는 복구 추정 (3.5절, I8)", () => {
  it("기본 상태: ROTATING은 NEAR_CERTAIN, 나머지는 ASSUMED_RANGE", () => {
    expect(defaultStatus("ROTATING")).toBe("NEAR_CERTAIN");
    expect(defaultStatus("APT_FIRE")).toBe("ASSUMED_RANGE");
  });
  it("ASSUMED_RANGE: 정전 시작 시 P10~P90 = 원인 표, 범위와 리터럴 표지 필수", () => {
    const d = computeRestoration({ cause: "APT_NIGHT_XFMR", tOutageH: 0, nowH: 0 });
    const t = quantileTable("APT_NIGHT_XFMR");
    expect([d.p10S, d.p50S, d.p80S, d.p90S]).toEqual([t[100], t[500], t[800], t[900]]);
    expect(d.view.label).toBe(RESTORATION_LABEL);
    expect(d.view.p10).toBeLessThanOrEqual(d.view.p90);
    expect(d.view.status).toBe("ASSUMED_RANGE");
  });
  it("NEAR_CERTAIN(ROTATING): 화면 0.5~1.0, R80 = 1.0", () => {
    const d = computeRestoration({ cause: "ROTATING", tOutageH: 2, nowH: 2.2 });
    expect([d.p10S, d.p80S, d.p90S]).toEqual([qT(2.5), qT(3), qT(3)]);
  });
  it("CONFIRMED: 남은 시간에 exp(±1.2816σ)·exp(0.8416σ), σ=0이면 한 점", () => {
    const z = computeRestoration({ cause: "APT_PARTS", tOutageH: 0, nowH: 2, status: "CONFIRMED", confirmedEndH: 12, sigmaE: 0 });
    expect([z.p10S, z.p50S, z.p80S, z.p90S]).toEqual([qT(12), qT(12), qT(12), qT(12)]);
    const d = computeRestoration({ cause: "APT_PARTS", tOutageH: 0, nowH: 2, status: "CONFIRMED", confirmedEndH: 12 });
    expect(d.view.sigmaE).toBe(0.3); // UI 기본값
    expect(d.p10S).toBe(qT(2) + qT(10 * Math.exp(-1.2816 * 0.3)));
    expect(d.p80S).toBe(qT(2) + qT(10 * Math.exp(0.8416 * 0.3)));
    expect(d.p90S).toBe(qT(2) + qT(10 * Math.exp(1.2816 * 0.3)));
    expect(d.p10S).toBeLessThan(d.p50S);
    expect(d.p50S).toBeLessThan(d.p80S);
    expect(d.p80S).toBeLessThan(d.p90S);
    expect(() => computeRestoration({ cause: "APT_PARTS", tOutageH: 0, nowH: 0, status: "CONFIRMED" })).toThrow();
  });
  it("표본기는 시드가 같으면 같은 결과(결정성)", () => {
    const a = makeRestorationSampler(new Gen(9).next);
    const b = makeRestorationSampler(new Gen(9).next);
    for (let i = 0; i < 1000; i++) expect(a("APT_FIRE", 1.3)).toBe(b("APT_FIRE", 1.3));
  });
});
