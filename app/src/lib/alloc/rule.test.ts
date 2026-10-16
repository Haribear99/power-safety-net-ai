// RULE·기준선 단위 시험(4.1·4.2·4.3절, 1.4절 재계산). 숫자는 명세 식으로 손계산하거나 엔진 기본 함수로만 다시 계산한다.
import { arrivalLimitS } from "../engine/margin";
import { describe, expect, it } from "vitest";
import { auditEntryRuleSchema } from "../domain/audit";
import type { HouseholdView, PlannerView } from "../domain/types";
import { makeResource } from "../engine/arrival";
import { computeLowerBoundDetail } from "../engine/lowerBound";
import { qT, sToH } from "../engine/quantize";
import { makeHH } from "../engine/test-fixtures";
import { POLICY_CFGS, kr07CallS, noneBaseline, oracleInfo, runPolicy } from "./baselines";
import { buildCtx, filterReport } from "./feasible";
import { holdExpiredEntries, judgeNeed } from "./need";
import { fmtH, placeholders, renderReason } from "./reasons";
import { allocate, nextState, recheckApproved, rule, unassignedIds, type AllocRow } from "./rule";
import { FLAT, view } from "./test-scenario";

const opts = { travel: FLAT };
const fastPrep = { prepH: { lo: 0.1, hi: 0.2 } };

/** TRILOGY100, 연식 0.5년(9/10), 기기 화면 100% → L = 3 × 0.9 × 0.9 = 2.43h = 8748s */
type HHOver = Partial<Omit<HouseholdView, "device">> & { device?: Partial<HouseholdView["device"]> };
function hhLong(id: string, over: HHOver = {}): HouseholdView {
  return makeHH({ id, pseudonym: id, ...over, device: { batteryAgeY: 0.5, charge: { value: 100, source: "device_screen" }, ...(over.device ?? {}) } });
}
/** TRILOGY100, 연식·충전 모름 → L = 3 × 0.7 × 0.5 = 1.05h = 3780s */
function hhShort(id: string, over: HHOver = {}): HouseholdView {
  return makeHH({ id, pseudonym: id, ...over });
}
const row = (rows: AllocRow[], id: string) => rows.find((r) => r.rec.householdId === id)!;

describe("하한·도착 손계산 고정점", () => {
  it("L과 도착 A", () => {
    expect(computeLowerBoundDetail(hhLong("H")).Ls).toBe(8748);
    expect(computeLowerBoundDetail(hhShort("H")).Ls).toBe(3780);
    const v = view({ now: 0.5, households: [hhLong("H")], resources: [makeResource("ESS_L", "R", { x: 2.5, y: 0 }, fastPrep)] });
    const ctx = buildCtx(v, opts);
    // A = 720 + floor(2500·3600/25000) = 720 + 360
    expect(filterReport(ctx, ctx.infos[0], v.resources[0]).aS).toBe(1080);
  });
});

describe("RULE 5단계: PROPOSE_ASSIGN", () => {
  const v = view({
    now: 0.5, households: [hhLong("H-1")],
    resources: [
      makeResource("ESS_S", "R-S", { x: 2.5, y: 0 }, fastPrep),
      makeResource("ESS_L", "R-L", { x: 2.5, y: 0 }, fastPrep),
      makeResource("MOBILE_GEN", "R-G", { x: 2.5, y: 0 }, fastPrep),
    ],
  });
  const res = rule(v, opts);
  const r = res.rows[0];

  it("에너지 미달(ESS_S)은 빼고, 가능 자원 중 낭비 최소(ESS_L)를 준다", () => {
    expect(r.rec.lane).toBe("PROPOSE_ASSIGN");
    expect(r.rec.resourceId).toBe("R-L");
    expect(r.status).toBe("PROPOSED");
    const ctx = buildCtx(v, opts);
    expect(filterReport(ctx, ctx.infos[0], v.resources[0]).energy).toBe(false);
  });
  it("slack = floor(0.8·L_rem) − A_min, tier 0 (L_end < R90_end)", () => {
    // L_rem = 8748 − 1800 = 6948 → floor(6948·4/5) = 5558, A_min = 1080
    expect(r.slackS).toBe(5558 - 1080);
    expect(r.rec.tier).toBe(0);
    expect(r.rec.etaH).toBe(sToH(1800 + 1080));
  });
  it("근거 문장 숫자 = 결정 레코드 숫자", () => {
    expect(r.rec.reason.templateId).toBe("R-ASSIGN");
    const p = r.rec.reason.params;
    expect(p.s).toBe(fmtH(r.slackS as number));
    expect(p.A).toBe(fmtH(r.aS as number));
    expect(p.L).toBe(fmtH(8748 - 1800));
    expect(p.L08).toBe(fmtH(5558));
    expect(p.R80).toBe(fmtH(qT(v.restoration.p80) - 1800));
    expect(p.R90).toBe(fmtH(qT(v.restoration.p90) - 1800));
    expect(p.mlo).toBe(fmtH(qT((r.rec.marginH as { lo: number }).lo)));
    expect(p.W).toBe(1800);
    expect(p.w).toBe(60);
    expect(p.conn).toBe("AC220+DC12");
    const text = renderReason(r.rec.reason as never);
    for (const k of placeholders("R-ASSIGN")) expect(text).toContain(String(p[k]));
  });
  it("여유는 범위(I8): [L_end − min(R90, A*), L_end − min(R10, A*)]", () => {
    const aStar = 1800 + 1080;
    expect(r.rec.marginH).toEqual({ lo: sToH(8748 - Math.min(qT(v.restoration.p90), aStar)), hi: sToH(8748 - Math.min(qT(v.restoration.p10), aStar)) });
  });
});

