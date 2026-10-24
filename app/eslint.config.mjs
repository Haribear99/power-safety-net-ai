import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// ---- 보호 규칙 (spec.md 2장·3장·9절, 관문 1) ----
// 승인 우회 경로 0: status "APPROVED"를 만드는 곳은 ApproveDrawer 한 곳뿐이다(I6). approval-scan.test.ts의 정규식 검사와 겹쳐 지킨다.
const NO_APPROVED = [
  { selector: "Property[key.name='status'][value.value='APPROVED']", message: "status \"APPROVED\"는 components/ops/ApproveDrawer.tsx에서만 만든다(I6, 승인 우회 경로 0)." },
  { selector: "Property[key.value='status'][value.value='APPROVED']", message: "status \"APPROVED\"는 components/ops/ApproveDrawer.tsx에서만 만든다(I6)." },
  { selector: "Property[key.name='status'] > TemplateLiteral[quasis.0.value.raw='APPROVED']", message: "status `APPROVED`는 components/ops/ApproveDrawer.tsx에서만 만든다(I6)." },
  { selector: "AssignmentExpression[left.property.name='status'][right.value='APPROVED']", message: "status = \"APPROVED\" 대입은 components/ops/ApproveDrawer.tsx에서만 한다(I6)." },
  // `"APPROVED" as const`, `satisfies`, 삼항식 갈래로 감싼 경우
  { selector: "Property[key.name='status'] > :matches(TSAsExpression, TSSatisfiesExpression, TSNonNullExpression) > Literal[value='APPROVED']", message: "status \"APPROVED\"는 components/ops/ApproveDrawer.tsx에서만 만든다(I6)." },
  { selector: "Property[key.name='status'] > ConditionalExpression > Literal.consequent[value='APPROVED'], Property[key.name='status'] > ConditionalExpression > Literal.alternate[value='APPROVED']", message: "status \"APPROVED\"는 components/ops/ApproveDrawer.tsx에서만 만든다(I6)." },
  // 값으로서의 "APPROVED"·"APPROVE"(감사 행 승인)는 어디에도 만들지 않는다: 상수·함수 반환·배열 등 우회까지 막는다(레드팀 10/24 C1).
  // 허용: 타입 선언(TSLiteralType)과 비교(=== "APPROVED")
  { selector: "Literal[value=/^APPROVED?$/]:not(TSLiteralType > Literal):not(BinaryExpression[operator=/^[!=]==?$/] > Literal)", message: "승인 상태·승인 감사 값(\"APPROVED\"·\"APPROVE\")은 components/ops/ApproveDrawer.tsx에서만 만든다(I6). 비교와 타입 선언만 허용." },
  { selector: "TemplateElement[value.raw=/APPROV/]", message: "템플릿 문자열로 승인 상태를 만들지 않는다(I6)." },
];
// 결정 경로 파일은 초월함수 금지(Math.sqrt 허용). 진실값(materialize 단계) 함수 truth*는 Math.exp 뒤 qT로 바꾸는 예외(3절).
const TRANSCENDENTAL = "exp|expm1|log|log1p|log2|log10|pow|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|cbrt|hypot";
const NO_TRANSCENDENTAL = [
  {
    selector: `MemberExpression[object.name='Math'][property.name=/^(${TRANSCENDENTAL})$/]:not(FunctionDeclaration[id.name=/^truth/] MemberExpression)`,
    message: "결정 경로(alloc·engine)에서는 초월함수를 쓰지 않는다(spec.md 3절, Math.sqrt만 허용). 진실값 계산은 truth* 함수에서만.",
  },
  { selector: "BinaryExpression[operator='**']", message: "결정 경로(alloc·engine)에서는 거듭제곱(**)을 쓰지 않는다(spec.md 3절 초월함수 규칙)." },
  // 우회: Math["exp"], const { log } = Math, const M = Math
  { selector: "MemberExpression[object.name='Math'][computed=true]", message: "결정 경로에서 Math를 계산된 이름으로 읽지 않는다(초월함수 규칙 우회 방지)." },
  { selector: "VariableDeclarator[init.name='Math']", message: "결정 경로에서 Math를 변수·구조 분해로 꺼내지 않는다(초월함수 규칙 우회 방지)." },
];
// 판단·진실 분리: 화면과 배정 규칙은 WorldTruth를 import하지 않는다(2장).
const NO_WORLD_TRUTH = {
  patterns: [{ group: ["**/domain/types", "@/lib/domain/types"], importNames: ["WorldTruth"], message: "WorldTruth는 화면·배정 규칙·재진입에서 import하지 않는다(spec.md 2장 판단·진실 분리)." }],
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.ts"],
    rules: { "no-restricted-syntax": ["error", ...NO_APPROVED] },
  },
  {
    // restoration.ts: CONFIRMED 범위 exp(±zσ)는 Math.exp 직후 qT로 바꾸는 명세 예외(3절)라 초월함수 규칙에서 뺀다
    files: ["src/lib/alloc/**/*.ts", "src/lib/engine/**/*.ts"],
    ignores: ["src/**/*.test.ts", "src/lib/engine/restoration.ts"],
    rules: { "no-restricted-syntax": ["error", ...NO_APPROVED, ...NO_TRANSCENDENTAL] },
  },
  {
    // 승인 핸들러가 있는 유일한 파일
    files: ["src/components/ops/ApproveDrawer.tsx"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}", "src/lib/alloc/**/*.ts", "src/lib/sim/reentry.ts"],
    ignores: ["src/**/*.test.ts"],
    rules: { "@typescript-eslint/no-restricted-imports": ["error", NO_WORLD_TRUTH] },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 시험 산출물
    "playwright-report/**",
    "test-results/**",
    "coverage/**",
    ".lighthouseci/**",
  ]),
]);

export default eslintConfig;
