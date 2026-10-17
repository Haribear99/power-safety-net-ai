// 합성 가구·자원 생성기 (spec.md 5.2절). 비AI — 가구는 코드가 공개 분포에서 뽑는다. LLM은 가구를 만들지 않는다.
// 분포 값은 spec/params.json(gen.*, sweep.*)과 이 폴더의 sim_params.json(명세에 값이 없는 생성 규칙, 모두 assumed)에서 읽는다.
// 결정성: 가구마다 스트림에서 고정 개수의 균등값을 먼저 꺼내 쓴다(θ가 바뀌어도 같은 가구는 같은 균등값 → 축 간 결합이 단조).
// 시간은 정수 초로 만든 뒤 h로 바꾼다(qT(sToH(s)) = s). 좌표는 0.1km 격자, 연식은 0.01년 단위.
import { z } from "zod";
import simParamsRaw from "./sim_params.json";
import type { Cause, DeviceClass, DeviceSpec, ExtSpec, HouseholdView, ResourceKind, ResourceView } from "../domain/types";
import { makeResource } from "../engine/arrival";
import { CYLINDERS, DEFAULT_DB, type EngineDb } from "../engine/lowerBound";
import { PROV_TYPES, pNum, pRange, pValue } from "../engine/params";
import { qT, sToH } from "../engine/quantize";
import { classOf, GEN_CLASSES, type GenClass } from "./labels";
import type { Theta } from "./lhs";
import { rngFor, type Rng } from "./prng";

// ---------- 보조 장부(sim_params.json) ----------
const SimRowSchema = z.object({
  key: z.string().min(1),
  value: z.unknown().optional(),
  range: z.object({ lo: z.number(), hi: z.number() }).optional(),
  unit: z.string().min(1),
  type: z.enum(PROV_TYPES),
  sourceIds: z.array(z.string().min(1)),
  note: z.string().min(1),
}).strict().refine((r) => r.value !== undefined || r.range !== undefined, { message: "value 또는 range 필요" });
type SimRow = z.infer<typeof SimRowSchema>;

export const SIM_PARAMS: ReadonlyMap<string, SimRow> = (() => {
  const rows = z.object({ meta: z.record(z.string(), z.unknown()), rows: z.array(SimRowSchema) }).parse(simParamsRaw).rows;
  const m = new Map<string, SimRow>();
  for (const r of rows) {
    if (m.has(r.key)) throw new Error(`sim_params.json 중복 키 ${r.key}`);
    m.set(r.key, r);
  }
  return m;
})();

function simRow(key: string): SimRow {
  const r = SIM_PARAMS.get(key);
  if (!r) throw new Error(`sim_params.json에 키가 없음: ${key}`);
  return r;
}
export function sValue<T>(key: string): T {
  return simRow(key).value as T;
}
export function sNum(key: string): number {
  const v = simRow(key).value;
  if (typeof v !== "number") throw new Error(`sim_params ${key}: 숫자 value가 아님`);
  return v;
}
export function sRange(key: string): { lo: number; hi: number } {
  const r = simRow(key).range;
  if (!r) throw new Error(`sim_params ${key}: range 없음`);
  return r;
}

// ---------- 타입 ----------
/** materialize JSON의 가구: HouseholdView + 수동검토 완료 뒤 값(4.1절 2단계, PlannerView 쪽 표본) */
export interface MatHousehold extends HouseholdView {
  reentry?: { specId?: string; operatorLowerH?: number };
}

export interface PopulationSpec {
  scenarioId: string;
  seed: string;
  cause: Cause;
  theta: Theta;
  /** 도구에 보이는 등록 가구 수 */
  nRegistered: number;
  nResources: number;
  /** 초점 등급(표준 50건, 5.6절). 없으면 전부 혼합 */
  focusClass?: GenClass | null;
  nFocus?: number;
  /** E1 층화(5.4절): 7등급 각 stratPerClass가구, 나머지는 혼합. focusClass와 함께 쓰지 않는다. 없으면 기존과 같은 결과 */
  stratPerClass?: number;
  db?: EngineDb;
}

export interface GenHousehold {
  view: MatHousehold;
  label: DeviceClass;
  trueSpecId: string;
  /** 신고 시각 기준 진실 잔여 수명(정수 초). L_true_end = tReport + lTrueS (3.8절) */
  lTrueS: number;
  extWorks: boolean[];
  /** 진실 수동검토 지연(정수 초) — 수동검토 가구만 쓰인다 */
  mrDelayS: number;
  /** KR-07 호출 균등값 (u1: 조기 여부, u2: 조기 시각) */
  kr07U: readonly [number, number];
}

