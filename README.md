# 전력안심망 AI

2026 AI 라이프 솔루션 챌린지 후보작 12번 「전력안심망 AI」 구현. 운영 URL: https://power-safety-net-ai.vercel.app

> 본 서비스는 AI 기반으로 운용됩니다 · 화면의 가구·자원은 모두 시연용 합성 데이터입니다 · 의료 판단 도구가 아닙니다.

## 무엇을 하나

정전이 나면 인공호흡기·산소발생기를 쓰는 가구마다 **배터리가 먼저 끝날지, 전기(또는 비상전원)가 먼저 올지**를 계산해 담당자에게 처리 순서와 맞는 비상전원을 제안합니다. 담당자가 승인해야 배정되고, 119에는 위치·기기·예상 안전시간 세 가지만 넘어갑니다.

| 화면 | 내용 |
|---|---|
| `/` | 두 시계(배터리 대 복구), 30초 비교 위젯, 끝 카드 |
| `/household` | 기기 라벨 사진 → AI가 글자만 옮김 → 코드가 검증 사양 DB와 대조 → 배터리 하한 분해식 |
| `/ops` · `/ops/119` | 운영자 화면(모의 정전, 처리 순서, 승인·수정·확인 조작, 감사 로그), 119 3필드 화면 |
| `/lab` | 리허설 랩: 같은 정전을 정책만 바꿔 반복한 결과(빈틈 지도, 도구 대 현행, 보완안, 사전등록 대조) |
| `/ledger` | AI 사용 장부: 라벨 판독 봉인 실측과 OCR 기준선, 독립 구현 차등 시험 |

## AI가 하는 일과 하지 않는 일

- **AI(Claude Sonnet)**: 기기 라벨 이미지의 글자를 옮겨 적는다. 가린 글자는 채우지 않고, 확실하지 않으면 표시한다.
- **AI 아님(결정적 코드)**: 기종 결정(검증 사양 DB 정확 일치만), 배터리 하한, 복구 가정 범위, 도착 시각, 처리 순서·배정 규칙, 시뮬레이션, 채점.
- **사람**: 기종 확인, 외장배터리·실린더 확인, 모든 배정 승인.

## 주요 결과(봉인 실측, 합성 데이터 위의 모의)

숫자는 `app/src/data/evidence.json`에서 나온다. 예측·임계값·실행 코드 해시는 결과를 보기 전에 커밋하고 OpenTimestamps로 봉인했다(`prereg/`, `seal/`).

- 같은 정전 5,400회: 현행 공개 절차(자원 연결 단계 없음, 119 자가 호출)보다 공백 가구·시간 15.0% 감소, 27개 조건 모두 우세. 단순 규칙(짧은 순·가까운 순)과는 24개 조건에서 차이 없음.
- 빈틈 지도 32,000회: 도구를 써도 가정 범위 추첨 90% 이상에서 공백이 남는 기기×정전 조합 12곳(1·3시간급 인공호흡기 × 아파트 장기 정전 등).
- 보완안 8,000회: 휴대용 배터리 사전 배치(PG&E 절차의 한국화)를 얹으면 남던 빈틈 13곳 중 11곳이 닫힘.
- 라벨 판독 봉인 시험셋 120장 1회: 흐림·가림 60장에서 모델명을 자신 있게 틀린 경우 0/60, DB의 엉뚱한 기종과 표시 없이 일치 0/120.

## 재현

```bash
cd app && npm ci
npm test                      # vitest
npx tsx scripts/sweep.ts E2 --tag sealed --seedLo 3000001 --cells 27
npx tsx scripts/sweep.ts E1 --tag sealed --seedLo 2000001 --draws 4000 --master E1 --falsify 500 --lognormal
npx tsx scripts/sweep.ts E3 --tag sealed --seedLo 1000001 --draws 1000 --master E3
npx tsx scripts/lab-analyze.ts --tag sealed && npx tsx scripts/score-prereg.ts --tag sealed && npx tsx scripts/score-prereg-e3.ts --tag sealed
npx tsx scripts/sync-evidence.ts
node ../tools/check-seal-order.mjs
python -I ../tools/check_report_numbers.py
```

라벨 판독 원시 응답(요청 ID 포함)은 `out/sealed/c1/`에 있다. 독립 Python 오라클은 `oracle/`.

## 착안과 차이

`[사용자 결정 대기: 착안 공개 문구(Q1·Q2)]` 시뮬레이션으로 안전 매뉴얼의 빈틈을 찾는 해커톤 작품에서 착안했다. 그 작품의 코드·자산은 쓰지 않았다. 이 저장소는 ① 공인 사양 DB와 공개 통계에 맞춘 정량 몬테카를로, ② 빈틈 발견 → 해외 보완안 → 재시뮬레이션 검증의 닫힌 고리, ③ 같은 엔진을 쓰는 실제 운영자 도구, ④ 결과 전 사전등록·봉인을 더했다.

## 문서

- 빌드 명세 `docs/spec.md` · 개발 기록 `docs/DEVLOG.md` · 준법 `docs/compliance/README.md`
- 성과보고서 초안 `submission/report_draft.md` · 영상 콘티 `submission/video_storyboard.md`