describe("RULE 3단계: 필요성 판정(HOLD)", () => {
  const res = [makeResource("ESS_L", "R-L", { x: 2.5, y: 0 }, fastPrep)];
  const mk = (confirmedEndH: number, sigmaE: number, now = 0.5) =>
    view({ now, households: [hhLong("H-1")], resources: res, status: "CONFIRMED", confirmedEndH, sigmaE });

  it("복구 통보가 하한 기준보다 이르면 HOLD, 재확인 시한 = L_end − floor(1.25·A_min)", () => {
    const out = rule(mk(1.0, 0.3), opts).rows[0];
    expect(out.rec.lane).toBe("HOLD");
    expect(out.rec.holdRecheckBy).toBe(sToH(8748 - 1350));
    expect(out.rec.tier).toBeNull();
    expect(out.rec.reason.templateId).toBe("R-HOLD");
    // th = min(floor(0.8·6948), 6948 − 1800) = 5148
    expect(out.rec.reason.params.th).toBe(fmtH(5148));
  });
  it("I1: R(복구 예정)만 늦추면 HOLD → 필요", () => {
    expect(rule(mk(1.0, 0.3), opts).rows[0].rec.lane).toBe("HOLD");
    expect(rule(mk(6.0, 0.3), opts).rows[0].rec.lane).toBe("PROPOSE_ASSIGN");
  });
  it("σ_e > 0.75면 HOLD 안 함(σ_e = 0.75 경계는 HOLD)", () => {
    expect(rule(mk(1.0, 0.75), opts).rows[0].rec.lane).toBe("HOLD");
    expect(rule(mk(1.0, 0.76), opts).rows[0].rec.lane).toBe("PROPOSE_ASSIGN");
  });
  it("ASSUMED_RANGE에서는 HOLD 없음(통보 없음 → 기본값 배정)", () => {
    const v = view({ now: 0.5, households: [hhLong("H-1")], resources: res, cause: "KEPCO_DIST" });
    const r = rule(v, opts).rows[0];
    expect(r.rec.lane).toBe("PROPOSE_ASSIGN");
    expect(r.rec.reason.templateId).toBe("R-ASSIGN-DEF");
  });
  it("NEAR_CERTAIN(ROTATING)도 HOLD 대상", () => {
    const v = view({ now: 0.2, tOutage: 0, households: [hhLong("H-1")], resources: res, cause: "ROTATING" });
    expect(v.restoration.status).toBe("NEAR_CERTAIN");
    expect(rule(v, opts).rows[0].rec.lane).toBe("HOLD");
  });
  it("now ≥ holdRecheckBy이면 HOLD가 남지 않고 HOLD_EXPIRED 감사 행(system)", () => {
    // A_min = 720 + floor(33900·3600/25000) = 720 + 4881 = 5601 → 1.25·A_min = 7001 > L_rem 6948 → 시한 이미 지남
    const far = [makeResource("ESS_L", "R-F", { x: 33.9, y: 0 }, fastPrep)];
    const v = view({ now: 0.5, households: [hhLong("H-1")], resources: far, status: "CONFIRMED", confirmedEndH: 1.0, sigmaE: 0.3 });
    const ctx = buildCtx(v, opts);
    const need = judgeNeed(ctx, ctx.infos[0], 5601);
    expect(need.holdConditions).toBe(true);
    expect(need.hold).toBe(false);
    expect(need.why).toBe("HOLD_EXPIRED");
    const out = rule(v, opts);
    expect(out.rows[0].rec.lane).not.toBe("HOLD");
    const prev = rule(mk(1.0, 0.3), opts).rows.map((r) => r.rec);
    const at = "2026-10-17T22:00:00+09:00";
    const entries = holdExpiredEntries(prev, (prev[0].holdRecheckBy as number), at, out.rows.map((r) => r.rec));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actor: "system", action: "HOLD_EXPIRED", from: { lane: "HOLD" } });
    expect(auditEntryRuleSchema.safeParse(entries[0]).success).toBe(true);
    expect(holdExpiredEntries(prev, (prev[0].holdRecheckBy as number) - 1 / 3600, at)).toHaveLength(0);
  });
});

