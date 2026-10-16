import { describe, expect, it } from "vitest";
import { INF_S, NEG_INF_S, floorDiv, mulDivFloor, qD, qE, qT, sToH } from "./quantize";
import { Gen } from "./test-rng";

describe("quantize (3.1절)", () => {
  it("qT는 floor(h*3600 + 0.5) — 은행가 반올림이 아님", () => {
    expect(qT(1)).toBe(3600);
    expect(qT(0.5 / 3600)).toBe(1); // 0.5초 → 1 (반올림 위로)
    expect(qT(1.5 / 3600)).toBe(2); // 은행가 반올림이면 2, 2.5초 경우와 구분
    expect(qT(2.5 / 3600)).toBe(3); // 은행가 반올림이면 2
    expect(qT(-0.5 / 3600)).toBe(0); // floor(-0.5 + 0.5) = 0
    expect(qT(-1.5 / 3600)).toBe(-1);
    expect(qT(1.05)).toBe(3780);
    expect(qT(0.33)).toBe(1188);
  });
  it("qE·qD 정수 mWh·m", () => {
    expect(qE(500)).toBe(500000);
    expect(qE(0.0005)).toBe(1);
    expect(qD(1.2345)).toBe(1235);
  });
  it("감시값은 ±(2^31−1)", () => {
    expect(INF_S).toBe(2 ** 31 - 1);
    expect(NEG_INF_S).toBe(-(2 ** 31 - 1));
  });
  it("sToH → qT 왕복이 정확하다(|s| < 2^31)", () => {
    const g = new Gen(1);
    for (let i = 0; i < 20000; i++) {
      const s = g.int(-(2 ** 31 - 1), 2 ** 31 - 1);
      expect(qT(sToH(s))).toBe(s);
    }
  });
  it("floorDiv는 Python //와 같다(음수 포함), BigInt 기준과 일치", () => {
    expect(floorDiv(-7, 2)).toBe(-4);
    expect(floorDiv(7, 2)).toBe(3);
    const g = new Gen(2);
    for (let i = 0; i < 20000; i++) {
      const a = g.int(-(2 ** 52), 2 ** 52);
      const b = g.int(1, 2 ** 30);
      const A = BigInt(a), B = BigInt(b);
      let q = A / B;
      if (A % B !== BigInt(0) && A < BigInt(0)) q -= BigInt(1);
      expect(floorDiv(a, b)).toBe(Number(q));
    }
  });
  it("mulDivFloor: 분자 곱 먼저, 나눗셈 마지막 한 번 — 순서 차이를 만든다", () => {
    // 10800 × 7/10 × 1/2 = 3780 (분자 먼저) — 단계별 floor와 같거나 다를 수 있음
    expect(mulDivFloor(10800, [7, 1], [10, 2])).toBe(3780);
    expect(mulDivFloor(3, [7, 9], [10, 10])).toBe(1); // 189/100 → 1 (단계별 floor면 floor(floor(2.1)×0.9)=1)
    expect(mulDivFloor(11, [9, 9], [10, 10])).toBe(8); // 891/100 = 8.91 → 8; 단계별이면 floor(9×0.9)=8
    expect(mulDivFloor(-5, [4], [5])).toBe(-4);
    expect(mulDivFloor(-6, [4], [5])).toBe(-5); // floor(-4.8)
  });
  it("mulDivFloor는 2^53 이상 중간값을 거부한다", () => {
    expect(() => mulDivFloor(2 ** 40, [2 ** 14], [1])).toThrow();
    expect(() => mulDivFloor(1.5, [1], [1])).toThrow();
  });
});