export interface GenUnregistered {
  id: string;
  cell: { x: number; y: number };
  label: DeviceClass;
  trueSpecId: string;
  /** 정전 시작 기준 진실 수명(정수 초) */
  lTrueS: number;
  kr07U: readonly [number, number];
}

export interface Population {
  households: GenHousehold[];
  unregistered: GenUnregistered[];
  resources: ResourceView[];
  aptCenter: { x: number; y: number } | null;
}

// ---------- 보조 ----------
/** 누적 가중치 역함수(항목 순서 고정) */
export function pickByU<T>(entries: readonly (readonly [T, number])[], u: number): T {
  let total = 0;
  for (const [, w] of entries) total += w;
  if (!(total > 0)) throw new Error("가중치 합이 0");
  const x = u * total;
  let acc = 0;
  for (const [v, w] of entries) {
    acc += w;
    if (x < acc) return v;
  }
  return entries[entries.length - 1][0];
}

function draws(rng: Rng, k: number): number[] {
  return Array.from({ length: k }, () => rng.uniform());
}

function cellQ(v: number): number {
  const inv = Math.round(1 / sNum("gen.cellStepKm"));
  const r = Math.round(v * inv) / inv;
  return r === 0 ? 0 : r;
}

function between(lo: number, hi: number, u: number): number {
  return lo + (hi - lo) * u;
}

function intBetween(lo: number, hi: number, u: number): number {
  return lo + Math.min(hi - lo, Math.floor(u * (hi - lo + 1)));
}

/** 설정표 선형 보간(진실 설정용, 3.3절 보간 규칙과 같음) */
export function settingRuntimeH(dev: DeviceSpec, setting: number): number {
  const t = [...(dev.settingTable ?? [])].sort((a, b) => a.setting - b.setting);
  if (t.length === 0) return dev.internalH.value;
  if (setting <= t[0].setting) return t[0].runtimeH;
  for (let i = 0; i + 1 < t.length; i++) {
    const a = t[i], b = t[i + 1];
    if (setting <= b.setting) return a.runtimeH + ((b.runtimeH - a.runtimeH) * (setting - a.setting)) / (b.setting - a.setting);
  }
  return t[t.length - 1].runtimeH;
}

/**
 * 진실 본체 가동시간(완충, h) = T_true × k_set × k_age.
 * 설정표가 있는 기기(휴대형 산소)는 진실 설정을 직접 뽑으므로 k_set을 곱하지 않는다(DEVLOG TASK C 결정).
 */
export function trueCapacityH(dev: DeviceSpec, setting: number | null, kSet: number, kAge: number): number {
  const hasTable = (dev.settingTable?.length ?? 0) > 0;
  const base = hasTable && setting != null ? settingRuntimeH(dev, setting) : dev.internalH.value;
  return base * (hasTable ? 1 : kSet) * kAge;
}

function extFor(specId: string, db: EngineDb): ExtSpec | undefined {
  return [...db.ext.values()].filter((e) => e.forSpecIds.includes(specId)).sort((a, b) => (a.extSpecId < b.extSpecId ? -1 : 1))[0];
}

function extCountFor(specId: string): number {
  const m = sValue<Record<string, number>>("gen.extCount");
  return m[specId] ?? m.default;
}

/** 7등급 → 진실 기종 후보와 가중치(인공호흡기는 params gen.ventModelMix, 그 밖은 같은 가중) */
function specCandidates(cls: GenClass, db: EngineDb): [string, number][] {
  const mix = pValue<Record<string, number>>("gen.ventModelMix");
  const base: DeviceClass = cls === "O2_STAT_CYL" ? "O2_STAT" : cls === "VENT_8H_EXT2" ? "VENT_8H" : cls;
  let ids = [...db.devices.values()].filter((d) => d.cls === base && d.continuous).map((d) => d.specId).sort();
  if (cls === "VENT_8H_EXT2") ids = ids.filter((id) => extFor(id, db) != null && extCountFor(id) >= 2);
  if (ids.length === 0) throw new Error(`등급 ${cls}에 맞는 DB 기종 없음`);
  return ids.map((id) => [id, mix[id] ?? 1] as [string, number]);
}

interface ClassChoice { cls: GenClass; specId: string }

