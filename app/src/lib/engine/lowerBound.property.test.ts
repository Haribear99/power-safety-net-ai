// 속성 시험 I2·I3·I4·I5 중 엔진(하한 L)에 해당하는 것 (spec.md 9절). 불변식마다 10,000회, 시드 고정.
import { describe, expect, it } from "vitest";
import type { DeviceSpec, ExtSpec, HouseholdView } from "../domain/types";
import { buildDb, computeLowerBoundDetail, DEFAULT_DB, type EngineDb } from "./lowerBound";
import { qT } from "./quantize";
import { makeHH } from "./test-fixtures";
import { Gen, PROPERTY_RUNS } from "./test-rng";

const CONT_SPECS = [...DEFAULT_DB.devices.values()].filter((d) => d.continuous).map((d) => d.specId);
const EXT_IDS = [...DEFAULT_DB.ext.keys()];

type OpItems = Pick<HouseholdView, "ext" | "cylinder"> & { specId: string; specBy: HouseholdView["device"]["specBy"];
  batteryAgeY: number | null; opSetting?: number };

/** 운영자 확인 항목(사양 + VERIFY_*)만 무작위 */
function randomOpItems(g: Gen, specs = CONT_SPECS, extIds = EXT_IDS): OpItems {
  const nExt = g.int(0, 2);
  const ext: HouseholdView["ext"] = [];
  for (let i = 0; i < nExt; i++) {
    const declaredCount = g.int(0, 3);
    const verified = g.bool(0.6) && declaredCount > 0;
    ext.push({
      extSpecId: g.bool(0.9) ? g.pick(extIds) : null,
      declaredCount,
      opVerified: verified
        ? { count: g.int(0, declaredCount), chargeConfirmed: g.bool() ? "device_screen" : null,
            extAgeY: g.maybe(0.5, () => g.float(0, 4)), auditId: `A-${i}` }
        : null,
    });
  }
  const cylCount = g.int(1, 3);
  return {
    specId: g.pick(specs),
    specBy: g.pick(["db_exact", "operator", "ai_label_user_confirmed", null] as const),
    batteryAgeY: g.maybe(0.6, () => g.float(0, 4)),
    opSetting: g.bool(0.3) ? g.int(0, 7) : undefined,
    ext,
    cylinder: g.bool(0.3)
      ? { declared: true, opVerified: g.bool(0.6) ? { count: cylCount, hoursLo: g.float(0, 10 * cylCount), auditId: "C" } : null }
      : undefined,
  };
}

/** 이용자(가구) 입력만 무작위: 충전량·출처, 화면 남은 시간, setting(user), 신고 개수, 이용자 연식 */
function withRandomUserInputs(g: Gen, op: OpItems): HouseholdView {
  const source = g.pick(["device_screen", "user", "unknown"] as const);
  const userSetting = op.opSetting === undefined && g.bool(0.5);
  return makeHH({
    tReport: g.float(0, 2),
    device: {
      specId: op.specId, specBy: op.specBy, batteryAgeY: op.batteryAgeY,
      charge: { value: source === "unknown" ? null : g.int(-10, 130), source },
      screenRemainingH: g.bool(0.3) ? g.float(0, 20) : undefined,
      userAgeY: g.maybe(0.5, () => g.float(0, 10)),
      ...(op.opSetting !== undefined ? { setting: op.opSetting, settingSource: "operator" as const }
        : userSetting ? { setting: g.int(0, 7), settingSource: "user" as const } : {}),
    },
    // 신고 개수는 이용자 입력: 확인 개수 이상으로만 늘리거나 확인 없는 항목은 자유롭게
    ext: op.ext.map((e) => ({ ...e, declaredCount: e.opVerified ? e.opVerified.count + g.int(0, 3) : g.int(0, 5) })),
    cylinder: op.cylinder,
  });
}

