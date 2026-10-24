// 공통 고정장치: /api/** 차단, 위치 권한 감시, /ops 조작 도우미.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test as base, type Page } from "@playwright/test";

export const PAGES = ["/", "/ops", "/ops/119", "/household", "/lab", "/ledger", "/about"] as const;
export const BANNER_TEXT = "본 서비스는 AI 기반으로 운용됩니다 · AI: 라벨 판독·알림 문장 · 계산: 검증 가능한 규칙 · 결정: 담당자 · 시연용 합성 데이터";
export const BANNER_SHORT = "AI 기반 운용(판독·알림) · 계산은 규칙 · 합성 데이터";

/** 화면 숫자의 정본(직접 편집 금지, scripts/sync-evidence.ts가 만든다) */
export const evidence = JSON.parse(readFileSync(path.join(__dirname, "..", "src", "data", "evidence.json"), "utf-8"));

type Fixtures = {
  /** 시험이 직접 가로채지 않은 /api/** 호출(실제 AI·예산 사용을 막기 위해 중단시키고 기록) */
  apiCalls: string[];
};

export const test = base.extend<Fixtures>({
  apiCalls: [async ({ page }, use) => {
    const calls: string[] = [];
    // 먼저 등록한 라우트가 가장 낮은 우선순위다. 시험이 page.route로 따로 등록한 /api 응답이 이것보다 먼저 쓰인다.
    await page.route("**/api/**", (route) => { calls.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`); return route.abort(); });
    // 위치 권한 호출 감시(spec.md 9절: navigator.geolocation 호출 0)
    await page.addInitScript(() => {
      const w = window as unknown as { __geoCalls: number };
      w.__geoCalls = 0;
      const g = navigator.geolocation;
      if (g) {
        for (const k of ["getCurrentPosition", "watchPosition"] as const) {
          Object.defineProperty(g, k, { configurable: true, value: () => { w.__geoCalls++; return 0; } });
        }
      }
    });
    await use(calls);
    // 어떤 화면도 시험이 허락하지 않은 API를 부르면 안 된다(샘플·위젯은 호출 0, AI 호출은 버튼을 눌렀을 때만)
    expect(calls, "시험이 가로채지 않은 /api 호출이 있었습니다").toEqual([]);
  }, { auto: true }],
});
export { expect };

export async function geoCalls(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __geoCalls?: number }).__geoCalls ?? 0);
}

/** 모의 정전을 일으키고 처리 순서 표가 뜰 때까지 기다린다 */
export async function startOutage(page: Page, preset = "PRESET-SUWON") {
  await page.goto(`/ops?s=${preset}`);
  await page.getByTestId("start-outage").click();
  await expect(page.getByTestId("lane-table")).toBeVisible();
}

/** 처리 순서 표에서 레인별 '제안' 행 id 목록. device를 주면 기기 칸에 그 글자가 든 행만(예: "인공호흡기") */
export async function rowIds(page: Page, lane: string, device?: string): Promise<string[]> {
  return page.locator(`[data-testid="lane-table"] tbody tr[data-lane="${lane}"]`).evaluateAll((rows, dev) =>
    rows.filter((r) => r.textContent?.includes("제안") && (!dev || r.children[1]?.textContent?.includes(dev)))
      .map((r) => r.getAttribute("data-testid")!.replace(/^row-/, "")), device);
}

/** 처리 순서 표의 '제안' 행: id·레인·기기·남은 하한(시간, 소진·미계산이면 null) */
export async function rowsInfo(page: Page): Promise<{ id: string; lane: string; device: string; lH: number | null }[]> {
  return page.locator('[data-testid="lane-table"] tbody tr').evaluateAll((rows) => rows
    .filter((r) => r.textContent?.includes("제안"))
    .map((r) => {
      const l = r.children[2]?.textContent ?? "";
      const m = /^([\d.]+)h/.exec(l.trim());
      return { id: r.getAttribute("data-testid")!.replace(/^row-/, ""), lane: r.getAttribute("data-lane")!, device: r.children[1]?.textContent ?? "", lH: m ? Number(m[1]) : null };
    }));
}

export async function laneCounts(page: Page): Promise<Record<string, number>> {
  return page.locator('[data-testid="lane-table"] tbody tr').evaluateAll((rows) => {
    const m: Record<string, number> = {};
    for (const r of rows) { const l = r.getAttribute("data-lane")!; m[l] = (m[l] ?? 0) + 1; }
    return m;
  });
}

export async function openRow(page: Page, id: string) {
  await page.getByTestId(`open-${id}`).click();
  await expect(page.getByTestId("approve-drawer")).toBeVisible();
}

/** 한전 복구 예정 통보(시간)를 넣어 HOLD·PROPOSE_ASSIGN 판정이 가능하게 한다 */
export async function enterNotice(page: Page, hours: string) {
  await page.getByLabel("복구까지 남은 시간(시간)").fill(hours);
  await page.getByTestId("notice-submit").click();
}

/** 화면 안 링크로 /ops ↔ /ops/119 이동(주소창 이동은 탭 상태를 초기화하므로 쓰지 않는다) */
export async function goto119(page: Page) {
  await page.getByTestId("link-119").click();
  await expect(page).toHaveURL(/\/ops\/119$/);
}
export async function backToOps(page: Page) {
  await page.getByRole("link", { name: "← 운영자 화면" }).click();
  await expect(page.getByTestId("lane-table")).toBeVisible();
}

export async function auditRows(page: Page): Promise<string[]> {
  const t = page.getByTestId("audit-table");
  if (!(await t.count())) return [];
  return t.locator("tbody tr").allInnerTexts();
}
