// /lab·/ledger의 숫자와 공개 단서 — 인수인계서 4.2절 A-1·2(숫자 = evidence.json), B-6(한계·틀린 예측·맞바꿈), D-22(절 번호).
// 기대 문자열은 evidence.json에서 다시 만든다(화면 문자열을 손으로 베끼지 않는다). 띄어쓰기는 무시하고 대조한다.
import type { Page } from "@playwright/test";
import { evidence as e, expect, expectReadable, test } from "./fixtures";

const squash = (t: string) => t.replace(/\s+/g, "");
const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;
async function mainText(page: Page) { return squash(await page.locator("main").innerText()); }

/** /lab 절 번호와 앵커의 짝(다른 화면·콘티가 「랩 ⑥」「리허설 랩 ⑨」처럼 부른다) */
const LAB_SECTIONS: Record<string, string> = { breakeven: "①", map: "②", compare: "③", patches: "④", prereg: "⑥", empirical: "⑦", "ai-target": "⑧", notice: "⑨" };

test("/lab 절 번호와 앵커의 짝이 그대로", async ({ page }) => {
  await page.goto("/lab");
  for (const [id, n] of Object.entries(LAB_SECTIONS)) {
    await expect(page.locator(`section#${id} > h2`), `#${id}`).toContainText(n);
  }
});

test("/lab 공개 단서·숫자 = evidence.json", async ({ page }) => {
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
  // 틀린 예측 공개: 사전등록 대조 절에 틀린 판정(×)과 맞힌 수 표기가 있어야 한다
  const prereg = page.locator("section#prereg");
  await expect(prereg).toContainText("×");
  await expect(prereg).toContainText("맞힘");
  await expect(prereg).toContainText("목표 0건에 못 미칩니다");
  await expectReadable(page.locator("section#prereg > h2"), "/lab ⑥ 제목");
});

test("/ledger 공개 단서·숫자 = evidence.json", async ({ page }) => {
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
});
