// /ops 세션 시험 (spec.md 1.4·1.5절, 9절 E2E 항목 중 순수 로직으로 확인 가능한 것)
import { describe, expect, it } from "vitest";
import suwon from "@/data/presets/suwon.json";
import rotating from "@/data/presets/rotating.json";
import seosan from "@/data/presets/seosan.json";
import { project119 } from "../alloc/project119";
import { qT } from "../engine/quantize";
import type { AuditEntry } from "../domain/types";
import {
  applyVerify, commitDecision, decisionFromRow, lEndH, modifyOptions, newSession, parseOperatorNumber, purge119, recompute, reReport, setNotice, start, visible119Ids,
  type Decision, type Session, type UiPreset,
} from "./session";

const preset = suwon as unknown as UiPreset;

function approve(s: Session, id: string): Session {
  const row = s.result!.rows.find((r) => r.rec.householdId === id)!;
  const d: Decision = { ...decisionFromRow(row), status: "APPROVED", decidedAtS: s.nowS };
  const a: AuditEntry = { at: "t", actor: "demo-operator", householdId: id, action: "APPROVE", from: { lane: row.rec.lane }, to: { lane: row.rec.lane, resourceId: row.rec.resourceId } };
  return commitDecision(s, d, a);
}
function rows119(s: Session) {
  return project119(Object.values(s.decisions).map((d) => ({ householdId: d.householdId, lane: d.lane, status: d.status, lEndH: lEndH(s.households.find((h) => h.id === d.householdId)!) })), s.households, preset.meta.baseIso);
}

