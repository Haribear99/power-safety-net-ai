import { describe, expect, it } from "vitest";
import {
  default119RangeH, floorDelayS, makeResource, manhattanM, o2CylDeliveryS, plan119S, planArrivalS, RESOURCE_KINDS,
  rentalExtResource, transport119S, travelProfile, truth119S, truthArrivalS,
} from "./arrival";
import { DEFAULT_DB } from "./lowerBound";
import { makeHH } from "./test-fixtures";

const hh = makeHH({ cell: { x: 3, y: 4 }, floor: 5, mobilityNeed: true });
const ess = makeResource("ESS_L", "R-1", { x: 0, y: 0 });

describe("도착시간 (3.6절)", () => {
  it("이동시간 분포 3종", () => {
    expect(travelProfile("fast")).toEqual({ prepMult: [1, 2], speedKmh: 40, congest: [1, 1] });
    expect(travelProfile("standard")).toEqual({ prepMult: [1, 1], speedKmh: 25, congest: [3, 2] });
    expect(travelProfile("slow")).toEqual({ prepMult: [2, 1], speedKmh: 15, congest: [5, 2] });
  });
  it("계획 A = prepH.hi × prepMult + 맨해튼/속도 × 혼잡 + 층 지연 (손계산)", () => {
    expect(manhattanM(ess.cell, hh.cell)).toBe(7000);
    // 표준: 3600 + floor(7000·3600·3/(25000·2)) = 3600 + 1512, 층 지연 900 (APT_*, 5층, 이동지원)
    expect(planArrivalS(ess, hh, "APT_NIGHT_XFMR", travelProfile("standard"))).toBe(3600 + 1512 + 900);
    // KEPCO_DIST는 층 지연 없음
    expect(planArrivalS(ess, hh, "KEPCO_DIST", travelProfile("standard"))).toBe(3600 + 1512);
    // 빠름: 1800 + 630, 느림: 7200 + floor(7000·3600·5/(15000·2)) = 7200 + 4200
    expect(planArrivalS(ess, hh, "KEPCO_DIST", travelProfile("fast"))).toBe(1800 + 630);
    expect(planArrivalS(ess, hh, "KEPCO_DIST", travelProfile("slow"))).toBe(7200 + 4200);
  });
  it("층 지연은 4층 이상 ∧ 이동지원 ∧ APT_* 원인일 때만 0.25h", () => {
    expect(floorDelayS({ floor: 4, mobilityNeed: true }, "APT_FIRE")).toBe(900);
    expect(floorDelayS({ floor: 3, mobilityNeed: true }, "APT_FIRE")).toBe(0);
    expect(floorDelayS({ floor: 9, mobilityNeed: false }, "APT_FIRE")).toBe(0);
    expect(floorDelayS({ floor: 9, mobilityNeed: true }, "TYPHOON_STRONG")).toBe(0);
  });
  it("진실 도착: u=1·z=0이면 계획값과 같고, 준비 시간은 [lo, hi] 안", () => {
    const p = travelProfile("standard");
    expect(truthArrivalS(ess, hh, "APT_SHORT", p, 1, 0)).toBe(planArrivalS(ess, hh, "APT_SHORT", p));
    expect(truthArrivalS(ess, hh, "APT_SHORT", p, 0, 0)).toBe(1080 + 1512 + 900);
    expect(truthArrivalS(ess, hh, "APT_SHORT", p, 0.5, 2)).toBeGreaterThan(truthArrivalS(ess, hh, "APT_SHORT", p, 0.5, 0));
  });
  it("119: 계획 = a119H.hi × stress, 진실 = U(a119H) × stress, 이송 +0.33h", () => {
    const r = default119RangeH();
    expect(r.lo).toBeCloseTo(1 / 6, 12);
    expect(r.hi).toBe(0.5);
    expect(plan119S(r, 2)).toBe(3600);
    expect(truth119S(r, 2, 0)).toBe(1200);
    expect(transport119S()).toBe(1188);
  });
});

describe("자원 목록 (3.6절)", () => {
  it("모든 종류가 mock이고 스키마 출처를 단다", () => {
    expect([...RESOURCE_KINDS.keys()].sort()).toEqual(["ESS_L", "ESS_S", "EV_V2L", "MOBILE_GEN", "O2_CYL_DELIVERY", "RENTAL_EXT"]);
    const v2l = makeResource("EV_V2L", "V-1", { x: 1, y: 1 });
    expect(v2l).toMatchObject({ mock: true, schemaRef: "data.go.kr/15151542", inverterSafe: "unknown", outputW: 3600, energyWh: 8000 });
    expect(makeResource("ESS_S", "S", { x: 0, y: 0 })).toMatchObject({ outputW: 600, energyWh: 500, prepH: { lo: 0.3, hi: 1.0 } });
  });
  it("RENTAL_EXT 에너지 = 외장 h × 기기 W, O2 실린더 배달 = 10h", () => {
    const ext = DEFAULT_DB.ext.get("ASTRAL_EXT")!;
    expect(rentalExtResource("X", { x: 0, y: 0 }, ext, 60)).toMatchObject({ outputW: 60, energyWh: 480, connectors: ["VENDOR_EXT"] });
    expect(o2CylDeliveryS()).toBe(36000);
  });
});
