// E2E (spec.md 9절 'E2E', 인수인계서 6장). 빌드 산출물을 next start로 띄워 돌린다: npm run build && npm run test:e2e
// 실제 AI·예산을 쓰지 않는다: ① 서버의 예산 저장소·API 키 변수를 비워 재생 모드로 띄우고 ② 브라우저의 /api/** 요청은
// 고정장치(e2e/fixtures.ts)가 모두 가로챈다(시험이 직접 응답을 지정한 경우만 통과, 그 밖의 호출은 시험 실패).
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3210);
const BLANK = { UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "", KV_REST_API_URL: "", KV_REST_API_TOKEN: "", ANTHROPIC_API_KEY: "", JUDGE_ACCESS_CODE: "" };

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", locale: "ko-KR", timezoneId: "Asia/Seoul" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    // 모바일은 투표자 경로(랜딩·가구 화면·전 페이지 공통 검사)만
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    // 남은 서버(이전 빌드)를 재사용하지 않는다: 중단된 실행이 남긴 서버로 옛 빌드를 시험하는 사고 방지(레드팀 10/24)
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...BLANK, NODE_ENV: "production" },
  },
});