describe("RULE 5단계 ①·② 와 6단계 대체 레인", () => {
  it("① 가능 자원 없음 → 제때 119(슬롯 시작 + A_119 + 0.33h ≤ L_end)", () => {
    const v = view({ now: 0.5, households: [hhLong("H-1")], resources: [] });
    const r = rule(v, opts).rows[0];
    expect(r.rec.lane).toBe("FALLBACK_119");
    // 물리 자원이 없으면 slack은 −∞가 아니라 119 계획 도착(A_119 계획 1800 + 이송 1188)으로 잰다(4.1절 5단계 1항, 라운드 4)
    expect(r.slackS).toBe(arrivalLimitS(r.lEndS as number, 1800) - (1800 + 1188));
    // 1800 + qT(0.5) + floor(3600·33/100) = 1800 + 1800 + 1188
    expect(r.rec.etaH).toBe(sToH(4788));
    expect(r.rec.reason.templateId).toBe("R-119");
    expect(r.late119).toBe(false);
  });
  it("② 0.8L 안 도착 불가 + 119 늦음 → Δ ≥ 1h면 GAP_REDUCE(Δ = min(R80, A_end + run) − max(A_end, L_end))", () => {
    const v = view({ now: 0, households: [hhShort("H-1")], resources: [makeResource("ESS_L", "R-L", { x: 0, y: 0 })] });
    const out = rule(v, { ...opts, stress119: 20 });
    const r = out.rows[0];
    expect(r.rec.lane).toBe("GAP_REDUCE");
    expect(r.rec.reason.templateId).toBe("R-GAP");
    // A = 3600 > floor(3780·4/5) = 3024. run = floor(2000000·3600·17/(20·60000)) = 102000
    const r80 = qT(v.restoration.p80);
    expect(r.deltaS).toBe(Math.min(r80, 3600 + 102000) - Math.max(3600, 3780));
    expect(r.rec.reason.params.d).toBe(fmtH(r.deltaS as number));
  });
  it("Δ < 1h면 6단계로 넘어가 (b) 물리 가능 자원 GAP_REDUCE(공백 단축 목적)", () => {
    // KEPCO_DIST: R80이 L_end(1.05h) 근처라 Δ < 1h
    const v = view({ now: 0, cause: "KEPCO_DIST", households: [hhShort("H-1")], resources: [makeResource("ESS_L", "R-L", { x: 0, y: 0 })] });
    const r = rule(v, { ...opts, stress119: 20 }).rows[0];
    expect(r.rec.lane).toBe("GAP_REDUCE");
    expect(r.rec.reason.templateId).toBe("R-GAP-FB");
  });
  it("(c) 자원 없음 + 제때 119 불가 → L_end 전 시작 슬롯이면 지연 플래그 119", () => {
    const v = view({ now: 0, households: [hhShort("H-1")], resources: [] });
    const r = rule(v, { ...opts, stress119: 20 }).rows[0];
    expect(r.rec.lane).toBe("FALLBACK_119");
    expect(r.late119).toBe(true);
    expect(r.rec.reason.templateId).toBe("R-119-LATE");
  });
  it("(d) 119 슬롯도 없으면 쉼터(이동지원 필요 ∧ 보호자 없음이면 제외) → (e) UNSERVED_VISIBLE", () => {
    const lanes = { k119PerH: 2, a119H: { lo: 10 / 60, hi: 30 / 60 }, shelter: { seats: 1, prepH: { lo: 0.5, hi: 2 } } };
    const busy = { slots119: [{ householdId: "X", callS: 0, startS: 0, endS: 5 * 3600, kind: "CALL" as const }] };
    const a = hhShort("H-1", { mobilityNeed: true, caregiver: false });
    const b = hhShort("H-2", { mobilityNeed: false });
    const c = hhShort("H-3", { mobilityNeed: true, caregiver: true });
    const out = rule(view({ now: 0, households: [a, b, c], resources: [], lanes }), opts, busy);
    expect(row(out.rows, "H-1").rec.lane).toBe("UNSERVED_VISIBLE");
    expect(row(out.rows, "H-2").rec.lane).toBe("FALLBACK_SHELTER");
    expect(row(out.rows, "H-3").rec.lane).toBe("UNSERVED_VISIBLE"); // 좌석 1개를 H-2가 먼저(id 순) 씀
    expect(out.shelterSeatsUsed).toBe(1);
  });
  it("119 계획 대기열: 서비스 1/k h, 슬롯 시작 = max(호출, 앞 슬롯 종료)", () => {
    const hs = [hhLong("H-1"), hhLong("H-2"), hhLong("H-3")];
    const out = rule(view({ now: 0.5, households: hs, resources: [] }), opts);
    const starts = out.rows.map((r) => r.slot119?.startS);
    expect(starts).toEqual([1800, 1800 + 1800, 1800 + 3600]);
  });
});

