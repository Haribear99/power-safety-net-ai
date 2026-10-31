// 화면 문구를 텍스트로 덤프(콘티 작성용). 사용: npx tsx record/dump-text.mts <base> <outdir>
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
const [base = "http://localhost:3100", out = "out-text"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const routes = ["/", "/household", "/ops", "/lab", "/ledger"];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1536, height: 864 } });
for (const r of routes) {
  await page.goto(base + r, { waitUntil: "networkidle" });
  const t = await page.locator("body").innerText();
  writeFileSync(`${out}/${r === "/" ? "home" : r.slice(1)}.txt`, t);
  console.log(r, t.length);
}
await browser.close();
