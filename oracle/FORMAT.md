# 오라클 입출력 형식 (차등 시험 계약, spec 8절)

TS 쪽 `scripts/export-scenarios.ts`(입력)와 TS 결과 내보내기(출력)는 이 형식을 따른다. 오라클은 Python 3.12 표준 라이브러리만 쓰며 `python -I`로 실행한다.

```
python -I oracle/run.py <scenario.json | dir> [-o <out.json | outdir>]   # 출력 sha256도 찍는다
python -I oracle/diff.py <oracle_out(.json|dir)> <ts_out(.json|dir)>     # 불일치면 종료 코드 1
python -I oracle/run_tests.py                                            # 손계산 사례·불변식·스모크
```

## 입력: materialize된 시나리오 JSON (`pl26-materialized/1`)

난수는 모두 펼쳐져 있어야 한다. 초월함수(exp·log·cos)가 들어간 값은 **정수 초(`…S`)**로 저장한다(3.1절). 시간 필드는 `<이름>S`(정수 초)를 먼저 읽고, 없으면 `<이름>H`(시간, `qT`로 변환)를 읽는다.

| 경로 | 내용 |
|---|---|
| `scenarioId`, `seed` | 문자열 |
| `sim.table` | `"gamma"`(기본) 또는 `"lognormal"` — `spec/restoration_quantiles.json`의 표 계열 |
| `sim.travel` | `{prepMult:[n,d], speedKmh:정수, congest:[n,d]}` (params `arrival.profiles`) |
| `sim.stress119` | 계획 `A_119 = qT(a119H.hi × stress)` |
| `planner` | spec 2장 `PlannerView`. `now`는 무시(결정 시점은 4.3절로 계산) |
| `planner.restoration` | `{cause, tOutage, status, sigmaE}`. `status = "CONFIRMED"`이면 `confirmed: {rEstEndS, multPpm: {p10, p80, p90}}` (multPpm = floor(exp(±z·σ_e)·10⁶ + 0.5), materialize가 계산) |
| `planner.households[]` | `HouseholdView`. 추가 필드 `reentry`(선택): 수동검토 완료 뒤 값 `{specId?, operatorLowerH?, physical?}`. `physical = {drawW:{lo,hi}, connectors, inverterSensitive, oxygen}`은 DB 밖 기종의 물리 속성(없으면 AC220·인버터 민감·출력/에너지 필터 생략) |
| `planner.resources[]` | `ResourceView` |
| `planner.lanes` | `{k119PerH, a119H:{lo,hi}, shelter:{seats, prepH}}` |
| `truth.restorationS` | R_true(정전 시작 기준 길이) |
| `truth.hh[id]` | `{LTrueS(신고 시각 기준 잔여), backupFails, shelterRefuses, mrDelayS}` |
| `truth.unregistered[]` | `{id, LTrueS(정전 시작 기준), callS(KR-07 호출 절대 시각, 없으면 소진 시각)}` |
| `truth.arrivalTrueS["hh|res"]` | 자원 실제 도착 **소요시간**(결정 시각부터) |
| `truth.a119TrueS[id]`, `truth.shelterTrueS[id]` | 119 슬롯 시작부터 도착까지, 쉼터 결정 시각부터 도착까지 |
| `overrides` | 시험 전용: `devices`, `ext`, `qS` |

## 출력 (`pl26-oracle-out/1`)

키 정렬 JSON, 숫자는 모두 정수(초·mWh·개수). 감시값 ±(2^31−1).

```
{ format, scenarioId, seed,
  households: { <id>: { lane, resourceId, order, decidedAtS, delayed119, everHold, holdRecheckByS,
                        reservedResourceId, reserved119, L: {status, hoursS, endS, capS, flags} } },
  decisions: [ { tS, r80EndS, r90EndS, assigned: [[order, hhId, lane, resourceId], ...] } ],
  metrics: { M1, M2S, highRisk, gapS: {<id>: s}, serveSource: {<id>: RESTORE|RESOURCE|119|SHELTER} } }
```

`diff.py` 통과 기준(8절): 가구별 `lane`·`resourceId`·`order`와 `M1`·`M2S`가 정확히 같다. `order`는 결정 시점을 가로지르는 전역 처리 순번이며 MANUAL_REVIEW·HOLD는 `null`이다.
