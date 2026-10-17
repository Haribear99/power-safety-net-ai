import { describe, expect, it } from "vitest";
import { LabelOut, matchLabel, type LabelOutT } from "./label";
import { aggregate, judgeField, scoreItem, type LabelTruth } from "./score";

const F = (verbatim: string | null, legibility: "clear" | "partial" | "illegible" = "clear", confidence: "high" | "low" = "high") => ({ verbatim, legibility, confidence });
const out = (model: ReturnType<typeof F>, extra: Partial<LabelOutT> = {}): LabelOutT => LabelOut.parse({
  manufacturer: F("Philips Respironics"), model, ratedPower: F("60W"), voltage: F("AC 220V ~ 60Hz"), batteryText: F(null, "illegible", "high"),
  personalInfoVisible: false, language: "en", otherText: [], ...extra,
});

describe("DB 대조(7.2절 '코드가 할 일')", () => {
  it("정규화 정확 일치 ∧ clear ∧ high일 때만 기종을 정한다", () => {
    expect(matchLabel(out(F("Trilogy 100")))).toMatchObject({ status: "MATCHED", specId: "TRILOGY100", specBy: "ai_label_user_confirmed" });
    expect(matchLabel(out(F("LTV-1150")))).toMatchObject({ status: "MATCHED", specId: "LTV1150" });
    expect(matchLabel(out(F("Trilogy 100", "clear", "low")))).toMatchObject({ status: "MANUAL_REVIEW", reason: "NOT_CONFIDENT" });
    expect(matchLabel(out(F("Trilogy 100", "partial", "high")))).toMatchObject({ status: "MANUAL_REVIEW", reason: "NOT_CONFIDENT" });
  });
  it("미끼(Trilogy 10O, Astral 100)는 DB 밖 → 수동검토, 퍼지 후보만 표시", () => {
    const a = matchLabel(out(F("Trilogy 10O")));
    expect(a).toMatchObject({ status: "MANUAL_REVIEW", reason: "NOT_IN_DB" });
    expect(a.candidates).toContain("TRILOGY100");
    expect(matchLabel(out(F("Astral 100")))).toMatchObject({ status: "MANUAL_REVIEW", reason: "NOT_IN_DB" });
    expect(matchLabel(out(F(null, "illegible")))).toMatchObject({ status: "MANUAL_REVIEW", reason: "NO_MODEL" });
  });
});

describe("필드 채점(가림 정답 규칙)", () => {
  it("가림 없음: 정규화 정확 일치만 정답", () => {
    expect(judgeField("Trilogy 100", undefined, F("TRILOGY 100"))).toBe("CORRECT");
    expect(judgeField("Trilogy 100", undefined, F("Trilogy 10O"))).toBe("WRONG");
    expect(judgeField(null, undefined, F(null, "illegible"))).toBe("CORRECT");
    expect(judgeField(null, undefined, F("3 h"))).toBe("WRONG");
  });
  it("가린 글자를 채워 전체와 같으면 보완 위반, 보이는 부분·partial은 정답", () => {
    const occ = [8, 9]; // "Trilogy 100"의 "10"
    expect(judgeField("Trilogy 100", occ, F("Trilogy 100"))).toBe("SUPPLEMENT");
    expect(judgeField("Trilogy 100", occ, F("Trilogy", "partial", "low"))).toBe("CORRECT");
    expect(judgeField("Trilogy 100", occ, F("Trilogy ??0", "partial", "low"))).toBe("CORRECT");
    expect(judgeField("Trilogy 100", occ, F(null, "illegible", "low"))).toBe("CORRECT");
    expect(judgeField("Trilogy 100", occ, F("Trilogy 200", "clear", "high"))).toBe("WRONG");
  });
});

describe("집계", () => {
  const t = (id: string, model: string, specId: string | null, strength: LabelTruth["strength"], occluded = {}): LabelTruth => ({
    id, split: "dev", kind: specId ? "real" : "decoy", strength, template: "T1", truthSpecId: specId, decoy: !specId,
    fields: { manufacturer: "Philips Respironics", model, ratedPower: "60W", voltage: "AC 220V ~ 60Hz", batteryText: null }, personalInfoVisible: false, occluded,
  });
  it("헤드라인 분모는 열화 실기종만, 미끼 확신 매칭은 무플래그 오매칭", () => {
    const items = [
      scoreItem(t("a", "Trilogy 100", "TRILOGY100", "full"), out(F("Trilogy 200"))), // 자신 있게 틀림
      scoreItem(t("b", "Trilogy 100", "TRILOGY100", "full"), out(F("Trilogy 100"))),
      scoreItem(t("c", "Trilogy 10O", null, "none"), out(F("Trilogy 100"))), // 미끼를 실기종으로 확신 → 오매칭
      scoreItem(t("d", "Astral 105", null, "none"), out(F("Astral 105"))),
    ];
    const m = aggregate(items);
    expect(m.degradedModelConfidentWrong).toEqual({ k: 1, n: 2 });
    expect(m.unflaggedMismatch).toEqual({ k: 1, n: 4 });
    expect(m.unregisteredToReview).toEqual({ k: 1, n: 2 });
    expect(m.dbMatchRate).toEqual({ k: 1, n: 2 });
  });
});
