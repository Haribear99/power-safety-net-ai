// 도착시간과 자원 (spec.md 3.6절).
// 계획 도착(planArrivalS·plan119S)은 결정 경로라 정수 초·정수 유리수로 계산한다.
// 진실 도착(truthArrivalS·truth119S)은 materialize 단계용이며 Math.exp를 쓴 뒤 qT 정수로 돌려준다(3절 초월함수 규칙).
import { z } from "zod";
import resRaw from "../../../../spec/resources_mock.json";
import type { Cause, Connector, ExtSpec, HouseholdView, Range, ResourceKind, ResourceView } from "../domain/types";
import { pNum, pRange, pRatio, pValue } from "./params";
import { mulDivFloor, qD, qT } from "./quantize";

// ---------- 이동시간 분포 ----------
export type TravelProfileName = "fast" | "standard" | "slow";
export interface TravelProfile { prepMult: readonly [number, number]; speedKmh: number; congest: readonly [number, number] }

export function travelProfile(name: TravelProfileName): TravelProfile {
  const all = pValue<Record<TravelProfileName, TravelProfile>>("arrival.profiles");
  const p = all[name];
  if (!p) throw new Error(`이동시간 분포 없음: ${name}`);
  return p;
}

/** 맨해튼 거리(정수 m). 격자 좌표는 km */
export function manhattanM(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return qD(Math.abs(a.x - b.x) + Math.abs(a.y - b.y));
}

/** floorDelay(i) = floor ≥ 4 ∧ mobilityNeed ∧ cause ∈ APT_* ? 0.25h : 0 */
export function floorDelayS(hh: Pick<HouseholdView, "floor" | "mobilityNeed">, cause: Cause): number {
  if (hh.floor >= pNum("arrival.floorDelayMinFloor") && hh.mobilityNeed && cause.startsWith("APT_")) {
    const [n, d] = pRatio("arrival.floorDelayH");
    return mulDivFloor(3600, [n], [d]);
  }
  return 0;
}

/** 이동 시간(정수 초) = floor(dist_m × 3600 × congest / (speed × 1000)) */
export function travelS(distM: number, p: TravelProfile): number {
  if (!Number.isInteger(p.speedKmh) || p.speedKmh <= 0) throw new Error("speedKmh는 양의 정수");
  return mulDivFloor(distM, [3600, p.congest[0]], [p.speedKmh * 1000, p.congest[1]]);
}

/**
 * 계획 도착 길이 A_ij (정수 초, '지금' 기준):
 * prepH.hi × prepMult + manhattan/speed × congest + floorDelay. 곱마다 floor 한 번(DEVLOG).
 */
export function planArrivalS(
  res: Pick<ResourceView, "cell" | "prepH">, hh: Pick<HouseholdView, "cell" | "floor" | "mobilityNeed">,
  cause: Cause, p: TravelProfile,
): number {
  const prep = mulDivFloor(qT(res.prepH.hi), [p.prepMult[0]], [p.prepMult[1]]);
  return prep + travelS(manhattanM(res.cell, hh.cell), p) + floorDelayS(hh, cause);
}

/**
 * 진실 도착 길이 (materialize용): U(prepH.lo, prepH.hi) × prepMult + manhattan/speed × congest × exp(N(0, 0.3)) + floorDelay.
 * uPrep ∈ [0,1), z ~ N(0,1)은 호출자의 ARRIVAL 스트림이 준다.
 */
export function truthArrivalS(
  res: Pick<ResourceView, "cell" | "prepH">, hh: Pick<HouseholdView, "cell" | "floor" | "mobilityNeed">,
  cause: Cause, p: TravelProfile, uPrep: number, z: number,
): number {
  const pm = p.prepMult[0] / p.prepMult[1];
  const cg = p.congest[0] / p.congest[1];
  const prepH = (res.prepH.lo + (res.prepH.hi - res.prepH.lo) * uPrep) * pm;
  const distKm = Math.abs(res.cell.x - hh.cell.x) + Math.abs(res.cell.y - hh.cell.y);
  const travelH = (distKm / p.speedKmh) * cg * Math.exp(pNum("arrival.noiseSigma") * z);
  return qT(prepH) + qT(travelH) + floorDelayS(hh, cause);
}

// ---------- 119 레인 ----------
/** 계획 A_119 = a119H.hi × stress (정수 초) */
export function plan119S(a119H: Range, stress: number): number {
  return qT(a119H.hi * stress);
}
/** 진실 A_119 = U(a119H) × stress (materialize용) */
export function truth119S(a119H: Range, stress: number, u: number): number {
  return qT((a119H.lo + (a119H.hi - a119H.lo) * u) * stress);
}
/** 119 이송 완료 +0.33h (정수 초) */
export function transport119S(): number {
  const [n, d] = pRatio("lane119.transportH");
  return mulDivFloor(3600, [n], [d]);
}
/** params의 119 도착 범위(lane119.a119Min, 분)를 시간 Range로 */
export function default119RangeH(): Range {
  const r = pRange("lane119.a119Min");
  return { lo: r.lo / 60, hi: r.hi / 60 };
}

// ---------- 자원 목록 ----------
const KindSchema = z.object({
  kind: z.enum(["ESS_S", "ESS_L", "MOBILE_GEN", "RENTAL_EXT", "O2_CYL_DELIVERY", "EV_V2L"]),
  outputW: z.number().nonnegative(),
  energyWh: z.number().nonnegative(),
  connectors: z.array(z.enum(["AC220", "DC12", "VENDOR_EXT", "O2_FLOW"])).min(1),
  inverterSafe: z.union([z.boolean(), z.literal("unknown")]),
  prepH: z.object({ lo: z.number().nonnegative(), hi: z.number().nonnegative() }),
  prov: z.object({ type: z.string(), sourceIds: z.array(z.string()), note: z.string().optional() }),
});
export type ResourceKindSpec = z.infer<typeof KindSchema>;
export const RESOURCE_KINDS: ReadonlyMap<ResourceKind, ResourceKindSpec> = new Map(
  z.object({ kinds: z.array(KindSchema) }).parse(resRaw).kinds.map((k) => [k.kind, k] as const),
);

export function makeResource(
  kind: ResourceKind, id: string, cell: { x: number; y: number },
  overrides: Partial<Pick<ResourceView, "outputW" | "energyWh" | "available" | "prepH">> = {},
): ResourceView {
  const k = RESOURCE_KINDS.get(kind);
  if (!k) throw new Error(`자원 종류 없음: ${kind}`);
  return {
    id, kind, cell: { ...cell },
    outputW: overrides.outputW ?? k.outputW,
    energyWh: overrides.energyWh ?? k.energyWh,
    connectors: [...k.connectors] as Connector[],
    inverterSafe: k.inverterSafe,
    prepH: overrides.prepH ?? { ...k.prepH },
    available: overrides.available ?? true,
    mock: true, schemaRef: "data.go.kr/15151542",
  };
}

/** RENTAL_EXT: 기기 전용, 출력 = 기기 W, 에너지 = 외장 h × 기기 W (3.6절) */
export function rentalExtResource(id: string, cell: { x: number; y: number }, ext: ExtSpec, deviceDrawWHi: number): ResourceView {
  return makeResource("RENTAL_EXT", id, cell, { outputW: deviceDrawWHi, energyWh: ext.runtimeH * deviceDrawWHi });
}

/** O2_CYL_DELIVERY 산소 공급 시간(정수 초) */
export function o2CylDeliveryS(): number {
  return qT(pNum("alloc.o2CylDeliveryH"));
}
