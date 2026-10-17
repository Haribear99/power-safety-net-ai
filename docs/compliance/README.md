# 준법 문서 (spec.md Q11①: 4종을 1개 문서로 합침) — 초안

> 상태: Phase 4에서 '민감정보'·'국외 이전' 절만 썼다. 나머지(AI기본법 표지, 개인정보 최소화, 의료기기 해당성)는 Phase 6에서 채운다.

## 민감정보

- 이 서비스는 실제 환자 데이터를 쓰지 않는다. 화면의 가구·자원은 전부 시연용 합성 데이터다(배너 고지).
- `/household` 업로드: 이미지는 서버 메모리에서만 처리하고 저장·로그 기록을 하지 않는다(`app/src/app/api/vision/route.ts`, 본문 무로그 `app/src/lib/claude/client.ts`).
- 업로드 전 체크 2개(합성 라벨 또는 환자가 쓰지 않는 기기 라벨 / 국외 전송 동의)를 모두 해야 업로드가 열린다. 기본값은 샘플 재생(API 호출 없음).
- 프롬프트는 성명·사용자 칸과 제조번호(일련번호)의 값을 옮기지 않고 `personalInfoVisible`만 표시하게 한다. 봉인 측정에서 성명 칸 표시 판정 116/120 일치.

## 국외 이전

| 항목 | 내용 |
|---|---|
| 이전받는 자 | Anthropic, PBC (Claude API) |
| 이전 국가 | 미국 |
| 목적 | 업로드한 기기 라벨 이미지의 글자 판독 |
| 항목 | 라벨 이미지 1장(긴 변 1568px JPEG로 줄이고 EXIF 제거) |
| 시점·방법 | 업로드 시 HTTPS API 호출 |
| 보유 기간 | Anthropic API는 입력·출력을 수신·생성 후 30일 안에 삭제한다. 사용 정책 위반으로 자동 분류되면 입력·출력 최대 2년, 분류 점수 최대 7년 보관한다. 출처: Anthropic Privacy Center 「How long do you store my organization's data?」(페이지 표기 2026-07-01, 2026-10-17 확인) https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data |
| 동의 | 업로드 화면 체크 ② 「국외 전송에 동의합니다」 |
| 거부 시 | 샘플 재생으로만 이용(불이익 없음) |
