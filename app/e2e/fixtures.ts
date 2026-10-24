// 공통 고정장치: /api/** 차단, 위치 권한 감시, /ops 조작 도우미.
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test as base, type Page } from "@playwright/test";

export const PAGES = ["/", "/ops", "/ops/119", "/household", "/lab", "/ledger", "/about"] as const;
export const BANNER_TEXT = "본 서비스는 AI 기반으로 운용됩니다 · AI: 라벨 판독·알림 문장 · 계산: 검증 가능한 규칙 · 결정: 담당자 · 시연용 합성 데이터";
export const BANNER_SHORT = "AI 기반 운용(판독·알림) · 계산은 규칙 · 합성 데이터";

/** 화면 숫자의 정본(직접 편집 금지, scripts/sync-evidence.ts가 만든다) */
export const evidence = JSON.parse(readFileSync(path.join(__dirname, "..", "src", "data", "evidence.json"), "utf-8"));

/** 문구 규칙 공용 목록(scripts/claims-rules.json): 금지 구문과 화면 글자에서 허용하는 문맥 */
const RULES = JSON.parse(readFileSync(path.join(__dirname, "..", "scripts", "claims-rules.json"), "utf-8")) as { banned: string[]; renderedAllow: string[] };

/** 화면 글자에 남은 금지 구문(허용 문맥은 지운 뒤 찾는다) */
export function bannedIn(text: string): string[] {
  let t = text.replace(/\s+/g, " ");
  for (const re of RULES.renderedAllow) t = t.replace(new RegExp(re, "g"), " ");
  return RULES.banned.filter((b) => t.includes(b));
}

type Fixtures = {
  /** 시험이 직접 가로채지 않은 /api/** 호출(실제 AI·예산 사용을 막기 위해 중단시키고 기록) */
  apiCalls: string[];
  /** 위치 권한 호출 수(페이지를 옮겨도 누적) */
  geo: { calls: number };
};

