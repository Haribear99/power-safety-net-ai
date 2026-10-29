// 법정 배너와 고정 머리줄이 겹치지 않는지 — 인수인계서 4.2절 C-8.
// 배너는 글꼴에 따라 약 640~690px 폭에서 두 줄이 된다. 예전에는 /ops 상단 바(top 29px)·/lab 탭 바(top 32px)가 한 줄 높이에 고정돼 있어
// 두 줄이 되면 가렸다(10/24 발견·수정: BannerHeightSync가 --banner-h를 내보내고 두 머리줄이 그 값을 쓴다).
import { BANNER_SHORT, BANNER_TEXT, expect, expectReadable, test } from "./fixtures";

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

// 배너가 두 줄이 되는 폭까지 모든 폭에서 배너 글자가 잘리거나·흐려지거나·덮이지 않고 읽혀야 한다
// (두 줄 문제를 '고정 높이 + 말줄임'으로 덮는 실수 대비, 레드팀 10/24 R4-1)
for (const w of WIDTHS) {
  test(`${w}px: 배너 글자가 잘리지 않고 읽힘(/, /ops, /lab)`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 });
    for (const p of ["/", "/ops", "/lab"]) {
      await page.goto(p);
      const banner = page.getByTestId("legal-banner");
      await expectReadable(banner, `${w}px ${p} 배너`);
      expect((await banner.innerText()).replace(/\s+/g, " ").trim(), `${w}px ${p} 배너 문구`).toBe(w < 640 ? BANNER_SHORT : BANNER_TEXT);
    }
  });
}

// 배너가 실제로 두 줄이 되는 폭을 찾아(글꼴에 따라 폭이 다르므로 고정하지 않음) 그 폭에서 확인한다(레드팀 10/30 L3:
// 배너에 고정 높이(h-[29px])를 주면 두 줄째 글자가 배너 밖으로 넘치는데, 시험 폭에서 한 줄이면 드러나지 않았다)
test("배너가 두 줄이 되는 폭에서도 글자가 배너 상자 안에 있고 머리줄을 가리지 않음", async ({ page }) => {
  await page.goto("/ops?s=PRESET-SUWON");
  await page.getByTestId("start-outage").click();
  const banner = page.getByTestId("legal-banner");
  let found = 0;
  for (let w = 640; w <= 1000 && !found; w += 10) {
    await page.setViewportSize({ width: w, height: 900 });
    const lines = await banner.evaluate((el) => {
      const sp = [...el.querySelectorAll("span")].find((s) => getComputedStyle(s).display !== "none");
      if (!sp) return 0;
      const r = document.createRange();
      r.selectNodeContents(sp);
      return new Set([...r.getClientRects()].filter((x) => x.width > 1).map((x) => Math.round(x.top))).size;
    });
    if (lines >= 2) found = w;
  }
  if (!found) {
    // 이 환경의 글꼴이 좁아 한 줄로 끝나면(로컬 Windows: 긴 문구 565px), 넓은 글꼴 환경을 흉내 내 배너 글자를 키워 640px에서 두 줄을 만든다
    found = 640;
    await page.setViewportSize({ width: found, height: 900 });
    await page.addStyleTag({ content: '[data-testid="legal-banner"] { font-size: 16px !important; }' });
  }
  await page.waitForTimeout(150);
  const spill = await banner.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const r = document.createRange();
    r.selectNodeContents(el);
    return [...r.getClientRects()].filter((x) => x.width > 1 && (x.bottom > box.bottom + 0.5 || x.top < box.top - 0.5)).length;
  });
  expect(spill, `${found}px: 배너 글자 줄이 배너 상자 밖으로 넘침(고정 높이?)`).toBe(0);
  await expectReadable(banner, `${found}px 두 줄 배너`);
  const b = (await banner.boundingBox())!;
  const bar = (await page.locator("header.sticky").first().boundingBox())!;
  expect(bar.y, `${found}px: 배너 아래 ${b.y + b.height}px, 상단 바 위 ${bar.y}px`).toBeGreaterThanOrEqual(b.y + b.height - 0.5);
});
