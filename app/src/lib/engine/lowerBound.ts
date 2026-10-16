// 하한 L (spec.md 3.2절, 3.9절 L_end). 결정 경로 파일 — 정수 초·정수 유리수 계수만, 초월함수 금지.
// 보수 계수는 노후(f_age)·충전(c) 두 개만 한 번씩 곱한다. 이용자 입력은 L_cap을 넘지 못한다(I2).
// 신고만 된 외장·실린더는 0(I3). DB 밖 기종·비연속 기기는 operatorLowerH 없으면 MANUAL_REVIEW(I4).
// 기기 등급(cls)은 읽지 않는다(I5).
import { z } from "zod";
import deviceRaw from "../../../../spec/device_db.json";
import extRaw from "../../../../spec/ext_db.json";
import type { DeviceSpec, ExtSpec, HouseholdView, LowerBound, LowerBoundFlag, Prov } from "../domain/types";
import { pNum, pRatio } from "./params";
import { floorDiv, mulDivFloor, qT, sToH } from "./quantize";

// ---------- DB 로드 ----------
const ProvSchema = z.object({
  type: z.enum(["spec", "measured", "event", "policy", "inferred", "assumed", "calibrated", "operator"]),
  sourceIds: z.array(z.string()),
  note: z.string().optional(),
});
const RangeSchema = z.object({ lo: z.number(), hi: z.number() });
const ConnectorSchema = z.enum(["AC220", "DC12", "VENDOR_EXT", "O2_FLOW"]);
const DeviceSchema = z.object({
  specId: z.string(), manufacturer: z.string(), model: z.string(),
  matchKeys: z.array(z.string()).min(1),
  cls: z.enum(["O2_STAT", "O2_STAT_CYL", "VENT_1H", "VENT_3H", "O2_PORT", "VENT_8H", "VENT_8H_EXT2", "INTERMITTENT", "UNKNOWN"]),
  continuous: z.boolean(),
  internalH: z.object({ value: z.number().nonnegative(), condition: z.string(), prov: ProvSchema }),
  settingTable: z.array(z.object({ setting: z.number().int(), runtimeH: z.number().nonnegative() })).min(2).optional(),
  drawW: z.object({ value: RangeSchema, prov: ProvSchema }),
  connectors: z.array(ConnectorSchema).min(1),
  inverterSensitive: z.boolean(),
});
const CylinderSchema = z.object({
  specId: z.string(), cls: z.literal("O2_STAT_CYL"),
  hoursLoPerUnit: z.object({ value: z.number().positive(), range: RangeSchema, condition: z.string(), prov: ProvSchema }),
  drawW: z.object({ value: RangeSchema, prov: ProvSchema }),
  connectors: z.array(ConnectorSchema),
});
const ExtSchema = z.object({ extSpecId: z.string(), forSpecIds: z.array(z.string()).min(1), runtimeH: z.number().positive(), prov: ProvSchema });

export interface EngineDb {
  devices: ReadonlyMap<string, DeviceSpec>;
  ext: ReadonlyMap<string, ExtSpec>;
}

export function buildDb(devices: DeviceSpec[], ext: ExtSpec[]): EngineDb {
  const d = new Map<string, DeviceSpec>();
  for (const x of devices) {
    if (d.has(x.specId)) throw new Error(`device_db 중복 specId ${x.specId}`);
    d.set(x.specId, x);
  }
  const e = new Map<string, ExtSpec>();
  for (const x of ext) {
    if (e.has(x.extSpecId)) throw new Error(`ext_db 중복 extSpecId ${x.extSpecId}`);
    e.set(x.extSpecId, x);
  }
  return { devices: d, ext: e };
}

const parsedDevices = z.object({ devices: z.array(DeviceSchema), cylinders: z.array(CylinderSchema) }).parse(deviceRaw);
export const CYLINDERS = parsedDevices.cylinders;
export const DEFAULT_DB: EngineDb = buildDb(
  parsedDevices.devices as DeviceSpec[],
  z.object({ ext: z.array(ExtSchema) }).parse(extRaw).ext as ExtSpec[],
);

