// 시연영상 화면 녹화기. 장면 길이는 script/timing.json(TTS 실측)을 따른다.
// CDP 화면 캐스트로 1920×1080(CSS 1280×720 × 1.5) JPEG 프레임을 받아 ffmpeg로 30fps H.264 클립을 만든다.
// 사용(video/에서): npx tsx record/record.mts <base URL> [구간 id ...]
//   예: npx tsx record/record.mts https://power-safety-net-ai.vercel.app
import { chromium, type Locator, type Page } from "playwright";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const [base = "http://localhost:3100", ...only] = process.argv.slice(2);
const timing: { scenes: { id: string; dur: number; lines: { start: number; dur: number }[] }[] } = JSON.parse(readFileSync(path.join(ROOT, "script", "timing.json"), "utf-8"));
const sceneDur = (id: string) => timing.scenes.find((s) => s.id === id)!.dur;
const OUT = path.join(ROOT, "public", "clips");
mkdirSync(OUT, { recursive: true });
const log: string[] = [];
/** MANUAL_APPROVE=1: 창을 띄우고 /ops 승인 버튼은 사람이 직접 누른다 */
const MANUAL = process.env.MANUAL_APPROVE === "1";

// ---- 보이는 커서(녹화 전용, 페이지 기능과 무관) ----
const CURSOR = () => {
  const mk = () => {
    if (document.getElementById("__cur")) return;
    document.documentElement.style.scrollBehavior = "auto";
    const c = document.createElement("div");
    c.id = "__cur";
    c.style.cssText = "position:fixed;left:0;top:0;width:30px;height:30px;z-index:2147483647;pointer-events:none;transform:translate(-200px,-200px);will-change:transform";
    c.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M4 2l15 10.5-6.6 1.2 3.9 7.4-2.7 1.4-3.9-7.4L4 20z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    const ring = document.createElement("div");
    ring.style.cssText = "position:fixed;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid #f59e0b;z-index:2147483646;pointer-events:none;opacity:0";
    document.documentElement.append(c, ring);
    addEventListener("mousemove", (e) => { c.style.transform = `translate(${e.clientX - 3}px,${e.clientY - 2}px)`; }, true);
    addEventListener("mousedown", (e) => {
      ring.style.left = `${e.clientX}px`; ring.style.top = `${e.clientY}px`;
      ring.animate([{ opacity: 0.9, transform: "scale(0.4)" }, { opacity: 0, transform: "scale(1.4)" }], { duration: 450, easing: "ease-out" });
    }, true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mk); else mk();
};

// ---- 동작 도우미 ----
let mx = 640, my = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function glide(page: Page, x: number, y: number, ms = 700) {
  const sx = mx, sy = my, n = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= n; i++) {
    const k = i / n, e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    await page.mouse.move(sx + (x - sx) * e, sy + (y - sy) * e);
    await sleep(ms / n);
  }
  mx = x; my = y;
}
async function moveTo(page: Page, loc: Locator, ms = 700) {
  const b = (await loc.boundingBox())!;
  await glide(page, b.x + b.width / 2, b.y + b.height / 2, ms);
}
async function click(page: Page, loc: Locator, ms = 700) {
  await moveTo(page, loc, ms);
  await sleep(180);
  await page.mouse.down(); await sleep(90); await page.mouse.up();
}
/** 요소를 화면 위 offset(CSS px) 자리로 부드럽게 스크롤. 스크롤 상자 안이면 그 상자를 움직인다 */
async function scrollTo(loc: Locator, offset = 140, ms = 1000, where: "top" | "center" = "top") {
  await loc.evaluate((el, [offset, ms, where]) => new Promise<void>((done) => {
    let box: Element | null = el.parentElement;
    while (box && !(/(auto|scroll)/.test(getComputedStyle(box).overflowY) && box.scrollHeight > box.clientHeight + 4)) box = box.parentElement;
    const win = !box || box === document.body || box === document.documentElement;
    const r = el.getBoundingClientRect();
    const top0 = win ? 0 : box!.getBoundingClientRect().top;
    const view = win ? innerHeight : box!.clientHeight;
    const want = where === "center" ? (view - r.height) / 2 : (offset as number);
    const s = win ? scrollY : box!.scrollTop;
    const d = r.top - top0 - want;
    const t0 = performance.now();
    const f = (t: number) => {
      const k = Math.min(1, (t - t0) / (ms as number)), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      if (win) window.scrollTo(0, s + d * e); else box!.scrollTop = s + d * e;
      if (k < 1) requestAnimationFrame(f); else done();
    };
    requestAnimationFrame(f);
  }), [offset, ms, where] as const);
}
async function jumpTo(loc: Locator, offset = 140) { await scrollTo(loc, offset, 1); await sleep(200); }

