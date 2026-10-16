// 시험 전용 시나리오 생성기(배정기 단위·속성 시험). 엔진·시뮬레이션 본 코드는 쓰지 않는다.
import type { Cause, DeviceSpec, HouseholdView, PlannerView, ResourceKind, ResourceView } from "../domain/types";
import { CAUSES } from "../domain/types";
import { makeResource, rentalExtResource, type TravelProfileName } from "../engine/arrival";
import { buildDb, DEFAULT_DB, type EngineDb } from "../engine/lowerBound";
import { computeRestorationView, defaultStatus } from "../engine/restoration";
import { Gen } from "../engine/test-rng";
import type { AllocOptions } from "./feasible";
import type { Slot119 } from "./fallback";
import type { AllocState } from "./rule";

/** 산소 기기에 O2_FLOW 커넥터를 더한 시험용 DB(O2_CYL_DELIVERY 경로 시험용) */
export const O2_DB: EngineDb = buildDb(
  [...DEFAULT_DB.devices.values()].map((d) =>
    d.specId === "PERFECTO2" || d.specId === "INOGEN_G5" ? { ...d, connectors: [...d.connectors, "O2_FLOW"] } : d),
  [...DEFAULT_DB.ext.values()],
);

/** 등급 이름만 순환시킨 DB(I5): L·전력·커넥터는 같다 */
export function renamedClassDb(db: EngineDb): EngineDb {
  const classes: DeviceSpec["cls"][] = ["O2_STAT", "O2_STAT_CYL", "VENT_1H", "VENT_3H", "O2_PORT", "VENT_8H", "VENT_8H_EXT2", "INTERMITTENT", "UNKNOWN"];
  return buildDb(
    [...db.devices.values()].map((d) => ({ ...d, cls: classes[(classes.indexOf(d.cls) + 3) % classes.length] })),
    [...db.ext.values()],
  );
}

export function view(over: Partial<PlannerView> & { cause?: Cause; status?: PlannerView["restoration"]["status"]; confirmedEndH?: number; sigmaE?: number } = {}): PlannerView {
  const cause = over.cause ?? "APT_NIGHT_XFMR";
  const now = over.now ?? 0.5;
  const tOutage = over.tOutage ?? 0;
  const restoration = over.restoration ?? computeRestorationView({
    cause, tOutageH: tOutage, nowH: now, status: over.status, confirmedEndH: over.confirmedEndH, sigmaE: over.sigmaE,
  });
  return {
    scenarioId: "T", now, tOutage, households: over.households ?? [], resources: over.resources ?? [], restoration,
    lanes: over.lanes ?? { k119PerH: 2, a119H: { lo: 10 / 60, hi: 30 / 60 }, shelter: { seats: 0, prepH: { lo: 0.5, hi: 2 } } },
  };
}

export const FLAT: AllocOptions["travel"] = { prepMult: [1, 1], speedKmh: 25, congest: [1, 1] };

const SPEC_IDS = ["LTV1150", "TRILOGY100", "TRILOGY_EVO", "ASTRAL150", "PERFECTO2", "INOGEN_G5", "COUGH_E70"] as const;
const KINDS: ResourceKind[] = ["ESS_S", "ESS_L", "MOBILE_GEN", "RENTAL_EXT", "O2_CYL_DELIVERY", "EV_V2L"];

export interface RandomCase { view: PlannerView; opts: AllocOptions; state: AllocState; db: EngineDb }

let gridKm = 10;
function cell(g: Gen) {
  return { x: Math.round(g.float(0, gridKm) * 10) / 10, y: Math.round(g.float(0, gridKm) * 10) / 10 };
}

