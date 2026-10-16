// 가능성 필터 단위 시험(4.1절 4단계). 숫자는 손계산.
import { describe, expect, it } from "vitest";
import type { ResourceView } from "../domain/types";
import { makeResource } from "../engine/arrival";
import { DEFAULT_DB } from "../engine/lowerBound";
import { makeHH } from "../engine/test-fixtures";
import {
  buildCtx, compatible, deviceEnvelope, energyOk, filterReport, hNeedS, inverterOk, isO2Flow, needMWh, outputOk, runS, unknownEnvelope, usableMWh, wasteMWh,
} from "./feasible";
import { rule } from "./rule";
import { FLAT, O2_DB, view } from "./test-scenario";

const vent = deviceEnvelope(makeHH(), DEFAULT_DB); // TRILOGY100: 60W, AC220+DC12, 인버터 민감
const res = (over: Partial<ResourceView>): ResourceView => ({ ...makeResource("ESS_L", "R", { x: 0, y: 0 }), ...over });

describe("개별 필터", () => {
  it("커넥터 교집합", () => {
    expect(compatible(vent, res({ connectors: ["DC12"] }))).toBe(true);
    expect(compatible(vent, res({ connectors: ["VENDOR_EXT"] }))).toBe(false);
    expect(compatible(vent, res({ connectors: ["O2_FLOW"] }))).toBe(false);
  });
  it("인버터 민감 기기는 inverterSafe === true만(V2L 'unknown' 제외)", () => {
    expect(inverterOk(vent, res({ inverterSafe: "unknown" }))).toBe(false);
    expect(inverterOk(vent, res({ inverterSafe: false }))).toBe(false);
    expect(inverterOk(vent, res({ inverterSafe: true }))).toBe(true);
    const o2 = deviceEnvelope(makeHH({ device: { specId: "PERFECTO2" } }), DEFAULT_DB);
    expect(inverterOk(o2, res({ inverterSafe: "unknown" }))).toBe(true);
  });
  it("출력 ≥ 1.25 × drawW.hi (경계 75W 포함)", () => {
    expect(outputOk(vent, res({ outputW: 75 }))).toBe(true);
    expect(outputOk(vent, res({ outputW: 74.999 }))).toBe(false);
  });
  it("H_need = clamp(R80_end − A_end, 1h, 24h)", () => {
    expect(hNeedS(10000, 9000)).toBe(3600);
    expect(hNeedS(50000, 10000)).toBe(40000);
    expect(hNeedS(200000, 0)).toBe(86400);
  });
  it("에너지: qE(Wh × 0.85) ≥ qE(drawW.hi × H_need) — 경계 정확히", () => {
    // 60W × 10h = 600Wh = 600000 mWh. 필요 energyWh = 600/0.85 = 705.88… → 705.883 Wh면 600000.55 → floor 600000
    expect(usableMWh(res({ energyWh: 705.883 }))).toBe(600000);
    expect(needMWh(vent, 36000)).toBe(600000);
    expect(energyOk(vent, res({ energyWh: 705.883 }), 36000)).toBe(true);
    expect(energyOk(vent, res({ energyWh: 705.88 }), 36000)).toBe(false);
    expect(wasteMWh(vent, res({ energyWh: 2000 }), 36000)).toBe(1700000 - 600000);
  });
  it("에너지 우변은 3.1절 규칙 2대로 floor(qE(draw) × H_s / 3600) (오라클과 같음, DEVLOG TASK D)", () => {
    // 60W × 1s = 16.67 mWh → 16 (half-up이면 17), 60W × 3599s = 59983.3 → 59983
    expect(needMWh(vent, 1)).toBe(16);
    expect(needMWh(vent, 3599)).toBe(59983);
  });
  it("run = energyWh × 0.85 / drawW.hi (초)", () => {
    expect(runS(vent, res({ energyWh: 2000 }))).toBe(102000);
  });
  it("DB 밖 기종 외피: DB 최대 소비(280W)·AC220만·인버터 민감", () => {
    const u = unknownEnvelope(DEFAULT_DB);
    expect(u).toEqual({ drawHiW: 280, connectors: ["AC220"], inverterSensitive: true, known: false });
    expect(deviceEnvelope(makeHH({ device: { specId: null, specBy: null } }), DEFAULT_DB)).toEqual(u);
  });
});