// ---------- 정규화·이웃 기종 ----------
/** 정규화(대문자, 공백·하이픈 제거) — 3장 DeviceSpec.matchKeys */
export function normalizeKey(s: string): string {
  return s.toUpperCase().replace(/[\s-]/g, "");
}

export function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** 판독 일치 기종 ∪ matchKey 편집거리 ≤ 2인 DB 연속 기기(3.2절). 자기 자신 포함, specId 사전순 */
export function neighborSpecs(dev: DeviceSpec, db: EngineDb): DeviceSpec[] {
  const maxD = pNum("lb.neighbor.maxEditDistance");
  const keys = dev.matchKeys.map(normalizeKey);
  const out: DeviceSpec[] = [];
  for (const d of db.devices.values()) {
    if (d.specId !== dev.specId && !d.continuous) continue; // 비연속 이웃은 T_spec이 정의되지 않음(DEVLOG)
    const near = d.specId === dev.specId ||
      d.matchKeys.some((k) => keys.some((r) => editDistance(normalizeKey(k), r) <= maxD));
    if (near) out.push(d);
  }
  return out.sort((a, b) => (a.specId < b.specId ? -1 : a.specId > b.specId ? 1 : 0));
}

// ---------- 사양 시간 ----------
function maxRuntimeS(d: DeviceSpec): number {
  const hs = d.settingTable ? d.settingTable.map((r) => r.runtimeH) : [d.internalH.value];
  return Math.max(...hs.map(qT));
}
function minRuntimeS(d: DeviceSpec): number {
  const hs = d.settingTable ? d.settingTable.map((r) => r.runtimeH) : [d.internalH.value];
  return Math.min(...hs.map(qT));
}

/** 운영자 확인 설정의 선형 보간(정수 초, floor). 표 범위 밖이면 null → min(runtimeH) */
function interpSettingS(d: DeviceSpec, setting: number): number | null {
  const t = [...(d.settingTable ?? [])].sort((a, b) => a.setting - b.setting);
  if (!Number.isInteger(setting) || t.length < 2) return null;
  if (setting < t[0].setting || setting > t[t.length - 1].setting) return null;
  for (let i = 0; i + 1 < t.length; i++) {
    const a = t[i], b = t[i + 1];
    if (setting >= a.setting && setting <= b.setting) {
      const sa = qT(a.runtimeH), sb = qT(b.runtimeH), dx = b.setting - a.setting;
      return floorDiv(sa * dx + (sb - sa) * (setting - a.setting), dx);
    }
  }
  return null;
}

/** 한 기종의 T_spec(초)과 설정 표지 */
function tSpecS(d: DeviceSpec, hh: HouseholdView): { s: number; userMin: boolean } {
  if (!d.settingTable) return { s: qT(d.internalH.value), userMin: false };
  const { setting, settingSource } = hh.device;
  if (setting != null && settingSource === "operator") {
    const v = interpSettingS(d, setting);
    if (v != null) return { s: v, userMin: false };
  }
  return { s: minRuntimeS(d), userMin: setting != null && settingSource !== "operator" };
}

function ageFactor(ageY: number | null): readonly [number, number] {
  if (ageY == null) return pRatio("lb.fAge.default");
  if (ageY < pNum("lb.ageBand.edge1Y")) return pRatio("lb.fAge.lt1");
  if (ageY < pNum("lb.ageBand.edge2Y")) return pRatio("lb.fAge.lt2");
  return pRatio("lb.fAge.default");
}

const OP: Prov = { type: "operator", sourceIds: [] };

export interface LowerBoundDetail {
  lb: LowerBound;
  /** 정수 초. MANUAL_REVIEW면 null */
  Ls: number | null;
  capS: number | null;
  /** L_end 정수 초(절대 모의 시각) */
  endS: number | null;
}

/**
 * 하한 L 계산 (3.2절) + L_end (3.9절).
 * 재신고 규칙: hh.lEndPrev != null이면 L_end = min(lEndPrev, tReport + L).
 * POWER_SUPPLIED 뒤 첫 신고는 호출자가 lEndPrev를 null로 넘겨 표현한다.
 */
