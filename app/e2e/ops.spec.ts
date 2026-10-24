// /ops·/ops/119 — spec.md 1.4·1.5절, 9절 E2E '/ops', 인수인계서 4.2절 D(사람 승인 구조와 화면 안 로직).
// 수원형 프리셋 기준(정전 직후 배정 제안·대기 0건, 한전 통보 1시간을 넣으면 배정 제안 1·대기 6).
import type { Page } from "@playwright/test";
import { auditRows, backToOps, enterNotice, expect, expectReadable, goto119, LANE_ROWS, laneCounts, openRow, rowIds, startOutage, test } from "./fixtures";

async function approve(page: Page, id: string) {
  await openRow(page, id);
  await page.getByTestId("approve").click();
  await expect(page.getByTestId("approve-drawer")).toContainText("승인됨");
}

test("수동검토 행이 맨 위, 승인 전 119 화면은 빈 화면", async ({ page }) => {
  await startOutage(page);
  const first = page.locator(LANE_ROWS).first();
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
    await expectBlockedApprove(page, lane);
  }
  await enterNotice(page, "1");
  const [hold] = await rowIds(page, "HOLD");
  expect(hold, "통보 뒤 대기 행").toBeTruthy();
  await openRow(page, hold);
  await expectBlockedApprove(page, "HOLD");
  // 버튼을 강제로 눌러도(이벤트 직접 발생) 승인 기록이 생기지 않아야 한다
  expect((await auditRows(page)).filter((t) => t.includes("APPROVE")), "막힌 레인에서 승인 기록").toEqual([]);
});

/** 승인 버튼이 진짜로 막혔는지: disabled 속성(aria-disabled만으로는 눌림) + 강제 클릭 뒤에도 '승인됨' 없음 */
async function expectBlockedApprove(page: Page, lane: string) {
  const btn = page.getByTestId("approve");
  await expect(btn, lane).toHaveAttribute("disabled", "");
  await btn.dispatchEvent("click");
  await page.waitForTimeout(150);
  await expect(page.getByTestId("approve-drawer"), `${lane} 강제 클릭 뒤 승인됨`).not.toContainText("승인됨");
}

test("일괄·자동 승인 경로 없음: 승인 한 번 = 승인 행 1개·감사 APPROVE 1건", async ({ page }) => {
  await startOutage(page);
  const [id] = await rowIds(page, "FALLBACK_119");
  await openRow(page, id);
  // 화면 어디에도 '모두·일괄·전체·자동 승인' 같은 버튼이 없어야 한다(인수인계서 4.2절 11번)
  await expect(page.getByRole("button", { name: /(모두|일괄|전체|자동|한꺼번에).*(승인|확정)|(승인|확정).*(모두|일괄|전체)/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /승인/ })).toHaveCount(1);
  await page.getByTestId("approve").click();
  await expect(page.getByTestId("approve-drawer")).toContainText("승인됨");
  expect(await page.locator('[data-testid="audit-table"] [data-action="APPROVE"]').count()).toBe(1);
});