describe("처리 순서 키 (tier, slack) — I1", () => {
  // H-A: L 2.43h(L_end 8748), 먼 자원 A 큼 → slack 작음. H-B: L 1.05h, 가까운 자원 → slack 큼
  const hA = hhLong("H-A", { cell: { x: 0, y: 0 } });
  const hB = makeHH({ id: "H-B", pseudonym: "H-B", cell: { x: 50, y: 0 }, device: { batteryAgeY: 0.5, charge: { value: 50, source: "user" } } });
  const resources = [makeResource("ESS_L", "R-A", { x: 30, y: 0 }, fastPrep), makeResource("ESS_L", "R-B", { x: 50, y: 0 }, fastPrep)];
  it("ASSUMED_RANGE에서 원인(R 분위)만 바꿔도 처리 순서가 바뀐다(tier 경로)", () => {
    const vFire = view({ now: 0, cause: "APT_FIRE", households: [hA, hB], resources });
    const vKepco = view({ now: 0, cause: "KEPCO_DIST", households: [hA, hB], resources });
    const oFire = rule(vFire, opts).rows.map((r) => r.rec.householdId);
    const oKepco = rule(vKepco, opts).rows.map((r) => r.rec.householdId);
    expect(oFire).not.toEqual(oKepco);
    // APT_FIRE: 둘 다 tier 0 → slack 작은 H-A 먼저. KEPCO_DIST: H-A는 L_end ≥ R90 → tier 1, H-B 먼저
    expect(oFire[0]).toBe("H-A");
    expect(oKepco[0]).toBe("H-B");
    // RULE_NO_R(slack만)은 원인과 무관하게 H-A 먼저
    expect(allocate(vKepco, POLICY_CFGS.RULE_NO_R, opts).rows[0].rec.householdId).toBe("H-A");
    // R_L(L 오름차순)은 H-B 먼저
    expect(allocate(vFire, POLICY_CFGS.R_L, opts).rows[0].rec.householdId).toBe("H-B");
  });
});