export const test = base.extend<Fixtures>({
  geo: [async ({ page }, use) => {
    const geo = { calls: 0 };
    await page.exposeBinding("__geoHit", () => { geo.calls++; });
    // 위치 권한 호출 감시(spec.md 9절: navigator.geolocation 호출 0). 샘플·업로드 같은 조작 뒤 호출도 센다
    await page.addInitScript(() => {
      const w = window as unknown as { __geoHit: () => void };
      const g = navigator.geolocation;
      if (g) {
        for (const k of ["getCurrentPosition", "watchPosition"] as const) {
          Object.defineProperty(g, k, { configurable: true, value: () => { w.__geoHit(); return 0; } });
        }
      }
    });
    await use(geo);
    expect(geo.calls, "위치 권한(geolocation) 호출이 있었습니다").toBe(0);
  }, { auto: true }],
  apiCalls: [async ({ page }, use) => {
    const calls: string[] = [];
    const external: string[] = [];
    // 먼저 등록한 라우트가 가장 낮은 우선순위다. 시험이 page.route로 따로 등록한 /api 응답이 이것보다 먼저 쓰인다.
    await page.route("**/api/**", (route) => { calls.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`); return route.abort(); });
    // 외부 호스트 요청 0(인수인계서 4.2절 34번: 새 외부 글꼴·CDN·추적 금지). 시험 서버(localhost) 밖으로 나가는 요청은 막고 기록한다
    await page.route((url) => url.hostname !== "localhost" && url.hostname !== "127.0.0.1" && url.protocol.startsWith("http"), (route) => {
      external.push(route.request().url()); return route.abort();
    });
    await use(calls);
    // 어떤 화면도 시험이 허락하지 않은 API를 부르면 안 된다(샘플·위젯은 호출 0, AI 호출은 버튼을 눌렀을 때만)
    expect(calls, "시험이 가로채지 않은 /api 호출이 있었습니다").toEqual([]);
    expect(external, "외부 호스트로 나간 요청이 있었습니다").toEqual([]);
    // 시험이 끝난 화면(서랍·알림·업로드를 연 상태 포함)의 보이는 글자에 금지 구문이 없어야 한다(클라이언트에서만 그리는 글자 대비)
    if (!page.isClosed() && page.url().startsWith("http")) {
      const text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
      expect(bannedIn(text), "화면 글자에 금지 구문(scripts/claims-rules.json)").toEqual([]);
    }
  }, { auto: true }],
});
export { expect };

/** 지금 페이지의 보이는 글자에서 금지 구문 확인(시험 중간 단계용) */
export async function expectNoBanned(page: Page) {
  expect(bannedIn(await page.evaluate(() => document.body.innerText)), "화면 글자에 금지 구문").toEqual([]);
}

/**
 * 사람이 실제로 읽을 수 있는지(DOM에 있는지만이 아니라): 보임·크기·글자 크기 12px 이상·다른 요소에 덮이지 않음·대비 4.5:1 이상.
 * 법정 배너, AI 표지, 공개 단서 문장에 쓴다(인수인계서 4.2절 B·C).
 */
export async function expectReadable(loc: import("@playwright/test").Locator, what: string) {
  await loc.scrollIntoViewIfNeeded();
  const r = await loc.evaluate((el) => {
    const he = el as HTMLElement;
    const rect = he.getBoundingClientRect();
    const cs = getComputedStyle(he);
    const visible = typeof he.checkVisibility === "function" ? he.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : true;
    // 다른 요소에 덮였는지: 요소 안 여러 점에서 맨 위 요소가 이 요소(또는 그 자식)인지
    const pts = [[0.5, 0.5], [0.15, 0.5], [0.85, 0.5]].map(([fx, fy]) => document.elementFromPoint(rect.left + rect.width * fx, rect.top + rect.height * fy));
    const covered = pts.filter((p) => !(p && (p === he || he.contains(p)))).length;
    // 대비: 글자색 대 실제 배경(투명이면 위로 올라가며 찾음)
    const parse = (c: string) => { const m = c.match(/[\d.]+/g)!.map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
    let bgEl: HTMLElement | null = he, bg = { r: 255, g: 255, b: 255, a: 0 };
    const layers: { r: number; g: number; b: number; a: number }[] = [];
    while (bgEl) { const c = parse(getComputedStyle(bgEl).backgroundColor); if (c.a > 0) { layers.push(c); if (c.a >= 1) break; } bgEl = bgEl.parentElement; }
    bg = { r: 255, g: 255, b: 255, a: 1 };
    for (const l of layers.reverse()) bg = { r: l.r * l.a + bg.r * (1 - l.a), g: l.g * l.a + bg.g * (1 - l.a), b: l.b * l.a + bg.b * (1 - l.a), a: 1 };
    const fg0 = parse(cs.color);
    const op = Number(cs.opacity);
    const fg = { r: fg0.r * fg0.a * op + bg.r * (1 - fg0.a * op), g: fg0.g * fg0.a * op + bg.g * (1 - fg0.a * op), b: fg0.b * fg0.a * op + bg.b * (1 - fg0.a * op) };
    const lum = (c: { r: number; g: number; b: number }) => { const f = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
    return { visible, w: rect.width, h: rect.height, font: parseFloat(cs.fontSize), covered, contrast: (l1 + 0.05) / (l2 + 0.05) };
  });
  expect(r.visible, `${what}: 보이지 않음`).toBe(true);
  expect(r.w > 4 && r.h > 4, `${what}: 크기 ${r.w}×${r.h}`).toBe(true);
  expect(r.font, `${what}: 글자 크기`).toBeGreaterThanOrEqual(12);
  expect(r.covered, `${what}: 다른 요소에 덮임`).toBe(0);
  expect(r.contrast, `${what}: 명도 대비`).toBeGreaterThanOrEqual(4.5);
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