test("119 승인 → 3필드(세 번째는 절대 시각) → 파기 → 빈 화면, 파기 가구는 보호자 알림 없음", async ({ page }) => {
  await startOutage(page);
  const [id] = await rowIds(page, "FALLBACK_119");
  await approve(page, id);
  expect((await auditRows(page)).some((t) => t.includes(id) && t.includes("APPROVE"))).toBe(true);
  await goto119(page);
  const row = page.getByTestId("row-119");
  await expect(row).toHaveCount(1);
  await expect(row.locator("[data-field]")).toHaveCount(3);
  for (const f of ["location", "device", "expectedSafeUntil"]) await expect(row.locator(`[data-field="${f}"]`)).not.toBeEmpty();
  await expect(row.locator('[data-field="expectedSafeUntil"]')).toContainText(/소진 하한 시각 \d\d:\d\d\(모의시각\)/);
  // 행 전체 글자가 세 칸의 이름표와 값으로만 이뤄져야 한다(연락처·층 같은 추가 정보 금지, I7 최소 전달)
  const values = await row.locator("[data-field]").allInnerTexts();
  const squash = (t: string) => t.replace(/\s+/g, "");
  let rest = squash(await row.innerText());
  for (const v of [...values, "위치", "기기", "예상안전시간"]) rest = rest.replace(squash(v), "");
  expect(rest, "119 행에 세 칸 밖의 정보").toBe("");
  await page.getByTestId("purge-119").click();
  await expect(page.getByTestId("empty-119")).toBeVisible();
  await backToOps(page);
  await openRow(page, id);
  await expect(page.getByTestId("notice-blocked")).toContainText("보호자 알림 없음");
  await expect(page.getByTestId("notice-panel"), "파기 가구에 알림 판").toHaveCount(0);
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
  const alert = page.getByTestId("approve-drawer").getByRole("alert");
  const MSG = "사유 코드와 자유문 5자 이상이 필요합니다";
  await page.getByTestId("modify-submit").click();
  await expect(alert).toHaveText(MSG);
  // 사유 코드 없이 긴 자유문 → 거부
  await page.getByTestId("modify-text").fill("현장 확인 결과 반영");
  await page.getByTestId("modify-submit").click();
  await expect(alert).toHaveText(MSG);
  // 사유 코드 + 4자 → 거부(앞뒤 공백은 세지 않음)
  await page.getByTestId("modify-code").selectOption({ index: 1 });
  await page.getByTestId("modify-text").fill("  네글자다  ");
  await page.getByTestId("modify-submit").click();
  await expect(alert).toHaveText(MSG);
  expect((await auditRows(page)).length).toBe(before);
  // 사유 코드 + 정확히 5자 → 저장
  await page.getByTestId("modify-text").fill("다섯글자다");
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
  await expect(page.getByTestId("notice-panel"), "재검토 가구에 알림 판").toHaveCount(0);
  expect((await auditRows(page)).some((t) => t.includes(id) && t.includes("RECHECK_FLAG"))).toBe(true);
});

test("재신고 칸에 공백·글자만 넣으면 거부(0%로 저장되지 않음)", async ({ page }) => {
  // 알려진 결함(레드팀 10/24 발견): Number("   ")은 0이라 공백 입력이 0% 재신고로 저장된다. 수정은 브랜치 fix/screen-defects
  test.fail(!process.env.SCREEN_FIXES, "알려진 결함 — fix/screen-defects 병합 전까지 실패가 정상");
  await startOutage(page);
  await enterNotice(page, "1");
  const [id] = await rowIds(page, "PROPOSE_ASSIGN");
  await approve(page, id);
  const before = (await auditRows(page)).length;
  await page.getByText("가구 재신고(시연)").click();
  for (const v of ["   ", "abc"]) {
    await page.getByLabel("재신고 충전량 퍼센트").fill(v);
    await page.getByTestId("rereport").click();
    await page.waitForTimeout(150);
  }
  expect((await auditRows(page)).length, "공백·글자 재신고가 저장됨").toBe(before);
  await expect(page.getByTestId(`recheck-${id}`)).toHaveCount(0);
});

test("한전 복구 예정 통보: 0·음수·빈칸·글자는 거부", async ({ page }) => {
  await startOutage(page);
  for (const v of ["0", "-1", "", "abc"]) {
    await enterNotice(page, v);
    await page.waitForTimeout(100);
    expect((await laneCounts(page)).HOLD ?? 0, `통보 '${v}'가 저장됨`).toBe(0);
    await expect(page.getByRole("button", { name: "통보 지우기" })).toHaveCount(0);
  }
  await enterNotice(page, "1");
  await expect(page.getByRole("button", { name: "통보 지우기" })).toHaveCount(1);
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
  await expectReadable(panel.getByText("AI 생성", { exact: false }).first(), "알림 AI 생성 표지");
  await expectReadable(panel.getByText(/실제 발송 기능 없음/).first(), "알림 '실제 발송 기능 없음'");
  // 다른 가구의 알림에는 이 AI 글이 나오면 안 된다(사실이 다르면 이전 AI 글을 버림, 4.2절 15번)
  const [other] = (await rowIds(page, "GAP_REDUCE")).filter((x) => x !== id);
  await approve(page, other);
  await expect(page.getByTestId("notice-panel")).toContainText("고정 문안");
  await expect(page.getByTestId("notice-text")).not.toContainText("시험용 AI 문장입니다");
});