describe("2단계 검토 예약", () => {
  const mr1 = makeHH({ id: "M-1", pseudonym: "M-1", tReport: 0.1, device: { specId: null, specBy: null } });
  const mr2 = makeHH({ id: "M-2", pseudonym: "M-2", tReport: 0.2, device: { specId: "COUGH_E70" } });
  const mr3 = makeHH({ id: "M-3", pseudonym: "M-3", tReport: 0.05, device: { specId: "UNKNOWN_SUCTION" } });
  const ten = Array.from({ length: 10 }, (_, j) => makeResource("ESS_S", `R-${j}`, { x: 9, y: 9 }));

  it("A 최소 → 커넥터 넓은 것 → 출력 큰 것 → id 순으로 1개, 예약 시한 = tReport + 1h", () => {
    const resources = [
      makeResource("MOBILE_GEN", "R-GEN", { x: 0, y: 0 }, fastPrep),
      makeResource("ESS_S", "R-ESS-S", { x: 0, y: 0 }, fastPrep),
      makeResource("ESS_L", "R-ESS-L", { x: 0, y: 0 }, fastPrep),
      ...ten,
    ];
    const out = rule(view({ now: 0.3, households: [mr1], resources }), opts);
    const r = out.rows[0];
    expect(r.rec.lane).toBe("MANUAL_REVIEW");
    expect(r.rec.reservedResourceId).toBe("R-ESS-L");
    expect(r.reservation?.untilS).toBe(qT(0.1) + 3600);
    expect(r.rec.reason.templateId).toBe("R-MR");
    expect(r.rec.tier).toBeNull();
  });
  it("예약 총수 ≤ floor(가용 자원 × 1/5): 자원 5개면 1건, 나머지는 '대기열 최상단' 표시만(tReport 순)", () => {
    const five = ten.slice(0, 5);
    const out = rule(view({ now: 0.3, households: [mr1, mr2, mr3], resources: five }), opts);
    expect(out.reserveCapResources).toBe(1);
    expect(out.rows.map((r) => r.rec.householdId)).toEqual(["M-3", "M-1", "M-2"]);
    expect(out.rows[0].rec.reservedResourceId).toBeDefined();
    expect(out.rows[1].reservation?.noResourceWhy).toBe("CAP");
    expect(out.rows[2].reservation?.noResourceWhy).toBe("CAP");
    expect(out.rows[1].rec.reason.templateId).toBe("R-MR-NORES");
  });
  it("tier 0 ∧ slack < mrHoldH 가구의 유일한 물리 자원은 예약에서 뺀다", () => {
    // 자원 5개 중 R-ONLY만 단기 가구(H-1)의 phys(ESS_L, 에너지 충분), 나머지는 ESS_S(에너지 부족)
    const h = hhLong("H-1", { cell: { x: 20, y: 0 } });
    const only = makeResource("ESS_L", "R-ONLY", { x: 0, y: 0 }, fastPrep);
    const others = Array.from({ length: 4 }, (_, j) => makeResource("ESS_S", `R-S${j}`, { x: 30, y: 30 }));
    const v = view({ now: 0, households: [mr1, h], resources: [only, ...others] });
    const out = rule(v, opts);
    expect(out.protectedResourceIds).toEqual(["R-ONLY"]);
    expect(row(out.rows, "M-1").rec.reservedResourceId).not.toBe("R-ONLY");
    expect(row(out.rows, "H-1").rec.resourceId).toBe("R-ONLY");
  });
  it("RULE_NO_RESERVE: 물리 자원·119 예약 없이 표시만", () => {
    const out = allocate(view({ now: 0.3, households: [mr1], resources: ten }), POLICY_CFGS.RULE_NO_RESERVE, opts);
    expect(out.rows[0].rec.reservedResourceId).toBeUndefined();
    expect(out.rows[0].reservation?.noResourceWhy).toBe("POLICY");
    expect(out.rows[0].reservation?.slot119).toBeNull();
  });
  it("예약 시한 경과면 예약 없음", () => {
    const out = rule(view({ now: 1.2, households: [mr1], resources: ten }), opts);
    expect(out.rows[0].reservation?.noResourceWhy).toBe("EXPIRED");
  });
  it("수동검토 가구는 자동 배정되지 않는다(I4), 예약 자원은 다른 가구에 배정되지 않는다", () => {
    const h = hhLong("H-1", { cell: { x: 0, y: 0 } });
    const rs = Array.from({ length: 5 }, (_, j) => makeResource("ESS_L", `R-${j}`, { x: 0, y: 0 }, fastPrep));
    const out = rule(view({ now: 0.3, households: [mr1, h], resources: rs }), opts);
    const m = row(out.rows, "M-1");
    expect(m.rec.lane).toBe("MANUAL_REVIEW");
    expect(row(out.rows, "H-1").rec.resourceId).not.toBe(m.rec.reservedResourceId);
  });
  it("수동검토 완료(operatorLowerH) 뒤 재진입: DB 밖 기종은 보수 외피(AC220만·최대 소비·인버터 민감)", () => {
    const done = makeHH({ id: "M-1", pseudonym: "M-1", device: { specId: null, specBy: null, operatorLowerH: { hours: 3, basis: "시험", auditId: "a" } } });
    const v = view({ now: 0, households: [done], resources: [makeResource("EV_V2L", "R-EV", { x: 0, y: 0 }, fastPrep), makeResource("MOBILE_GEN", "R-G", { x: 1, y: 0 }, fastPrep)] });
    const r = rule(v, opts).rows[0];
    expect(r.rec.lane).toBe("PROPOSE_ASSIGN");
    expect(r.rec.resourceId).toBe("R-G"); // V2L은 에너지는 되지만 inverterSafe "unknown" → 제외
    expect(r.rec.reason.params.w).toBe(280);
  });
});