export function computeLowerBoundDetail(hh: HouseholdView, db: EngineDb = DEFAULT_DB): LowerBoundDetail {
  const flags: LowerBoundFlag[] = [];
  const terms: LowerBound["terms"] = [];
  const addFlag = (f: LowerBoundFlag) => { if (!flags.includes(f)) flags.push(f); };
  if (hh.device.userAgeY != null) addFlag("USER_AGE_IGNORED");

  const dev = hh.device.specId != null ? db.devices.get(hh.device.specId) : undefined;
  const tReportS = qT(hh.tReport);
  const finish = (Ls: number, capS: number): LowerBoundDetail => {
    if (Ls > capS) throw new Error(`I2 위반: qT(L)=${Ls} > qT(L_cap)=${capS} (${hh.id})`);
    let endS = tReportS + Ls;
    if (hh.lEndPrev != null) endS = Math.min(qT(hh.lEndPrev), endS);
    return {
      lb: { hours: sToH(Ls), endT: sToH(endS), status: "AUTO", capH: sToH(capS), terms, flags },
      Ls, capS, endS,
    };
  };

  // I4: DB 밖 기종 또는 비연속 기기
  if (!dev || !dev.continuous) {
    const op = hh.device.operatorLowerH;
    if (op && Number.isFinite(op.hours) && op.hours >= 0) {
      addFlag("OPERATOR_LOWER");
      const s = qT(op.hours);
      terms.push({ label: "운영자 입력 보수 하한(수동검토 완료)", hours: sToH(s), prov: { ...OP, note: op.basis } });
      return finish(s, s);
    }
    return { lb: { hours: null, endT: null, status: "MANUAL_REVIEW", capH: null, terms, flags }, Ls: null, capS: null, endS: null };
  }

  // T_spec과 L_cap 첫 항
  const aiLabel = hh.device.specBy === "ai_label_user_confirmed";
  const candidates = aiLabel ? neighborSpecs(dev, db) : [dev];
  let tS = Infinity, capBaseS = Infinity, userMin = false;
  for (const c of candidates) {
    const t = tSpecS(c, hh);
    if (t.s < tS) tS = t.s;
    userMin = userMin || t.userMin;
    capBaseS = Math.min(capBaseS, maxRuntimeS(c));
  }
  if (userMin) addFlag("SETTING_USER_MIN");
  if (aiLabel) addFlag("MODEL_AI_UNCONFIRMED");

  // 노후: 운영자 VERIFY_AGE 값만
  const age = hh.device.batteryAgeY;
  if (age == null) addFlag("AGE_UNKNOWN");
  const fa = ageFactor(age);

  // 충전: 정수 퍼센트 0~100
  const ch = hh.device.charge;
  let cNum: number, cDen: number, cLabel: string;
  if (ch.source === "unknown" || ch.value == null || !Number.isFinite(ch.value)) {
    [cNum, cDen] = pRatio("lb.charge.unknown");
    addFlag("CHARGE_UNKNOWN");
    cLabel = `${cNum}/${cDen}(모름)`;
  } else {
    const pct = Math.min(100, Math.max(0, Math.floor(ch.value)));
    const [un, ud] = pRatio("lb.charge.userFactor");
    cNum = pct * un;
    cDen = 100 * ud;
    addFlag("USER_INPUT_DISCOUNTED");
    cLabel = `${pct}%×${un}/${ud}`;
  }
  let devS = mulDivFloor(tS, [fa[0], cNum], [fa[1], cDen]);
  const devProv: Prov = aiLabel
    ? { type: "inferred", sourceIds: candidates.flatMap((c) => c.internalH.prov.sourceIds), note: "AI 판독 기종 미확인 · 이웃 기종 최소값" }
    : dev.internalH.prov;
  terms.push({ label: `기기 ${sToH(tS)}h × 노후 ${fa[0]}/${fa[1]} × 충전 ${cLabel}`, hours: sToH(devS), prov: devProv });

  const scr = hh.device.screenRemainingH;
  if (scr != null && Number.isFinite(scr)) {
    const sS = qT(Math.max(0, scr));
    if (sS < devS) {
      devS = sS;
      addFlag("SCREEN_CAPPED");
      terms[terms.length - 1] = { ...terms[terms.length - 1], label: `기기 화면 남은 시간 ${sToH(sS)}h로 제한`, hours: sToH(devS) };
    }
  }

  // 외장: 운영자 확인분만(I3)
  const [capN, capD] = pRatio("lb.cap.factor");
  let extS = 0, extCapS = 0;
  for (const e of hh.ext) {
    const spec = e.extSpecId != null ? db.ext.get(e.extSpecId) : undefined;
    const v = e.opVerified;
    const valid = v != null && spec != null && hh.device.specId != null && spec.forSpecIds.includes(hh.device.specId) &&
      Number.isInteger(v.count) && v.count >= 0 && v.count <= e.declaredCount;
    if (!valid || !v || !spec) {
      if (e.declaredCount > 0) {
        addFlag("EXT_UNVERIFIED_ZERO");
        terms.push({ label: `신고 외장 ${e.declaredCount}개(운영자 확인 전) → 0시간`, hours: 0, prov: { type: "assumed", sourceIds: [], note: "I3" } });
      }
      continue;
    }
    const cExt = v.chargeConfirmed === "device_screen" ? pRatio("lb.ext.chargeConfirmed") : pRatio("lb.ext.chargeUnknown");
    if (v.chargeConfirmed !== "device_screen") addFlag("EXT_CHARGE_UNKNOWN");
    const faExt = v.extAgeY != null ? ageFactor(v.extAgeY) : pRatio("lb.ext.ageUnknown");
    const rS = qT(spec.runtimeH);
    const termS = mulDivFloor(v.count * rS, [faExt[0], cExt[0]], [faExt[1], cExt[1]]);
    extS += termS;
    extCapS += mulDivFloor(v.count * rS, [capN, cExt[0]], [capD, cExt[1]]);
    terms.push({
      label: `확인 외장 ${spec.runtimeH}h × ${v.count}개 × 노후 ${faExt[0]}/${faExt[1]} × 충전 ${cExt[0]}/${cExt[1]}`,
      hours: sToH(termS), prov: { ...spec.prov, note: `운영자 확인 ${v.auditId}` },
    });
    if (v.count < e.declaredCount) {
      addFlag("EXT_UNVERIFIED_ZERO");
      terms.push({ label: `미확인 외장 ${e.declaredCount - v.count}개 → 0시간`, hours: 0, prov: { type: "assumed", sourceIds: [], note: "I3" } });
    }
  }

  // 실린더: 운영자 확인분만, hoursLo ≤ 10h × count
  let cylS = 0;
  const cyl = hh.cylinder;
  if (cyl?.declared) {
    const v = cyl.opVerified;
    const perUnit = pNum("lb.cyl.hoursLoPerUnitH");
    if (v && Number.isInteger(v.count) && v.count >= 1 && Number.isFinite(v.hoursLo) && v.hoursLo >= 0 &&
        qT(v.hoursLo) <= qT(perUnit) * v.count) {
      cylS = qT(v.hoursLo);
      terms.push({ label: `확인 실린더 ${v.count}개 하한`, hours: sToH(cylS), prov: { ...OP, note: `운영자 확인 ${v.auditId}` } });
    } else {
      terms.push({ label: "신고 실린더(운영자 확인 전) → 0시간", hours: 0, prov: { type: "assumed", sourceIds: [], note: "I3" } });
    }
  }

  const Ls = devS + extS + cylS;
  const capS = mulDivFloor(capBaseS, [capN], [capD]) + extCapS + cylS;
  return finish(Ls, capS);
}

export function computeLowerBound(hh: HouseholdView, db: EngineDb = DEFAULT_DB): LowerBound {
  return computeLowerBoundDetail(hh, db).lb;
}

/** 재신고 단조 규칙(3.9절): L_end = min(lEndPrev, tReport_new + L_new). powerSupplied면 min 없이 새로 */
export function reportLEndS(prevEndS: number | null, tReportS: number, Ls: number, powerSuppliedSincePrev: boolean): number {
  const fresh = tReportS + Ls;
  if (prevEndS == null || powerSuppliedSincePrev) return fresh;
  return Math.min(prevEndS, fresh);
}
