// /ops·/ops/119 — spec.md 1.4·1.5절, 9절 E2E '/ops', 인수인계서 4.2절 D(사람 승인 구조와 화면 안 로직).
// 수원형 프리셋 기준(정전 직후 배정 제안·대기 0건, 한전 통보 1시간을 넣으면 배정 제안 1·대기 6).
import type { Page } from "@playwright/test";
import { auditRows, backToOps, enterNotice, expect, goto119, laneCounts, openRow, rowIds, startOutage, test } from "./fixtures";

async function approve(page: Page, id: string) {
  await openRow(page, id);
  await page.getByTestId("approve").click();
  await expect(page.getByTestId("approve-drawer")).toContainText("승인됨");
}

test("수동검토 행이 맨 위, 승인 전 119 화면은 빈 화면", async ({ page }) => {
  await startOutage(page);
  const first = page.locator('[data-testid="lane-table"] tbody tr').first();
  await expect(first).toHaveAttribute("data-lane", "MANUAL_REVIEW");
  const counts = await laneCounts(page);
  expect(counts.MANUAL_REVIEW).toBeGreaterThan(0);
  expect(counts.PROPOSE_ASSIGN ?? 0, "통보 전에는 배정 제안 0").toBe(0);
  expect(counts.HOLD ?? 0, "통보 전에는 대기 0").toBe(0);
  await goto119(page);
  await expect(page.getByTestId("empty-119")).toBeVisible();
  await expect(page.getByTestId("purge-119")).toBeDisabled();
});

test("승인할 배정이 없는 레인(수동검토·미배정·대기)은 승인 버튼 비활성", async ({ page }) => {
  await startOutage(page);
  for (const lane of ["MANUAL_REVIEW", "UNSERVED_VISIBLE"]) {
    const [id] = await rowIds(page, lane);
    expect(id, `${lane} 행 있음`).toBeTruthy();
    await openRow(page, id);
    await expect(page.getByTestId("approve"), lane).toBeDisabled();
  }
  await enterNotice(page, "1");
  const [hold] = await rowIds(page, "HOLD");
  expect(hold, "통보 뒤 대기 행").toBeTruthy();
  await openRow(page, hold);
  await expect(page.getByTestId("approve")).toBeDisabled();
});

test("119 승인 → 3필드(세 번째는 절대 시각) → 파기 → 빈 화면, 파기 가구는 보호자 알림 없음", async ({ page }) => {
  await startOutage(page);
  const [id] = await rowIds(page, "FALLBACK_119");
  await approve(page, id);
  expect((await auditRows(page)).some((t) => t.includes(id) && t.includes("APPROVE"))).toBe(true);
  await goto119(page);
  const row = page.getByTestId("row-119");
  await expect(row).toHaveCount(1);
  await expect(row.locator("dt")).toHaveText(["위치", "기기", "예상 안전시간"]);
  await expect(row.locator("dd")).toHaveCount(3);
  await expect(row.locator('[data-field="expectedSafeUntil"]')).toContainText(/소진 하한 시각 \d\d:\d\d\(모의시각\)/);
  await page.getByTestId("purge-119").click();
  await expect(page.getByTestId("empty-119")).toBeVisible();
  await backToOps(page);
  await openRow(page, id);
  await expect(page.getByTestId("notice-blocked")).toContainText("보호자 알림 없음");
  expect((await auditRows(page)).some((t) => t.includes("PURGE_119"))).toBe(true);
});

test("배정 제안 승인 행은 119 화면에 나오지 않음", async ({ page }) => {
  await startOutage(page);
  await enterNotice(page, "1");
  const counts = await laneCounts(page);
  expect(counts.PROPOSE_ASSIGN, "수원형 통보 1시간 → 배정 제안 1").toBe(1);
  expect(counts.HOLD, "수원형 통보 1시간 → 대기 6").toBe(6);
  const [id] = await rowIds(page, "PROPOSE_ASSIGN");
  await approve(page, id);
  await goto119(page);
  await expect(page.getByTestId("empty-119")).toBeVisible();
});

test("수정은 사유 코드 + 자유문 5자 이상 없으면 저장 불가", async ({ page }) => {
  await startOutage(page);
  const [id] = await rowIds(page, "MANUAL_REVIEW");
  await openRow(page, id);
  const before = (await auditRows(page)).length;
  await page.getByText("수정", { exact: true }).click();
  await page.getByTestId("modify-submit").click();
  await expect(page.getByTestId("approve-drawer").getByRole("alert")).toHaveText("사유 코드와 자유문 5자 이상이 필요합니다");
  await page.getByTestId("modify-code").selectOption({ index: 1 });
  await page.getByTestId("modify-text").fill("짧음");
  await page.getByTestId("modify-submit").click();
  await expect(page.getByTestId("approve-drawer").getByRole("alert")).toHaveText("사유 코드와 자유문 5자 이상이 필요합니다");
  expect((await auditRows(page)).length).toBe(before);
  await page.getByTestId("modify-text").fill("현장 확인 결과 반영");
  await page.getByTestId("modify-submit").click();
  await expect(page.getByTestId("approve-drawer")).toContainText("수정됨");
  expect((await auditRows(page)).some((t) => t.includes(id) && t.includes("MODIFY"))).toBe(true);
});

