import { describe, expect, it } from "vitest";
import { robustPhrase } from "./ClosingCard";

describe("끝 카드 ROBUST 쌍 문장(라운드 5)", () => {
  it("기기별 원인 수로 요약하고 기기 순서는 CLASS_ORDER를 따른다", () => {
    const s = robustPhrase([
      { cls: "VENT_3H", cause: "APT_PARTS" }, { cls: "VENT_1H", cause: "APT_FIRE" },
      { cls: "VENT_1H", cause: "APT_PARTS" }, { cls: "VENT_3H", cause: "APT_FIRE" },
      { cls: "O2_PORT", cause: "APT_FIRE" },
    ]);
    expect(s).toBe("인공호흡기 내장 1시간급(정전 원인 2종), 인공호흡기 내장 3시간급(정전 원인 2종), 휴대형 산소(정전 원인 1종)");
  });
  it("빈 목록이면 빈 문자열", () => {
    expect(robustPhrase([])).toBe("");
  });
});