test("심사위원 경로를 따라가도 클릭 없이 승인 0", async ({ page }) => {
  await page.goto("/ledger#judge");
  await page.locator("#judge + ol").getByRole("link", { name: "운영자 화면" }).click();
  await expect(page).toHaveURL(/\/ops/);
  await page.getByTestId("start-outage").click();
  await page.waitForTimeout(1500);
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
  // 알려진 결함(10/24 발견): 서랍이 가구마다 새로 만들어지지 않아 앞 가구에 쓰던 사유가 다음 가구로 이어진다. 수정은 브랜치 fix/screen-defects
  test.fail(!process.env.SCREEN_FIXES, "알려진 결함 — fix/screen-defects 병합 전까지 실패가 정상");
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

test("어떤 조작을 해도 감사 기록 없는 결정·일괄 승인이 생기지 않는다(상태 불변식)", async ({ page }) => {
  // 이름이 아니라 행동과 상태로 본다(레드팀 10/24 R2-2·R3-2·R4-2):
  // - 승인·대안 승인 버튼만 빼고 모든 버튼·체크박스·라디오·선택 상자를 조작한다('닫기'·'정지' 포함, 서랍 밖은 승인 전후 두 번)
  // - 판정: 표에서 결정된 가구 = 감사 기록(APPROVE·MODIFY)이 있는 가구, 119 화면 행 ≤ 감사된 119 결정, 승인 1번 = APPROVE 1건
  test.setTimeout(300_000);
  // 이 시험은 시험용 서버의 실제 응답을 쓴다: 서버는 키·예산 저장소 변수가 비어 있어(playwright.config.ts) 외부 호출 없이 재생 모드로 답한다
  await page.route("**/api/**", (r) => r.continue());
  page.on("dialog", (d) => d.dismiss());
  await startOutage(page);
  const SKIP = new Set(["approve", "approve-alt"]);

  /** 상태 불변식: 결정된 행과 감사 기록이 서로 맞는지 */
  async function invariant(label: string) {
    const decided = await page.locator(LANE_ROWS).evaluateAll((rows) => rows
      .filter((r) => !r.textContent?.includes("제안"))
      .map((r) => ({ id: r.getAttribute("data-testid")!.replace(/^row-/, ""), lane: r.getAttribute("data-lane")! })));
    const audited = await page.locator('[data-testid="audit-table"] [data-action="APPROVE"], [data-testid="audit-table"] [data-action="MODIFY"]').allInnerTexts();
    const auditedIds = new Set(audited.map((t) => /\bH\d{3}\b/.exec(t)?.[0]).filter(Boolean) as string[]);
    expect(decided.map((d) => d.id).filter((id) => !auditedIds.has(id)), `${label}: 감사 기록 없이 결정된 가구`).toEqual([]);
    const fallback = decided.filter((d) => d.lane === "FALLBACK_119").length;
    await goto119(page);
    const rows119 = await page.getByTestId("row-119").count();
    await backToOps(page);
    expect(rows119, `${label}: 119 화면 행이 감사된 119 결정보다 많음`).toBeLessThanOrEqual(fallback);
    return { decided: decided.length, approves: await page.locator('[data-testid="audit-table"] [data-action="APPROVE"]').count() };
  }

  /** scope 안의 대화형 요소를 하나씩 모두 조작한다. 서랍이 닫히면 다시 열고, 그 가구가 표에서 빠지면 끝낸다 */
  async function operateAll(id: string, scope: "drawer" | "outside") {
    const reopen = async () => {
      if ((await page.getByTestId(`open-${id}`).count()) === 0) return false;
      await page.getByTestId(`open-${id}`).dispatchEvent("click", undefined, { timeout: 5000 });
      await expect(page.getByTestId("approve-drawer")).toBeVisible();
      return true;
    };
    if (!(await reopen())) return;
    const sel = "button, input[type=checkbox], input[type=radio], select";
    let i = 0;
    for (let guard = 0; guard < 80; guard++) {
      if (!(await page.getByTestId("approve-drawer").isVisible().catch(() => false)) && !(await reopen())) break;
      await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
      const els = scope === "drawer" ? page.getByTestId("approve-drawer").locator(sel) : page.locator(`:is(${sel}):not([data-testid='approve-drawer'] *)`);
      const n = await els.count();
      if (i >= n) break;
      const el = els.nth(i++);
      const tid = (await el.getAttribute("data-testid", { timeout: 1000 }).catch(() => null)) ?? "";
      if (SKIP.has(tid) || tid.startsWith("open-")) continue;
      if (!(await el.isVisible().catch(() => false)) || !(await el.isEnabled().catch(() => false))) continue;
      const tag = await el.evaluate((e) => e.tagName).catch(() => "");
      if (tag === "SELECT") {
        // 시나리오 선택은 다른 시나리오를 새로 불러오는 화면 이동이라 뺀다(정전 전 상태로 돌아감)
        if ((await el.locator("option[value^='PRESET']").count()) > 0) continue;
        const count = await el.locator("option").count();
        for (let k = 0; k < count; k++) await el.selectOption({ index: k }, { timeout: 2000 }).catch(() => {});
      } else {
        await el.click({ timeout: 2000 }).catch(() => {});
      }
      // 모의 시계 배속을 눌렀으면 바로 멈춘다(화면이 계속 다시 그려지면 이후 조작이 흔들림)
      if (tid.startsWith("speed-")) await page.getByTestId("speed-0").click({ timeout: 2000 }).catch(() => {});
      if (!page.url().includes("/ops") || page.url().includes("/ops/119")) await page.goBack();
    }
  }

  // 1) 승인 없이: 서랍 밖 전부 + 레인마다 서랍 안 전부 → 결정 0
  const lanes = Object.keys(await laneCounts(page));
  const [first] = await rowIds(page, lanes[0]);
  await operateAll(first, "outside");
  for (const lane of lanes) {
    const [id] = await rowIds(page, lane);
    if (id) await operateAll(id, "drawer");
  }
  expect(await invariant("승인 전 조작 뒤"), "승인 없이 결정이 생김").toEqual({ decided: 0, approves: 0 });
  // 2) 승인 한 번 = 결정 1·APPROVE 1, 그 뒤 서랍 안·밖을 다시 모두 조작해도 그대로
  const [target] = await rowIds(page, "FALLBACK_119");
  await approve(page, target);
  expect(await invariant("승인 1번 뒤")).toEqual({ decided: 1, approves: 1 });
  await operateAll(target, "drawer");
  await operateAll(target, "outside");
  expect(await invariant("승인 뒤 다시 조작한 뒤"), "승인 뒤 조작으로 결정·승인이 늘어남").toEqual({ decided: 1, approves: 1 });
});

test("같은 가구에서 사실이 바뀌면 이전 AI 글을 버리고 고정 문안으로 돌아간다", async ({ page }) => {
  await page.route("**/api/notice", (route) => route.fulfill({ json: {
    mode: "live", ok: true, promptVersion: "e2e", checkVersion: "e2e",
    composed: { sentences: ["보호자님, 시험용 AI 문장입니다."], source: "ai", violations: [], rejectedAt: null, footer: "" },
    meta: { latencyMs: 10, costUsd: 0, model: "e2e-mock" },
  } }));
  await startOutage(page);
  await enterNotice(page, "1");
  const [id] = await rowIds(page, "PROPOSE_ASSIGN");
  await approve(page, id);
  await page.getByTestId("notice-generate").click();
  await expect(page.getByTestId("notice-text")).toContainText("시험용 AI 문장입니다");
  // 연식 확인으로 배터리 하한이 바뀌면(사실 변경) 결정은 그대로라도 앞서 만든 AI 글은 버려야 한다
  await page.getByText("확인 조작(운영자, 사유 필수)").click();
  await page.getByTestId("verify-reason").fill("대여 기록 확인");
  // 빈 연식으로 저장하면 거부 문구가 뜬다(이 문구도 시험 중 화면 글자 검사 대상)
  await page.getByTestId("verify-age").click();
  await expect(page.getByTestId("approve-drawer").getByRole("status")).toContainText("저장 불가");
  await page.getByLabel("배터리 연식(년)").fill("0");
  await page.getByTestId("verify-age").click();
  await expect(page.getByTestId("approve-drawer").getByRole("status")).toContainText("저장했습니다");
  await expect(page.getByTestId("notice-text")).not.toContainText("시험용 AI 문장입니다");
  await expect(page.getByTestId("notice-panel")).toContainText("고정 문안");
});