describe("기준선 (4.2절)", () => {
  it("B1: 필요성 판정·도착 필터 없음, L 오름차순 + 가장 가까운 물리 자원", () => {
    const v = view({ now: 0.5, households: [hhLong("H-1")], resources: [makeResource("ESS_L", "R-L", { x: 2.5, y: 0 }, fastPrep)], status: "CONFIRMED", confirmedEndH: 1.0, sigmaE: 0.3 });
    expect(rule(v, opts).rows[0].rec.lane).toBe("HOLD");
    const b1 = runPolicy("B1_SHORTEST", v, opts);
    expect(b1.rows[0].rec.lane).toBe("PROPOSE_ASSIGN");
    expect(b1.rows[0].rec.reason.templateId).toBe("R-BASE");
  });
  it("B2: (i,j) 쌍 A 오름차순 탐욕 매칭 — 가까운 쌍이 먼저", () => {
    const h1 = hhLong("H-1", { cell: { x: 0, y: 0 } });
    const h2 = hhLong("H-2", { cell: { x: 4, y: 0 } });
    const rs = [makeResource("ESS_L", "R-1", { x: 3, y: 0 }, fastPrep), makeResource("ESS_L", "R-2", { x: 10, y: 0 }, fastPrep)];
    const b2 = runPolicy("B2_NEAREST", view({ now: 0, households: [h1, h2], resources: rs }), opts);
    expect(row(b2.rows, "H-2").rec.resourceId).toBe("R-1");
    expect(row(b2.rows, "H-1").rec.resourceId).toBe("R-2");
    expect(b2.rows[0].rec.householdId).toBe("H-2");
  });
  it("RULE_FEASIBLE_FIRST: 도착 필터 통과 가구만 루프, 나머지는 6단계", () => {
    const v = view({ now: 0, households: [hhShort("H-1")], resources: [makeResource("ESS_L", "R-L", { x: 0, y: 0 })] });
    expect(rule(v, { ...opts, stress119: 20 }).rows[0].rec.reason.templateId).toBe("R-GAP");
    const ff = runPolicy("RULE_FEASIBLE_FIRST", v, { ...opts, stress119: 20 });
    expect(ff.rows[0].rec.lane).toBe("GAP_REDUCE");
    expect(ff.rows[0].rec.reason.templateId).toBe("R-GAP-FB");
  });
  it("ORACLE_INFO: L_true·R_true를 넣는다", () => {
    const v = view({ now: 0.5, households: [hhLong("H-1")], resources: [makeResource("ESS_L", "R-L", { x: 2.5, y: 0 }, fastPrep)] });
    const o = oracleInfo(v, { lEndS: { "H-1": 20 * 3600 }, rTrueS: 2 * 3600 }, opts);
    expect(o.rows[0].rec.lane).toBe("HOLD");
    expect(o.rows[0].lEndS).toBe(72000);
    expect(() => runPolicy("ORACLE_INFO", v, opts)).toThrow();
  });
  it("NONE: 모두 미배정 표시", () => {
    const n = noneBaseline(view({ households: [hhLong("H-1")] }));
    expect(n.rows[0].rec.lane).toBe("UNSERVED_VISIBLE");
  });
  it("KR-07 호출 시각: p_early 이하 u면 정전 시작 + U[0, L_true], 아니면 L_true", () => {
    expect(kr07CallS(0, 7200, 0.4, 0.1, 0.5)).toBe(3600);
    expect(kr07CallS(0, 7200, 0.4, 0.9, 0.5)).toBe(7200);
    expect(() => kr07CallS(0, 7200, 0.9, 0.1, 0.5)).toThrow();
  });
});