describe("filterReport: feasible ⊂ phys, 도착 0.8L", () => {
  it("A = floor(0.8·L_rem) 경계는 feasible, 1초 넘으면 phys만", () => {
    // L = 3 × 0.7 × 0.5 = 3780s, now 0 → 0.8L = 3024. ESS_L prepH.hi를 3024s로
    const hh = makeHH();
    const v = view({ now: 0, households: [hh], resources: [makeResource("ESS_L", "R", { x: 0, y: 0 }, { prepH: { lo: 0, hi: 3024 / 3600 } })] });
    const ctx = buildCtx(v, { travel: FLAT });
    const f = filterReport(ctx, ctx.infos[0], v.resources[0]);
    expect(f.aS).toBe(3024);
    expect(f.phys && f.feasible).toBe(true);
    const v2 = view({ now: 0, households: [hh], resources: [makeResource("ESS_L", "R", { x: 0, y: 0 }, { prepH: { lo: 0, hi: 3025 / 3600 } })] });
    const ctx2 = buildCtx(v2, { travel: FLAT });
    const f2 = filterReport(ctx2, ctx2.infos[0], v2.resources[0]);
    expect(f2.phys).toBe(true);
    expect(f2.feasible).toBe(false);
  });
  it("비가용 자원은 phys 아님", () => {
    const v = view({ now: 0, households: [makeHH()], resources: [makeResource("ESS_L", "R", { x: 0, y: 0 }, { available: false })] });
    const ctx = buildCtx(v, { travel: FLAT });
    expect(filterReport(ctx, ctx.infos[0], v.resources[0]).phys).toBe(false);
  });
});

describe("산소 O2_FLOW 경로", () => {
  const o2hh = makeHH({ id: "H-O2", device: { specId: "PERFECTO2", charge: { value: 100, source: "device_screen" } } });
  const cyl = makeResource("O2_CYL_DELIVERY", "R-CYL", { x: 0, y: 0 }, { prepH: { lo: 0, hi: 0.1 } });
  it("현재 device_db: 산소발생기는 O2_FLOW 커넥터로 실린더 배달과 호환, 인공호흡기는 비호환(등급 이름이 아니라 커넥터, I5)", () => {
    expect(compatible(deviceEnvelope(o2hh, DEFAULT_DB), cyl)).toBe(true);
    expect(isO2Flow(deviceEnvelope(o2hh, DEFAULT_DB), cyl)).toBe(true);
    expect(compatible(deviceEnvelope(makeHH(), DEFAULT_DB), cyl)).toBe(false);
  });
  it("O2_FLOW 커넥터가 있으면 출력 필터 면제, 에너지는 10h ≥ H_need", () => {
    const env = deviceEnvelope(o2hh, O2_DB);
    expect(compatible(env, cyl)).toBe(true);
    expect(outputOk(env, cyl)).toBe(true);
    expect(energyOk(env, cyl, 36000)).toBe(true);
    expect(energyOk(env, cyl, 36001)).toBe(false);
    expect(runS(env, cyl)).toBe(36000);
  });
  it("PERFECTO2(배터리 0h)는 L=0이라 0.8L 안 도착 불가 → GAP_REDUCE로 실린더(Δ ≥ 1h). 복구 P80이 10h를 넘으면 에너지 미달", () => {
    const v = view({ now: 0, cause: "APT_SHORT", households: [o2hh], resources: [cyl] });
    const r = rule(v, { db: O2_DB, travel: FLAT, stress119: 20 }).rows[0];
    expect(r.rec.lane).toBe("GAP_REDUCE");
    expect(r.rec.resourceId).toBe("R-CYL");
    const vLong = view({ now: 0, cause: "APT_NIGHT_XFMR", households: [o2hh], resources: [cyl] });
    const r2 = rule(vLong, { db: O2_DB, travel: FLAT, stress119: 20 }).rows[0];
    expect(r2.rec.resourceId).toBeUndefined();
  });
});