function mixedClass(u0: number, u1: number, db: EngineDb): ClassChoice {
  if (u0 < pNum("gen.ventRatio")) {
    const mix = pValue<Record<string, number>>("gen.ventModelMix");
    const specId = pickByU(Object.entries(mix), u1);
    const dev = db.devices.get(specId);
    if (!dev) throw new Error(`gen.ventModelMix 기종이 DB에 없음: ${specId}`);
    return { cls: dev.cls as GenClass, specId };
  }
  const o2 = sValue<Record<string, number>>("gen.o2Mix");
  const cls = pickByU(Object.entries(o2) as [GenClass, number][], u1);
  return { cls, specId: pickByU(specCandidates(cls, db), 0) };
}

function focusClass(cls: GenClass, u1: number, db: EngineDb): ClassChoice {
  return { cls, specId: pickByU(specCandidates(cls, db), u1) };
}

// 가구별 고정 균등값 개수
const K_HH = 21;
const K_BEH = 8;
const H = {
  classA: 0, classB: 1, x: 2, y: 3, detached: 4, floor: 5, mobility: 6, caregiver: 7, age: 8, ageUnknown: 9,
  extOwn: 10, extVerify: 11, cylVerify: 12, unknownModel: 13, startCharge: 14, setting: 15,
  extWorks0: 16, extWorks1: 17, extCharge0: 18, extCharge1: 19, cylH: 20,
} as const;
const B = { tReport: 0, chargeSrc: 1, chargeSrc2: 2, overInput: 3, mrDelay: 4, opLower: 5, kr07a: 6, kr07b: 7 } as const;

interface DeviceDraw {
  choice: ClassChoice;
  cell: { x: number; y: number };
  floor: number;
  mobilityNeed: boolean;
  caregiver: boolean;
  batteryAgeY: number | null;
  ext: { spec: ExtSpec; count: number; verified: boolean } | null;
  cylinder: { count: number; verified: boolean } | null;
  unknownModel: boolean;
  /** 진실 본체 완충 가동시간(h) */
  capH: number;
  startCharge: number;
  extWorks: boolean[];
  /** 정전 시작 기준 진실 수명(h) */
  lFromOutageH: number;
}

function drawDevice(
  u: number[], choice: ClassChoice, spec: PopulationSpec, db: EngineDb, apt: { x: number; y: number } | null, forceExt: boolean, noExt2: boolean,
): DeviceDraw {
  const th = spec.theta;
  const grid = pNum("gen.gridKm");
  const dev = db.devices.get(choice.specId);
  if (!dev) throw new Error(`DB에 없는 기종 ${choice.specId}`);
  let cell: { x: number; y: number };
  if (apt) {
    const r = sNum("gen.aptClusterKm");
    cell = {
      x: cellQ(Math.min(grid, Math.max(0, apt.x + (2 * u[H.x] - 1) * r))),
      y: cellQ(Math.min(grid, Math.max(0, apt.y + (2 * u[H.y] - 1) * r))),
    };
  } else cell = { x: cellQ(u[H.x] * grid), y: cellQ(u[H.y] * grid) };
  const fr = sRange("gen.floorRange");
  const detached = !apt && u[H.detached] < sNum("gen.detachedShare");
  const floor = detached ? fr.lo : intBetween(fr.lo, fr.hi, u[H.floor]);
  const ageR = pRange("gen.batteryAgeY");
  const age = Math.round(between(ageR.lo, ageR.hi, u[H.age]) * 100) / 100;
  const batteryAgeY = u[H.ageUnknown] < th.ageUnknownRate ? null : age;

  const forecast = sValue<string[]>("gen.forecastCauses").includes(spec.cause);
  const sc = pRange("gen.startCharge");
  const scF = pValue<{ forecastH: number }>("gen.startCharge").forecastH;
  const startCharge = forecast ? scF : between(sc.lo, sc.hi, u[H.startCharge]);
  const st = sRange("gen.o2PortTrueSetting");
  const setting = (dev.settingTable?.length ?? 0) > 0 ? intBetween(st.lo, st.hi, u[H.setting]) : null;
  const capH = trueCapacityH(dev, setting, th.kSetTrue, th.kAgeTrue);

  let ext: DeviceDraw["ext"] = null;
  const es = extFor(choice.specId, db);
  if (es && (forceExt || u[H.extOwn] < th.extOwnRate)) {
    const count = extCountFor(choice.specId);
    let verified = forceExt || u[H.extVerify] < th.extVerifyRate;
    if (noExt2 && count >= 2) verified = false; // 초점 VENT_8H 가구가 VENT_8H_EXT2로 바뀌지 않게
    ext = { spec: es, count, verified };
  }
  const extWorks: boolean[] = [];
  let extTrueH = 0;
  if (ext) {
    const pWork = 1 - th.backupFailProb; // sim_params gen.extWorksProb
    for (let k = 0; k < ext.count; k++) {
      const works = u[H.extWorks0 + Math.min(k, 1)] < pWork;
      extWorks.push(works);
      const ch = forecast ? scF : between(sc.lo, sc.hi, u[H.extCharge0 + Math.min(k, 1)]);
      if (works) extTrueH += ext.spec.runtimeH * th.kAgeTrue * ch;
    }
  }
  let cylinder: DeviceDraw["cylinder"] = null;
  let cylTrueH = 0;
  if (choice.cls === "O2_STAT_CYL") {
    const count = sNum("gen.cylinderCount");
    cylinder = { count, verified: u[H.cylVerify] < th.extVerifyRate };
    const cr = CYLINDERS[0].hoursLoPerUnit.range;
    cylTrueH = count * between(cr.lo, cr.hi, u[H.cylH]);
  }
  return {
    choice, cell, floor,
    mobilityNeed: u[H.mobility] < pNum("gen.mobilityNeed"),
    caregiver: u[H.caregiver] < sNum("gen.caregiverRate"),
    batteryAgeY, ext, cylinder,
    unknownModel: u[H.unknownModel] < th.unknownModelRate,
    capH, startCharge, extWorks,
    lFromOutageH: capH * startCharge + extTrueH + cylTrueH,
  };
}

