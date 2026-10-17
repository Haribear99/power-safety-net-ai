# 개발 기록 (DEVLOG)

## 2026-10-17 (D1)
### 결정 (사용자 부재 중 자율 진행, 10/17 사용자 지시 "너 판단으로 계속 진행")
- spec Q4: 전용 키 대신 형제 저장소의 기존 ANTHROPIC_API_KEY를 쓰고, 코드상 출품 누적 예산 상한 USD 50(풀 키 `pl26:budget:*`)으로 막는다. 콘솔 상한은 사용자 확인 대상.
- spec Q6: 같은 대회 프로젝트이므로 push·Vercel 배포 자동 위임을 이 저장소에도 적용한다.
- spec Q7: 형제 Upstash를 키 접두사 `pl26:`로 공유한다(새 DB 생성은 외부 계정 작업이라 보류). 장애 격리 한계는 기록.
- spec Q11: 에이전트 작업 시간이 하루 5h 가정보다 길므로 C2(문서→DSL)를 Must로 유지한다.
- Q1·Q2·Q3·Q8·Q9·Q10은 기본안으로 진행하고 최종 보고에서 확인받는다.

### 완료
- 리서치 run power-outage-lifeline-sim-95b993 출하(형제 저장소 research/), 인계 research/handoff_power.md
- 설계 패널(시안 3 → 심사 3 → 종합 → 레드팀 3라운드): docs/spec.md, docs/design/panel-summary.md
- 앱 골격(app/, Next.js 16·React 19·TS·Tailwind 4·vitest·Anthropic SDK)

### 구현 중 결정 (TASK A — 기반: 도메인·엔진·outcome·spec 데이터)
- **spec JSON 위치**: §10대로 저장소 루트 `spec/`(params·device_db·ext_db·resources_mock·restoration_quantiles)에 두고 엔진이 상대 경로로 import한다. Turbopack은 기본 루트(app/) 밖 import를 막으므로, 화면이 엔진을 import하기 전에 `app/next.config.ts`에 `turbopack.root: path.resolve(__dirname, "..")`를 넣어야 한다(임시 적용 후 `next build` 통과 확인, 원복함 — next.config는 이 작업 소유가 아님).
- **충전량 단위**: `charge.value`는 정수 퍼센트 0~100(3.1절 규칙 2가 3.2절 `min(value,1)`보다 뒤의 수정). 100 초과는 100, 소수는 floor.
- **이용자 입력 연식**: `USER_AGE_IGNORED` 표지를 달려면 입력 사실이 필요해 `HouseholdView.device.userAgeY?`(계산 미사용)를 추가했다.
- **L 정수 계산**: 기기 항 `floor(T_s × fa_n × c_n / (fa_d × c_d))`, c는 `pct × 9 / 1000`. 외장은 항목마다 floor 후 합, L_cap도 같은 방식. `qT(L) ≤ qT(L_cap)` 위반 시 예외(I2 단언).
- **설정 보간**: 운영자 확인 setting은 정수만, 표 범위 밖(INOGEN 6 등)은 보간·외삽 대신 min(runtimeH)(보수).
- **ai_label 이웃 기종**: 이웃은 DB 기종의 matchKey 간 편집거리 ≤ 2(판독 키 = 그 기종 matchKey와 정확 일치이므로 같은 집합). continuous=false 이웃은 T_spec이 없어 제외. L_cap 첫 항은 이웃 집합의 max(runtime) 중 최솟값. 실제 DB에는 미끼 쌍(Astral 100, LTV 1105)이 없어 I2 미끼 속성 시험은 시험용 고정 DB로 했다.
- **CYL_LARGE**: 가구 기기가 아니라 실린더 사양이므로 `device_db.json`의 `devices`가 아니라 `cylinders`에 둔다. hoursLo 상한은 params `lb.cyl.hoursLoPerUnitH`(10h).
- **재신고**: `lEndPrev != null`이면 `L_end = min(lEndPrev, tReport + L)`. `POWER_SUPPLIED` 뒤 첫 신고는 호출자가 `lEndPrev = null`로 넘긴다(`reportLEndS` 보조 함수도 제공).
- **분위 표**: 감마는 P10·P90에 형상 k 이분법, 72h는 `min(Q, 72h)` 절단(3.1절 규칙 5의 '72h 평탄 구간'과 일치하는 해석). TYPHOON_STRONG 구간선형 CDF에 F(0)=0 매듭 추가(assumed). 로그정규 대안 표는 감마 원인과 혼합 성분만 바꾸고, 구간선형·고정 원인은 같은 표. 값은 qT 정수 초. 생성기 `tools/build_quantiles.py`(scipy 1.18.1, 사용자 site-packages라 `python -I` 대신 `python`으로 실행).
- **조건부 분위 정확 계산**: F(e)·Q(u)를 BigInt 유리수로 계산(중간값이 2^53을 넘을 수 있어 단언 대신 BigInt). Q는 floor. e < 0이면 e = 0. NEAR_CERTAIN은 명세대로 tOutage + 1.0 고정(now가 지나도 당기지 않음).
- **도착 정수화**: 거리 qD(km) = floor(km×1000 + 0.5) m, 준비 `floor(qT(prepH.hi) × pm_n / pm_d)`, 이동 `floor(dist_m × 3600 × cg_n / (speed × 1000 × cg_d))`, 곱마다 floor 한 번. 계획 119 = qT(a119H.hi × stress)(부동소수 곱 1회, Python도 같은 IEEE 곱).
- **자원 inverterSafe**: ESS·이동발전기·대여 외장은 true(assumed, 출처 없음), V2L은 "unknown"(명세). COUGH_E70 소비전력은 출처에 W가 없어 인공호흡기 가정값 30~60W를 빌림(assumed).
- **outcome 공백식(명세 3.8절과 다름 — 오라클 ENGINE_SPEC 반영 필요)**: 문자 그대로의 `G = max(0, T−L) + max(0, R − (T + run))`는 자원이 L_true 전에 도착하면 배터리 잔량을 무시해, 고위험이 아닌 가구(R ≤ L)에도 공백을 만든다(예: L 10h, R 5h, 자원 1h 도착·1h 지속 → 3h). 그래서 둘째 항을 `max(0, R − (T + run + max(0, L − T)))`로 했다. T ≥ L이면 명세 식과 정확히 같다.
- **L_true 기준**: 등록 가구 `L_true_end = tReport + LTrueH`(LTrueH는 신고 시점 잔여 진실 수명이어야 함 — 생성기 작업에 전달 필요), 미등록 가구는 `tOutage + LTrueH`.
- **M5 정의**: 미등록 가구 중 G>0 비율. M3·M5는 `{num, den, value}`로 내보내 분모 20 미만 「n건 중 k건」 표기를 지원한다. 공급원 동점은 RESTORE > RESOURCE > 119 > 쉼터.
- **속성 시험 도구**: fast-check가 설치돼 있지 않고 package.json은 이 작업 소유가 아니라, 같은 xoshiro128**(시드 고정)로 불변식마다 10,000회 돌렸다(`engine/test-rng.ts`). 변이 3종(외장 신고 개수 사용, 충전 100% 상한 제거, 재신고 min 제거)으로 시험이 실제로 실패함을 확인했다.

