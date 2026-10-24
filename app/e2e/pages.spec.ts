// 전 페이지 공통: 법정 배너, 가로 스크롤, 위치 권한, 앵커·절 번호, 접근성(axe).
// 인수인계서 4.2절 C-8·D-22·G-31·32, spec.md 9절 '모든 페이지 배너'·'geolocation 호출 0'·'axe 심각 위반 0'.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { BANNER_SHORT, BANNER_TEXT, expect, geoCalls, PAGES, test } from "./fixtures";

const WIDTHS = [390, 640, 680, 768, 1024, 1440];

for (const p of PAGES) {
  test(`배너 고정·문구 그대로 ${p} @mobile`, async ({ page }) => {
    await page.goto(p);
    const banner = page.getByTestId("legal-banner");
    await expect(banner).toBeVisible();
    const vw = page.viewportSize()!.width;
    // 넓은 화면·좁은 화면 문구가 둘 다 DOM에 있고 CSS로 하나만 보이므로 보이는 글자(innerText)로 본다
    expect((await banner.innerText()).trim()).toBe(vw < 640 ? BANNER_SHORT : BANNER_TEXT);
    // 스크롤해도 상단에 붙어 있어야 한다
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(200);
    const box = await banner.boundingBox();
    expect(box!.y).toBeLessThanOrEqual(1);
    expect(await geoCalls(page)).toBe(0);
  });

  test(`가로 스크롤 없음 ${p}`, async ({ page }) => {
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto(p);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `${w}px에서 가로로 ${over}px 넘침`).toBeLessThanOrEqual(0);
    }
  });
}

test("다른 화면·콘티가 참조하는 앵커와 /lab 절 번호", async ({ page }) => {
  for (const [p, id] of [["/ledger", "judge"], ["/about", "inspiration"], ["/lab", "notice"], ["/lab", "prereg"], ["/lab", "compare"]] as const) {
    await page.goto(`${p}#${id}`);
    await expect(page.locator(`[id="${id}"]`).first(), `${p}#${id}`).toBeAttached();
  }
  await page.goto("/lab");
  const text = await page.locator("main").innerText();
  for (const n of ["①", "②", "③", "④", "⑥", "⑦", "⑧", "⑨"]) expect(text, `/lab 절 번호 ${n}`).toContain(n);
});

// ---- 접근성: 기존 위반은 기준선 파일, 새 위반만 실패 ----
const BASELINE = path.join(__dirname, "axe-baseline.json");
type Key = { page: string; rule: string; target: string };
const baseline: Key[] = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf-8")).violations : [];

async function axeKeys(page: import("@playwright/test").Page, p: string): Promise<Key[]> {
  await page.goto(p);
  // /ops는 정전·서랍(수동검토 행)을 연 상태, /household는 샘플 결과를 띄운 상태까지 본다
  if (p === "/ops") { await page.getByTestId("start-outage").click(); await page.locator('[data-testid^="open-"]').first().click(); }
  if (p === "/household") await page.getByRole("button", { name: /샘플 라벨:/ }).first().click();
  // 그림이 다 그려지고 애니메이션(시계 3초 + 막대 0.6초)이 끝난 뒤 잰다(색 대비 판정이 흔들리지 않게)
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(3800);
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical")
    .flatMap((v) => v.nodes.map((n) => ({ page: p, rule: v.id, target: n.target.join(" ") })));
}

if (process.env.UPDATE_AXE_BASELINE) {
  // 기준선 다시 만들기: UPDATE_AXE_BASELINE=1 npx playwright test e2e/pages.spec.ts -g "기준선" --project=desktop
  test("axe 기준선 다시 만들기", async ({ page }) => {
    test.setTimeout(120_000);
    const all: Key[] = [];
    for (const p of PAGES) all.push(...(await axeKeys(page, p)));
    writeFileSync(BASELINE, JSON.stringify({ _comment: "기존 axe serious·critical 위반. 고치면 줄이고, 새로 넣지 않는다(UPDATE_AXE_BASELINE=1로 다시 만듦)", violations: all }, null, 2) + "\n");
  });
} else {
  for (const p of PAGES) {
    test(`접근성 axe serious·critical: 새 위반 없음 ${p}`, async ({ page }) => {
      const keys = await axeKeys(page, p);
      const fresh = keys.filter((k) => !baseline.some((b) => b.page === k.page && b.rule === k.rule && b.target === k.target));
      expect(fresh, `새 접근성 위반(기준선 e2e/axe-baseline.json에 없는 것)`).toEqual([]);
    });
  }
}
