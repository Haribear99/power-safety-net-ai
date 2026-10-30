// 랜딩(/) — spec.md 1.1·1.3절, 9절 E2E '/', 인수인계서 4.2절 A·B·G.
import { evidence, expect, expectReadable, test } from "./fixtures";

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

  test("두 시계: 막대·주변에 출처 없는 시간 차 숫자 없음, 막대 라벨 그대로 @mobile", async ({ page }) => {
    await page.goto("/");
    const clocks = page.getByTestId("two-clocks");
    await expect(page.getByTestId("gap-bar")).toHaveText("");
    await expect(clocks).toContainText("목표 상한까지 남는 차이 · 내장배터리만, 외장·이송 없을 때의 단순 비교");
    await page.waitForTimeout(3800); // 라벨은 시계 애니메이션(3초) 뒤 나타난다
    await expectReadable(clocks.getByText("목표 상한까지 남는 차이"), "두 시계 막대 라벨");
    // 시계 값(배터리 3시간, 24:00:00) 밖의 'n시간' 숫자는 두 출처를 빼서 만든 파생 수치라 금지(spec.md 9절 '출처 없는 시간 차')
    const text = (await clocks.innerText()).replace(/24:00:00/g, "");
    const hours = [...text.matchAll(/\d+(\.\d+)?\s*시간/g)].map((m) => m[0].replace(/\s/g, ""));
    expect(hours.filter((h) => h !== "3시간"), "두 시계 영역의 시간 숫자").toEqual([]);
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
  // 정적 파일과 Next의 링크 미리 받기(_rsc)는 화면 이동 준비라 제외하고, 데이터 요청(fetch·xhr)만 본다
  page.on("request", (r) => { if (["fetch", "xhr"].includes(r.resourceType()) && !r.url().includes("_rsc=")) reqs.push(r.url()); });
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

test("공개 단서 문장과 숫자 = evidence.json @mobile", async ({ page }) => {
  await page.goto("/");
  const k = evidence.kpiOverPredict.rule;
  const overPct = ((k.k / k.n) * 100).toFixed(1);
  // 숫자만이 아니라 뜻(모의·실제보다 긴 경우·사후 집계)이 같은 항목 안에 있어야 한다(인수인계서 4.2절 B-4)
  const kpiItem = page.getByText(`모의에서는 이 하한이 실제보다 긴 경우가 ${overPct}%`, { exact: false });
  await expect(kpiItem).toHaveCount(1);
  await expect(kpiItem).toContainText("사후 집계");
  await expectReadable(kpiItem, "하한 14.9% 단서 문장");
  const noticeClue = page.getByText("시연용·담당자 확인 뒤 발송, 실제 발송 기능 없음", { exact: false });
  await expect(noticeClue).toHaveCount(1);
  await expectReadable(noticeClue, "알림 소개(실제 발송 기능 없음)");
  const apt = evidence.calib.apt;
  await expect(page.getByTestId("avg-line")).toContainText(`${apt.n}건 중 ${apt.gt12h}건`);
  // 끝 카드 첫 줄: 현행 대비 감소율(evidence.lab.e2.pooledRel, ClosingCard의 pct())
  await expect(page.getByTestId("closing-card")).toContainText(`${(evidence.lab.e2.pooledRel * 100).toFixed(1)}% 감소`);
});

test("랜딩 본문 글자 16px 이상(표지·각주 제외) @mobile", async ({ page }) => {
  // spec.md 1.3절 품질 예산 '본문 16px 이상', 인수인계서 4.2절 32번. 표지·각주는 명세가 정한 작은 글씨라 뺀다.
  // 10/24 발견·수정: 끝 카드 본문 문단이 15px였다(ClosingCard 16px로)
  await page.goto("/");
  const CAPTION = ["가정 시나리오 범위", "배터리 하한:", "복구 범위:", "AI 기반 운용 · 시연용"];
  const small = await page.evaluate((caption) => [...document.querySelectorAll("main p, main li")]
    .filter((e) => !e.closest("footer") && (e.textContent ?? "").trim().length > 0 && !caption.some((c) => (e.textContent ?? "").trim().startsWith(c)))
    .map((e) => [parseFloat(getComputedStyle(e).fontSize), (e.textContent ?? "").trim().slice(0, 30)] as const)
    .filter(([px]) => px < 16), CAPTION);
  expect(small, "16px 미만 본문").toEqual([]);
});
