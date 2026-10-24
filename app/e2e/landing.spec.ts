// 랜딩(/) — spec.md 1.1·1.3절, 9절 E2E '/', 인수인계서 4.2절 A·B·G.
import { evidence, expect, test } from "./fixtures";

test.describe("랜딩 첫 화면", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("390×844에서 스크롤 없이 배너·H1·두 시계·CTA @mobile", async ({ page }) => {
    await page.goto("/");
    for (const id of ["legal-banner", "two-clocks", "cta-ops"]) {
      const b = await page.getByTestId(id).boundingBox();
      expect(b, id).not.toBeNull();
      expect(b!.y + b!.height, `${id}가 첫 화면 아래로 내려감`).toBeLessThanOrEqual(844);
    }
    const h1 = await page.locator("h1").boundingBox();
    expect(h1!.y + h1!.height).toBeLessThanOrEqual(844);
    await expect(page.locator("h1")).toHaveText("배터리가 먼저 끝날까, 전기가 먼저 올까");
  });

  test("첫 화면(배너 제외)에 AI·시뮬레이션·예측·생명·안전 없음 @mobile", async ({ page }) => {
    await page.goto("/");
    const words = await page.evaluate(() => {
      const banner = document.querySelector('[data-testid="legal-banner"]');
      const out: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const n = walker.currentNode as Text;
        const el = n.parentElement;
        if (!el || banner?.contains(el) || !n.textContent?.trim()) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none" || el.closest(".sr-only")) continue;
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.top < innerHeight) out.push(n.textContent);
      }
      return out.join(" ");
    });
    for (const w of ["AI", "시뮬레이션", "예측", "생명", "안전"]) expect(words, `첫 화면에 '${w}'`).not.toContain(w);
  });

  test("두 시계 막대에 시간 숫자 없음, 막대 라벨 그대로 @mobile", async ({ page }) => {
    await page.goto("/");
    const clocks = page.getByTestId("two-clocks");
    await expect(page.getByTestId("gap-bar")).toHaveText("");
    await expect(clocks).toContainText("목표 상한까지 남는 차이 · 내장배터리만, 외장·이송 없을 때의 단순 비교");
    const label = await clocks.locator("text=목표 상한까지").innerText();
    expect(label).not.toMatch(/\d/);
  });

  test("동작 줄이기면 시계가 정지 그림 @mobile", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    const anim = await page.locator(".clock-digits").evaluate((e) => getComputedStyle(e).animationName);
    expect(anim).toBe("none");
  });
});

test("위젯 조작은 네트워크 요청 0 @mobile", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const reqs: string[] = [];
  page.on("request", (r) => { if (!r.url().includes("/_next/static/")) reqs.push(r.url()); });
  const w = page.getByTestId("gap-widget");
  const buttons = w.getByRole("button");
  const n = await buttons.count();
  expect(n).toBeGreaterThanOrEqual(8);
  for (let i = 0; i < n; i++) await buttons.nth(i).click();
  await expect(page.getByTestId("gw-summary")).not.toBeEmpty();
  await page.waitForTimeout(300);
  expect(reqs, "위젯이 요청을 보냄").toEqual([]);
  await expect(w).toContainText("가정 시나리오 범위 · 한전 실시간 예측 아님");
});

test("공개 단서 문장과 숫자 = evidence.json", async ({ page }) => {
  await page.goto("/");
  const k = evidence.kpiOverPredict.rule;
  const overPct = `${((k.k / k.n) * 100).toFixed(1)}%`;
  const main = page.locator("main");
  await expect(main).toContainText(overPct);
  await expect(main).toContainText("실제 발송 기능 없음");
  const apt = evidence.calib.apt;
  await expect(page.getByTestId("avg-line")).toContainText(`${apt.n}건 중 ${apt.gt12h}건`);
  // 끝 카드 첫 줄: 현행 대비 감소율(evidence.lab.e2.pooledRel, ClosingCard의 pct())
  await expect(page.getByTestId("closing-card")).toContainText(`${(evidence.lab.e2.pooledRel * 100).toFixed(1)}% 감소`);
});