/** 법정 배너가 화면 안에 보이는지(인수인계서 5.2절 3번) */
async function bannerCheck(page: Page, tag: string) {
  const ok = await page.evaluate(() => {
    const el = [...document.querySelectorAll("body *")].find((e) => e.children.length === 0 && e.textContent?.startsWith("본 서비스는 AI 기반으로 운용됩니다"));
    if (!el) return false;
    const r = el.getBoundingClientRect(), st = getComputedStyle(el);
    return r.top >= 0 && r.bottom <= innerHeight && r.width > 100 && st.visibility !== "hidden" && Number(st.opacity) > 0.9;
  });
  log.push(`${ok ? "✓" : "✗"} 배너 ${tag}`);
  if (!ok) console.error(`✗ 배너가 안 보임: ${tag}`);
}

// ---- 구간(연속 녹화 단위) ----
type Seg = { id: string; scenes: string[]; url: string; prep?: (p: Page) => Promise<void>; run: (p: Page, at: (scene: string, line: number, plus?: number) => Promise<void>) => Promise<void> };
const SEGS: Seg[] = [
  {
    id: "landing-top", scenes: ["hook", "problem", "solution"], url: "/",
    run: async (p, at) => {
      // 두 시계: 첫 문장(질문) 동안 3:00:00에 멈춰 두고, 둘째 문장(배터리 3시간)에서 애니메이션을 다시 튼다
      const clocks = ".clock-digits,.clock-fill,.gap-reveal,.empty-reveal";
      await p.evaluate((sel) => document.querySelectorAll<HTMLElement>(sel).forEach((e) => { e.style.animation = "none"; void e.offsetHeight; e.style.animation = ""; e.style.animationPlayState = "paused"; }), clocks);
      await at("hook", 1, 0);
      await p.evaluate((sel) => document.querySelectorAll<HTMLElement>(sel).forEach((e) => { e.style.animationPlayState = "running"; }), clocks);
      await at("hook", 2, -0.2);
      await moveTo(p, p.getByText(/7건에 1건꼴로 12시간을 넘겼습니다/), 900);
      await at("problem", 0, -0.3);
      await glide(p, 1180, 650, 400);
      await scrollTo(p.locator("#problem"), 150, 1100);
      await at("solution", 0, -0.2);
      await scrollTo(p.locator("#how"), 130, 1100);
      await bannerCheck(p, "landing-top");
    },
  },
  {
    id: "household", scenes: ["household"], url: "/household",
    run: async (p, at) => {
      await at("household", 0, 0.2);
      await click(p, p.getByRole("button", { name: /깨끗한 라벨/ }), 800);
      await scrollTo(p.getByTestId("result"), 150, 900);
      await sleep(1600);
      await click(p, p.getByRole("button", { name: "이 기종이 맞습니다" }), 700);
      await scrollTo(p.getByTestId("lb-hours"), 0, 900, "center");
      await at("household", 1, -0.6);
      await scrollTo(p.getByTestId("samples"), 150, 900);
      await click(p, p.getByRole("button", { name: /일부 가려짐/ }), 700);
      await scrollTo(p.getByTestId("result"), 150, 1000);
      await moveTo(p, p.getByTestId("extract-table").getByText("일부만 보임 · 확신 낮음").first(), 800);
      await at("household", 2, 0);
      await moveTo(p, p.getByTestId("match-review"), 900);
      await bannerCheck(p, "household");
    },
  },
  {
    id: "ops", scenes: ["ops"], url: "/ops?s=PRESET-SUWON",
    run: async (p, at) => {
      await sleep(300);
      await click(p, p.getByTestId("start-outage"), 900);
      await p.getByTestId("lane-table").waitFor();
      await sleep(500);
      await scrollTo(p.getByTestId("lane-table"), 170, 1000);
      await sleep(500);
      const row = p.getByTestId("row-H030");
      await scrollTo(row, 0, 1300, "center");
      await click(p, p.getByTestId("open-H030"), 800);
      await p.getByTestId("approve-drawer").waitFor();
      await at("ops", 1, -0.4);
      if (MANUAL) {
        // 사람이 직접 승인 버튼을 누른다(인수인계서 5.2절 4번). 창에 뜬 서랍의 「승인」을 마우스로 누를 것
        console.log(">>> 지금 브라우저 창에서 「승인」 버튼을 직접 누르세요");
      } else {
        await moveTo(p, p.getByTestId("approve"), 800);
        await sleep(500);
        await click(p, p.getByTestId("approve"), 150);
      }
      await p.getByTestId("approve-drawer").getByText("승인됨").waitFor({ timeout: MANUAL ? 120_000 : 30_000 });
      await at("ops", 2, 0.3);
      await scrollTo(p.getByTestId("approve-drawer").getByText("계산값이라 더 일찍 떨어질 수 있습니다").first(), 0, 1600, "center");
      await moveTo(p, p.getByTestId("approve-drawer").getByText("계산값이라 더 일찍 떨어질 수 있습니다").first(), 900);
      await bannerCheck(p, "ops");
      await at("ops", 3, -1.6);
      await click(p, p.getByTestId("link-119"), 900);
      await p.waitForURL(/\/ops\/119$/);
      await sleep(600);
      await moveTo(p, p.getByTestId("row-119").first(), 900);
      await bannerCheck(p, "ops-119");
    },
  },
  {
    id: "lab-notice", scenes: ["notice"], url: "/lab",
    prep: async (p) => { await jumpTo(p.getByTestId("n1-examples"), 120); },
    run: async (p, at) => {
      await at("notice", 0, 1.5);
      await scrollTo(p.getByTestId("n1-examples"), 60, 6000);
      await bannerCheck(p, "lab-notice");
    },
  },
  {
    id: "lab-proof", scenes: ["proof"], url: "/lab",
    prep: async (p) => { await jumpTo(p.getByTestId("lab-hero"), 130); },
    run: async (p, at) => {
      await at("proof", 1, 0.4);
      await moveTo(p, p.getByTestId("lab-hero").getByText(/감소/).first(), 900);
      await at("proof", 2, -0.3);
      await glide(p, 1200, 660, 400);
      await scrollTo(p.locator('[id="compare"]'), 130, 1300);
      await at("proof", 3, 0);
      await scrollTo(p.locator('[id="compare"]'), -150, 3000);
      await bannerCheck(p, "lab-proof");
    },
  },
  {
    id: "lab-limit", scenes: ["limit"], url: "/lab",
    prep: async (p) => { await jumpTo(p.locator('[id="empirical"]'), 130); },
    run: async (p, at) => {
      await at("limit", 1, -0.5);
      const table = p.getByText("전원 공백이 생긴 가구 비율(모의, 도구 + 사전 배치)");
      await scrollTo(table, 150, 1300);
      await moveTo(p, p.getByRole("row", { name: /1시간급 인공호흡기/ }).first(), 900);
      await at("limit", 2, 0);
      await moveTo(p, p.getByRole("row", { name: /3시간급 인공호흡기/ }).first(), 900);
      await bannerCheck(p, "lab-limit");
    },
  },
  {
    id: "ledger", scenes: ["ledger"], url: "/ledger",
    prep: async (p) => { await jumpTo(p.getByRole("table").first(), 200); },
    run: async (p, at) => {
      // 표에만 머문다(아래 알림 문단의 옛 문구 「고친 검사는 미측정」은 화면에 담지 않음, Codex 2라운드 2번)
      await at("ledger", 0, 1.0);
      await moveTo(p, p.getByRole("row", { name: /자신 있게 틀림/ }).first(), 900);
      await bannerCheck(p, "ledger");
    },
  },
  {
    id: "landing-next", scenes: ["next"], url: "/",
    // '정전 전 대비' 절만 보여 준다(끝 카드의 옛 문구 「정전 뒤 배정이 닿지 않았습니다」는 화면에 담지 않음, Codex 2라운드 1번)
    prep: async (p) => { await scrollTo(p.locator("#prepare"), 0, 1, "center"); await sleep(200); },
    run: async (p, at) => {
      await at("next", 1, -0.2);
      await moveTo(p, p.locator("#prepare"), 900);
      await at("next", 2, 0);
      await moveTo(p, p.getByText("이 결과는 AI가 아니라 평시 정책에서 나온 모의 결과입니다", { exact: false }), 900);
      await bannerCheck(p, "landing-next");
    },
  },
];

