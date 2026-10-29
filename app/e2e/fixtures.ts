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
      // CSS ::before·::after로 그린 글자는 innerText에 없으므로 따로 모은다
      const pseudo = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of [...document.querySelectorAll("body *")].slice(0, 8000)) {
          for (const ps of ["::before", "::after"]) {
            const c = getComputedStyle(el, ps).content;
            if (c && c !== "none" && c !== "normal" && c !== '""') out.push(c.replace(/^["']|["']$/g, ""));
          }
        }
        return out.join(" ");
      }).catch(() => "");
      expect(bannedIn(pseudo), "CSS ::before·::after 글자에 금지 구문").toEqual([]);
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
    // 다른 요소에 덮였는지: 글자가 실제로 그려진 줄 사각형마다 8px 간격으로 찍는다.
    // 마우스 투과(pointer-events: none) 요소도 덮개가 될 수 있으므로 검사 동안만 투과를 끈다(앱은 pointer-events를 쓰지 않음).
    const force = document.createElement("style");
    force.textContent = "*, *::before, *::after { pointer-events: auto !important; }";
    document.head.appendChild(force);
    const paints = (e: Element) => {
      // 그 자리에 실제로 무언가를 그리는 요소만 덮개로 센다(투명한 빈 상자는 덮지 않음)
      const s = getComputedStyle(e);
      if (Number(s.opacity) === 0 || s.visibility === "hidden") return false;
      if (/^(IMG|SVG|CANVAS|VIDEO|svg|IFRAME)$/.test(e.tagName)) return true;
      const bgA = Number((s.backgroundColor.match(/[\d.]+/g) ?? ["0", "0", "0", "0"])[3] ?? 1);
      return bgA > 0 || s.backgroundImage !== "none" || s.backdropFilter !== "none";
    };
    // 글자 조각(텍스트 노드)마다: 그 글자를 가진 요소(또는 그 조상)에 닿기 전에 무언가를 그리는 요소가 있으면 덮임.
    // 같은 요소 안의 자식(예: 배너 안에 끼운 띠)도 글자를 가진 요소가 아니면 덮개다.
    const range = document.createRange();
    const lines: DOMRect[] = [];
    const owners = new Set<HTMLElement>([he]);
    let covered = 0, sampled = 0;
    const tw = document.createTreeWalker(he, NodeFilter.SHOW_TEXT);
    while (tw.nextNode()) {
      const tn = tw.currentNode as Text;
      if (!tn.textContent?.trim() || !tn.parentElement) continue;
      const owner = tn.parentElement;
      if (owner.closest(".sr-only") || getComputedStyle(owner).display === "none") continue;
      owners.add(owner);
      range.selectNodeContents(tn);
      for (const ln of [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < innerHeight)) {
        lines.push(ln);
        for (let x = ln.left + 2; x < ln.right - 1; x += 8) {
          sampled++;
          for (const p of document.elementsFromPoint(x, ln.top + ln.height / 2)) {
            if (p === owner || p.contains(owner)) break; // 글자를 가진 요소(또는 그 조상)에 닿음: 덮개 없음
            if (paints(p)) { covered++; break; }
          }
        }
      }
    }
    force.remove();
    if (sampled === 0) covered = 1;
    // 잘라냄·흐림(레드팀 10/24 R4-1): 글자를 가진 요소마다(검사 대상 안쪽 요소 포함) 문서 끝까지 clip-path·filter·mask가 있거나,
    // 넘침을 숨기는 조상(overflow ≠ visible) 안에서 글자 줄이 잘리거나, 말줄임으로 잘리면 읽을 수 없다
    const clipped: string[] = [];
    const seen = new Set<HTMLElement>();
    for (const start of owners) for (let a: HTMLElement | null = start; a && !seen.has(a); a = a.parentElement) {
      seen.add(a);
      const s = getComputedStyle(a);
      if (s.clipPath && s.clipPath !== "none") clipped.push(`${a.tagName} clip-path`);
      if (s.filter && s.filter !== "none") clipped.push(`${a.tagName} filter ${s.filter}`);
      const mask = (s as unknown as { maskImage?: string; webkitMaskImage?: string });
      if ((mask.maskImage && mask.maskImage !== "none") || (mask.webkitMaskImage && mask.webkitMaskImage !== "none")) clipped.push(`${a.tagName} mask`);
      if (s.overflowX !== "visible" || s.overflowY !== "visible") {
        const box = a.getBoundingClientRect();
        const scrolls = /auto|scroll/.test(s.overflowX + s.overflowY); // 스크롤로 볼 수 있는 상자는 잘림이 아니다
        if (!scrolls && lines.some((l) => l.left < box.left - 1 || l.right > box.right + 1 || l.top < box.top - 1 || l.bottom > box.bottom + 1)) clipped.push(`${a.tagName} overflow 잘림`);
        if (s.textOverflow === "ellipsis" && a.scrollWidth > a.clientWidth + 1) clipped.push(`${a.tagName} 말줄임`);
      }
      if (a === document.body) break;
    }
    // 실제로 그려진 크기: 계산된 글자 크기가 아니라 줄 높이와 변형(scale·transform·zoom) 비율로 본다
    const lineH = lines.length ? Math.min(...lines.map((l) => l.height)) : 0;
    const scale = he.offsetWidth > 0 ? rect.width / he.offsetWidth : 1;
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
    return { visible, w: rect.width, h: rect.height, font: parseFloat(cs.fontSize), lineH, scale, covered, clipped, contrast: (l1 + 0.05) / (l2 + 0.05) };
  });
  expect(r.visible, `${what}: 보이지 않음`).toBe(true);
  expect(r.w > 4 && r.h > 4, `${what}: 크기 ${r.w}×${r.h}`).toBe(true);
  expect(r.font, `${what}: 글자 크기`).toBeGreaterThanOrEqual(12);
  expect(r.scale, `${what}: 축소 변형(그려진 폭/원래 폭)`).toBeGreaterThan(0.95);
  expect(r.lineH, `${what}: 실제로 그려진 줄 높이(글자 ${r.font}px 대비)`).toBeGreaterThanOrEqual(r.font * 0.9);
  expect(r.covered, `${what}: 글자 일부가 다른 요소에 덮임(또는 그려진 글자 없음)`).toBe(0);
  expect(r.clipped, `${what}: 잘라냄·흐림·말줄임`).toEqual([]);
  expect(r.contrast, `${what}: 명도 대비`).toBeGreaterThanOrEqual(4.5);
  await expectInked(loc, what);
}