### 구현 중 결정 (TASK B3 — 독립 Python 오라클 `oracle/`)
- **독립성 범위**: `app/src`는 읽지 않았다(파일 이름 목록만 확인). 근거는 `docs/spec.md`(3.1·3.2·3.4·3.5·3.6·3.8·3.9·4.1·4.3·8절, 레드팀 기록)와 이 DEVLOG의 TASK A '구현 중 결정'이다. 명세가 정하지 않은 정수화 규약(충전 정수 %, floor 위치, 보간 정수 setting, 이웃 기종 정의, 도착 정수화 `qE(km)`·곱마다 floor, 공백식 둘째 항 수정)은 TASK A 결정을 명세 보충으로 채택했다. 따라서 이 규약들은 독립 검증이 아니라 '같은 문서 규약'이다(한계로 `/ledger`에 적을 것). `spec/ENGINE_SPEC.md`는 아직 없어 spec.md에서 직접 작성했다.
- **파일 이름**: 8·10절의 `{engine, alloc, outcome, run, diff}.py` 대신 작업 지시의 `lower_bound.py`·`rule.py`·`outcome.py`·`run.py`를 쓰고, `common.py`(양자화·장부)·`restoration.py`(조건부 분위)·`diff.py`를 더했다. 손계산은 `spec/hand_calc/`가 아니라 지시대로 `oracle/tests/hand_cases.json`(20건)이다. 8절 '세 번째 서브에이전트 작성 20건'은 별도 작업으로 남는다.
- **입출력 형식**: `oracle/FORMAT.md`로 고정했다(입력 `pl26-materialized/1`, 출력 `pl26-oracle-out/1`). 시간 필드는 `…S` 정수 초 우선, 없으면 `…H`를 qT. TS 쪽 export·결과 내보내기가 이 형식을 따라야 `diff.py`가 돈다.
- **CONFIRMED 배수**: exp(±1.2816σ)·exp(0.8416σ)는 materialize가 `multPpm`(×10⁶ 정수)으로 저장하고, `R_q_end = now + floor(max(0, R_est_end − now) × ppm / 10⁶)`. NEAR_CERTAIN은 모든 분위가 `tOutage + 1.0h`(now가 지나도 고정).
- **조건부 분위**: F(e)·Q(u)를 `fractions.Fraction`으로 정확 계산, Q만 마지막에 floor. Q(0) > e이면 F = 0. 내부 평탄 구간 동점은 최댓값 u(HC10b).
- **에너지 필터**: `floor(qE(E)×17/20) ≥ floor(qE(draw.hi)×H_need_s/3600)`(양변 각각 floor). 낭비 = 좌변 − 우변(mWh). O2_CYL_DELIVERY는 `36000 ≥ H_need_s`, 낭비 = `floor((36000 − H_need_s)×draw/3600)`, run = 36000s. run_j = `floor(qE(E)×17×3600/(20×qE(draw.hi)))`.
- **산소 호환**: 「산소는 O2_FLOW 또는 AC」를 '기기 등급이 `O2_`로 시작하면 O2_FLOW 자원도 호환'으로 구현했다. 등급 이름을 쓰므로 I5(등급 이름만 바꾸면 결정 동일)와 긴장이 있다 → 미해결(아래).
- **계획자 119 대기열**: 계획자 자신의 호출을 처리 순서대로 덧붙인다(다음 슬롯 = max(now, 마지막 슬롯 종료)). 진실 대기열만 (호출 시각, id) 정렬. 서비스 시간 = qT(1/k).
- **검토 예약**: 예약은 t₀에 1회. 자원 상한 = floor(가용 자원 × 1/5). 커넥터 '폭' = {AC220, DC12}와의 교집합 크기. 제약 ②의 보호 자원 집합은 예약 시작 전 1회 계산(비수동검토 AUTO 가구 전체의 phys 기준). 119 예약의 '남은 슬롯'은 MR 가구에 L_end가 없으므로 [now, now + mrHoldH) 안에 시작 가능한 슬롯 수로 정의했고, 상한 floor(슬롯 × 1/5). 예약은 검토 완료 시 계획자 대기열에서 지운다.
- **HOLD**: 세 조건 + `now < holdRecheckBy`일 때만 HOLD(phys가 비면 A_min = 감시값 → HOLD 안 됨). 만료 전 HOLD는 다른 결정 시점에서 재평가하지 않고, 만료 시점에는 강제로 '필요'.
- **결정 시점**: 검토 완료 시각 `tReport + mrDelayH`가 t₀보다 이르면 t₀로 당기고, 그 가구는 t₀ 실행 전에 검토 완료로 본다(예약 없음). 재진입 값(`reentry`)이 없거나 재진입 뒤에도 L이 없으면 MANUAL_REVIEW로 남는다.
- **order**: 결정 시점을 가로지르는 전역 순번. 5단계에서 6단계로 넘긴 가구는 6단계에서 레인을 받을 때 번호를 받는다. UNSERVED_VISIBLE이 뒤 시점에 다시 배정되면 새 번호. MANUAL_REVIEW·HOLD는 null.
- **진실 도착**: `arrivalTrue[hh|res]`·`shelterTrue`는 결정 시각부터의 소요시간, `a119True`는 슬롯 시작부터. 미등록 가구 호출 시각이 없으면 소진 시각(L_true).
- **표지(flags)**: SCREEN_CAPPED는 screenRemainingH가 있으면 붙인다(실제로 깎였는지와 무관). SETTING_USER_MIN은 settingSource = user이고 설정 표가 있는 기기에만. AGE_UNKNOWN은 연식 null일 때만.

