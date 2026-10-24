// /household — spec.md 1.6절, 9절 E2E '/household', 인수인계서 4.2절 C-10·D-16·D-20.
import type { Page } from "@playwright/test";
import { expect, expectReadable, test } from "./fixtures";

const SAMPLE_BTN = /샘플 라벨:/;

test("샘플: API 호출 0, AI 추출 표지, 일치 → 확인 전 분해식 없음 → 확인 뒤 분해식, 불일치 → 수동검토 @mobile", async ({ page }) => {
  await page.goto("/household");
  const buttons = page.getByRole("button", { name: SAMPLE_BTN });
  const n = await buttons.count();
  expect(n).toBe(6);
  let matched = 0, review = 0;
  for (let i = 0; i < n; i++) {
    // 샘플마다 새로 연다(샘플 사이 상태 이어짐은 아래 별도 시험)
    if (i > 0) await page.reload();
    await buttons.nth(i).click();
    await expect(page.getByTestId("extract-table")).toContainText("AI 추출");
    if (await page.getByTestId("match-ok").count()) {
      matched++;
      await expect(page.getByTestId("lb-form")).toHaveCount(0);
      await page.getByRole("button", { name: "이 기종이 맞습니다" }).click();
      await expect(page.getByTestId("lb-hours")).toContainText(/배터리 하한/);
      await expect(page.getByTestId("notice-panel")).toBeVisible();
    } else {
      review++;
      await expect(page.getByTestId("match-review")).toContainText("수동검토 대기 — 자동 계산하지 않습니다");
      await expect(page.getByTestId("lb-form")).toHaveCount(0);
    }
  }
  expect(matched, "일치 샘플").toBeGreaterThan(0);
  expect(review, "수동검토 샘플(가림·미등록)").toBeGreaterThan(0);
  // apiCalls 고정장치가 시험 끝에 /api 호출 0을 확인한다
});

test("다른 샘플로 바꾸면 기종 확인을 다시 받아야 한다(확인 상태가 이어지지 않음) @mobile", async ({ page }) => {
  // 10/24 발견·수정: 결과 화면이 샘플마다 새로 만들어지지 않아 '확인함'이 다음 샘플로 이어졌다(HouseholdScreen ResultView key)
  await page.goto("/household");
  const buttons = page.getByRole("button", { name: SAMPLE_BTN });
  await buttons.nth(0).click();
  await page.getByRole("button", { name: "이 기종이 맞습니다" }).click();
  await expect(page.getByTestId("lb-form")).toBeVisible();
  await buttons.nth(1).click();
  await expect(page.getByTestId("match-ok")).toBeVisible();
  await expect(page.getByTestId("lb-form"), "확인 없이 하한이 보임").toHaveCount(0);
  await expect(page.getByRole("button", { name: "이 기종이 맞습니다" })).toBeVisible();
});

test("업로드: 체크 2개 전 비활성, 국외 전송 안내, 접근 코드 칸 가림 @mobile", async ({ page }) => {
  await page.goto("/household");
  await page.getByRole("tab", { name: "사진 올리기" }).click();
  const up = page.getByTestId("upload");
  await expect(up).toContainText("국외 AI 사업자(Anthropic, 미국)");
  const input = page.getByTestId("upload-input");
  await expect(input).toBeDisabled();
  await page.getByLabel("합성 라벨이거나 환자가 쓰지 않는 기기의 라벨입니다").check();
  await expect(input).toBeDisabled();
  await page.getByLabel("국외 전송에 동의합니다").check();
  await expect(input).toBeEnabled();
  await expect(up.locator('input[autocomplete="off"]').first()).toHaveAttribute("type", "password");
});

/** 캔버스로 만든 JPEG(JFIF) 앞에 EXIF(APP1) 조각을 끼워 '휴대폰 사진'처럼 만든다 */
async function jpegWithExif(page: Page, w: number, h: number): Promise<Buffer> {
  const b64 = await page.evaluate(([w, h]) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d")!;
    g.fillStyle = "#f4f4f4"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#111"; g.font = "120px sans-serif"; g.fillText("TEST LABEL 1150", 80, 300);
    const u = c.toDataURL("image/jpeg", 0.9);
    return u.slice(u.indexOf(",") + 1);
  }, [w, h]);
  const jfif = Buffer.from(b64, "base64");
  expect(jfif.subarray(0, 4).toString("hex")).toBe("ffd8ffe0");
  // TIFF 머리(빅엔디언) + 빈 IFD — 내용이 아니라 'EXIF 조각이 있다'는 것만 필요하다
  const tiff = Buffer.from("4d4d002a00000008000000000000", "hex");
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const len = Buffer.alloc(2); len.writeUInt16BE(payload.length + 2);
  const app1 = Buffer.concat([Buffer.from("ffe1", "hex"), len, payload]);
  return Buffer.concat([jfif.subarray(0, 2), app1, jfif.subarray(2)]);
}

/** JPEG SOF 조각에서 가로·세로를 읽는다 */
function jpegSize(buf: Buffer): { w: number; h: number } {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw new Error("JPEG 조각 경계가 아님");
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error("SOF 없음");
}