describe("4.3절 ② 결정 시점 재실행", () => {
  it("고정 행의 자원·119 슬롯·좌석은 다음 결정 시점에 다시 쓰지 않는다", () => {
    const rs = [makeResource("ESS_L", "R-1", { x: 0, y: 0 }, fastPrep)];
    const v1 = view({ now: 0.5, households: [hhLong("H-1"), hhLong("H-2", { cell: { x: 5, y: 0 } })], resources: rs });
    const a = rule(v1, opts);
    const st = nextState({}, a);
    expect(st.usedResourceIds).toEqual(["R-1"]);
    expect(st.slots119?.length).toBe(1);
    expect(unassignedIds(a, qT(1.0))).toEqual([]);
    const late = hhLong("H-3", { tReport: 1 });
    const b = rule(view({ now: 1.0, households: [late], resources: rs }), opts, st);
    expect(b.rows[0].rec.resourceId).toBeUndefined();
    expect(b.rows[0].rec.lane).toBe("FALLBACK_119");
    expect(b.rows[0].slot119?.startS).toBe(Math.max(3600, (st.slots119 ?? [])[0].endS));
  });
});

describe("검토 예약 유지·해제 (4.1절 2단계, 4.3절 ②)", () => {
  const mr = makeHH({ id: "M-1", pseudonym: "M-1", tReport: 0.1, device: { specId: null, specBy: null } });
  const rs = Array.from({ length: 5 }, (_, j) => makeResource("ESS_L", `R-${j}`, { x: j, y: 0 }, fastPrep));
  it("다음 결정 시점에도 수동검토 중이면 같은 자원·119 슬롯을 유지하고, 재진입하면 풀린다", () => {
    const a = rule(view({ now: 0.3, households: [mr], resources: rs, lanes: { k119PerH: 6, a119H: { lo: 10 / 60, hi: 30 / 60 }, shelter: { seats: 0, prepH: { lo: 0.5, hi: 2 } } } }), opts);
    const r0 = a.rows[0];
    expect(r0.rec.reservedResourceId).toBe("R-0");
    expect(r0.reservation?.slot119).not.toBeNull(); // [0.3h, 1.3h)에 슬롯 6개 → 상한 1
    const st = nextState({}, a);
    expect(st.reservations).toHaveLength(1);
    // 다른 가구가 생겨도 유지 예약 자원은 그 가구에 가지 않는다
    const h = hhLong("H-1", { cell: { x: 0, y: 0 } });
    const lanes6 = { k119PerH: 6, a119H: { lo: 10 / 60, hi: 30 / 60 }, shelter: { seats: 0, prepH: { lo: 0.5, hi: 2 } } };
    const b = rule(view({ now: 0.6, households: [mr, h], resources: rs, lanes: lanes6 }), opts, st);
    expect(row(b.rows, "M-1").rec.reservedResourceId).toBe("R-0");
    expect(row(b.rows, "M-1").reservation?.slot119).toEqual(r0.reservation?.slot119);
    expect(row(b.rows, "H-1").rec.resourceId).not.toBe("R-0");
    expect(b.slots119.filter((x) => x.kind === "RESERVE")).toHaveLength(1);
    // 재진입(수동검토 완료): 예약이 풀려 R-0과 RESERVE 슬롯이 다시 쓰인다
    const done = { ...mr, device: { ...mr.device, operatorLowerH: { hours: 3, basis: "시험", auditId: "x" } } };
    const c = rule(view({ now: 0.6, households: [done], resources: rs, lanes: lanes6 }), opts, st);
    expect(c.slots119.filter((x) => x.kind === "RESERVE")).toHaveLength(0);
    expect(c.rows[0].rec.lane).not.toBe("MANUAL_REVIEW");
  });
  it("동점 A에서는 커넥터 폭({AC220, DC12} 교집합 크기)이 출력보다 먼저: ESS_S(폭 2, 600W) > 발전기(폭 1, 5000W)", () => {
    const gen = makeResource("MOBILE_GEN", "R-A", { x: 0, y: 0 }, { prepH: { lo: 0, hi: 0.2 } });
    const ess = makeResource("ESS_S", "R-B", { x: 0, y: 0 }, { prepH: { lo: 0, hi: 0.2 } });
    const others = Array.from({ length: 3 }, (_, j) => makeResource("ESS_S", `R-Z${j}`, { x: 9, y: 9 }));
    const cough = makeHH({ id: "M-2", pseudonym: "M-2", device: { specId: "COUGH_E70" } });
    const out = rule(view({ now: 0.1, households: [cough], resources: [gen, ess, ...others] }), opts);
    expect(out.rows[0].rec.reservedResourceId).toBe("R-B");
  });
});