describe("ops 세션", () => {
  const s0 = start(newSession(preset));

  it("정전 발생 전에는 결과 없음, 발생 뒤 모든 가구가 PROPOSED 한 행씩", () => {
    expect(newSession(preset).result).toBeNull();
    expect(s0.result!.rows).toHaveLength(preset.planner.households.length);
    expect(new Set(s0.result!.rows.map((r) => r.status))).toEqual(new Set(["PROPOSED"]));
    expect(Object.keys(s0.decisions)).toHaveLength(0);
  });

  it("119 파기는 그 시점 표시분만 지우고 감사 행을 남기며, 파기 뒤 새 119 결정은 다시 보인다", () => {
    const rows = s0.result!.rows;
    const first = rows.find((r) => r.rec.lane === "FALLBACK_119")!;
    const s1 = purge119(approve(s0, first.rec.householdId));
    expect(visible119Ids(s1)).toEqual([]);
    expect(s1.audit.filter((a) => a.action === "PURGE_119").map((a) => a.householdId)).toEqual([first.rec.householdId]);
    const other = rows.find((r) => r.rec.householdId !== first.rec.householdId)!;
    const d: Decision = { ...decisionFromRow(other), lane: "FALLBACK_119", status: "MODIFIED", decidedAtS: s1.nowS };
    const a: AuditEntry = { at: "t", actor: "demo-operator", householdId: other.rec.householdId, action: "MODIFY", from: { lane: other.rec.lane }, to: { lane: "FALLBACK_119" }, reasonCode: "OTHER", reasonText: "현장 요청으로 119" };
    const s2 = commitDecision(s1, d, a);
    expect(visible119Ids(s2)).toEqual([other.rec.householdId]);
    expect(purge119(s1)).toBe(s1);
    // 같은 가구를 파기 뒤 다시 119로 결정하면 다시 보인다
    const d2: Decision = { ...s1.decisions[first.rec.householdId], status: "MODIFIED", decidedAtS: s1.nowS };
    const a2: AuditEntry = { at: "t", actor: "demo-operator", householdId: first.rec.householdId, action: "MODIFY", from: { lane: "FALLBACK_119" }, to: { lane: "FALLBACK_119" }, reasonCode: "OTHER", reasonText: "재결정 확인용" };
    expect(visible119Ids(commitDecision(s1, d2, a2))).toContain(first.rec.householdId);
  });

  it("운영자 숫자 입력은 0 이상 십진수만 받는다(빈 칸이 0이 되지 않음)", () => {
    for (const bad of ["", " ", "abc", "0x1", "1e1", "-1", "1.", ".5"]) expect(parseOperatorNumber(bad)).toBeNull();
    expect(parseOperatorNumber(" 2.5 ")).toBe(2.5);
    expect(parseOperatorNumber("0")).toBe(0);
  });

  it("승인 전 119 화면은 비고, 119 레인 승인 뒤 정확히 3필드 1행", () => {
    expect(rows119(s0)).toEqual([]);
    const id = s0.result!.rows.find((r) => r.rec.lane === "FALLBACK_119")!.rec.householdId;
    const s1 = approve(s0, id);
    const v = rows119(s1);
    expect(v).toHaveLength(1);
    expect(Object.keys(v[0]).sort()).toEqual(["device", "expectedSafeUntil", "location"]);
    expect(s1.audit.at(-1)?.action).toBe("APPROVE");
  });

  it("PROPOSE_ASSIGN·GAP_REDUCE 승인 행은 119 화면에 없다", () => {
    const row = s0.result!.rows.find((r) => r.rec.lane === "PROPOSE_ASSIGN" || r.rec.lane === "GAP_REDUCE")!;
    const s1 = approve(s0, row.rec.householdId);
    expect(rows119(s1)).toEqual([]);
    // 승인 자원은 다른 가구 추천에서 빠진다
    expect(s1.result!.rows.some((r) => r.rec.resourceId === row.rec.resourceId)).toBe(false);
  });

  it("수동검토 완료 전에는 수정 목록에 PROPOSE_ASSIGN이 없다", () => {
    const mr = s0.result!.rows.find((r) => r.rec.lane === "MANUAL_REVIEW")!;
    const opts = modifyOptions(s0, mr.rec.householdId);
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.some((o) => o.lane === "PROPOSE_ASSIGN")).toBe(false);
  });

  it("수정은 사유 코드와 자유문 5자 이상이 없으면 저장 불가", () => {
    const row = s0.result!.rows[0];
    const d: Decision = { ...decisionFromRow(row), lane: "FALLBACK_119", status: "MODIFIED", decidedAtS: s0.nowS };
    const bad: AuditEntry = { at: "t", actor: "demo-operator", householdId: row.rec.householdId, action: "MODIFY", from: { lane: row.rec.lane }, to: { lane: "FALLBACK_119" }, reasonCode: "OTHER", reasonText: "짧음" };
    expect(() => commitDecision(s0, d, bad)).toThrow();
    const ok = commitDecision(s0, d, { ...bad, reasonText: "현장 연락 결과 이송 희망" });
    expect(rows119(ok)).toHaveLength(1);
  });

  it("수동검토 완료(DB 기종 선택) 뒤 자동 계산 레인으로 나온다", () => {
    const mr = s0.result!.rows.find((r) => r.rec.lane === "MANUAL_REVIEW")!;
    const out = applyVerify(s0, { action: "MANUAL_REVIEW_DONE", householdId: mr.rec.householdId, specId: "TRILOGY100", reasonText: "라벨 사진 대조" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.session.result!.rows.find((r) => r.rec.householdId === mr.rec.householdId)!.rec.lane).not.toBe("MANUAL_REVIEW");
    expect(out.session.audit.at(-1)?.action).toBe("MANUAL_REVIEW_DONE");
  });

  it("사유 없는 확인 조작은 저장 불가", () => {
    const id = s0.households[0].id;
    expect(applyVerify(s0, { action: "VERIFY_AGE", householdId: id, batteryAgeY: 1, reasonText: " " }).ok).toBe(false);
  });

  it("승인 뒤 재신고로 하한이 줄면 재검토 배지 + RECHECK_FLAG + 대안 PROPOSED", () => {
    const row = s0.result!.rows.find((r) => r.rec.lane === "FALLBACK_119" && !s0.households.find((h) => h.id === r.rec.householdId)!.cylinder)!;
    const id = row.rec.householdId;
    const s1 = approve(s0, id);
    const s2 = reReport(s1, id, 0);
    expect(lEndH(s2.households.find((h) => h.id === id)!)!).toBeLessThanOrEqual(lEndH(s1.households.find((h) => h.id === id)!)!);
    expect(s2.flagged[id]).toBeTruthy();
    expect(s2.audit.filter((a) => a.action === "RECHECK_FLAG" && a.householdId === id)).toHaveLength(1);
    expect(s2.alternatives[id]?.status).toBe("PROPOSED");
    expect(s2.decisions[id].status).toBe("APPROVED"); // 자동으로 바꾸지 않는다
    // 같은 위반으로 다시 재계산해도 감사 행은 한 번만
    expect(recompute(s2).audit.filter((a) => a.action === "RECHECK_FLAG")).toHaveLength(1);
  });

  it("복구 예정 통보가 있어야만 HOLD가 생기고, 재확인 시한이 지나면 HOLD_EXPIRED", () => {
    expect(s0.result!.rows.some((r) => r.rec.lane === "HOLD")).toBe(false);
    const s1 = setNotice(s0, { confirmedEndH: preset.planner.now + 0.25, sigmaE: 0.1 });
    const hold = s1.result!.rows.find((r) => r.rec.lane === "HOLD");
    expect(hold).toBeTruthy();
    const by = qT(hold!.rec.holdRecheckBy!);
    const s2 = recompute(s1, by);
    expect(s2.audit.some((a) => a.action === "HOLD_EXPIRED" && a.householdId === hold!.rec.householdId && a.actor === "system")).toBe(true);
    expect(s2.result!.rows.find((r) => r.rec.householdId === hold!.rec.householdId)!.rec.lane).not.toBe("HOLD");
  });
});