test("업로드 이미지는 EXIF 없이 다시 인코딩·긴 변 1568px 이하로 줄여 보낸다, 브라우저 저장소에 이미지 없음", async ({ page }) => {
  let sent: { imageBase64: string; consent: { synthetic: boolean; overseas: boolean }; accessCode?: string } | null = null;
  await page.route("**/api/vision", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ json: { mode: "replay", reason: "no_store", message: "시험: 재생 모드로 응답" } });
  });
  await page.goto("/household");
  const file = await jpegWithExif(page, 2400, 1600);
  expect(file.subarray(0, 4).toString("hex"), "원본에 EXIF(APP1)가 있어야 시험이 의미 있음").toBe("ffd8ffe1");
  await page.getByRole("tab", { name: "사진 올리기" }).click();
  await page.getByLabel("합성 라벨이거나 환자가 쓰지 않는 기기의 라벨입니다").check();
  await page.getByLabel("국외 전송에 동의합니다").check();
  await page.getByTestId("upload-input").setInputFiles({ name: "phone.jpg", mimeType: "image/jpeg", buffer: file });
  await expect(page.getByRole("status")).toContainText("시험: 재생 모드로 응답");
  expect(sent, "/api/vision 요청이 나감").not.toBeNull();
  const s = sent!;
  expect(s.imageBase64.startsWith("/9j/4AAQSkZJRg"), "EXIF가 지워진 JFIF로 시작").toBe(true);
  const out = Buffer.from(s.imageBase64, "base64");
  expect(out.includes(Buffer.from("Exif\0\0", "latin1")), "EXIF 조각이 남음").toBe(false);
  const { w, h } = jpegSize(out);
  expect(Math.max(w, h)).toBeLessThanOrEqual(1568);
  expect(w / h).toBeCloseTo(2400 / 1600, 1);
  expect(s.consent).toEqual({ synthetic: true, overseas: true });
  expect(s.accessCode, "코드 칸이 비면 코드를 보내지 않음").toBeUndefined();
  const stored = await page.evaluate(async () => {
    const ls = Object.keys(localStorage).map((k) => localStorage.getItem(k) ?? "");
    const ss = Object.keys(sessionStorage).map((k) => sessionStorage.getItem(k) ?? "");
    const dbs = indexedDB.databases ? await indexedDB.databases() : [];
    return { big: [...ls, ...ss].filter((v) => v.length > 2000 || v.includes("data:image")).length, dbs: dbs.length };
  });
  expect(stored).toEqual({ big: 0, dbs: 0 });
});

test("AI 추출 표지가 실제로 읽힌다(숨김·덮임·저대비 아님) @mobile", async ({ page }) => {
  await page.goto("/household");
  await page.getByRole("button", { name: SAMPLE_BTN }).first().click();
  const tags = page.getByTestId("extract-table").getByText("AI 추출");
  expect(await tags.count()).toBeGreaterThanOrEqual(5);
  for (let i = 0; i < (await tags.count()); i++) await expectReadable(tags.nth(i), `AI 추출 표지 ${i + 1}`);
});

test("줄인 이미지가 2MB를 넘으면 보내지 않는다", async ({ page }) => {
  let called = 0;
  await page.route("**/api/vision", async (route) => { called++; await route.fulfill({ json: { mode: "replay", reason: "no_store", message: "x" } }); });
  await page.goto("/household");
  const file = await jpegWithExif(page, 400, 300);
  // 시험 이미지를 만든 뒤, 캔버스 출력을 2MB 넘게 흉내 낸다(실제 사진으로는 재현이 들쭉날쭉해서)
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toDataURL = function () { return "data:image/jpeg;base64," + "A".repeat(2 * 1024 * 1024 + 8); };
  });
  await page.getByRole("tab", { name: "사진 올리기" }).click();
  await page.getByLabel("합성 라벨이거나 환자가 쓰지 않는 기기의 라벨입니다").check();
  await page.getByLabel("국외 전송에 동의합니다").check();
  await page.getByTestId("upload-input").setInputFiles({ name: "big.jpg", mimeType: "image/jpeg", buffer: file });
  await expect(page.getByRole("status")).toContainText("이미지가 너무 큽니다");
  expect(called, "2MB 넘는 이미지를 보냄").toBe(0);
});

test("가구 화면 알림: 검사에 탈락한 AI 원문은 보여 주지 않는다", async ({ page }) => {
  const SECRET = "검사에서떨어진원문문장";
  await page.route("**/api/notice", async (route) => {
    await route.fulfill({ json: {
      mode: "live", ok: true, promptVersion: "e2e", checkVersion: "e2e",
      composed: { sentences: ["고정 문안 시험 문장입니다."], source: "template", violations: [{ code: "E2E", detail: "시험", sentence: SECRET }], rejectedAt: "gate1", footer: "" },
      rejected: [SECRET], meta: { latencyMs: 10, costUsd: 0, model: "e2e-mock" },
    } });
  });
  await page.goto("/household");
  await page.getByRole("button", { name: SAMPLE_BTN }).first().click();
  await page.getByRole("button", { name: "이 기종이 맞습니다" }).click();
  await page.getByTestId("notice-generate").click();
  await expect(page.getByTestId("notice-rejected")).toContainText("AI 문장이 검사를 통과하지 못해");
  await expect(page.locator("body")).not.toContainText(SECRET);
});