describe("I2: 이용자 입력은 L_cap(사양 + 운영자 확인, c=1, f_age=0.9)을 넘지 못한다", () => {
  it("무작위 이용자 입력 10,000회: qT(L) ≤ qT(L_cap), L_cap은 이용자 입력과 무관", () => {
    const g = new Gen(20261017);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const op = randomOpItems(g);
      const a = computeLowerBoundDetail(withRandomUserInputs(g, op));
      const b = computeLowerBoundDetail(withRandomUserInputs(g, op));
      expect(a.Ls!).toBeLessThanOrEqual(a.capS!);
      expect(b.Ls!).toBeLessThanOrEqual(b.capS!);
      // L_cap에는 이용자 입력 필드가 들어가지 않는다(동어반복 아님): 같은 운영자 항목이면 같은 cap.
      // 단 외장 신고 개수가 바뀌면 확인 개수 ≤ 신고 개수 검사가 같으므로 cap도 같다.
      expect(a.capS).toBe(b.capS);
    }
  });

  it("정전 중 재신고 시퀀스 10,000회: POWER_SUPPLIED 없으면 L_end 단조 비증가", () => {
    const g = new Gen(7);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const op = randomOpItems(g);
      let prevEndH: number | null = null;
      let t = 0;
      let prevEndS: number | null = null;
      const steps = g.int(2, 5);
      for (let k = 0; k < steps; k++) {
        t += g.float(0, 1.5);
        const hh = withRandomUserInputs(g, op);
        hh.tReport = t;
        hh.lEndPrev = prevEndH;
        const d = computeLowerBoundDetail(hh);
        if (prevEndS != null) expect(d.endS!).toBeLessThanOrEqual(prevEndS);
        prevEndS = d.endS;
        prevEndH = d.lb.endT;
      }
    }
  });

  it("이용자 입력 연식을 무작위로 바꿔도 L 불변(USER_AGE_IGNORED)", () => {
    const g = new Gen(11);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const hh = withRandomUserInputs(g, randomOpItems(g));
      const base = computeLowerBoundDetail({ ...hh, device: { ...hh.device, userAgeY: null } });
      const alt = computeLowerBoundDetail({ ...hh, device: { ...hh.device, userAgeY: g.float(0, 30) } });
      expect(alt.Ls).toBe(base.Ls);
      expect(alt.lb.flags).toContain("USER_AGE_IGNORED");
    }
  });

  it("ai_label_user_confirmed: L ≤ 이웃 기종 각각의 L 최솟값, 미끼 쌍에서 더 긴 기종의 L이 나오지 않는다", () => {
    // 시험용 미끼 DB: Astral 100/150, LTV 1105/1150 (실제 사양 DB가 아니라 혼동 쌍 구조만 재현한 고정 데이터)
    const base = DEFAULT_DB.devices.get("ASTRAL150")!;
    const mk = (specId: string, key: string, h: number): DeviceSpec => ({
      ...base, specId, model: specId, matchKeys: [key], internalH: { ...base.internalH, value: h },
    });
    const decoyDb: EngineDb = buildDb(
      [mk("ASTRAL100", "ASTRAL100", 6), mk("ASTRAL150", "ASTRAL150", 8), mk("LTV1105", "LTV1105", 3), mk("LTV1150", "LTV1150", 1)],
      [] as ExtSpec[],
    );
    const pairs: Record<string, string[]> = { ASTRAL100: ["ASTRAL100", "ASTRAL150"], ASTRAL150: ["ASTRAL100", "ASTRAL150"],
      LTV1105: ["LTV1105", "LTV1150"], LTV1150: ["LTV1105", "LTV1150"] };
    const g = new Gen(13);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const op = randomOpItems(g, Object.keys(pairs), []);
      op.ext = [];
      const hh = withRandomUserInputs(g, { ...op, specBy: "ai_label_user_confirmed" });
      const ai = computeLowerBoundDetail(hh, decoyDb);
      const each = pairs[op.specId].map((s) =>
        computeLowerBoundDetail({ ...hh, device: { ...hh.device, specId: s, specBy: "db_exact" } }, decoyDb));
      expect(ai.Ls!).toBeLessThanOrEqual(Math.min(...each.map((e) => e.Ls!)));
      expect(ai.capS!).toBeLessThanOrEqual(Math.min(...each.map((e) => e.capS!)));
      expect(ai.lb.flags).toContain("MODEL_AI_UNCONFIRMED");
    }
  });
});