// 통합 레드팀 16라운드: 재신고 → 확인과 확인 → 재신고가 같은 L_end·배정을 낸다(확인은 재신고 단조 묶음의 대상이 아님)
describe("확인·재신고 순서 무관", () => {
  const presets = { suwon, rotating, seosan } as unknown as Record<string, UiPreset>;
  const lanes = (s: Session) => s.result!.rows.map((r) => `${r.rec.householdId}:${r.rec.lane}:${r.rec.resourceId ?? ""}`).join(" ");
  const ends = (s: Session) => s.households.map((h) => `${h.id}:${lEndH(h)}:${h.lEndPrevBattery ?? ""}`).join(" ");
  for (const [name, p] of Object.entries(presets)) {
    const base = recompute(start(newSession(p)), start(newSession(p)).nowS + 1800);
    const verifies: { id: string; v: (id: string) => Parameters<typeof applyVerify>[1] }[] = [
      ...p.planner.households.filter((h) => h.cylinder).map((h) => ({ id: h.id, v: (id: string) => ({ action: "VERIFY_CYL" as const, householdId: id, count: 1, hoursLo: 10, reasonText: "현장 확인" }) })),
      ...p.planner.households.filter((h) => h.ext.some((e) => e.declaredCount > 0)).map((h) => ({ id: h.id, v: (id: string) => ({ action: "VERIFY_EXT" as const, householdId: id, extIndex: h.ext.findIndex((e) => e.declaredCount > 0), count: h.ext.find((e) => e.declaredCount > 0)!.declaredCount, chargeConfirmed: true, reasonText: "현장 확인" }) })),
      // 17라운드: 연식 확인(충전량과 곱해짐)·수동검토 완료(보수 하한)도 순서 무관
      ...p.planner.households.filter((h) => h.device.batteryAgeY == null).flatMap((h) => [0.5, 5].map((y) => ({ id: h.id, v: (id: string) => ({ action: "VERIFY_AGE" as const, householdId: id, batteryAgeY: y, reasonText: "구입 영수증" }) }))),
      ...base.result!.rows.filter((r) => r.rec.lane === "MANUAL_REVIEW").map((r) => ({ id: r.rec.householdId, v: (id: string) => ({ action: "MANUAL_REVIEW_DONE" as const, householdId: id, operatorLowerH: 2, reasonText: "담당 의료진 확인" }) })),
    ];
    for (const charge of [0, 80]) it(`${name} 충전 ${charge}%: 산소통·외장·연식·수동검토 후보 ${verifies.length}건`, () => {
      let n = 0;
      for (const { id, v } of verifies) {
        const a1 = applyVerify(reReport(base, id, charge), v(id));
        const b0 = applyVerify(base, v(id));
        expect(a1.ok).toBe(b0.ok); // 저장 불가(예: 기종에 맞지 않는 외장)도 순서와 무관
        if (!a1.ok || !b0.ok) continue;
        n++;
        const b1 = reReport(b0.session, id, charge);
        expect(ends(a1.session)).toBe(ends(b1));
        expect(lanes(a1.session)).toBe(lanes(b1));
      }
      expect(n).toBeGreaterThan(0);
    });
    it(`${name}: 재신고 두 번 사이 어디에 확인을 넣어도 L_end가 같다(R·V·R = V·R·R = R·R·V)`, () => {
      for (const { id, v } of verifies) {
        const t1 = recompute(base, base.nowS + 1800);
        const rv = applyVerify(reReport(base, id, 80), v(id));
        if (!rv.ok) continue;
        const a = reReport(recompute(rv.session, t1.nowS), id, 60);
        const vr = applyVerify(base, v(id));
        if (!vr.ok) continue;
        const b = reReport(recompute(reReport(vr.session, id, 80), t1.nowS), id, 60);
        const rr = reReport(recompute(reReport(base, id, 80), t1.nowS), id, 60);
        const c = applyVerify(rr, v(id));
        if (!c.ok) continue;
        expect(ends(a)).toBe(ends(b));
        expect(ends(c.session)).toBe(ends(b));
        // 배정은 비교하지 않는다: 시간을 넘기면 HOLD 만료(HOLD_EXPIRED)가 그 사이 보인 추천에 따라 달라진다(재신고 묶음과 별개, 1.4절)
      }
    });
  }
});
