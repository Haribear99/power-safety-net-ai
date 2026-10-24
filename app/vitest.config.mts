import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    // 기본 5초는 전수 조합 시험(notice/rules.test.ts '모든 조합', 이 PC에서 약 4.7초)이 부하·CI에서 넘겨 간헐 실패했다(10/23·10/24 관측).
    // 결과가 정해진 시험이라 시간 제한만 늘린다. 개별 제한이 있는 속성 시험(rule.property)은 그대로.
    testTimeout: 30_000,
    // npm run coverage. 계산·배정·검사 코드(lib)만 잰다. 화면은 E2E(e2e/)가 맡는다.
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/lib/**/test-*.ts"],
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "coverage",
      // 전체: 10/24 실측(구문 76.89·분기 78.4·함수 77.44·줄 79.17%)을 내림한 하한, 떨어지는 것만 막는다.
      // engine·alloc: spec.md 9절 '결정 파일 라인 커버리지 90% 이상'(10/24 실측 engine 98.5%·alloc 99.6%)
      thresholds: {
        statements: 76, branches: 78, functions: 77, lines: 79,
        "src/lib/engine/**": { lines: 90 },
        "src/lib/alloc/**": { lines: 90 },
      },
    },
  },
});
