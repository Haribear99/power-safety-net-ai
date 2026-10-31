// 가구·랩·장부 화면 탐색 스크린샷(녹화 전 확인용)
import { chromium } from "playwright";
const [base = "http://localhost:3100", out = "."] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1536, height: 864 }, deviceScaleFactor: 1.25 });
await p.goto(base + "/household");
await p.getByRole("button", { name: /깨끗한 라벨/ }).click();
await p.getByTestId("result").scrollIntoViewIfNeeded();
await p.getByRole("button", { name: "이 기종이 맞습니다" }).click();
await p.getByTestId("lb-form").scrollIntoViewIfNeeded();
await p.screenshot({ path: `${out}/hh-clean.png` });
await p.getByRole("button", { name: /일부 가려짐/ }).click();
await p.getByTestId("result").scrollIntoViewIfNeeded();
await p.screenshot({ path: `${out}/hh-masked.png` });
console.log("masked:", (await p.getByTestId("result").innerText()).replace(/\s+/g, " ").slice(0, 500));
await p.goto(base + "/lab");
for (const id of ["notice", "compare", "map", "empirical", "ai-target"]) {
  await p.locator(`[id="${id}"]`).evaluate((e) => e.scrollIntoView({ block: "start" }));
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/lab-${id}.png` });
}
await p.locator('[data-testid="lab-hero"]').evaluate((e) => e.scrollIntoView({ block: "start" }));
await p.screenshot({ path: `${out}/lab-hero.png` });
await p.locator('[data-testid="n1-examples"]').evaluate((e) => e.scrollIntoView({ block: "start" }));
await p.screenshot({ path: `${out}/lab-n1ex.png` });
await p.goto(base + "/ledger");
await p.screenshot({ path: `${out}/ledger-top.png` });
await p.goto(base + "/");
await p.locator('[id="prepare"]').evaluate((e) => e.scrollIntoView({ block: "center" }));
await p.screenshot({ path: `${out}/home-prepare.png` });
await p.getByTestId("closing-card").evaluate((e) => e.scrollIntoView({ block: "center" }));
await p.screenshot({ path: `${out}/home-closing.png` });
await b.close();
