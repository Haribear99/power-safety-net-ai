// /lab·/ledger의 숫자와 공개 단서 — 인수인계서 4.2절 A-1·2(숫자 = evidence.json), B-6(한계·틀린 예측·맞바꿈), D-22(절 번호).
// 기대 문자열은 evidence.json에서 다시 만든다(화면 문자열을 손으로 베끼지 않는다). 띄어쓰기는 무시하고 대조한다.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { evidence as e, expect, expectReadable, test } from "./fixtures";

const squash = (t: string) => t.replace(/\s+/g, "");
const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;
async function mainText(page: Page) { return squash(await page.locator("main").innerText()); }

/** 단서 문장을 감싼 가장 안쪽 요소가 사람이 읽을 수 있는지(레드팀 10/30 C5: sr-only·1px 글씨로 숨겨도 innerText 대조는 통과했음) */
async function expectClueReadable(page: Page, s: string, what: string) {
  const found = await page.locator("main").evaluate((m, want) => {
    const sq = (t: string) => t.replace(/\s+/g, "");
    let best: Element | null = null;
    for (const el of m.querySelectorAll("*")) if (sq(el.textContent ?? "").includes(want) && (!best || best.contains(el))) best = el;
    best?.setAttribute("data-clue-target", "");
    return !!best;
  }, squash(s));
  expect(found, `${what}: 단서 문장을 감싼 요소 없음`).toBe(true);
  try {
    await expectReadable(page.locator("[data-clue-target]"), what);
  } finally {
    await page.locator("main").evaluate((m) => m.querySelectorAll("[data-clue-target]").forEach((e) => e.removeAttribute("data-clue-target")));
  }
}

/** /lab 절 번호와 앵커의 짝(다른 화면·콘티가 「랩 ⑥」「리허설 랩 ⑨」처럼 부른다) */
const LAB_SECTIONS: Record<string, string> = { breakeven: "①", map: "②", compare: "③", patches: "④", prereg: "⑥", empirical: "⑦", "ai-target": "⑧", notice: "⑨" };

test("/lab 절 번호와 앵커의 짝이 그대로", async ({ page }) => {
  await page.goto("/lab");
  for (const [id, n] of Object.entries(LAB_SECTIONS)) {
    await expect(page.locator(`[id="${id}"]`).getByRole("heading").first(), `#${id}`).toContainText(n);
  }
});

test("/lab 공개 단서·숫자 = evidence.json @mobile", async ({ page }) => {
  await page.goto("/lab");
  const t = await mainText(page);
  const must: [string, string][] = [
    ["전체가 모의라는 표지", "모든값은합성가구·가정분포위의모의결과입니다"],
    ["현행 대비 감소율", `현행절차보다공백가구·시간${pct1(e.lab.e2.pooledRel)}감소`],
    ["단순 규칙과 차이 없음", `${e.lab.e2.nCells}개중${e.lab.e2.P0}개조건에서차이가없고`],
    ["가까운 순이 더 나음", `합산하면가까운순이${pct1(Math.abs(e.lab.e2.vsB2.rel))}낫습니다`],
    ["하한 과대예측(사후 집계)", `${e.kpiOverPredict.rule.k.toLocaleString("en-US")}/${e.kpiOverPredict.rule.n.toLocaleString("en-US")}가구·회(${pct1(e.kpiOverPredict.rule.k / e.kpiOverPredict.rule.n)})`],
    ["사후 집계·사전등록 밖 표기", "사후집계,사전등록밖"],
    ["나간 알림 글 결함 판정", `나간글60건중봉인뒤결함판정${e.n1.sentDefects}건`],
    ["맞바꿈", "맞바꿈"],
  ];
  for (const [what, s] of must) expect(t.includes(squash(s)), `/lab ${what}: 「${s}」`).toBe(true);
  for (const [what, s] of must) await expectClueReadable(page, s, `/lab ${what}`);
  // 틀린 예측 공개: 사전등록 대조 절에 틀린 판정(×)과 맞힌 수 표기가 있어야 한다
  const prereg = page.locator('[id="prereg"]');
  await expect(prereg).toContainText("×");
  await expect(prereg).toContainText("맞힘");
  await expect(prereg).toContainText("목표 0건에 못 미칩니다");
  await expectReadable(page.locator('[id="prereg"]').getByRole("heading").first(), "/lab ⑥ 제목");
});

