# 사전등록 예측 (S4 봉인본, 2026-10-17)

> 예비 몬테카를로(L 오름차순, 중간보고) 결과를 본 뒤 작성함.
> 1절은 그 예비 결과와 전략 보고서 5.3절의 산술만 보고 쓴 예측(이 저장소의 시뮬레이션을 돌리기 전)이고,
> 2절은 이 저장소의 개발 시드 예비 실행(E2 시드 4,001~9,400, E1 LHS master `E1-dev` 400추첨·시드 9,401~9,800)을 본 뒤 쓴 예측이다.
> 두 절의 맞힌 수와 틀린 수를 따로 센다. 봉인 실행은 E1 시드 2,000,001~2,004,000(LHS master `E1`), E2 시드 3,000,001~3,005,400만 쓴다.

- 봉인 뒤 임계값·코드를 바꾸면 `seal/CHANGELOG.md`에 기록하고, 바꾸기 전과 후의 결과를 둘 다 싣는다.
- 결과 공개 때 맞힌 수와 틀린 수를 그대로 싣는다.
- 판정 정의·설정·코드 sha256은 `prereg/sweep.json`(같은 커밋)에 있다. 아래 '표지'는 KR_BASELINE 정책의 E1 최종 표지(p_early 강등 뒤)다.

## 1. 전략 보고서 5.3절 판정 7개 (시뮬레이션 전 예측, 사전등록본)

전략 보고서의 등급별 판정을 칸 판정 규칙으로 옮겼다. 원인 열은 KEPCO_DIST, APT_SHORT, APT_NIGHT_XFMR, APT_PARTS, APT_FIRE, TYPHOON_WEAK, TYPHOON_STRONG, ROTATING(8개)이다.

| # | 등급 | 전략 보고서 판정 | 맞힘 규칙 |
|---|---|---|---|
| 1 | O2_STAT(배터리 없는 거치형 산소) | ROBUST | 8개 원인 중 7개 이상 ROBUST |
| 2 | O2_STAT_CYL(거치형 + 실린더) | CONDITIONAL(경계 10~20h) | ROBUST 0개이고, ROTATING 밖 7개 원인 중 4개 이상 CONDITIONAL |
| 3 | VENT_1H(내장 1h) | ROBUST | 8개 원인 중 5개 이상 ROBUST |
| 4 | VENT_3H(내장 3h) | ROBUST(아파트 장기 구간) | APT_NIGHT_XFMR·APT_PARTS·APT_FIRE 셋 다 ROBUST |
| 5 | O2_PORT(휴대용 산소) | CONDITIONAL | ROTATING 밖 7개 원인 중 4개 이상 CONDITIONAL |
| 6 | VENT_8H(내장 8h) | 12h 이상 아파트 구간 ROBUST, 전체 CONDITIONAL | APT_PARTS·APT_FIRE 둘 다 ROBUST이고, KEPCO_DIST·APT_SHORT는 둘 다 ROBUST 아님 |
| 7 | VENT_8H_EXT2(내장 + 외장 2개) | FRAGILE(헤드라인 금지) | ROBUST 0개이고, 8개 원인 중 4개 이상 FRAGILE |

## 2. 개발 시드 예비 실행을 본 뒤의 예측

### 2.1 E2 (27칸 × 짝 시드 200, 정책 10개)

| # | 예측 | 예비 실행 값 |
|---|---|---|
| 2.1 | RULE이 KR_BASELINE보다 **우세**인 칸이 27칸 중 25칸 이상 | 27칸 |
| 2.2 | 27칸 합산 M2 상대 감소율(1 − ΣRULE/ΣKR)이 12% 이상 18% 이하 | 14.95% |
| 2.3 | 칸별 감소율 최솟값 ≥ 3%, 최댓값 ≤ 30%. 가구/자원 비 1.5 칸 9개의 평균 감소율 > 비 6 칸 9개의 평균 감소율 | 5.2%~27.1% |
| 2.4 | 단순 규칙 합산 판정: [P1] ≤ 2칸, [P2] ≤ 4칸, [P0] ≥ 21칸 | P1 0, P0 25, P2 2 |
| 2.5 | 27칸 합산 M1 승패에서 B2_NEAREST가 RULE보다 많이 이긴다(RULE 패 > RULE 승). 즉 '공백 고위험 가구 수'만 보면 가까운 짝 규칙이 원안 규칙보다 낫다 | RULE 751승 1,416패 |
| 2.6 | RULE_NO_R(tier 제거)와 RULE의 합산 M2 차이가 ±0.5% 안 | 0.00% |
| 2.7 | 합산 정보 상한 몫((ΣKR − ΣRULE)/(ΣKR − ΣORACLE_INFO))이 85% 이상 | 95.3% |

### 2.2 E1 (4,000추첨 × 원인 8, 등록 60가구, 7등급 각 5가구 층화)

| # | 예측 | 예비 실행 값 |
|---|---|---|
| 2.8 | KR 표지 ROBUST(O2_STAT 제외) 칸이 8개 이상 16개 이하이고, VENT_1H·VENT_3H × {APT_NIGHT_XFMR, APT_PARTS, APT_FIRE} 6칸을 모두 포함한다 | 12칸, 6칸 포함 |
| 2.9 | **RULE 표지에서도** VENT_1H·VENT_3H × {APT_NIGHT_XFMR, APT_PARTS, APT_FIRE} 6칸이 모두 ROBUST다(도구를 써도 남는 빈틈) | 6칸 모두 |
| 2.10 | KEPCO_DIST·APT_SHORT 두 열에는 O2_STAT 밖의 ROBUST가 없다(KR 표지) | 없음 |
| 2.11 | 안정성 시험(로그정규 표) 통과, 강등 전 표지가 바뀐 칸이 12개 이하(두 정책 합) | 통과, 3칸 |
| 2.12 | RULE 표지 ROBUST 칸 수(O2_STAT 제외)가 KR 표지 ROBUST 칸 수보다 적거나 같다 | 9 ≤ 12 |

## 3. E3 가설 (보완안, 보류 시드 1,000,001~1,001,000. 실행은 S4 뒤 별도)

- P2·P3·P7(사전 배치형)은 원인과 무관하게 공백 가구·시간을 줄인다.
- P6·P8(사전 통지·사전 충전)은 예보 가능한 사건(태풍·순환단전)에서만 효과가 있다.
- 2.9가 맞으면, RULE 위에 사전 배치형 보완안(P2·P3·P7)을 얹을 때 VENT_1H·VENT_3H × 아파트 장기 칸의 RULE 표지 p가 내려간다.

## 4. 관문 2 (라운드 5 정의, spec.md 끝 '반영 기록 (라운드 5)' #7)

- (a) KR 표지 ROBUST가 O2_STAT 밖에 1개 이상
- (b) RULE이 KR_BASELINE보다 우세인 칸이 27칸 중 18칸 이상
- 둘 다 맞으면 통과. 하나라도 틀리면 끝 카드는 spec.md 12.3절 대체안. 예측: 통과.

## 5. 함께 봉인하는 설정

`prereg/sweep.json`: 축·표준 θ·시드 범위·표지 컷·관문 값·E1/E2 설정·실행 코드 sha256. 재현 명령은 같은 파일의 `commands`.