/**
 * 픽셀로 확인(레드팀 10/30 C3·C7·H1): 위의 계산식 검사는 글자 채우기 투명(bg-clip-text), 가상 요소 덮개(::after), 배경 이미지,
 * 조상 불투명도, 화면 밖 이동, 자간 겹치기를 놓쳤다. 그래서 실제 화면을 찍어, 글자를 투명하게 한 화면과 비교한다.
 * 달라진 픽셀 = 실제로 그려진 글자. 그 비율과 글자 픽셀 대 배경 픽셀의 대비(상위 5%)를 본다. 작은 글자는 가장자리 흐림 때문에
 * 픽셀 대비가 색 대비보다 낮게 나와(정상 12px 배지 상위 10% 4.46) 문턱은 3.0으로 둔다. WCAG 4.5:1은 위의 계산식 검사가 따로 본다.
 */
async function expectInked(loc: import("@playwright/test").Locator, what: string) {
  const page = loc.page();
  const g = await loc.evaluate((el) => {
    const range = document.createRange();
    const owners = new Set<Element>();
    const vis: DOMRect[] = [];
    let total = 0, inView = 0;
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (tw.nextNode()) {
      const tn = tw.currentNode as Text;
      if (!tn.textContent?.trim() || !tn.parentElement) continue;
      owners.add(tn.parentElement);
      range.selectNodeContents(tn);
      for (const r of range.getClientRects()) {
        if (r.width <= 1 || r.height <= 1) continue;
        total += r.width;
        const l = Math.max(r.left, 0), rt = Math.min(r.right, innerWidth), t = Math.max(r.top, 0), b = Math.min(r.bottom, innerHeight);
        if (rt > l && b > t) { inView += rt - l; vis.push(new DOMRect(l, t, rt - l, b - t)); }
      }
    }
    for (const o of owners) o.setAttribute("data-xr", "");
    // 자간·낱말 간격을 보통으로 되돌렸을 때의 폭과 비교(겹쳐 써서 못 읽게 만드는 자간)
    const widths = () => { let w = 0; const tw2 = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); while (tw2.nextNode()) { const tn = tw2.currentNode as Text; if (!tn.textContent?.trim()) continue; range.selectNodeContents(tn); for (const r of range.getClientRects()) w += r.width; } return w; };
    const st = document.createElement("style");
    st.textContent = "[data-xr] { letter-spacing: normal !important; word-spacing: normal !important; }";
    document.head.appendChild(st);
    const natural = widths();
    st.remove();
    if (!vis.length) return { box: null, total, inView, natural, rendered: total };
    const x = Math.floor(Math.min(...vis.map((r) => r.left))), y = Math.floor(Math.min(...vis.map((r) => r.top)));
    const r2 = Math.ceil(Math.max(...vis.map((r) => r.right))), b2 = Math.ceil(Math.max(...vis.map((r) => r.bottom)));
    return { box: { x, y, width: Math.max(1, r2 - x), height: Math.max(1, b2 - y) }, total, inView, natural, rendered: total };
  });
  const clear = () => loc.evaluate((el) => { el.ownerDocument.querySelectorAll("[data-xr]").forEach((e) => e.removeAttribute("data-xr")); el.ownerDocument.getElementById("__xr")?.remove(); });
  try {
    expect(g.box, `${what}: 화면 안에 그려진 글자 줄이 없음`).not.toBeNull();
    expect(g.inView / Math.max(1, g.total), `${what}: 글자 줄이 화면 밖으로 나감(가로)`).toBeGreaterThanOrEqual(0.9);
    expect(g.rendered / Math.max(1, g.natural), `${what}: 자간을 좁혀 글자가 겹침(그려진 폭/보통 폭)`).toBeGreaterThanOrEqual(0.9);
    const a = await page.screenshot({ clip: g.box!, scale: "css" });
    await loc.evaluate((el) => {
      const st = el.ownerDocument.createElement("style");
      st.id = "__xr";
      st.textContent = "[data-xr] { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; }";
      el.ownerDocument.head.appendChild(st);
    });
    const b = await page.screenshot({ clip: g.box!, scale: "css" });
    const m = await pixelInk(page, a, b);
    if (process.env.XR_LOG) console.log(`[expectInked] ${what}: ink ${m.ink.toFixed(3)} p95 ${m.p95.toFixed(2)} px ${m.n}`);
    expect(m.ink, `${what}: 실제로 그려진 글자 픽셀이 거의 없음(글자 투명·덮개·화면 밖)`).toBeGreaterThanOrEqual(INK_MIN);
    expect(m.p95, `${what}: 그려진 글자의 실제 픽셀 대비(상위 5%)`).toBeGreaterThanOrEqual(INK_CONTRAST_MIN);
  } finally {
    await clear();
  }
}
const INK_MIN = 0.02;
const INK_CONTRAST_MIN = 3.0;