const pad = (n: number, w: number) => String(n).padStart(w, "0");

/**
 * 등록 가구·미등록 가구·자원을 만든다.
 * 스트림: HH(구성·기기 진실), BEHAVIOR(신고 시각·충전 입력·수동검토 지연·재진입 하한 표본·KR-07 호출), RES(자원).
 */
export function generatePopulation(spec: PopulationSpec): Population {
  const db = spec.db ?? DEFAULT_DB;
  const th = spec.theta;
  const N = spec.nRegistered;
  if (!Number.isInteger(N) || N <= 0) throw new Error("nRegistered는 양의 정수");
  const nFocus = spec.focusClass ? (spec.nFocus ?? 0) : 0;
  if (nFocus < 0 || nFocus > N) throw new Error("nFocus 범위 오류");
  const strat = spec.stratPerClass ?? 0;
  if (strat > 0 && (nFocus > 0 || strat * GEN_CLASSES.length > N)) throw new Error("stratPerClass 범위 오류");

  const hhRng = rngFor(spec.seed, spec.scenarioId, "HH");
  const behRng = rngFor(spec.seed, spec.scenarioId, "BEHAVIOR");
  const resRng = rngFor(spec.seed, spec.scenarioId, "RES");
  const grid = pNum("gen.gridKm");

  // 단지 중심(APT_* 원인만 사용, 균등값 2개는 항상 소비)
  const c0 = draws(hhRng, 2);
  const aptR = sNum("gen.aptClusterKm");
  const aptCenter = spec.cause.startsWith("APT_")
    ? { x: cellQ(between(aptR, grid - aptR, c0[0])), y: cellQ(between(aptR, grid - aptR, c0[1])) }
    : null;
  // 초점 가구 위치(순열 앞 nFocus개)
  const perm = hhRng.shuffle(Array.from({ length: N }, (_, i) => i));
  const focusSet = new Set(perm.slice(0, nFocus));
  // 층화 위치: 순열 앞 7×strat개를 등급 순서대로(같은 순열을 쓰므로 균등값 소비는 늘지 않는다)
  const stratOf = new Map<number, GenClass>();
  for (let k = 0; k < strat * GEN_CLASSES.length; k++) stratOf.set(perm[k], GEN_CLASSES[Math.floor(k / strat)]);

  const tOutageS = qT(sNum("sim.tOutageH"));
  const rd = pRange("sim.reportDelayH");
  const md = pRange("sim.mrDelayRangeH");
  const ol = pRange("sim.operatorLowerRangeH");

  const households: GenHousehold[] = [];
  for (let i = 0; i < N; i++) {
    const u = draws(hhRng, K_HH);
    const b = draws(behRng, K_BEH);
    const fc: GenClass | null = focusSet.has(i) && spec.focusClass ? spec.focusClass : (stratOf.get(i) ?? null);
    const choice = fc ? focusClass(fc, u[H.classB], db) : mixedClass(u[H.classA], u[H.classB], db);
    const d = drawDevice(u, choice, spec, db, aptCenter, fc === "VENT_8H_EXT2", fc === "VENT_8H");
    const dev = db.devices.get(choice.specId)!;
    const id = `H${pad(i + 1, 3)}`;

    // ---- BEHAVIOR ----
    const tReportS = tOutageS + qT(between(rd.lo, rd.hi, b[B.tReport]));
    const elapsedH = sToH(tReportS - tOutageS);
    let source: HouseholdView["device"]["charge"]["source"];
    if (b[B.chargeSrc] < th.screenChargeRate) source = "device_screen";
    else source = b[B.chargeSrc2] < sNum("gen.chargeUserShareOfRest") ? "user" : "unknown";
    let pct: number | null = null;
    if (source !== "unknown") {
      const remH = Math.max(0, d.capH * d.startCharge - elapsedH);
      pct = d.capH > 0 ? Math.min(100, Math.max(0, Math.floor((100 * remH) / d.capH))) : 0;
      if (b[B.overInput] < th.overInputProb) pct = sNum("gen.overInputPct");
    }
    const mrDelayS = qT(between(md.lo, md.hi, b[B.mrDelay]));
    const opLowerH = sToH(qT(between(ol.lo, ol.hi, b[B.opLower])));
    const lTrueS = Math.max(0, qT(d.lFromOutageH) - (tReportS - tOutageS));

    const view: MatHousehold = {
      id, pseudonym: `H-${pad(i + 1, 3)}`,
      cell: d.cell, floor: d.floor, mobilityNeed: d.mobilityNeed, caregiver: d.caregiver,
      tReport: sToH(tReportS), lEndPrev: null,
      device: {
        specId: d.unknownModel ? null : choice.specId,
        specBy: d.unknownModel ? null : "db_exact",
        batteryAgeY: d.batteryAgeY,
        charge: { value: pct, source },
      },
      ext: d.ext ? [{
        extSpecId: d.ext.spec.extSpecId, declaredCount: d.ext.count,
        opVerified: d.ext.verified ? { count: d.ext.count, chargeConfirmed: null, extAgeY: null, auditId: `sim-ext-${id}` } : null,
      }] : [],
    };
    if (d.cylinder) {
      view.cylinder = {
        declared: true,
        opVerified: d.cylinder.verified
          ? { count: d.cylinder.count, hoursLo: pNum("lb.cyl.hoursLoPerUnitH") * d.cylinder.count, auditId: `sim-cyl-${id}` }
          : null,
      };
    }
    // 수동검토 재진입 값(4.1절 2단계): DB 연속 기기면 사양 기반, DB 밖·비연속이면 operatorLowerH 표본
    if (d.unknownModel) view.reentry = dev.continuous ? { specId: choice.specId } : { operatorLowerH: opLowerH };
    else if (!dev.continuous) view.reentry = { operatorLowerH: opLowerH };

    households.push({
      view, label: classOf(choice.specId, d.ext?.verified ? d.ext.count : 0, d.cylinder != null, db),
      trueSpecId: choice.specId, lTrueS, extWorks: d.extWorks, mrDelayS, kr07U: [b[B.kr07a], b[B.kr07b]],
    });
  }

  // ---- 미등록 가구(명단 밖, 도구에 안 보임): 혼합 구성, 신고 없음 ----
  const r = th.unregisteredRate;
  const nU = r > 0 ? Math.round((N * r) / (1 - r)) : 0; // sim_params gen.unregisteredCount
  const unregistered: GenUnregistered[] = [];
  for (let i = 0; i < nU; i++) {
    const u = draws(hhRng, K_HH);
    const b = draws(behRng, K_BEH);
    const choice = mixedClass(u[H.classA], u[H.classB], db);
    const d = drawDevice(u, choice, spec, db, aptCenter, false, false);
    unregistered.push({
      id: `U${pad(i + 1, 3)}`, cell: d.cell,
      label: classOf(choice.specId, d.ext?.verified ? d.ext.count : 0, d.cylinder != null, db),
      trueSpecId: choice.specId, lTrueS: qT(d.lFromOutageH), kr07U: [b[B.kr07a], b[B.kr07b]],
    });
  }

  // ---- 자원(모두 mock) ----
  const kindMix = Object.entries(sValue<Record<string, number>>("gen.resourceKindMix")) as [ResourceKind, number][];
  const resources: ResourceView[] = [];
  for (let j = 0; j < spec.nResources; j++) {
    const u = draws(resRng, 3);
    const kind = pickByU(kindMix, u[0]);
    resources.push(makeResource(kind, `R${pad(j + 1, 2)}`, { x: cellQ(u[1] * grid), y: cellQ(u[2] * grid) }));
  }
  return { households, unregistered, resources, aptCenter };
}