// ---- 녹화 ----
const browser = await chromium.launch({ headless: !MANUAL });
for (const seg of SEGS.filter((s) => !only.length || only.includes(s.id))) {
  const total = seg.scenes.reduce((a, s) => a + sceneDur(s), 0);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5, locale: "ko-KR", timezoneId: "Asia/Seoul" });
  // tsx(esbuild)가 page.evaluate 함수 안에 넣는 __name 도우미를 페이지에도 둔다
  await ctx.addInitScript("window.__name = (f) => f;");
  await ctx.addInitScript(CURSOR);
  const page = await ctx.newPage();
  await page.goto(base + seg.url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await seg.prep?.(page);
  mx = 1100; my = 600;
  await page.mouse.move(mx, my);
  await sleep(500);

  const cdp = await ctx.newCDPSession(page);
  const frames: { t: number; data: string }[] = [];
  cdp.on("Page.screencastFrame", (f) => {
    frames.push({ t: performance.now(), data: f.data });
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  await sleep(150);
  const t0 = performance.now();
  // 장면 s의 문장 i 시작 + plus초까지 기다린다(구간 시작 기준)
  const at = async (scene: string, line: number, plus = 0) => {
    let off = 0;
    for (const s of seg.scenes) { if (s === scene) break; off += sceneDur(s); }
    const target = (off + timing.scenes.find((x) => x.id === scene)!.lines[line].start + plus) * 1000;
    const late = performance.now() - t0 - target;
    if (late > 300) log.push(`! ${seg.id} ${scene}#${line} ${Math.round(late)}ms 늦음`);
    await sleep(Math.max(0, target - (performance.now() - t0)));
  };
  await seg.run(page, at);
  const used = (performance.now() - t0) / 1000;
  if (used > total) log.push(`! ${seg.id}: 동작이 ${used.toFixed(2)}s로 장면 길이 ${total.toFixed(2)}s를 넘음`);
  await sleep(Math.max(0, (total - used) * 1000 + 300));
  await cdp.send("Page.stopScreencast");
  await ctx.close();

  // 프레임 → 클립(첫 프레임은 t0 이전 것 중 마지막부터)
  const dir = path.join(tmpdir(), `psn-rec-${seg.id}`);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const startIdx = Math.max(0, frames.findIndex((f) => f.t >= t0) - 1);
  const use = frames.slice(startIdx);
  const lines: string[] = [];
  use.forEach((f, i) => {
    const name = `f${String(i).padStart(5, "0")}.jpg`;
    writeFileSync(path.join(dir, name), Buffer.from(f.data, "base64"));
    const a = Math.max(f.t, t0), b = i + 1 < use.length ? use[i + 1].t : t0 + total * 1000;
    lines.push(`file '${name}'`, `duration ${Math.max(0.001, (b - a) / 1000).toFixed(4)}`);
  });
  lines.push(`file '${`f${String(use.length - 1).padStart(5, "0")}.jpg`}'`);
  writeFileSync(path.join(dir, "list.txt"), lines.join("\n"));
  const out = path.join(OUT, `${seg.id}.mp4`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", "list.txt", "-vf", "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-crf", "14", "-preset", "medium", "-t", total.toFixed(3), out], { cwd: dir });
  const fps = (use.length / total).toFixed(1);
  log.push(`${seg.id}: ${total.toFixed(2)}s, 프레임 ${use.length}(평균 ${fps}fps) → ${path.relative(ROOT, out)}`);
  console.log(log[log.length - 1]);
}
await browser.close();
appendFileSync(path.join(ROOT, "record", "runs.log"), [`## ${new Date().toISOString()} base ${base} 구간 ${only.join(",") || "전체"}`, ...log, ""].join("\n"));
console.log(log.filter((l) => !l.includes("→")).join("\n"));