/** 두 스크린샷(PNG)을 빈 보조 페이지의 캔버스로 풀어 비교한다(앱 페이지의 CSP·상태를 건드리지 않음, 의존성 추가 없음) */
async function pixelInk(page: Page, a: Buffer, b: Buffer): Promise<{ ink: number; p95: number; n: number }> {
  const helper = await page.context().newPage();
  try {
    return await helper.evaluate(async ([a64, b64]) => {
      const load = async (s: string) => { const im = new Image(); im.src = `data:image/png;base64,${s}`; await im.decode(); const c = document.createElement("canvas"); c.width = im.width; c.height = im.height; const x = c.getContext("2d")!; x.drawImage(im, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
      const [pa, pb] = await Promise.all([load(a64), load(b64)]);
      const lum = (r: number, g: number, bl: number) => { const f = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl); };
      const cs: number[] = [];
      for (let i = 0; i < pa.length; i += 4) {
        const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
        if (d <= 24) continue;
        const [l1, l2] = [lum(pa[i], pa[i + 1], pa[i + 2]), lum(pb[i], pb[i + 1], pb[i + 2])].sort((x, y) => y - x);
        cs.push((l1 + 0.05) / (l2 + 0.05));
      }
      cs.sort((x, y) => x - y);
      const total = pa.length / 4;
      return { ink: cs.length / total, p95: cs.length ? cs[Math.floor(cs.length * 0.95)] : 1, n: cs.length };
    }, [a.toString("base64"), b.toString("base64")] as const);
  } finally {
    await helper.close();
  }
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