describe("승인 행 재검토 (1.4절 재계산, I6)", () => {
  const rs = [makeResource("ESS_L", "R-1", { x: 2.5, y: 0 }, fastPrep), makeResource("ESS_L", "R-2", { x: 0.5, y: 0 }, fastPrep)];
  const v0 = view({ now: 0.5, households: [hhLong("H-1")], resources: rs });
  const first = rule(v0, opts).rows[0];
  const approved = [{ householdId: "H-1", lane: first.rec.lane, resourceId: first.rec.resourceId, etaH: first.rec.etaH }];
  const at = "2026-10-17T22:30:00+09:00";

  it("조건이 그대로면 플래그 없음", () => {
    expect(recheckApproved(v0, approved, at, opts).flagged).toEqual([]);
  });
  it("승인 뒤 재신고로 L_end가 줄어 도착 조건이 깨지면 RECHECK_FLAG + 새 PROPOSED 대안, 승인 배정은 그대로", () => {
    const frozen = JSON.stringify(approved);
    // 재신고: 충전 5%(L = 3 × 0.9 × 0.045 = 0.1215h), lEndPrev = 2.43h → L_end = min(2.43, 0.5 + 0.1215)
    const re = hhLong("H-1", { tReport: 0.5, lEndPrev: 2.43, device: { batteryAgeY: 0.5, charge: { value: 5, source: "device_screen" } } });
    const v1: PlannerView = { ...v0, households: [re] };
    const out = recheckApproved(v1, approved, at, opts);
    expect(out.flagged).toHaveLength(1);
    expect(out.flagged[0].cause).toBe("ARRIVAL_LATE");
    expect(out.audit[0]).toMatchObject({ actor: "system", action: "RECHECK_FLAG", householdId: "H-1", from: { lane: "PROPOSE_ASSIGN", resourceId: first.rec.resourceId } });
    expect(auditEntryRuleSchema.safeParse(out.audit[0]).success).toBe(true);
    expect(out.alternatives).toHaveLength(1);
    expect(out.alternatives[0].status).toBe("PROPOSED");
    expect(JSON.stringify(approved)).toBe(frozen);
    expect(renderReason(out.flagged[0].reason)).toContain("0.8×하한");
  });
  it("배정 자원이 unavailable이 되면 플래그, 다른 승인 배정은 고정한 채 대안 계산", () => {
    const h2 = hhLong("H-2", { cell: { x: 0.5, y: 0 } });
    const v = view({ now: 0.5, households: [hhLong("H-1"), h2], resources: rs });
    const a = rule(v, opts);
    const appr = a.rows.map((r) => ({ householdId: r.rec.householdId, lane: r.rec.lane, resourceId: r.rec.resourceId, etaH: r.rec.etaH }));
    const r1 = appr.find((x) => x.householdId === "H-1")!.resourceId!;
    const r2 = appr.find((x) => x.householdId === "H-2")!.resourceId!;
    const vDown: PlannerView = { ...v, resources: v.resources.map((r) => (r.id === r1 ? { ...r, available: false } : r)) };
    const out = recheckApproved(vDown, appr, at, opts);
    expect(out.flagged.map((f) => [f.householdId, f.cause])).toEqual([["H-1", "RESOURCE_UNAVAILABLE"]]);
    expect(out.alternatives[0].rec.resourceId).not.toBe(r2);
    expect(out.alternatives[0].rec.householdId).toBe("H-1");
  });
});

describe("I6: 배정기 출력에 APPROVED 없음", () => {
  it("모든 정책의 status는 PROPOSED", () => {
    const v = view({ now: 0.5, households: [hhLong("H-1"), hhShort("H-2")], resources: [makeResource("ESS_L", "R-L", { x: 0, y: 0 })] });
    for (const p of ["RULE", "B1_SHORTEST", "B2_NEAREST", "R_L", "RULE_NO_R", "RULE_FEASIBLE_FIRST", "RULE_NO_RESERVE", "NONE"] as const) {
      for (const r of runPolicy(p, v, opts).rows) expect(r.status).toBe("PROPOSED");
    }
  });
});

describe("근거 문장 부가: R-EXT0", () => {
  it("신고만 된 외장 n개 → 0시간 문장", () => {
    const h = hhLong("H-1", { ext: [{ extSpecId: "TRILOGY100_DETACH", declaredCount: 2, opVerified: null }] });
    const r = rule(view({ now: 0.5, households: [h], resources: [] }), opts).rows[0];
    expect(r.notes).toEqual([{ templateId: "R-EXT0", params: { n: 2 } }]);
    expect(renderReason(r.notes[0])).toBe("외장배터리 2개 미확인 → 0시간으로 계산");
  });
});