test("재신고 빈칸은 거부, 승인 뒤 하한 감소 → 재검토 배지·감사 행·알림 보류", async ({ page }) => {
  await startOutage(page);
  // 도착 조건(0.8×하한 안 도착)이 있는 배정 제안 가구라야 하한이 줄 때 재검토가 뜬다. 수원형은 통보 1시간 뒤 1건(배터리 있는 기기)
  await enterNotice(page, "1");
  const [id] = await rowIds(page, "PROPOSE_ASSIGN");
  await approve(page, id);
  const before = (await auditRows(page)).length;
  await page.getByText("가구 재신고(시연)").click();
  await page.getByTestId("rereport").click();
  await page.waitForTimeout(200);
  expect((await auditRows(page)).length, "빈칸 재신고가 저장됨").toBe(before);
  await expect(page.getByTestId(`recheck-${id}`)).toHaveCount(0);
  await page.getByLabel("재신고 충전량 퍼센트").fill("0");
  await page.getByTestId("rereport").click();
  await expect(page.getByTestId(`recheck-${id}`)).toBeVisible();
  await expect(page.getByTestId("notice-blocked")).toContainText("보호자 알림 보류");
  expect((await auditRows(page)).some((t) => t.includes(id) && t.includes("RECHECK_FLAG"))).toBe(true);
});

test("보호자 알림: 고정 문안·소리로 듣기, AI 표지는 고정 문안일 때 없음", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __spoken: string[] };
    w.__spoken = [];
    window.speechSynthesis.speak = (u: SpeechSynthesisUtterance) => { w.__spoken.push(u.text); };
  });
  await startOutage(page);
  // 배터리가 남은 가구라야 '계산상 …까지'와 '계산값이라 더 일찍 떨어질 수 있습니다'가 붙는다
  await enterNotice(page, "1");
  const [id] = await rowIds(page, "PROPOSE_ASSIGN");
  await approve(page, id);
  const panel = page.getByTestId("notice-panel");
  await expect(panel).toContainText("고정 문안");
  await expect(panel).not.toContainText("AI 생성");
  await expect(page.getByTestId("notice-text")).toContainText("계산값이라 더 일찍 떨어질 수 있습니다");
  await page.getByTestId("notice-speak").click();
  const spoken = await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
  expect(spoken.length).toBe(1);
  await expect(panel.locator('input[aria-label="심사용 접근 코드"]')).toHaveAttribute("type", "password");
});

test("보호자 알림 AI 상태(응답 모킹): AI 생성 표지·검사 통과·실제 발송 기능 없음", async ({ page }) => {
  // 실제 AI를 부르지 않고, 서버가 AI 글을 통과시켰을 때의 응답 모양만 흉내 낸다(화면 표지 검사용)
  await page.route("**/api/notice", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.input, "사실 입력을 보냄").toBeTruthy();
    expect(JSON.stringify(body), "이미지·개인정보는 보내지 않음").not.toMatch(/imageBase64|pseudonym/);
    await route.fulfill({ json: {
      mode: "live", ok: true, promptVersion: "e2e", checkVersion: "e2e",
      composed: { sentences: ["보호자님, 시험용 AI 문장입니다.", "위급하면 119에 전화하세요."], source: "ai", violations: [], rejectedAt: null, footer: "AI가 쓴 글입니다(시험)" },
      meta: { latencyMs: 1200, costUsd: 0, model: "e2e-mock" },
    } });
  });
  await startOutage(page);
  const [id] = await rowIds(page, "GAP_REDUCE");
  await approve(page, id);
  await page.getByTestId("notice-generate").click();
  const panel = page.getByTestId("notice-panel");
  await expect(panel).toContainText("AI 생성");
  await expect(panel).toContainText("검사 통과·담당자 확인 필요");
  await expect(panel).toContainText("실제 발송 기능 없음");
  await expect(page.getByTestId("notice-text")).toContainText("시험용 AI 문장입니다");
});

test("심사위원 경로를 따라가도 클릭 없이 승인 0", async ({ page }) => {
  await page.goto("/ledger#judge");
  await page.locator("#judge + ol").getByRole("link", { name: "운영자 화면" }).click();
  await expect(page).toHaveURL(/\/ops/);
  await page.getByTestId("start-outage").click();
  await page.waitForTimeout(1500);
  const statuses = await page.locator('[data-testid="lane-table"] tbody tr td:last-child').allInnerTexts();
  expect(statuses.filter((t) => /승인|수정/.test(t))).toEqual([]);
  expect(await auditRows(page)).toEqual([]);
});

test("모의시계 ×600에서 대기 시한이 지나면 대기가 남지 않음(HOLD_EXPIRED)", async ({ page }) => {
  test.slow();
  await startOutage(page);
  await enterNotice(page, "1");
  expect((await laneCounts(page)).HOLD).toBeGreaterThan(0);
  await page.getByTestId("speed-600").click();
  await expect.poll(async () => (await laneCounts(page)).HOLD ?? 0, { timeout: 120_000, intervals: [2000] }).toBe(0);
  expect((await auditRows(page)).some((t) => t.includes("HOLD_EXPIRED"))).toBe(true);
});

test("다른 가구를 열면 서랍의 입력(사유·수정 사유)이 비워진다", async ({ page }) => {
  // 10/24 발견·수정: 서랍이 가구마다 새로 만들어지지 않아 앞 가구에 쓰던 사유가 다음 가구로 이어졌다(OpsScreen ApproveDrawer key)
  await startOutage(page);
  const [a, b] = await rowIds(page, "MANUAL_REVIEW");
  await openRow(page, a);
  await page.getByTestId("verify-reason").fill("가구 A 현장 확인");
  await page.getByText("수정", { exact: true }).click();
  await page.getByTestId("modify-text").fill("가구 A 수정 사유");
  await openRow(page, b);
  await expect(page.getByTestId("verify-reason")).toHaveValue("");
  await expect(page.getByTestId("modify-text")).toHaveValue("");
});
