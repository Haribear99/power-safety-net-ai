// 법정 배너와 고정 머리줄이 겹치지 않는지 — 인수인계서 4.2절 C-8.
// 배너는 글꼴에 따라 약 640~690px 폭에서 두 줄이 된다. 예전에는 /ops 상단 바(top 29px)·/lab 탭 바(top 32px)가 한 줄 높이에 고정돼 있어
// 두 줄이 되면 가렸다(10/24 발견·수정: BannerHeightSync가 --banner-h를 내보내고 두 머리줄이 그 값을 쓴다).
import { expect, test } from "./fixtures";

const WIDTHS = [390, 640, 660, 680, 700, 768, 1024, 1440];

for (const w of WIDTHS) {
  test(`${w}px: 스크롤해도 배너가 /ops 상단 바를 가리지 않음`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto("/ops");
    await page.getByTestId("start-outage").click();
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(300);
    const banner = (await page.getByTestId("legal-banner").boundingBox())!;
    const bar = (await page.locator("main header").first().boundingBox())!;
    expect(bar.y, `배너 아래 ${banner.y + banner.height}px, 상단 바 위 ${bar.y}px`).toBeGreaterThanOrEqual(banner.y + banner.height - 0.5);
  });

  test(`${w}px: 스크롤해도 배너가 /lab 탭 바를 가리지 않음`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto("/lab");
    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(300);
    const banner = (await page.getByTestId("legal-banner").boundingBox())!;
    const nav = (await page.getByRole("navigation", { name: "랩 탭" }).boundingBox())!;
    expect(nav.y, `배너 아래 ${banner.y + banner.height}px, 탭 바 위 ${nav.y}px`).toBeGreaterThanOrEqual(banner.y + banner.height - 0.5);
  });
}