export function randomHousehold(g: Gen, id: string, db: EngineDb): HouseholdView {
  const r = g.next();
  const specId: string | null = r < 0.08 ? null : r < 0.12 ? "SUCTION_X" : g.pick(SPEC_IDS);
  const dev = specId ? db.devices.get(specId) : undefined;
  const manualDevice = !dev || !dev.continuous;
  const ext: HouseholdView["ext"] = [];
  const extSpecs = [...db.ext.values()].filter((e) => specId != null && e.forSpecIds.includes(specId));
  if (extSpecs.length > 0 && g.bool(0.4)) {
    const declared = g.int(1, 2);
    ext.push({
      extSpecId: g.pick(extSpecs).extSpecId, declaredCount: declared,
      opVerified: g.bool(0.5) ? { count: g.int(0, declared), chargeConfirmed: g.bool() ? "device_screen" : null, extAgeY: g.maybe(0.5, () => g.int(0, 3)), auditId: "a" } : null,
    });
  }
  const chargeSrc = g.pick(["device_screen", "user", "unknown"] as const);
  const tReport = Math.round(g.float(0, 0.5) * 100) / 100;
  return {
    id, pseudonym: id, cell: cell(g), floor: g.int(1, 20), mobilityNeed: g.bool(0.42), caregiver: g.bool(0.6),
    tReport, lEndPrev: null, ext,
    cylinder: dev && dev.connectors.includes("O2_FLOW") && g.bool(0.2) ? { declared: true, opVerified: g.bool() ? { count: 1, hoursLo: g.int(1, 10), auditId: "c" } : null } : undefined,
    device: {
      specId, specBy: specId ? (g.bool(0.15) ? "ai_label_user_confirmed" : "db_exact") : null,
      batteryAgeY: g.maybe(0.6, () => g.int(0, 4)),
      userAgeY: g.maybe(0.2, () => g.int(0, 5)),
      charge: { value: chargeSrc === "unknown" ? null : g.int(0, 100), source: chargeSrc },
      setting: specId === "INOGEN_G5" && g.bool() ? g.int(1, 5) : undefined,
      settingSource: g.bool() ? "operator" : "user",
      screenRemainingH: g.maybe(0.1, () => g.float(0.2, 5)) ?? undefined,
      operatorLowerH: manualDevice && g.bool(0.5) ? { hours: Math.round(g.float(0.5, 4) * 100) / 100, basis: "시험", auditId: "o" } : undefined,
    },
  };
}

export function randomResource(g: Gen, id: string, db: EngineDb): ResourceView {
  const kind = g.pick(KINDS);
  if (kind === "RENTAL_EXT") {
    const e = g.pick([...db.ext.values()]);
    const d = db.devices.get(e.forSpecIds[0]);
    return { ...rentalExtResource(id, cell(g), e, d ? d.drawW.value.hi : 60), available: g.bool(0.85) };
  }
  return makeResource(kind, id, cell(g), { available: g.bool(0.85) });
}

export function randomCase(seed: number): RandomCase {
  const g = new Gen(seed);
  const db = g.bool() ? DEFAULT_DB : O2_DB;
  const cause = g.pick(CAUSES);
  const now = Math.round(g.float(0.5, 6) * 100) / 100;
  let status = defaultStatus(cause);
  let confirmedEndH: number | undefined;
  let sigmaE: number | undefined;
  if (status !== "NEAR_CERTAIN" && g.bool(0.4)) {
    status = "CONFIRMED";
    confirmedEndH = now + Math.round(g.float(0, 10) * 100) / 100;
    sigmaE = g.pick([0, 0.3, 0.5, 0.75, 1.0]);
  }
  gridKm = g.pick([2, 5, 10]);
  const n = g.int(1, 12), m = g.bool(0.3) ? g.int(5, 20) : g.int(0, 8);
  const households = Array.from({ length: n }, (_, i) => randomHousehold(g, `H-${String(i).padStart(3, "0")}`, db));
  const resources = Array.from({ length: m }, (_, j) => randomResource(g, `R-${String(j).padStart(2, "0")}`, db));
  const k = g.pick([1, 2, 3.5, 6]);
  const v = view({
    cause, now, status, confirmedEndH, sigmaE, households, resources,
    lanes: { k119PerH: k, a119H: { lo: 10 / 60, hi: 30 / 60 }, shelter: { seats: g.int(0, 3), prepH: { lo: 0.5, hi: 2 } } },
  });
  const travel = g.pick(["fast", "standard", "slow"] as TravelProfileName[]);
  const state: AllocState = {};
  if (resources.length > 0 && g.bool(0.2)) state.usedResourceIds = [resources[0].id];
  if (g.bool(0.2)) {
    const svc = Math.floor(3600 / k + 0.5);
    const start = Math.floor(now * 3600);
    const slots: Slot119[] = [{ householdId: "X-OLD", callS: start - 100, startS: start - 100, endS: start - 100 + svc, kind: "CALL" }];
    state.slots119 = slots;
  }
  if (g.bool(0.2)) state.shelterSeatsUsed = 1;
  return { view: v, opts: { db, travel, stress119: Math.round(g.float(1, 4) * 10) / 10 }, state, db };
}
