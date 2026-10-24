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
  /** 시험 동안 화면에 한 번이라도 나타난 글자(오류·안내 문구처럼 잠깐 뜨는 것까지) */
  seenText: string[];
};

export const test = base.extend<Fixtures>({
  seenText: [async ({ page }, use) => {
    const seen: string[] = [];
    await page.exposeBinding("__seenPush", (_src, t: string) => { if (t && t.trim()) seen.push(t); });
    await page.addInitScript(() => {
      const push = (window as unknown as { __seenPush: (t: string) => void }).__seenPush;
      const grab = (n: Node) => { const t = n.nodeType === Node.TEXT_NODE ? n.textContent : (n as HTMLElement).innerText ?? n.textContent; if (t) push(t); };
      const start = () => {
        grab(document.body);
        new MutationObserver((ms) => { for (const m of ms) { if (m.type === "characterData") grab(m.target); for (const n of m.addedNodes) grab(n); } })
          .observe(document.body, { childList: true, subtree: true, characterData: true });
      };
      if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
    });
    await use(seen);
    // 시험 동안 나타난 모든 글자에 금지 구문이 없어야 한다(마지막 화면만 보면 잠깐 뜨는 문구를 놓친다)
    expect([...new Set(seen.flatMap(bannedIn))], "시험 중 화면에 나타난 글자에 금지 구문(scripts/claims-rules.json)").toEqual([]);
  }, { auto: true }],
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
    // 다른 요소에 덮였는지: 글자가 실제로 그려진 줄 사각형마다 8px 간격으로 찍어, 맨 위 요소가 이 요소(또는 그 자식)인지
    const range = document.createRange();
    range.selectNodeContents(he);
    const lines = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < innerHeight);
    let covered = 0, sampled = 0;
    for (const ln of lines) {
      for (let x = ln.left + 2; x < ln.right - 1; x += 8) {
        const p = document.elementFromPoint(x, ln.top + ln.height / 2);
        sampled++;
        if (!(p && (p === he || he.contains(p)))) covered++;
      }
    }
    if (sampled === 0) covered = 1;
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
  expect(r.covered, `${what}: 글자 일부가 다른 요소에 덮임(또는 그려진 글자 없음)`).toBe(0);
  expect(r.contrast, `${what}: 명도 대비`).toBeGreaterThanOrEqual(4.5);
}

/** 모의 정전을 일으키고 처리 순서 표가 뜰 때까지 기다린다 */
export async function startOutage(page: Page, preset = "PRESET-SUWON") {
  await page.goto(`/ops?s=${preset}`);
  await page.getByTestId("start-outage").click();
  await expect(page.getByTestId("lane-table")).toBeVisible();
}

/** 처리 순서 표의 행(태그 구조가 아니라 data-lane 속성으로 찾는다: 표를 카드로 바꿔도 같은 속성이면 그대로 동작) */
export const LANE_ROWS = '[data-testid="lane-table"] [data-lane][data-testid^="row-"]';

/** 처리 순서 표에서 레인별 '제안' 행 id 목록 */
export async function rowIds(page: Page, lane: string): Promise<string[]> {
  return page.locator(`[data-testid="lane-table"] [data-lane="${lane}"][data-testid^="row-"]`).evaluateAll((rows) =>
    rows.filter((r) => r.textContent?.includes("제안")).map((r) => r.getAttribute("data-testid")!.replace(/^row-/, "")));
}

export async function laneCounts(page: Page): Promise<Record<string, number>> {
  return page.locator(LANE_ROWS).evaluateAll((rows) => {
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
  return t.locator("[data-action]").allInnerTexts();
}