describe("I3: 신고만 된 외장·실린더는 L에 들어가지 않는다", () => {
  it("운영자 확인 없는 외장·실린더를 추가·삭제해도 L 불변 (10,000회)", () => {
    const g = new Gen(17);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const hh = withRandomUserInputs(g, randomOpItems(g));
      const before = computeLowerBoundDetail(hh);
      const added: HouseholdView = {
        ...hh,
        ext: [...hh.ext, { extSpecId: g.pick([...EXT_IDS, null]), declaredCount: g.int(1, 5), opVerified: null }],
        cylinder: hh.cylinder?.opVerified ? hh.cylinder : { declared: true, opVerified: null },
      };
      const removed: HouseholdView = { ...hh, ext: hh.ext.filter((e) => e.opVerified != null), cylinder: hh.cylinder?.opVerified ? hh.cylinder : undefined };
      expect(computeLowerBoundDetail(added).Ls).toBe(before.Ls);
      expect(computeLowerBoundDetail(removed).Ls).toBe(before.Ls);
    }
  });

  it("외장 충전 미확인이면 외장 항 ≤ count × runtimeH × f_age_ext × 1/2, 외장 연식 미확인이면 본체 연식과 무관(7/10)", () => {
    const g = new Gen(19);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const specId = g.pick(["TRILOGY100", "TRILOGY_EVO", "ASTRAL150", "INOGEN_G5"]);
      const ext = [...DEFAULT_DB.ext.values()].find((e) => e.forSpecIds.includes(specId))!;
      const count = g.int(1, 3);
      const extAgeY = g.maybe(0.5, () => g.float(0, 4));
      const mkHH = (bodyAge: number | null) => makeHH({
        device: { specId, batteryAgeY: bodyAge, charge: { value: g.int(0, 100), source: "user" } },
        ext: [{ extSpecId: ext.extSpecId, declaredCount: count, opVerified: { count, chargeConfirmed: null, extAgeY, auditId: "A" } }],
      });
      const h1 = mkHH(g.maybe(0.8, () => g.float(0, 4)));
      const noExt = computeLowerBoundDetail({ ...h1, ext: [] }).Ls!;
      const extTerm = computeLowerBoundDetail(h1).Ls! - noExt;
      const fa = extAgeY == null ? [7, 10] : extAgeY < 1 ? [9, 10] : extAgeY < 2 ? [8, 10] : [7, 10];
      expect(extTerm).toBe(Math.floor((count * qT(ext.runtimeH) * fa[0]) / (fa[1] * 2)));
      expect(computeLowerBoundDetail(h1).lb.flags).toContain("EXT_CHARGE_UNKNOWN");
    }
  });
});

describe("I4: DB 밖 기종·비연속 기기는 운영자 하한 없으면 자동 계산 0", () => {
  it("specId null·DB 밖·continuous=false + operatorLowerH 없음 → MANUAL_REVIEW, L = null (10,000회)", () => {
    const g = new Gen(23);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const op = randomOpItems(g);
      const hh = withRandomUserInputs(g, op);
      hh.device.specId = g.pick([null, "SUCTION_X", "COUGH_E70", "ASTRAL-150", "trilogy100"]);
      hh.device.specBy = g.pick(["db_exact", "ai_label_user_confirmed", "operator", null] as const);
      const d = computeLowerBoundDetail(hh);
      expect(d.lb.status).toBe("MANUAL_REVIEW");
      expect(d.Ls).toBeNull();
      expect(d.lb.hours).toBeNull();
    }
  });
});

describe("I5: 등급 이름은 L에 들어가지 않는다", () => {
  it("L·전력·커넥터가 같고 cls만 바꾼 DB에서 L·L_cap·L_end 동일 (10,000회)", () => {
    const classes = ["O2_STAT", "O2_STAT_CYL", "VENT_1H", "VENT_3H", "O2_PORT", "VENT_8H", "VENT_8H_EXT2", "INTERMITTENT", "UNKNOWN"] as const;
    const g = new Gen(29);
    for (let i = 0; i < PROPERTY_RUNS; i++) {
      const hh = withRandomUserInputs(g, randomOpItems(g));
      const relabeled = buildDb(
        [...DEFAULT_DB.devices.values()].map((d) => ({ ...d, cls: g.pick(classes) })),
        [...DEFAULT_DB.ext.values()],
      );
      const a = computeLowerBoundDetail(hh);
      const b = computeLowerBoundDetail(hh, relabeled);
      expect([b.Ls, b.capS, b.endS]).toEqual([a.Ls, a.capS, a.endS]);
    }
  });
});
