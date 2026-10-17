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

숫자는 `app/src/data/evidence.json`에서 나온다. 예측·임계값·실행 코드 해시는 결과를 보기 전에 커밋했다(`prereg/`). S3는 sha256 매니페스트, S4~S6은 OpenTimestamps 비트코인 증명(`seal/`). 봉인 실행 산출물은 `seal/outputs/`. 외부 실측 자료: 기후에너지환경부 보도자료(2026-05-20) 붙임 「아파트 정전현황」(`datasets/external/`).

- 합성 정전 5,400건(비상전원이 가구 1.5~6곳당 1대 있다고 가정): 현행 공개 절차(자원 연결 단계 없음, 119 자가 호출)보다 공백 가구·시간 15.0% 감소, 27개 조건 모두 우세. 단순 규칙(짧은 순·가까운 순)과는 24개 조건에서 차이 없음, 합산하면 가까운 순이 0.6% 나음.
- 빈틈 지도 32,000회: 도구를 써도 가정 범위 추첨 90% 이상에서 공백이 남는 기기×정전 조합 12곳(1·3시간급 인공호흡기 × 아파트 장기 정전 등). 배터리 0시간 거치형 산소발생기는 따로 센다.
- 보완안 8,000회: 휴대용 배터리 사전 배치(PG&E 절차의 한국화, 보급률은 가정·미검수)를 얹으면 그 시드에서 남던 빈틈 13곳 중 11곳이 닫힘.
- 실측 정전시간 2,000회(E4): 기후에너지환경부 최근 3년 아파트 정전 382건의 정전시간 분포를 그대로 넣으면(계획자도 이 분포를 아는 낙관 조건), 도구는 공백 가구·시간을 16.5% 줄이지만 1시간급 인공호흡기 가구의 공백 발생 비율(95.8%)은 줄이지 못함. 사전 배치를 얹어야 73.1%. 원인별 가정 분포는 이 실측 분포의 3~6시간 구간을 재현하지 못했다(`tools/check_apt_calibration.py`).
- AI 판독·표적 배치 2,000회(E5, S7): 봉인 시험셋의 판독 미확정률 24/90을 넣어도 도구는 현행보다 17.2% 감소. 판독 없음(전부 수동검토)보다 0.5% 더 줄었을 뿐이라, AI의 몫은 주로 수동검토 부담(등록 기종 73% 자동 확정)이다. 같은 양의 배터리를 등록 기록상 배터리가 짧은 집부터 두면 1시간급 인공호흡기 공백 가구 73.1% → 56.3%(3시간급은 58.2% → 64.5%로 늘어나는 맞바꿈).
- 라벨 판독 봉인 시험셋 120장 1회: 모델명 정확 118/120(OCR 35/120), DB 기종 자동 확정 66/90. 흐림·가림 60장에서 모델명을 자신 있게 틀린 경우 0/60, DB의 엉뚱한 기종과 표시 없이 일치 0/120.

## 재현

```bash
cd app && npm ci
npm test                      # vitest
npx tsx scripts/sweep.ts E2 --tag sealed --seedLo 3000001 --cells 27
npx tsx scripts/sweep.ts E1 --tag sealed --seedLo 2000001 --draws 4000 --master E1 --falsify 500 --lognormal
npx tsx scripts/sweep.ts E3 --tag sealed --seedLo 1000001 --draws 1000 --master E3
npx tsx scripts/sweep.ts E4 --tag sealed --seedLo 4000001 --draws 2000 --master E4
npx tsx scripts/lab-analyze.ts --tag sealed && npx tsx scripts/score-prereg.ts --tag sealed && npx tsx scripts/score-prereg-e3.ts --tag sealed && npx tsx scripts/e4-analyze.ts --tag sealed
npx tsx scripts/sync-evidence.ts
node ../tools/check-seal-order.mjs
python -I ../tools/check_apt_calibration.py
python -I ../tools/check_report_numbers.py
```

라벨 판독 원시 응답(요청 ID 포함)은 `out/sealed/c1/`에 있다. 별도 Python 오라클(같은 명세로 따로 구현)은 `oracle/`.

## 착안과 차이

OpenAI DevDay Exchange Community Hackathon: Seoul(2026-10-09) 출품작 「전조(JEONJO)」(https://github.com/Hariuncle/JEONJO, 본 작품 출품자와 관계 없음)에서 착안했다. 그 작품은 행사장 안전을 주제로 같은 조건의 가상 세계에서 현행 매뉴얼과 개선 매뉴얼을 비교해 빈틈을 찾는다. **가져온 것은 이 실험 틀**이고, 코드·자산·화면은 쓰지 않았다. 이 저장소에서 새로 한 것: ① 주제를 정전·전력의존 가구로 옮기고 원안(12번) 판단식을 실행하는 운영자 도구와 같은 엔진으로 비교, ② 제조사 사양 DB·정부 정전 집계에 맞춘 정량 시뮬레이션과 공통 난수 쌍비교·통계 판정, ③ 해외 공개 절차를 근거로 한 보완안, ④ 결과 전 사전등록·봉인과 틀린 예측 공개, ⑤ AI 라벨 판독(봉인 시험셋 실측). 같은 표가 운영 사이트 /about#inspiration에 있다.

## 문서

- 빌드 명세 `docs/spec.md` · 개발 기록 `docs/DEVLOG.md` · 준법 `docs/compliance/README.md`
- 성과보고서 초안 `submission/report_draft.md` · 영상 콘티 `submission/video_storyboard.md`