test("/ledger 공개 단서·숫자 = evidence.json @mobile", async ({ page }) => {
  await page.goto("/ledger");
  const t = await mainText(page);
  const s = e.c1.sonnet.modelExact;
  const atLeast = e.n1.atLeastOnly.length;
  const must: [string, string][] = [
    ["라벨 모델명 정확", `${s.k}/${s.n}`],
    ["나간 글 결함 판정", `봉인뒤결함판정${e.n1.sentDefects}/60`],
    ["'적어도' 제외분 포함 합계", `합치면${e.n1.sentDefects + atLeast}/60`],
    ["틀린 글 통과", `틀린글통과${e.n1.badMissed.k}/${e.n1.badMissed.n}`],
    ["예측 틀림 공개", "예측‘5%이하’틀림"],
    ["고친 검사는 미측정", "고침·고친검사는미측정"],
  ];
  for (const [what, str] of must) expect(t.includes(squash(str)), `/ledger ${what}: 「${str}」`).toBe(true);
  for (const [what, str] of must) await expectClueReadable(page, str, `/ledger ${what}`);
});

/** 화면에 나오는 모든 %·분수가 evidence.json·lab.json·params.json의 값(또는 그 비율·반올림)으로 설명되는지(레드팀 10/24 R2-9: 같은 값이 여러 곳에 나올 때 한 곳만 보던 공백) */
function allowedNumbers() {
  const read = (p: string) => JSON.parse(readFileSync(path.join(__dirname, "..", p), "utf-8"));
  const vals = new Set<number>();
  const pairs: [number, number][] = [];
  const walk = (o: unknown) => {
    if (typeof o === "number") vals.add(o);
    else if (o && typeof o === "object") {
      const r = o as Record<string, unknown>;
      for (const [a, b] of [["k", "n"], ["hit", "total"], ["w", "n"]] as const) if (typeof r[a] === "number" && typeof r[b] === "number") pairs.push([r[a] as number, r[b] as number]);
      Object.values(r).forEach(walk);
    }
  };
  for (const p of ["src/data/evidence.json", "src/data/lab.json", "../spec/params.json"]) walk(read(p));
  for (const [k, n] of pairs) if (n) vals.add(k / n);
  const pct = new Set<string>();
  for (const v of vals) for (const x of [v, v * 100]) {
    if (!isFinite(x)) continue;
    for (const y of [x, Math.abs(x)]) for (const d of [0, 1, 2]) pct.add(y.toFixed(d));
  }
  return { vals, pct };
}

for (const p of ["/", "/lab", "/ledger"]) {
  test(`${p} 화면의 모든 %·분수 = 데이터 값`, async ({ page }) => {
    const { vals, pct } = allowedNumbers();
    await page.goto(p);
    const t = await page.locator("main").innerText();
    const badPct = [...new Set([...t.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => m[1]))].filter((x) => !pct.has(x));
    const badFrac = [...new Set([...t.matchAll(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/g)].map((m) => [m[1], m[2]]))]
      .filter(([a, b]) => ![a, b].every((x) => vals.has(Number(x.replace(/,/g, ""))) || pct.has(x.replace(/,/g, ""))))
      .map(([a, b]) => `${a}/${b}`);
    expect(badPct, `${p}: 데이터로 설명되지 않는 %`).toEqual([]);
    expect(badFrac, `${p}: 데이터로 설명되지 않는 분수`).toEqual([]);
  });
}