### 미해결 (TASK B3)
- I5 대 산소 호환: 등급 이름 대신 기기 DB에 `O2_FLOW` 커넥터나 `oxygen` 속성을 두는 쪽이 I5에 맞다. TS와 같은 규칙으로 맞춘 뒤 바꿀 것.
- 119 예약 '남은 슬롯'과 MR 가구의 'L_end 이전'은 명세에 정의가 없다. 위 정의로 TS와 맞추거나 명세를 고칠 것.
- DB 밖 기종 재진입의 물리 속성(소비전력·커넥터)은 명세에 없다. `reentry.physical` 또는 보수 기본값으로 처리.
- 차등 시험 자체(TS 출력 대 오라클)는 아직 돌리지 않았다. TS RULE과 export 스크립트가 FORMAT.md 형식을 내야 한다.

### 구현 중 결정 (TASK B1 — 배정기·기준선 `app/src/lib/alloc/`)
- **파일**: §10대로 `need`(3단계)·`feasible`(4단계 필터와 배정 문맥)·`rule`(공용 골격, RULE, 재검토, 결정 시점 상태)·`fallback`(계획자 119 대기열, 5단계 ①②, 6단계)·`baselines`·`reasons`·`project119`. 엔진은 고치지 않았다.
- **입력 보충**: PlannerView에 이동시간 분포와 119 stress가 없어 `AllocOptions.travel`(기본 standard)·`stress119`(기본 1, `lanes.a119H.hi`에 곱함)로 받는다. 복구 분위는 `view.restoration`의 h를 qT로 정수화한다.
- **DB 밖 기종의 물리 속성**(수동검토 완료 뒤 operatorLowerH로 재진입): 명세에 없어 DB 전체에서 유도한 보수 외피(최대 drawW.hi 280W·AC220만·인버터 민감)를 쓴다. 새 상수 없음. COUGH_E70처럼 DB에 있는 비연속 기기는 DB 값.
- **산소 O2_FLOW 호환**: I5 때문에 등급(cls)을 읽지 않고 '기기 커넥터 ∋ O2_FLOW'로만 판정한다. 현재 `spec/device_db.json`의 산소발생기 커넥터에 O2_FLOW가 없어 O2_CYL_DELIVERY는 어느 가구와도 호환되지 않는다(시험은 O2_FLOW를 더한 시험용 DB로 경로를 확인). TASK B3 오라클은 'cls가 O2_로 시작'으로 구현해 서로 다르다 → 미해결 1.
- **O2_FLOW 쌍**: 출력 필터 면제, 에너지는 `36000 ≥ H_need_s`, run = 10h, 낭비는 남는 산소 시간 × 기기 소비(mWh 등가, half-up).
- **에너지 우변**: `qE(draw × H_need)`를 글자 그대로 `floor(qE(draw)·H_s/3600 + 1/2)`(half-up)로 계산한다. B3 오라클은 floor(+1/2 없음)라 경계에서 다를 수 있다 → 미해결 2.
- **σ_e ≤ 0.75**: σ_e를 1e-4 정수로 양자화해 비교. NEAR_CERTAIN은 σ_e = 0으로 본다. HOLD는 명세대로 CONFIRMED·NEAR_CERTAIN 둘 다(작업 지시의 'CONFIRMED만'보다 명세 4.1절 3단계 우선).
- **HOLD 시한**: phys가 비면 시한을 정할 수 없어 '필요'(B3와 같음). now ≥ holdRecheckBy면 '필요'(why HOLD_EXPIRED). `holdExpiredEntries`가 HOLD_EXPIRED(system) 감사 행을 만든다.
- **검토 예약**: 후보는 가용 ∧ 커넥터 호환 ∧ 인버터(에너지·출력 필터 없음), 순서 (A, {AC220,DC12} 교집합 크기 내림, 출력 내림, id). 상한 자원 floor(가용 × 1/5), 119 floor([now, now + mrHoldH)에 시작 가능한 슬롯 수 × 1/5)(MR 가구는 L_end가 없어서. B3와 같은 정의). 제약 ② 보호 집합은 예약 전 전체 풀 기준, HOLD 포함 비수동검토 가구 전체. 예약 시한 = tReport + mrHoldH. `AllocState.reservations`로 이전 시점 예약을 넘기면 그 가구가 아직 수동검토 중이고 시한 전일 때 자원·119 슬롯을 그대로 유지하고(상한·보호 재검사 없음), 재진입·시한 경과면 풀고 RESERVE 슬롯을 대기열에서 지운다.
- **기준선 공통부**: '차이는 필요성·도착 필터·순서뿐'을 글자대로 읽어 B1·B2도 RULE과 같은 검토 예약과 6단계 대체 레인을 쓴다. B1·B2 배정 행은 0.8L 안이면 PROPOSE_ASSIGN, 밖이면 GAP_REDUCE로 표기(모든 정책에서 'PROPOSE_ASSIGN = 전체 필터 충족'이 성립). B1 = L_end 오름차순 + 가장 가까운 물리 자원, 물리 자원 없으면 6단계. R_L = tier 없이 L 오름차순. RULE_FEASIBLE_FIRST는 (tier, slack) 키를 유지한 단일 요인 절제. ORACLE_INFO는 L_end·R을 평범한 숫자로 받아 R10=R80=R90=R_true, status CONFIRMED·σ 0으로 둔다(WorldTruth import 없음). NONE은 모두 UNSERVED_VISIBLE. KR_BASELINE은 배정기가 아니라 시뮬레이터 행동이라 `kr07CallS`(호출 시각 규칙)만 둔다.
- **order**: 실행 1회 안에서 MANUAL_REVIEW(tReport 순) → 5단계 선택 순서(6단계로 넘긴 가구도 5단계에서 뽑힌 순번 유지, 1.4절 '가장 급한 가구가 레인과 무관하게 위') → HOLD(시한 순). B3 오라클은 '레인을 받은 순서, MR·HOLD는 null, 결정 시점 전역'이라 다르다 → 미해결 3.
- **etaH**: 절대 모의 시각. 자원 레인은 A_end, 119는 계획 이송 완료 시각. slack −∞는 `slackS = −(2^31−1)` 감시값, `slackH`는 그 h 환산값.
- **결정 시점 재실행(4.3절 ②)**: 배정기는 받은 가구만 처리한다. `nextState`가 고정 행의 자원·CALL 슬롯·좌석·예약을 넘기고, `unassignedIds(res, nextNowS)`가 MR·UNSERVED·만료된 HOLD만 돌려준다(만료 전 HOLD는 재평가하지 않음).
- **재검토(라운드 3 #4)**: `recheckApproved`는 승인 행을 바꾸지 않고, 위반(자원 불가·물리 위반·도착 깨짐·119 지연) 행마다 RECHECK_FLAG(system) 감사 행과 나머지 승인 배정을 고정한 RULE 대안(PROPOSED)을 낸다. 이미 도착한 자원은 도착 조건을 보지 않는다.
- **근거 문장**: 템플릿 15개(명세 예시 5개 + 기본값 배정·공백 단축(6단계)·119·119 지연·쉼터·미배정·수동검토 2종·재검토·기준선). 숫자 자리는 정수 초를 `fmtH`(소수 둘째 자리, half-up)로만 채우고 렌더 시 자리표시자 누락·초과를 예외로 막는다.
- **119 투영**: `expectedSafeUntil`은 Date 금지라 정수 달력 연산(Hinnant)으로 `baseIso + L_end`를 만든다. 기기 칸은 등급 표시 라벨(표시 전용).
- **속성 시험**: fast-check 대신 TASK A와 같은 시드 xoshiro128**로 불변식마다 10,000회. 물리 필터는 시험 파일 안에서 명세 식으로 따로 계산해 대조한다. 변이 10종(출력·에너지·인버터·도착 필터 끄기, HOLD 만료 무시, 예약 상한·보호 무시, 재검토 도착 무시, 등급을 인버터 판정에 사용)을 넣어 각각 시험이 실패함을 확인했다.

### 미해결 (TASK B1)
1. 산소 호환: `spec/device_db.json`의 PERFECTO2·INOGEN_G5 connectors에 `"O2_FLOW"`를 더하고, TS·오라클 모두 '커넥터 교집합' 하나로 판정할 것(B3의 cls 접두어 규칙은 I5 속성 시험과 충돌).
2. 에너지 우변 반올림(half-up 대 floor)과 O2 낭비 단위를 ENGINE_SPEC.md에 하나로 적고 TS·오라클을 맞출 것. TS는 qE 정의를 글자대로 따랐다.
3. order 정의(5단계 선택 순 대 레인 부여 순, MR·HOLD null 여부)를 ENGINE_SPEC.md에서 하나로 정하거나 차등 비교에서 order를 뺄 것.
4. RENTAL_EXT는 커넥터 VENDOR_EXT를 가진 기기가 DB에 없고, 출력 = 기기 W라 1.25× 필터도 통과하지 못해 현재 데이터로는 배정되지 않는다(명세 그대로 둠).
5. 계산량: 한 실행이 O(가구² × 자원)이고 300가구 × 자원 100개 RULE 1회가 약 135ms(Node, 이 PC)다. 결정 시점 여러 번 × 정책 9개 × 스윕 수백 회면 sim 작업에서 총 시간을 재 볼 것.

### 구현 중 결정 (TASK C — 시뮬레이션 핵심 `app/src/lib/sim/`)
- **파일**: §10의 `prng`·`generator`·`materialize`·`lhs`·`run`·`labels`와 2장·4.1절이 이름을 든 `reentry.ts`. §10 밖으로 `scenarios.ts`(표준 50건·프리셋 정의와 봉인 문서), `sim_params.json`(생성기 보조 장부)을 더했다. 스크립트는 `app/scripts/{build-standard50,build-presets,export-scenarios,build-prereg-stub}.ts`(§10의 `std50`·`export-scenarios` 자리). `outcome.ts`는 고치지 않았다.
- **PRNG**: xoshiro128** 상태 4워드 = splitmix32(FNV-1a32(`master␀scenarioId␀streamNo`))의 첫 4출력. 균등값 (x>>>8)/2^24, 정규값은 Box–Muller 코사인 가지(균등 2개 소비). 참조 벡터(상태 1,2,3,4 → 11520, 0, 5927040, 70819200)로 시험.
- **스트림 배치**: HH = 구성·기기 진실(시작 충전·진실 설정·외장 작동·실린더 진실 시간), BEHAVIOR = tReport·충전 출처/입력·과대입력·mrDelayH·operatorLowerH 표본·KR-07 호출 균등값, RES = 자원, TRUTH_R = R_true, EST = CONFIRMED 여부와 Z, ARRIVAL = 진실 도착, LANE = 예비전원 고장·쉼터 거부·A_119 진실·쉼터 도착. 가구마다 고정 개수(HH 21, BEHAVIOR 8, LANE 4)의 균등값을 먼저 꺼내 θ가 바뀌어도 같은 가구는 같은 균등값을 쓴다.
- **저장값 = 사용값**: materialize는 정본 JSON(키 정렬, 1e-6 반올림, undefined 생략)과 sha256을 내고, 시뮬레이터는 그 JSON을 다시 읽어 돈다. 시간은 정수 초로 만든 뒤 h로 바꾸고(qT(s/3600) = s), 좌표는 0.1km, 연식은 0.01년, θ는 1e-6로 반올림해 쓴다. sha256은 Worker에서도 쓰도록 순수 TS로 구현(node:crypto와 대조 시험).
- **materialize 형식**: oracle/FORMAT.md `pl26-materialized/1`을 따르고, 오라클이 무시하는 필드를 더했다: `truth.hh[id].kr07CallS`(KR_BASELINE용), `labels`(분석 전용 등급, PlannerView 밖), `theta`, `composition`, `sim.travelProfile`·`sim.pEarly`. CONFIRMED는 `confirmed.rEstEndS`와 `multPpm`(floor(exp(±zσ)·10⁶+0.5))을 저장하고, 시뮬레이터의 결정 시점 복구 범위도 오라클과 같은 정수 식 now + floor(max(0, R_est_end − now)·ppm/10⁶)로 계산한다(`engine/restoration.ts`의 UI용 Math.exp 경로를 쓰지 않음).
- **생성기 해석**(명세 5.2절의 빈칸, 값은 모두 `sim_params.json`에 출처·유형과 함께): 산소 하위 구성 기본점 0.5/0.2/0.3, 보호자 0.5, 층 U{1..20}(APT_* 외 원인은 단독주택 1층 0.5), APT_* 가구는 단지 중심 ±0.3km, 자원 구성 ESS_S .35·ESS_L .2·V2L .2·이동발전기 .1·산소 배달 .15(RENTAL_EXT 제외), 외장 개수 Astral 2·그 밖 1, 실린더 1개, 충전 출처 나머지 자가입력:모름 = 1:1, 과대입력 = 100%, '예보·통지 사건' = ROTATING·태풍 2종, 외장 작동 확률 = 1 − 예비전원 고장 확률, 미등록 가구 수 = round(N·r/(1−r)), 쉼터 좌석 max(1, floor(0.1N)), 쉼터 진실 도착 U(shelter.prepH), CONFIRMED 통보는 t₀ 전 도착, tOutage = 0.
- **진실 수명**: 본체 = T_spec × k_set(설정표 없는 기기만) × k_age × 시작 충전, 휴대형 산소는 진실 설정 U{1..5}의 설정표 보간(k_set 미적용), 외장 = Σ(작동) runtimeH × k_age × 외장 충전, 실린더 = 개수 × U[10, 20]h. θ의 k_set·k_age는 시나리오 단위 스칼라(가구별 추첨 아님). `LTrueS = max(0, qT(정전 시작 기준 수명) − (tReport − tOutage))`로 신고 시각 기준(TASK A 미해결 4 반영). 미등록 가구는 정전 시작 기준.
- **계획자 입력**: 시뮬레이션 가구 기종은 `specBy = db_exact`, 미확인 모델은 `specId = null`(MANUAL_REVIEW)이고 재진입 값 `reentry.specId`(진실 기종, 재진입 시 specBy = operator). 휴대형 산소의 setting은 보고하지 않아 min(runtimeH)를 쓴다. 충전 입력 % = floor(100 × 신고 시점 본체 잔량 / 본체 용량). 외장·실린더 운영자 확인은 확인 비율 θ로(외장 chargeConfirmed·extAgeY = null, 3.2절).
- **등급 라벨**: O2_STAT + 실린더 → O2_STAT_CYL, VENT_8H + 확인 외장 2개 → VENT_8H_EXT2(`labels.ts`). 초점 VENT_8H 가구가 EXT2로 바뀌지 않게 초점 VENT_8H의 Astral 외장은 미확인으로 둔다.
- **사건 루프(`run.ts`)**: 수동검토 완료 = max(t₀, tReport + mrDelayH)(t₀ 이전 완료는 t₀ 실행 전에 재진입 — B3 오라클과 같음). 각 시점의 실행 대상 = 재진입 가구·만료 HOLD·UNSERVED_VISIBLE이고, 검토를 기다리는 수동검토 가구도 함께 넘겨 B1의 예약 유지(AllocState)를 살린다(넘기지 않으면 예약이 풀림 — 시험으로 확인). 대상이 없는 시점은 건너뛴다. 재진입 값이 없으면 최종 MANUAL_REVIEW. 전역 순번은 레인을 받는 순간 부여(오라클과 같은 뜻, 실행 안의 순서는 B1 `rec.order`).
- **정책별 처리**: RULE·기준선 6종·ORACLE_INFO는 같은 루프. ORACLE_INFO에는 L_end = tReport + LTrueS, R_true를 숫자로 넘긴다. NONE은 아무 도움 없음(미등록 가구의 KR-07 호출도 없음). KR_BASELINE은 결정 시점 없이 모든 등록 가구가 KR-07(`kr07CallS`) 시각에 119를 부르고 미등록 가구와 진실 대기열을 나눈다. 6.2절 DSL 경로는 아직 없음.
- **표준 50건**: 7등급 × 7원인 순서(등급 바깥 고리), N=30·초점 12, 비 1.5/3/6을 idx%3로 순환(17/16/16), 자원 수 round(30/비) = 20/10/5. ROTATING 1건은 60가구 혼합, 비는 명세에 없어 3(자원 20). `spec/standard50.json`에는 정의와 materialize sha256만 싣고(본문은 `out/oracle_input/`), 시험이 현재 코드·장부로 다시 만든 파일과 바이트 동일함을 확인한다.
- **프리셋**: PRESET-SUWON(APT_NIGHT_XFMR, 시드 1001)·PRESET-SEOSAN(APT_PARTS, 1002)·PRESET-ROTATING(ROTATING, 1003), 30가구·자원 10·표준 θ. 시드는 배정기를 이 시나리오에 돌려 보기 전에 정했다. 파일 = `{format, meta, scenario}`(materialize 전체). 화면은 `scenario.planner`만 읽어야 한다.
- **사전등록 초안**: 5.5절 범위라 `prereg/sweep.json`(스크립트 생성: 축·표준 θ·시드 범위·장부 상수, 사람이 정할 칸은 null)과 `prereg/predictions.md`(틀만)를 만들었다. 둘 다 S4 전에 확정한다.

### 미해결 (TASK C)
1. **생성기 보조 장부 병합**: `app/src/lib/sim/sim_params.json` 19행은 `spec/params.json`(TASK A 소유)에 병합할 후보다. 병합하면 `npx tsx scripts/build-standard50.ts && npx tsx scripts/build-presets.ts`를 다시 돌려 봉인 파일을 갱신해야 한다(S2b 커밋 전에).
2. **미배정 등록 가구의 자가 119 호출(방향 결정 필요)**: 명세는 미등록 가구만 KR-07을 따른다고 적는다. 그대로 두면 도구 정책에서 끝까지 UNSERVED_VISIBLE인 등록 가구는 복구까지 아무 도움을 받지 못해, 서산형 프리셋에서는 KR_BASELINE의 M2가 RULE보다 작다(115.5h 대 156.4h. 수원형은 KR 105.7h 대 RULE 91.4h로 반대). `runScenario(m, p, { unservedSelfCall: true })`로 이 가구들도 KR-07 시각에 119를 부르게 할 수 있다(서산형 RULE 156.4h → 92.8h). 기본값은 명세 문자대로 false. E1·E2 전에 정해 S4에 봉인할 것.
3. **산소 배달이 현재 DB로는 어느 가구와도 맞지 않음**(B1 미해결 1과 같은 원인): 생성기 산소 비중이 85%이고 거치형(배터리 0h)이 많아, O2_FLOW 커넥터가 없으면 산소 가구의 처방이 사실상 119·쉼터뿐이다. 수원형 RULE은 PROPOSE_ASSIGN 0건·GAP_REDUCE 7건이다 → K-DEG(9절)가 실패할 가능성이 높다. `spec/device_db.json` PERFECTO2·INOGEN_G5에 `"O2_FLOW"`를 더하는 수정이 우선이다(이 수정은 봉인 파일 내용을 바꾸지 않는다: materialize는 커넥터를 쓰지 않음).
4. **차등 시험 현황**(통과 기준 100% 미달, 원인은 alloc·오라클 쪽 규약 차이): 53건(표준 50 + 프리셋 3)을 `out/oracle_input/`에 내보내 `python -I oracle/run.py`가 모두 실행됨을 확인했다. TS RULE 출력과 비교하면 order는 거의 모든 건에서 다르다(B1 미해결 3). O2 호환을 오라클과 맞춘 시험용 DB(`O2_DB`)로 돌리면 53건 중 40건이 lane·resourceId·M1·M2 일치. 남은 13건은 첫 결정 시점의 검토 예약 자원 선택(TS는 커넥터·인버터 호환 자원만, 오라클은 필터 없음)과 HOLD 재확인 시한의 A_min 풀(TS는 예약 전 전체 풀, 오라클은 예약 뒤 자유 자원)에서 갈린다. 결정 시점 목록은 확인한 건에서 같았다(사건 루프 규약 일치). `ENGINE_SPEC.md`에서 두 규약을 하나로 정할 것.
5. **ESLint 규칙 미적용**: 2장의 `sim/reentry.ts` WorldTruth import 금지와 3장 Math.random·Date 금지는 `eslint.config.mjs`(이 작업 소유 아님)에 아직 없다. 대신 `run.test.ts`가 소스를 읽어(주석 제거 뒤) `reentry.ts`의 진실 참조 0, `sim/` 본 코드의 Math.random·Date 0을 확인한다.
6. **npm 스크립트 없음**: `package.json`은 이 작업 소유가 아니라 스크립트 등록을 하지 않았다. 실행은 `app/`에서 `npx tsx scripts/<이름>.ts`.

### TASK D — 차등 시험 (10/17)
- `npx tsx app/scripts/diff-oracle.ts`: 시나리오 553건(표준 50 + 프리셋 3 + 경계 퍼즈 500, 가구 2,993) TS ↔ Python 오라클 **불일치 0건**(L·RULE 배정·M1/M2·보조 필드). 결과 `out/diff_report.{json,md}`.
- 산소 호환은 기기 등급 이름이 아니라 커넥터 교집합(`O2_FLOW`)으로 통일(I5).
- 결정: `unservedSelfCall`(끝까지 미배정인 등록 가구도 KR-07 시각에 스스로 119 호출)을 **켠다**. 근거: 도구가 배정하지 못한 가구가 아무 행동도 하지 않는다고 두면 RULE이 KR_BASELINE보다 불리하게 보이는 인위적 결과가 나온다(서산형 156.4h vs 115.5h). 현실의 미배정 가구는 119를 부른다. S4 봉인 전 확정값.
- 서브에이전트 주간 한도(10/19 21:00 KST 재개)로 적대적 검증 3라운드는 이월. 그동안 메인 세션이 직접 진행.

## Phase 2 — 화면 (10/17, 메인 세션 단독)

### 만든 것
- `/` 랜딩: 배너, H1, 두 시계(CSS `@property` 정수 카운터로 3:00:00→0:00:00, `prefers-reduced-motion`이면 정지), 막대 길이는 `params.landingGapBarH`, 평균 인정 줄(14% 추산은 1차 문서 미확인이라 사건형: 인천 계양 11h·충남 서산 14h), CTA 2개, 30초 비교 위젯(빌드 때 엔진으로 하한·복구 분위를 계산해 넘김, 클라이언트 API 0), 끝 카드(`evidence.json`만, 측정 전 표시).
- `/ops`: 프리셋 3개, 모의 정전 발생, 모의 시계 정지/×1/×60/×600(모의 5분마다 재계산), 지연 실측, 한전 복구 예정 통보(CONFIRMED → HOLD 가능), A/B 띠(`evidence.json`), 처리 순 표(MR 맨 위 고정·레인별 묶기·근거 펼치기·플래그·재검토 배지), 승인 서랍(승인·수정·확인 조작 5종·재신고 시연·대안 승인), 자원 패널·SVG 격자도, 감사 로그(JSON 내려받기), 누락률 감사 표.
- `/ops/119`: 운영자 결정 FALLBACK_119만 3필드, 파기. `/lab`·`/ledger`·`/about`는 Phase 3·6에서 채울 최소 페이지(숫자는 evidence.json, 없으면 「측정 전」).
- 데이터 경로: `scripts/presets-ab.ts`(봉인 프리셋 sha 확인 → RULE·B1·B2 → `out/presets_ab.json`) → `scripts/sync-evidence.ts` → `src/data/evidence.json`. `scripts/build-ui-presets.ts`가 봉인 프리셋에서 planner만 꺼내 `src/data/presets/*.json`(truth 없음)을 만든다.
- 세션 로직은 순수 모듈 `src/lib/ops/session.ts`(시험 9건). 승인 행 고정 + 나머지 RULE + `recheckApproved` + HOLD 시한 경과.
- 시험: vitest 198건 통과(Phase 1 186 + 세션 9 + 119 투영 2 + 승인 우회 스캔 1). 승인 우회 스캔: `status: "APPROVED"` 대입은 `ApproveDrawer.tsx` 1곳.
- 실제 구동 확인(Playwright MCP, 프로덕션 빌드): 390×844 랜딩 첫 화면(시계 애니메이션 시작·끝 프레임), 1440 데스크톱 `/ops` 정전 발생 → H-011 119 승인 → `/ops/119` 3필드 → 파기 → 복귀 시 상태 유지 → ×600 시계 진행. 콘솔 오류는 favicon 404 하나(아이콘 추가로 해결).

### 구현 중 결정
- **slack 정의 변경(spec 라운드 4 #1)**: 위 기록 참조. 이 변경은 봉인 프리셋 결과를 본 뒤의 변경이다(프리셋 A/B 값은 바뀜: 수원 RULE M2 76.24→76.35h, 서산 M1 28→29·M2 92.85→90.24h). 변경 판단의 근거는 프리셋 성적이 아니라 화면의 비상식적 순서이고, 효과 확인은 개발 시드(5000~5079)로 했다. A/B 띠의 「결과 보기 전 봉인된 프리셋」 문구는 시드에 대해서는 여전히 참이지만 규칙에 대해서는 아니므로, 툴팁 문구를 S4 전에 다시 정한다.
- `project119`: MODIFIED(수정으로 119 연계) 포함, 하한 미계산이면 「하한 미확인(수동검토 중)」.
- 수정(MODIFY)은 승인과 같은 효력의 운영자 결정(status MODIFIED). 대안 승인은 MODIFY(reasonCode RECHECK_ALT).
- 수동검토 시연 힌트: 시나리오의 `reentry`(PlannerView 쪽 BEHAVIOR 표본, 진실 아님)를 서랍에 「시연 데이터 · 현장 확인 결과」로 보여 준다.
- 119 화면 남은 하한은 같은 필드(ISO 시각)에서 계산한다(1.5절).
- 표준 50건은 `/ops` 시나리오 목록에 아직 없다(프리셋 3개만). 필요하면 build-ui-presets처럼 planner만 뽑아 싣는다.
- params.json `restoration.APT_FIRE` 메모의 「무안 약 25h」를 리서치 정정에 맞게 고쳤다(값은 그대로).

### 탐색 결과(개발 시드, 봉인 아님) — 방향 결정 필요
- 표준 θ, 가구/자원 3, 80건: 공백 고위험 가구 M1 = RULE 2035 / B1 2040 / B2 2031 / KR_BASELINE 2144 / ORACLE_INFO 1979 / NONE 2195(고위험 2195). M2(h) = 6120 / 6001 / 6120 / 6042 / 5849 / 23544.
- 자원 고장 0·빠른 이동에서도 RULE과 단순 규칙 차이는 ±1% 수준이고, 완전정보 상한(ORACLE_INFO)도 RULE보다 약 4% 낫다. 즉 이 모형에서 공백을 좌우하는 것은 처리 순서가 아니라 시간 구조(준비+이동 시간 > 남은 하한)와 가구 구성(산소 85% 중 거치형 무배터리 절반)이다.
- 표준 θ에서 RULE의 M2가 KR_BASELINE보다 크다. 원인 후보: 예비전원 고장(backupFailProb 0.4)이면 그 가구는 다른 수단 없이 복구까지 공백으로 남는다(고장 뒤 119 재호출 모형 없음). 현실과 다른 비대칭이므로 고장 발견 시 119 호출 규약을 넣을지 S4 전에 정한다.
- 결론: 끝 훅의 기본안(지배율 [P1])은 관문 2를 통과하기 어렵다. 헤드라인 후보는 ① 손익분기(배터리 하한 대 복구 분포)와 ROBUST 빈틈, ② 해외 사전 배치 보완안(E3), ③ 명단-절차 단절이다. 사용자 결정 사항으로 올린다.

## Phase 2.5 — 시뮬레이션 규약 보정 (10/17)

화면 점검과 개발 시드 탐색에서 나온 두 결함을 S4 봉인 전에 고쳤다(spec 라운드 4 #2·#5). TS·Python 오라클 동시 수정, 차등 553/553, 오라클 손 사례 20/20·스모크 200/200, vitest 199건.

1. **루프 안 지연 119**(4.1절 5단계 ③): 제때 119가 안 되고 공백 단축 자원도 없으면, L_end 전 시작 가능한 슬롯을 처리 순서대로 준다. 수원형에서 하한 0.95~2.35h 가구 7곳이 먼저, 실린더 보유 10h 가구 4곳이 뒤에 119를 받는다(전에는 반대).
2. **자원 멈춤 → 119 호출**(3.8·4.3절): 배정 자원이 고장 나거나 복구 전에 바닥나면 멈춘 시각에 가구가 119를 부른다. 끝까지 미배정·수동검토 등록 가구의 KR-07 자가 호출(TASK D 결정)과 함께 `runScenario` 기본값으로 올렸다. 오라클은 필드가 없는 손 사례에서는 두 호출을 하지 않는다(FORMAT.md).

개발 시드 80건(시드 5000~5079, 표준 θ, 가구/자원 3) 정책별 합계 — 봉인 측정 아님:

| 정책 | M1 공백 고위험 가구 | M2 공백 가구·시간(h) |
|---|---|---|
| RULE(원안 판단식 구현) | 2,033 | 5,148 |
| B1 배터리 짧은 순 | 2,031 | 5,187 |
| B2 가까운 자원 순 | 2,021 | 5,268 |
| ORACLE_INFO(완전정보 상한) | 1,976 | 4,950 |
| KR_BASELINE(현행 절차) | 2,144 | 6,042 |
| NONE(도움 없음) | 2,195 | 23,544 |

- 도구(어느 순서 규칙이든) 대 현행: M2 약 15% 감소, M1 약 5% 감소. RULE은 현행 대비 완전정보 상한까지 가능한 M2 개선의 약 81%를 얻는다((6042−5148)/(6042−4950)).
- 순서 규칙끼리(RULE·B1·B2)는 ±2% 안이다. 끝 훅 기본안(지배율 [P1])은 관문 2를 통과하기 어렵다 → 사용자 결정 사항.
- 봉인 프리셋 A/B는 이번 변경으로 다시 바뀌었다(수원 RULE 31/80.26h, B1 31/76.47h, B2 30/81.2h; 서산 28/86.79h, 28/82.42h, 30/100.14h). 프리셋 1건 값으로 규칙을 고르지 않았다(판단 근거는 개발 시드 합계와 화면 순서).

## Phase 3a — 실험 실행기와 S4 사전등록 (10/17)

사용자 결정: 헤드라인 방향 (가) 「도구 대 현행 절차 + 손익분기·ROBUST 빈틈」. 명세 변경은 spec.md 끝 「반영 기록 (라운드 5)」 11개 항목.

### 만든 것
- `src/lib/sim/sweep.ts`: E1·E2 시나리오 정의와 1건 실행(결과 행에 seed 기록). E2 27칸(σ_e 0.5 칸이 앞 9칸), E1 7등급 × 5가구 층화.
- `src/lib/sim/analyze.ts`: Wilson CI, E1 표지(ROBUST·CONDITIONAL·FRAGILE·BORDERLINE), 축별 1차원 반증, p_early 강등, CONDITIONAL 경계 정전시간, 안정성 시험(강등 전 표지끼리), E1b 곡선, E2 칸 판정(승/무/패 + M2 짝 차이 평균 부트스트랩 CI + 상대 감소율 CI), [P1]·[P0]·[P2], 정보 상한 몫.
- 생성기 `stratPerClass`(선택 필드): 없으면 결과가 이전과 같다. 봉인 프리셋 3개·표준 50건 sha256 그대로임을 확인했다.
- 난수 스트림 `BOOT=10` 추가(부트스트랩 전용).
- `scripts/sweep.ts`(worker_threads 14개), `scripts/sweep-worker.ts`, `scripts/lab-analyze.ts`.
- `scripts/build-prereg.ts`(이전 `build-prereg-stub.ts`): 봉인 설정 + 실행 코드 31개 파일 sha256 + 재현 명령.
- `tools/check-seal-order.mjs`: S4 태그 이전 git 이력과 S4 이전 로컬 out/ JSON에 E1·E2 전용 시드 0개. 위반 파일을 넣으면 실패하는 것을 확인했다.

### 계산 시간 실측 → 규모 결정(결과를 보기 전)
- E2 시나리오 1건(정책 10개) 약 52ms, E1 1건(정책 2개, 60가구) 약 21ms. 5,400건 E2가 14작업자로 약 20초.
- 그래서 11.3절 2단 절단을 되돌렸다: E2 9칸 → 27칸, E1 1,000 → 4,000추첨. 축별 반증은 앞 500추첨.

### 개발 시드 예비 실행(봉인 아님)
- E2(시드 4,001~9,400): RULE이 KR_BASELINE보다 27칸 모두 우세, 합산 M2 −14.95%(CI 14.5~15.5%), 칸별 5.2~27.1%. 단순 규칙과는 [P1] 0 · [P0] 25 · [P2] 2. 합산 M1 승패는 B2_NEAREST가 RULE보다 많이 이긴다(751승 1,416패). RULE_NO_R은 RULE과 사실상 같다(tier가 표준 θ에서는 순서를 거의 바꾸지 않음). 정보 상한 몫 95%.
- E1(master E1-dev, 400추첨): KR 표지 ROBUST(O2_STAT 제외) 12칸 — VENT_1H·VENT_3H × 아파트 장기 3원인, VENT_1H × 순환단전, O2_PORT × 아파트 장기, VENT_8H × APT_PARTS·APT_FIRE. RULE 표지에서도 VENT_1H·VENT_3H × 아파트 장기 6칸은 ROBUST로 남는다(준비+이동 시간 > 남은 하한). 안정성 통과.
- 해석: 도구 효과는 순서 규칙의 정교함이 아니라 '등록 기기 정보로 호환 자원을 정전 즉시 잇는 것'에서 나온다. 1~3시간 인공호흡기 × 아파트 장기 정전은 정전 뒤 배정으로 닫히지 않는다 → 사전 배치(E3)가 다음 질문.

### 남은 위험
- KR_BASELINE은 자원을 쓰지 않는다(공개 절차에 자원 연결 단계가 없어서). 그래서 '도구 대 현행' 차이는 자원 + 정보 연결 전체의 효과다. `/lab`과 끝 카드에서 이 분해를 함께 보인다(라운드 5 #2).
- 레드팀(서브에이전트)은 10/19 21:00 KST 한도 해제 뒤. 그 전 검증은 시험·실행·메인 세션 점검.
