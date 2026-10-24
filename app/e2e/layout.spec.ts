// 법정 배너와 고정 머리줄이 겹치지 않는지 — 인수인계서 4.2절 C-8.
// 배너는 글꼴에 따라 약 640~690px 폭에서 두 줄이 된다. 지금 /ops 상단 바(top 29px)·/lab 탭 바(top 32px)는 한 줄 배너 높이에 고정돼 있어
// 두 줄이 되면 가린다(10/24 확인, 수정은 브랜치 fix/screen-defects). 폭이 아니라 '배너가 실제로 두 줄인지'로 알려진 결함을 판정한다(글꼴 차이 대비).
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const WIDTHS = [390, 640, 660, 680, 700, 768, 1024, 1440];
const ONE_LINE_MAX = 32;

async function markKnownDefect(page: Page) {
  const h = (await page.getByTestId("legal-banner").boundingBox())!.height;
  test.fail(!process.env.SCREEN_FIXES && h > ONE_LINE_MAX, `알려진 결함: 배너가 두 줄(${h}px) — fix/screen-defects 병합 전까지 실패가 정상`);
}

for (const w of WIDTHS) {
  test(`${w}px: 스크롤해도 배너가 /ops 상단 바를 가리지 않음`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto("/ops");
    await page.getByTestId("start-outage").click();
    await markKnownDefect(page);
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(300);
    const banner = (await page.getByTestId("legal-banner").boundingBox())!;
    const bar = (await page.locator("main header").first().boundingBox())!;
    expect(bar.y, `배너 아래 ${banner.y + banner.height}px, 상단 바 위 ${bar.y}px`).toBeGreaterThanOrEqual(banner.y + banner.height - 0.5);
  });

  test(`${w}px: 스크롤해도 배너가 /lab 탭 바를 가리지 않음`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto("/lab");
    await markKnownDefect(page);
    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(300);
    const banner = (await page.getByTestId("legal-banner").boundingBox())!;
    const nav = (await page.getByRole("navigation", { name: "랩 탭" }).boundingBox())!;
    expect(nav.y, `배너 아래 ${banner.y + banner.height}px, 탭 바 위 ${nav.y}px`).toBeGreaterThanOrEqual(banner.y + banner.height - 0.5);
  });
}