// ---- 자리별 숫자표: 같은 데이터의 다른 값으로 바꿔치기(예: 14.9% → 4.9%)와 숫자 옆 뜻 바꾸기(「더 줄고」→「더 늘고」)를 잡는다(레드팀 10/24 R3-4, 10/30 C6) ----
// 각 숫자(%·분수·소수·두 자리 이상, 그리고 바로 뒤에 단위가 붙은 한 자리 수 — 「1시간급」「3곳」)의 앞 12자·뒤 12자(공백 제외)를
// 그 숫자의 자리 표지로 삼아 (앞, 값, 뒤) 짝의 모음을 고정한다. 앞뒤 문맥은 같은 줄(블록) 안에서만 따고 nav(탭 바)는 빼므로
// 절 순서 개편·탭 바 개편은 통과한다(레드팀 10/30 H2: 절 경계를 넘던 문맥, 탭 바 숫자). 데스크톱과 모바일 표를 따로 둔다(모바일에서만 숨기기, C4).
// 숫자 앞뒤 문구를 바꾸면 이 표도 바뀌므로, 의도한 변경이면 UPDATE_NUMBER_MAP=1 npx playwright test e2e/clues.spec.ts --workers=1로 다시 만들고(바뀐 짝을 나눠 출력) guard 승인을 받는다.
const NUMBER_MAP = path.join(__dirname, "number-map.json");
const UNIT_AFTER = /^[시분초일주개곳건년회명대배층급차]/;
function numberPairs(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const t = line.replace(/\s+/g, "");
    for (const m of t.matchAll(/\d[\d,]*(?:\.\d+)?(?:%|\/\d[\d,]*)?/g)) {
      const v = m[0], end = m.index! + v.length;
      // 한 자리 정수는 바로 뒤에 단위가 붙을 때만 고정(① 같은 번호·문장 속 작은 수는 뺀다)
      if (!/[%/.]/.test(v) && v.replace(/,/g, "").length < 2 && !UNIT_AFTER.test(t.slice(end))) continue;
      out.push(`${t.slice(Math.max(0, m.index! - 12), m.index)}|${v}|${t.slice(end, end + 12)}`);
    }
  }
  return out.sort();
}
/** main 글자(탭 바 nav는 잠시 숨겨 뺀다). innerText는 블록마다 줄을 나눈다 */
async function mapText(page: Page): Promise<string> {
  return page.locator("main").evaluate((m) => {
    const navs = [...m.querySelectorAll("nav")] as HTMLElement[];
    const prev = navs.map((n) => n.style.display);
    navs.forEach((n) => { n.style.display = "none"; });
    const t = (m as HTMLElement).innerText;
    navs.forEach((n, i) => { n.style.display = prev[i]; });
    return t;
  });
}
const mapKey = (project: string, p: string) => (project === "desktop" ? p : `${project}:${p}`);
const readMap = (): Record<string, string[]> => (existsSync(NUMBER_MAP) ? JSON.parse(readFileSync(NUMBER_MAP, "utf-8")).pages : {});

test.describe("자리별 숫자표", () => {
  if (process.env.UPDATE_NUMBER_MAP) {
    test("자리별 숫자표 다시 만들기 @mobile", async ({ page }, info) => {
      const old = readMap();
      const pages: Record<string, string[]> = { ...old };
      for (const p of ["/", "/lab", "/ledger"]) { await page.goto(p); pages[mapKey(info.project.name, p)] = numberPairs(await mapText(page)); }
      // 검토용 차이: 값이 바뀐 짝(같은 자리, 다른 값)과 문맥만 바뀐 짝(같은 값, 다른 자리)을 나눠 출력한다
      for (const p of ["/", "/lab", "/ledger"]) {
        const k = mapKey(info.project.name, p), now = pages[k], was = old[k] ?? [];
        const gone = was.filter((x) => !now.includes(x)), added = now.filter((x) => !was.includes(x));
        const key = (x: string) => x.split("|");
        const valueChanged = added.filter((a) => gone.some((g) => key(g)[0] === key(a)[0] && key(g)[2] === key(a)[2]));
        const placeChanged = added.filter((a) => !valueChanged.includes(a) && gone.some((g) => key(g)[1] === key(a)[1]));
        console.log(`[${k}] 값이 바뀐 짝 ${valueChanged.length}: ${valueChanged.join(" , ")}`);
        console.log(`[${k}] 문맥만 바뀐 짝 ${placeChanged.length}, 새 짝 ${added.length - valueChanged.length - placeChanged.length}, 없어진 짝 ${gone.length}`);
      }
      writeFileSync(NUMBER_MAP, JSON.stringify({ _comment: "앞 12자|값|뒤 12자 짝(같은 줄 안, nav 제외). 키 '/'는 데스크톱, 'mobile:/'는 모바일. 숫자나 그 앞뒤 문구가 바뀌면 시험이 실패한다. 의도한 변경이면 UPDATE_NUMBER_MAP=1(--workers=1)로 다시 만든다", pages }, null, 2) + "\n");
    });
    return;
  }
  for (const p of ["/", "/lab", "/ledger"]) {
    test(`${p} 숫자가 제자리에 그대로 @mobile`, async ({ page }, info) => {
      await page.goto(p);
      const now = numberPairs(await mapText(page));
      const want = readMap()[mapKey(info.project.name, p)] ?? [];
      expect(want.length, `${p}: 숫자표가 비어 있음(UPDATE_NUMBER_MAP=1로 만들 것)`).toBeGreaterThan(0);
      const missing = want.filter((x) => { const i = now.indexOf(x); if (i < 0) return true; now.splice(i, 1); return false; });
      expect({ 사라지거나_바뀐_숫자: missing, 새로_생긴_숫자: now }).toEqual({ 사라지거나_바뀐_숫자: [], 새로_생긴_숫자: [] });
    });
  }
});
