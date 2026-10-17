# 전력안심망 AI 빌드 명세 (최종판 v1)

- 작성일: 2026-10-17(토). 같은 날 레드팀 라운드 1(25건), 라운드 2(22건), 라운드 3(18건)을 반영했다(맨 끝 '레드팀 반영 기록').
- 제출 목표: 2026-10-30(금). 마감은 10/31 24:00 KST, 이메일 제출이다.
- 저장소: `C:\Users\user\Desktop\dev\공모전\전력안심망 AI\` (기존 git, 커밋 없음)
- 만든 방식: 시안 3개를 심사위원 3명이 채점했고, 만장일치 승자인 `evidence` 시안을 뼈대로 종합했다. 채점 경위는 `docs/design/panel-summary.md`에 있다.
- 기준 문서
  - 전략 보고서 `final_report_power-outage-lifeline-sim-95b993`
  - 중간보고 6건
  - 제안서와 답변서 1·2
  - 성과보고서 양식
  - 형제 저장소 `AI 라이프 솔루션 챌린지/app`의 코드
- 표기
  - 대괄호 안의 id는 `research/notes`의 note id다.
  - `assumed`는 출처 없는 가정값이다.
  - `inferred`는 출처 수치에서 계산한 값이다.
  - `calibrated`는 입력을 맞추는 데 쓴 값이며 검증 대상이 아니다.

**한 줄 구조.** 앞면은 작동하는 운영자 도구다. 증거층은 리허설 랩으로, 가정 범위 위에서 ROBUST·CONDITIONAL·FRAGILE 빈틈, 손익분기, 지배율, 해외 절차 순위를 낸다. Claude는 세 곳(라벨 비전, 문서→DSL, 보완안 한국화)에서만 일하고, 세 곳 모두 코드가 채점한다. 나머지는 전부 'AI 아님'으로 표기한다.

---

## 0. 착수 전 결정

### 0.1 사용자 답이 필요한 것

답이 없는 동안에는 기본안으로 진행한다. 다만 Q1의 답이 없으면 아래 두 가지만 멈춘다: 참가신청서 서명, README의 착안 문구 작성.

| # | 결정 | 기본안 | 막히는 작업 |
|---|---|---|---|
| Q1 | JEONJO 저장소 소유자와 사용자·팀원의 관계 | 관계 없음. 코드·자료 재사용 0을 전제한다 | 신청서 서명, README 착안 한 줄. 엔진·오라클 작업은 재사용이 0이므로 막지 않는다 |
| Q2 | 착안 사실 공개 방식 | README에 착안 한 줄과 차이표만 쓰고, 보고서 본문에는 원안의 모의정전 요구와 학술 계보만 쓴다 | README |
| Q3 | 먼저살기가 하루 이상 밀릴 때의 동결 규칙 | 채택한다. 11.3절 절단 순서를 따른다 | 없음 |
| Q4 | 이 출품 전용 Anthropic 워크스페이스·키, 콘솔 지출 상한 USD 50 | 사용자가 직접 만든다. **기한은 D3 종료(10/19 24:00 KST)**이고, D1에 한 줄로 요청한다. 그 전까지 Claude 호출은 0회다. 기한을 넘기면 11.2절 '키 지연 재배치 표'를 따른다. **콘솔 상한은 월 단위로 리셋된다.** 그래서 10/31(늦어도 11/1 오전)에 콘솔 상한을 (50 − 10월 실지출)로 낮추고, 심사·투표 종료일(Q10)까지 매월 1일에 (50 − 누적 실지출)로 다시 맞춘다(사용자 작업, D14 체크리스트와 `/ledger`에 기록) | C1 실호출(D5), C2(D9), C3(D10) |
| Q5 | 랩 명칭 | 전략 보고서가 정한 **'리허설 랩'을 유지**한다. 먼저살기 `oracle/rehearsal.py`와 이름이 겹치는 점은 AI 접근방법 서술을 따로 써서 해소한다. '모의정전 랩'으로 바꾸려면 지시해 달라 | 없음 |
| Q6 | push·Vercel 자동 배포 위임(10/15 지시)을 이 저장소에도 적용할지 | 확인 전까지 커밋은 자동, push는 한 줄로 확인받는다 | 매일 배포 |
| Q7 | 호출 제한·예산 저장소로 먼저살기 Upstash를 키 접두사 `pl26:`로 함께 쓸지, 새 DB를 만들지 | **새 무료 Upstash DB를 만든다.** 비용 0이고, 한 출품의 남용·명령 한도 소진이 다른 출품의 AI 호출을 막지 않게 장애를 격리한다(형제 ratelimit은 저장소 장애 시 닫힘). 키 접두사 `pl26:`는 그대로 쓴다 | D5 |
| Q8 | 렌더한 라벨 30장을 인쇄해 휴대폰으로 촬영하는 것(선택) | 없으면 렌더와 열화 이미지만으로 측정하고 한계를 밝힌다 | 없음 |
| Q9 | 사람 검수 시간(약 3~4시간): 독립 계산 20건 중 5건 검산(S2a 뒤), **KR-01~12 기준선 DSL 12행 검수(S4 뒤, 약 30분)**, **P1~P8 핵심 매개변수(coverage, failProb, delay, energyWh) 검수(E3 결과 공개 전, 약 20분)**, 보류 오라클 DSL 조항 단위 검수(S5 뒤, 1~2시간), 천장용 오라클 1~2건 재작성(선택) | 사용자가 한다. **라운드 3부터 사람 검수는 '봉인 전 필수'가 아니라 '봉인 후 검수 가능'이다.** 봉인은 에이전트 산출물로 예정일에 하고, 검수 결과와 수정은 `seal/CHANGELOG.md`에 남기며 수정 전후 결과를 둘 다 싣는다(5.5절 규칙 재사용). `evidence.json`의 `humanReview` 블록으로 `/ledger`에 자동 표시하고(7.6절), 예정일까지 검수 기록이 없으면 그 행에 「사람 검수 없음」이 자동 표시된다. 재작성을 못 하면 '천장' 대신 '모델 간 일치(같은 계열)'로 표기한다(7.3절). **D1 요청 메시지**에 4개 검수를 한 줄씩 적는다: 독립 계산 5건 검산(새 D3 이후, 약 40분) / KR-01~12(새 D10 이후, 약 30분) / 보류 오라클 DSL 3건(C2를 Must로 유지할 때만, S5 이후 1~2시간) / P1~P8 매개변수(E3를 할 때만, 약 20분) | 없음(봉인 일정을 막지 않음) |
| Q10 | 심사·국민투표 종료일(공개 URL이 버텨야 하는 마지막 날) | 공고문에서 확인해 `params.json`에 적는다. 확인 전에는 12/31로 둔다(assumed) | public 풀 일일 상한(7.5절) |
| Q11 | Must 시간 초과분 처리. **라운드 3에서 아래 절단을 D1에 확정 적용했다**(11.2절 항목별 시간표 91h → 76h, 라운드 3 추가분 +4h로 80h). 하루 5h 상한(D1~D14, 70h)으로는 여전히 약 10h 초과한다 | **확정 적용(−15h)**: ① 준법 문서 4종을 1개 문서(`docs/compliance/README.md`, 4개 절)로 합침(−2h) ② C1 봉인 측정을 Sonnet 2회 → 1회(헤드라인은 그 회차, 회차 간 불일치율은 dev 40장 2회에서만. S3에 봉인, 7.2절)(−1h) ③ E1b를 해석 구간 표 + 공백 곡선 1장으로 축소(−1h) ④ `/about`을 ODD 한 쪽과 장부 링크로 축소(−1h) ⑤ 프리셋 5개 → 3개(수원형·서산형·순환단전)(−1h) ⑥ Python 오라클 범위를 lowerBound·RULE·outcome(M1/M2)로 축소, 시험 집합은 표준 50 + 경계 퍼즈 500만(기준선 6종·`dsl_interp`·무작위 2,000건 제외)(−4h) ⑦ 초월함수 금지·정수 표·`no-magic-numbers` 제거(3절)(−3h) ⑧ Batches 경로 제거(7.1절)(−1h) ⑨ OTS는 S4·S5에만, S1·S2a·S2b·S3은 sha256 매니페스트 커밋만(−1h) ⑩ `/judge`를 `/ledger` 안의 한 절로 합침(Should라 Must 시간 변화 0). **남은 약 10h — 사용자 결정(D1 종료까지)**: (가) **기본안**: C2(항목 9·10, 12h)를 Should로 내린다. Must는 68h로 70h 안에 든다. C2를 하지 못하면 12.1절 AI 기술명 자동 전환과 K-DSL 강등 표기가 그대로 적용된다 (나) C2를 Must로 유지: 대신 C2 개발 3라운드 → 1라운드(−1h), KR 내장 경로를 없애고 DSL 경로 하나로 KR_BASELINE 구현(−2h), `/lab` 탭 ⑥을 `/ledger` 절로 합침(−1h), C1 dev 5판 → 3판(−1h), 영상 편집 6 → 5h(−1h)를 적용하고, 남는 약 4h는 10/31 오전을 쓴다(먼저살기 제출과 같은 날이라 위험 높음) | D8 이후 C2 일정(답이 없으면 (가)) |

### 0.2 연구 문서와 실제 조건이 다른 점 (이 명세가 고친 것)

1. **단가.** 전략 보고서 6.6절은 Sonnet $3/$15로 계산했다. 실제 단가는 $2/$10이다(형제 `models.ts`, Haiku $0.1/$0.5, Opus $4/$20). 예산은 7.5절에서 다시 계산했다.
2. **예산 키.** 형제 `budget.ts`의 `monthKey()`는 UTC 기준 `YYYY-MM` 키를 쓴다(코드로 확인함). 그대로 쓰면 11월 1일 심사 기간 중에 카운터가 초기화된다. 이 출품은 출품 단위 누적 키 `pl26:budget:<pool>`를 쓴다.
3. **배정 순서.** 전략 보고서 6.4절 3항과 중간보고의 예비 몬테카를로는 'L 오름차순'으로 돌았다. 반면 중간보고 결론과 이 명세의 제약은 'least-slack'이다. 이 명세는 **least-slack을 주 규칙으로** 정한다. 'L 오름차순'은 절제 기준선 `R_L`로 남기므로, 예비 실험 재현과 least-slack의 기여가 따로 측정된다.

---

## 1. 제품 화면

### 1.1 공통 원칙

- **법정 배너.** 모든 페이지 상단에 고정한다(AI기본법 제31조①). 문구: 「본 서비스는 AI 기반으로 운용됩니다 · 시연용 합성 데이터 · 계산·배정 규칙은 AI가 아닙니다」
- **AI 표지.** AI 출력에는 `<AiTag kind="추출|생성">`를 붙인다(제31조②).
- **첫 10초.** 시뮬레이션 없이도 참인 공공 수치와 두 시계만 보여 준다. 첫 화면에서는 배너를 빼고 'AI', '시뮬레이션', '예측', '생명', '안전'이라는 단어를 쓰지 않는다.
- **마지막 10초.** 끝 카드 `ClosingCard`는 `evidence.json`만 읽는다. 측정 전에는 「측정 전」으로 표시하고 하드코딩하지 않는다.
- **JEONJO와 겹치는 화면 문법 금지.** 3D, '세계 수' 선택기와 카운터, 페르소나 군중, 취약점 카드, 검토 지수 가중치, LED·LCD 표현은 쓰지 않는다. 결과는 표와 2D 차트로만 낸다.

### 1.2 경로

| 경로 | 대상 | 렌더링 | 내용 | 등급 |
|---|---|---|---|---|
| `/` | 투표자(모바일)·심사위원 | SSG | 두 시계 훅, 30초 비교 위젯, CTA 2개, 끝 카드 | Must |
| `/ops` | 심사위원(데스크톱) | 클라이언트 | 운영자 화면: 순위·여유 범위·추천·ETA·근거·승인/수정, A/B 카운터, 감사 로그 | Must |
| `/ops/119` | 데모 | 클라이언트 | 승인된 119 레인 건만, 정확히 3필드 | Must |
| `/household` | 데모 | 클라이언트 + `/api/vision` | 라벨 → AI 추출(샘플은 기록 재생, 업로드만 실호출) → DB 대조 → 사람 확인 → 하한 분해식 → 정전 신고 | Must |
| `/lab` | 심사위원 | SSG + Worker | 리허설 랩 탭 6개(5.8절) | Must(탭 ①②③⑥), Should(④⑤) |
| `/lab/manuals` | 심사위원 | SSG | 문서 원문 하이라이트와 DSL 규칙 대조, 오라클 대 Claude 차이, 지어낸 규칙 사례 | Should |
| `/ledger` | 심사위원 | SSG | AI 사용 장부(7.6절). `evidence.json`에서 자동 생성하며 손으로 적은 숫자는 0개다 | Must |
| `/judge` → `/ledger#judge` | 심사위원 | SSG + Worker | 3분 확인 경로, 화면×심사항목 표, 재현 해시 버튼. **Claude 호출 없음.** 라운드 3(Q11⑩)으로 별도 경로가 아니라 `/ledger` 안의 한 절로 합쳤다. 이 명세의 다른 곳에 나오는 `/judge`는 이 절을 뜻한다(`/judge`는 `/ledger#judge`로 리다이렉트) | Should |
| `/about` | 공통 | SSG | ODD 한 쪽, 매개변수 장부, 제31·33·34조 대응표, 민감정보, 의료기기 비해당, 한계 | Must |
| `POST /api/vision` | 서버 | Node 함수 | C1 업로드만 실호출한다(샘플 6장은 호출 0). 호출 제한, 전역 일일 상한, 예산 풀 `public`을 적용하고, 넘으면 재생 모드로 떨어진다(7.5절). 심사용 접근 코드가 맞으면 일일 상한과 별도인 `judge` 풀을 쓴다(7.2절) | Must |
| `GET /api/health` | 서버 | Node 함수 | 풀별 잔액(금액만), public·스모크 지출(Upstash 단독 기록, 7.1절)을 따로 표시. 형제의 현재 구현을 그대로 복사한다: 인스턴스 메모리 60초 캐시, `deep=1`은 `HEALTH_DEEP_TOKEN`과 같은 `x-health-token` 헤더가 있어야 하고 운영에서 토큰 환경변수가 없으면 403. **모델 ID 확인(Models API)은 deep 경로에서만** 한다 | Must |

C2와 C3는 공개 URL에서 실호출하지 않는다. 오프라인 스크립트로 실행하고, 봉인된 출력·해시·측정값만 화면에 싣는다. 공개 비용이 생기는 지점은 C1 업로드 하나다.

### 1.3 `/` 랜딩 (390×844 기준, 스크롤 없이 첫 화면)

| 구간 | 내용 |
|---|---|
| 배너 | 12px 한 줄 |
| H1 (28px) | 「배터리가 먼저 끝날까, 전기가 먼저 올까」 |
| 두 시계 (0~3초 자동, `prefers-reduced-motion`이면 정지 그림) | 왼쪽 「인공호흡기 내장배터리 3:00:00」이 빠르게 0까지 줄어든다 [astho-advancing-preparedness-for-life-support-users-during-power-outages-aug-202]. 오른쪽은 「최악의 단지 설비 고장 · 정부 임시전력 목표 24:00:00 이내」 [readnewsaspx]. 왼쪽이 0이 되면 빨간 막대가 뜬다. 막대에는 시간 숫자를 쓰지 않고, 라벨은 「목표 상한까지 남는 차이 · 내장배터리만, 외장·이송 없을 때의 단순 비교」로 고정한다. 막대 길이(24−3)는 `params.json`의 type `inferred` 행(`landingGapBarH`, sourceIds 두 출처)에서 읽는다. 애니메이션은 CSS만 쓴다 |
| 평균 인정 한 줄 | 「한국 정전은 한 집당 1년 9분입니다. 그러나 아파트 정전 7건 중 1건은 12시간을 넘깁니다(정부 추산, 보도)」 [한전-세계-최저수준-정전-더-줄인다][readnewsaspx]. 14% 추산을 1차 문서로 확인하지 못하면 사건형으로 바꾼다: 「2026년 8월 인천 계양 11시간, 충남 서산 14시간」 |
| 30초 비교 위젯 (스크롤 아래) | 기기 칩 4개(산소발생기·배터리 없음 / 인공호흡기 1시간 / 3시간 / 8시간)와 원인 칩 4개(단지 단기 고장 / 야간 변압기 / 전기실 화재 / 강한 태풍)를 고르면, 하한 막대 위에 복구 범위 막대(P10~P90)가 겹치고 공백 구간이 빨갛게 칠해진다. 표지는 「가정 시나리오 범위 · 한전 실시간 예측 아님」. 수치마다 출처 각주를 단다. 계산은 클라이언트에서만 하고 API는 부르지 않는다 |
| CTA | 기본: 「운영자 화면 체험 (수원형 야간 변압기)」 → `/ops?s=PRESET-SUWON`. 보조: 「같은 정전 [N]번 다시 돌린 결과」 → `/lab`([N]은 evidence.json에서 읽고, 측정 전이면 「결과 보기」) |
| 끝 카드 | `ClosingCard`. 그 아래 「2026 AI 라이프 아이디어 챌린지 12번 후보작 구현」과 링크(심사위원 경로 · AI 사용 장부 · 법·윤리) |

**품질 예산**
- `/` 초기 JS는 gzip 120KB 이하, 모바일 4G에서 LCP 2.0초 이하. LCP는 Playwright 기본 설정(스로틀 없음)이 아니라 **Lighthouse CI 모바일 프리셋(simulated throttling) 3회 실행의 중앙값**으로 잰다
- 본문 16px 이상, 명도 대비 4.5:1 이상
- OG 이미지: 1200×630 두 시계 그림을 `next/og`로 빌드할 때 만든다
- `og:title`은 H1과 같다

### 1.4 `/ops` 운영자 화면

**상단 바**
- 시나리오 선택: 프리셋 3개(수원형 야간 변압기, 서산형 부품 조달, 순환단전. Q11⑤로 5개 → 3개)와 표준 50건
- 「모의 정전 발생」 버튼. 답변서2 3번이 허용한 신고·시연 이벤트 방식이다
- 모의 시계: ×1 / ×60 / ×600
- 「정전→순위 표시 지연 ___ms」 실측값
- 운영자 입력 「한전 복구 예정 통보 받음」: 시각과 불확실성(±) 입력. 이 입력이 있어야만 HOLD 판정이 가능하다

**A/B 카운터 띠**
- 문구: 「같은 정전·같은 시드 — 공백이 남은 고위험 가구(모의): 원안 판단식 구현 규칙 a / 배터리 짧은 순 b / 가까운 자원 순 c · 공백 가구·시간(모의): a′ / b′ / c′」. M1과 M2를 늘 함께 싣는다(3.8절).
- 툴팁(고정): 「결과 보기 전 봉인된 프리셋 · 이 시나리오 1건 결과 · 전체 9칸 승/무/패는 /lab」
- `/lab#dominance` 링크를 단다
- **데이터 경로.** 카운터는 `WorldTruth`로 채점한 값이므로 화면이 직접 계산하지 않는다. sim 모듈(Node CLI)이 프리셋마다 미리 계산한 `out/presets_ab.json`을 `sync-evidence`가 `evidence.json`에 넣고, 화면은 `evidence.json`만 읽는다(2장 ESLint 규칙 유지). 프리셋 JSON(시드 포함)은 S2b에 봉인되므로(5.7절) 결과를 본 뒤 시드를 고를 수 없다
- 사용자가 「모의 정전 발생」 뒤 승인·수정으로 상태를 바꾸면 카운터는 「봉인 프리셋 기준값(조작 전)」 표지를 단 채 바뀌지 않는다

**가운데 표 (처리 순)**
- 기본 정렬: `MANUAL_REVIEW` 행을 맨 위에 고정하고, 나머지는 배정기의 처리 순서(`order`, tier 다음 slack 오름차순, 4.1절 5단계)로 늘어놓는다. 가장 급한 가구가 레인과 무관하게 위에 온다.
- 「레인별 묶어 보기」 토글을 켜면 아래 레인 순서로 묶는다.
- 레인 순서:
  1. `MANUAL_REVIEW` — 맨 위 고정, 빨간 테두리
  2. `PROPOSE_ASSIGN`
  3. `FALLBACK_119`
  4. `GAP_REDUCE`
  5. `FALLBACK_SHELTER`
  6. `HOLD`
  7. `UNSERVED_VISIBLE`
- 열은 다음과 같다.
  - 가명(H-017)
  - 기기 등급과 확인 배지(`사양 확인` / `수동검토`)
  - 하한 L: 「하한 L h(제조사 사양·입력 기반, 실측 보장 아님)」
  - 복구 범위: 「가정값 P10~P90 h」
  - 추천 자원, ETA
  - 순서 키 `tier · slack h`: 실제 처리 순서를 정한 값(4.1절 5단계). tier 0은 「복구 가정 P90 전에 하한 소진 가능」, tier 1은 「가정 범위를 넘을 때만 공백」. slack이 음수면 「0.8×하한 안 도착 불가」 표시
  - `MANUAL_REVIEW` 행: 「검토 예약 자원 {id} · 예약 시한 {t}」(4.1절 2단계)
  - 여유: **범위로만 표시**(I8, 3.7절)
  - 근거 문장: 템플릿으로 만들며 펼칠 수 있다. slack 값을 문장에 넣는다
  - 플래그: 보수 산정 / 수동확인 / 미확인 외장 0 처리 / 외장 충전 미확인(c_ext 1/2) / AI 판독 기종 미확인(이웃 기종 최소값) / 이용자 입력 연식 무시
  - 승인 행에 「재검토 필요」 배지(아래 '재계산')
- HOLD는 화면에 「대기(재확인)」로 표시한다. '모니터링'이라는 단어는 쓰지 않는다. HOLD 행에는 「재확인 시한 = L_end − 1.25·A_min − now」를 표시한다(3.9절).

**누락률 감사 표 (`/ops` 하단, `/ledger`에도 같은 표)**
- 행: 기기 등급, 충전량 출처(device_screen / user / unknown), **수동검토 경유**(MANUAL_REVIEW를 거쳐 재진입한 가구), **기종 확인 상태**(`specBy`: db_exact / ai_label_user_confirmed / operator)
- 열: `PROPOSE_ASSIGN` / `FALLBACK_119` / `GAP_REDUCE` / `UNSERVED_VISIBLE` 비율, **검토 예약률**(그 행 가구 중 4.1절 2단계 검토 예약을 받은 비율. 기기군별로 예약이 몰리는지 드러낸다)
- 기기군별로 한 레인에 몰리거나 배정이 0인 군을 드러내기 위한 표다(제안서 '지역·기기군별 누락률 감사'). 등급은 집계에만 쓰고 배정 입력이 아니다(I5).

**오른쪽: 자원 패널과 2D 격자도**
- 자원 패널: 종류, 잔량 Wh, 출력 W, 커넥터, 격자 위치, 상태, 배정 대상, 「모의 값」 표지
- 격자도: SVG 격자 개략도. 지도 타일과 GPS는 쓰지 않는다

**승인 서랍**
- 「승인」: 상태가 `APPROVED`가 된다. 119 전달은 레인이 `FALLBACK_119`인 행만 가능하다(1.5절).
- 「수정」: 다른 가능 자원이나 레인을 고른다. 사유 코드(드롭다운)와 자유문 5자 이상이 필수다. 레인을 `FALLBACK_119`로 바꾸면 '119 연계'로 기록된다.
- 거절 버튼과 일괄 자동 확정은 없다(I6).
- 모든 조작은 `AuditEntry`로 남고 JSON으로 내려받을 수 있다.

**확인 조작 (운영자만, 사유 필수)**
- 「외장 확인」: 가구가 신고한 외장배터리의 모델이 `ext_db`의 `extSpecId`와 정확히 일치하고 `forSpecIds`에 해당 기기 `specId`가 있을 때만 누를 수 있다. 확인한 개수를 입력한다. 개수는 `count ≤ declaredCount`를 zod로 검사한다(넘으면 저장 불가). `AuditEntry(VERIFY_EXT)`로 남고, 그 뒤에만 L_ext에 들어간다(3.2절). **모델·개수 확인은 충전 상태 확인이 아니다.** 운영자가 외장의 충전 표시를 직접 확인했을 때만 payload에 `chargeConfirmed: "device_screen"`을 넣을 수 있고(선택 칸), 없으면 c_ext = 1/2로 계산한다. 외장 연식은 대여·구입 기록으로 확인했을 때만 `extAgeY`(근거 텍스트 필수)를 넣고, 없으면 f_age_ext = 7/10이다(3.2절).
- 「실린더 확인」: 같은 방식. 실린더를 신고한 가구에만 누를 수 있다(`declared === true`, zod 검사). 확인 개수 `count`와 `hoursLo`를 입력하고, zod로 `hoursLo ≤ CYL_LARGE 사양 하한(10h) × count`를 강제한다(넘으면 저장 불가). `AuditEntry(VERIFY_CYL)`.
- 「연식 확인」: 기기 배터리 연식 `batteryAgeY`는 운영자가 대여·구입 기록으로 확인해 입력할 때만 계산에 쓴다(prov `operator`, 근거 텍스트 필수). `AuditEntry(VERIFY_AGE)`. 이용자가 입력한 연식은 null(f_age 7/10)로 처리하고 `USER_AGE_IGNORED` 플래그를 단다(3.2절).
- 「기종 확인」: AI 판독이 DB와 정확 일치해 `specBy = "ai_label_user_confirmed"`인 행에만 누를 수 있다. 운영자가 라벨 사진·판독 원문과 사양 카드를 대조한 뒤 누르면 `specBy = "db_exact"`가 되고 `AuditEntry(VERIFY_MODEL)`로 남는다. 그 전에는 이웃 기종 최소값으로 L을 계산한다(3.2절, 7.2절).
- 「수동검토 완료」(`MANUAL_REVIEW` 행에만): ① DB 기종 선택(정확 일치 키 확인) 또는 ② 사람 입력 보수 하한(시간, 근거 텍스트 필수, prov `operator`) 중 하나를 입력한다. `AuditEntry(MANUAL_REVIEW_DONE)`로 남는다.
- 수동검토 완료 전에는 「수정」에서 `PROPOSE_ASSIGN`을 고를 수 없고 `FALLBACK_119`와 `GAP_REDUCE`만 고를 수 있다.

**상태 보관**
- 세션 메모리에만 둔다. 서버 DB는 없다.
- 「새로고침하면 초기화됩니다」를 표시한다.

**재계산**
- 상태가 바뀔 때, 또는 모의시간 5분마다 다시 계산한다(제안값).
- 재계산은 모의 시각 `now`를 기준으로 하므로 L·R·A의 남은 시간이 경과시간만큼 줄어든다(3.9절).
- 승인된 행의 배정 자체는 자동으로 바꾸지 않는다. 대신 **매 재계산마다 승인 행의 `feasible`과 도착 조건(`qT(A_end − now) ≤ qT(0.8·L_rem)`, 자원 `available`)을 다시 평가한다.** 가구 재신고로 L_end가 줄었거나, 배정 자원이 unavailable이 되었거나, 모의시계 경과로 도착 조건이 깨지면 그 행에 「재검토 필요」 배지를 달고 `AuditEntry(system, RECHECK_FLAG)`를 남긴다. 그다음 그 가구를 제외한 나머지 승인 배정을 고정한 채 RULE로 대안 1건을 계산해 새 `PROPOSED`로 승인 서랍에 올린다(승인 필요, 자동 확정 없음). 대안이 승인되면 이전 배정은 `MODIFY`로 대체된다.
- HOLD 행의 재확인 시한이 지나면 자동으로 '필요' 판정으로 되돌리고(`PROPOSED`, 승인 필요), 감사 로그에 `HOLD_EXPIRED`(actor `system`)를 남긴다.

### 1.5 `/ops/119`

- 싣는 행: `APPROVED`이면서 레인이 `FALLBACK_119`인 행(수정에서 '119 연계'로 바꾼 행 포함)만. `PROPOSE_ASSIGN`·`GAP_REDUCE`·`FALLBACK_SHELTER` 등 다른 레인은 승인돼도 싣지 않는다(답변서2 1번 최소 정보).
- 해당 행이 없으면: 「승인된 119 연계 건이 없습니다」만 보인다.
- 있으면: `View119`의 **정확히 3필드**만 보인다.
  - 위치: 격자 셀 라벨
  - 기기: 등급 라벨
  - 예상 안전시간: 절대 시각으로 표시한다. 예) 「소진 하한 시각 14:20(모의시각) · 남은 하한 1.6h」. 남은 하한은 같은 필드에서 화면이 `now`로 계산해 붙인다
- 하단에 「재난 대응 종료 시 파기(재난안전법 제74조의3⑤)」 문구와 파기 버튼을 둔다(I7).
- 가명, 승인 시각 같은 다른 키는 타입 수준에서 금지한다(zod `.strict()`).

### 1.6 `/household`

1. 기본값은 샘플 라벨 고르기다. 렌더 라벨 6장이고, 미등록 모델 1장을 포함한다.
   - 샘플은 API를 부르지 않는다. 봉인 측정(D11) 때 같은 6장에 대해 받은 실제 Claude 출력을 그대로 재생하고 `AiTag` 「봉인 측정 시 실제 AI 출력 재생」을 단다. D11 전에는 D5 개발 중 기록한 실제 출력을 「개발 중 기록된 실제 AI 출력 재생(기록일)」로 재생한다.
   - 실호출은 사용자가 업로드할 때만 한다.
2. 업로드는 체크 2개를 모두 해야 열린다. 공개 배포의 기본값은 샘플이다. 「심사용 접근 코드」 칸(선택)이 있고, 코드가 맞으면 `judge` 풀로 실시간 판독한다. 코드가 없으면 공개 업로드 규칙(public 풀, 전역 일일 상한, IP당 시간 10회)을 따른다(7.2절).
   - 경고문: 「이 서비스는 이미지를 저장하지 않습니다. 판독을 위해 국외 AI 사업자(Anthropic) API로 전송되며, 해당 사업자의 데이터 보존 정책에 따라 일정 기간 보관될 수 있습니다(정책 링크). 실제 환자 라벨·성명·시리얼은 올리지 마세요」
   - 체크 ①: 「합성 라벨이거나 환자가 쓰지 않는 기기의 라벨입니다」
   - 체크 ②: 「국외 전송에 동의합니다」
   - 실제 보관 기간과 정책 URL은 구현 시점의 Anthropic API 데이터 보존 정책 문서를 확인해 `docs/compliance/README.md`의 '민감정보' 절(Q11①로 준법 문서 4종을 1개 문서로 합침)에 출처와 함께 적는다. 같은 문서에 '국외 이전' 항목(이전 국가, 사업자, 목적, 항목, 동의 방식)을 둔다.
3. 추출 표: 필드마다 `AI 추출` 태그, 원문 문자열(verbatim), 판독 상태를 보인다.
4. DB 대조
   - 정확히 일치하고 `legibility=clear ∧ confidence=high`이면 사양 카드를 보이고, 가구가 「이 기종이 맞습니다」를 누르면 `specBy = "ai_label_user_confirmed"`가 된다. 이 상태는 **검증 사양이 아니다.** 운영자 「기종 확인」(1.4절, `VERIFY_MODEL`) 전까지는 판독 키와 편집거리 ≤2인 DB 이웃 기종 중 runtimeH가 가장 작은 값으로 L을 계산하고, 분해식과 근거 문장에 「AI 판독 기종 미확인 · 이웃 기종 최소값」(`MODEL_AI_UNCONFIRMED`)을 표시한다(3.2절).
   - 불일치하거나 판독 불명확이거나 `confidence=low`이면 「수동검토 대기」로 두고 자동 계산은 하지 않는다(I4).
   - 퍼지 후보는 「후보(확인 필요)」로만 보이고 계산에는 쓰지 않는다.
5. 최소 입력
   - 충전량: 기기 화면 / 직접 입력 / 모름
   - 기기 화면의 남은 시간(선택)
   - 외장배터리: 보유 신고(모델, 개수)만 받는다. 가구 쪽 '확인 여부' 칸은 없다
   - 실린더: 보유 신고만 받는다
   - 보호자 유무, 이동지원 필요, 층수
6. 하한 분해식: 마치다시 양식처럼 「내장 h × 노후 × 충전 + 확인된 외장 h × 개수 = 하한」으로 보인다 [町田市-在宅人工呼吸器使用者のための災害時個別支援計画-様式].
   - 신고한 외장배터리와 실린더는 운영자가 `/ops`에서 「외장 확인」「실린더 확인」을 하기 전까지 회색 줄 「0시간으로 계산(운영자 확인 전)」으로 보인다(I3).
   - 「입력해도 하한은 제조사 사양의 90%(+운영자 확인분)를 넘지 못합니다 · 충전량 입력은 현재 상태 갱신용」을 표시한다(I2). 충전량을 '모름'에서 '100%'로 바꾸면 L은 오를 수 있으나 L_cap 이하로 묶인다. 실제로 지켜지는 불변식은 `qT(L) ≤ qT(L_cap)`이다.
   - 배터리 연식 칸은 두지 않는다. 연식은 운영자 「연식 확인」으로만 들어간다(1.4절).
7. 「정전 신고」를 누르면 같은 탭 세션의 `/ops` 시나리오에 이벤트가 들어간다.

### 1.7 화면과 심사항목 대응 (`/judge`에도 싣는다)

| 화면·요소 | 문제정의·해결 | AI 구현·완성도 | 사회문제 기여 | AI 창의적 응용 | 국민투표 | 가점 |
|---|---|---|---|---|---|---|
| `/` 두 시계, 평균 인정 | ● 꼬리 문제 | | ● 대상 규모 | | ● 10초 이해 | |
| `/` 비교 위젯 | ● 손익분기 직관 | | | | ● 참여감 | |
| `/ops` 순위·승인·119 | ● 답변서 판단구조 재현 | ● 작동 흐름 | ● 사람 승인 | | ○ | ● 12번 구현 |
| `/ops` A/B 카운터 | ● 단순 규칙 거부 근거 | | | | ● 숫자 하나 | |
| `/household` 라벨 | | ● C1 실측 | | ○ | ● 사진 한 장 | |
| `/lab` 빈틈 지도·손익분기 | ● ROBUST 표지 | ● 결정론·재현 | ● 공백 가구-시간 | | | |
| `/lab` 보완안 순위 | | | ● 정책 함의 | ● C3 닫힌 고리 | | |
| `/lab/manuals` | ● 현행 절차 실문서 | ● C2 실측 | | ● C2 | | |
| `/ledger` | | ● 측정값·비용·실패율 | | ● AI 경계 | | |
| `/judge`, `/about` | 체크리스트 | ● 봉인·차등시험·제33·34조 | ● 민감정보 | | | ● 아이디어 번호 |

---

## 2. 도메인 모델 (`app/src/lib/domain/types.ts`)

핵심 원칙은 **판단과 진실의 분리**다.
- 운영자 도구와 배정기는 `PlannerView`만 받는다.
- 결과 채점은 `WorldTruth`로만 한다.
- `WorldTruth`를 `src/app/**`와 `src/lib/alloc/**`에서 import하는 것은 ESLint `no-restricted-imports`로 금지한다. 시뮬레이터가 수동검토 가구를 재진입시킬 때(4.1절 2단계)도 `LTrueH`를 쓰지 못하게 같은 규칙을 `sim/reentry.ts`에 걸고, 속성 시험으로 'L_true를 바꿔도 재진입 L 불변'을 확인한다. `WorldTruth`로 채점해야 하는 화면 값(A/B 카운터 등)은 sim 모듈이 미리 계산한 출력 파일(`out/presets_ab.json` 등)을 `evidence.json` 경유로만 읽는다(1.4절).
- 명단에 없는 가구는 도구에 보이지 않지만 공백 집계에는 들어간다. 그래서 '명단 기반 도구의 한계'가 결과에 그대로 드러난다.

```ts
export type ProvType = "spec" | "measured" | "event" | "policy" | "inferred" | "assumed" | "calibrated" | "operator";
export interface Prov { type: ProvType; sourceIds: string[]; note?: string }
export interface Range { lo: number; hi: number }

// 등급은 표시·분석·라벨 집계용이다. 배정기의 입력이 아니다(I5).
export type DeviceClass = "O2_STAT" | "O2_STAT_CYL" | "VENT_1H" | "VENT_3H" | "O2_PORT"
  | "VENT_8H" | "VENT_8H_EXT2" | "INTERMITTENT" | "UNKNOWN";
export type Connector = "AC220" | "DC12" | "VENDOR_EXT" | "O2_FLOW";
export type Cause = "KEPCO_DIST" | "APT_SHORT" | "APT_NIGHT_XFMR" | "APT_PARTS" | "APT_FIRE"
  | "TYPHOON_WEAK" | "TYPHOON_STRONG" | "ROTATING";

export interface DeviceSpec {
  specId: string; manufacturer: string; model: string;
  matchKeys: string[];                 // 정규화(대문자, 공백·하이픈 제거) 정확 일치 키
  cls: DeviceClass; continuous: boolean; // false(기침유발기 등) → 수동검토
  internalH: { value: number; condition: string; prov: Prov };
  settingTable?: { setting: number; runtimeH: number }[];
  drawW: { value: Range; prov: Prov };
  connectors: Connector[]; inverterSensitive: boolean;
}
export interface ExtSpec { extSpecId: string; forSpecIds: string[]; runtimeH: number; prov: Prov }

// ---- PlannerView: 도구·배정기가 보는 것 ----
export interface HouseholdView {
  id: string; pseudonym: string;            // "H-017"
  cell: { x: number; y: number };           // 합성 격자 km, 주소·GPS 없음
  floor: number; mobilityNeed: boolean; caregiver: boolean;
  tReport: number;                          // 신고(충전량 입력) 모의 시각 h. L_end = tReport + L, 재신고 시 비증가(3.9절)
  lEndPrev: number | null;                  // 직전 신고의 L_end. 재신고 단조 규칙용(3.9절)
  device: {
    specId: string | null; specBy: "db_exact" | "ai_label_user_confirmed" | "operator" | null;
      // operator = 수동검토 완료에서 DB 기종 선택(1.4절). ai_label_user_confirmed = AI 판독 정확 일치 + 가구 확인만(검증 사양 아님,
      // VERIFY_MODEL 전에는 이웃 기종 최소값, 3.2절). db_exact = 운영자 VERIFY_MODEL 완료, 또는 시나리오 데이터(프리셋·시뮬레이션)
    setting?: number; settingSource?: "user" | "operator";          // user면 min(runtimeH)를 쓴다(3.2절)
    batteryAgeY: number | null;               // 운영자 VERIFY_AGE로만 채운다(prov operator). 이용자 입력 연식은 null + USER_AGE_IGNORED
    charge: { value: number | null; source: "device_screen" | "user" | "unknown" };
    screenRemainingH?: number;
    operatorLowerH?: { hours: number; basis: string; auditId: string };  // DB 밖 기종·비연속 기기: 사람 입력 보수 하한
  };
  // 가구는 보유 신고만 한다. 확인(opVerified)은 운영자 조작 AuditEntry로만 생긴다(I2·I3)
  ext: { extSpecId: string | null; declaredCount: number;
         opVerified: { count: number; chargeConfirmed: "device_screen" | null; extAgeY: number | null; auditId: string } | null }[];
  cylinder?: { declared: boolean; opVerified: { count: number; hoursLo: number; auditId: string } | null };   // hoursLo ≤ 10h × count (zod)
}
export type ResourceKind = "ESS_S" | "ESS_L" | "MOBILE_GEN" | "RENTAL_EXT" | "O2_CYL_DELIVERY" | "EV_V2L";
export interface ResourceView {
  id: string; kind: ResourceKind; cell: { x: number; y: number };
  outputW: number; energyWh: number; connectors: Connector[];
  inverterSafe: boolean | "unknown"; prepH: Range; available: boolean;
  mock: true; schemaRef: "data.go.kr/15151542";
}
export type EstimateStatus = "ASSUMED_RANGE" | "NEAR_CERTAIN" | "CONFIRMED";
export interface RestorationView {
  cause: Cause; tOutage: number;
  p10: number; p50: number; p80: number; p90: number;   // now 기준 조건부 분위의 절대 모의 시각(3.9절)
  status: EstimateStatus; sigmaE: number | null;
  label: "가정 시나리오 범위 · 한전 실시간 예측 아님";
}
export interface PlannerView {
  scenarioId: string;
  now: number; tOutage: number;             // 모의 시각 h(시나리오 시작 0). 모든 시각은 절대값(3.9절)
  households: HouseholdView[]; resources: ResourceView[];
  restoration: RestorationView;
  lanes: { k119PerH: number; a119H: Range; shelter: { seats: number; prepH: Range } };
}

// ---- WorldTruth: 시뮬레이터 채점 전용 ----
export interface WorldTruth {
  seed: string; restorationH: number;
  hh: Record<string, { LTrueH: number; extWorks: boolean[]; backupFails: boolean; shelterRefuses: boolean; mrDelayH: number }>;
  unregistered: { id: string; LTrueH: number; cell: { x: number; y: number } }[]; // 도구에 안 보임
  arrivalTrueH: Record<string, number>;   // key `${hh}|${res}`
  a119TrueH: Record<string, number>; shelterTrueH: Record<string, number>;
}

// ---- 출력 ----
export interface LowerBound {
  hours: number | null; endT: number | null;   // endT = L_end = tReport + hours (3.9절)
  status: "AUTO" | "MANUAL_REVIEW"; capH: number | null;
  terms: { label: string; hours: number; prov: Prov }[];
  flags: ("CHARGE_UNKNOWN" | "AGE_UNKNOWN" | "EXT_UNVERIFIED_ZERO" | "SCREEN_CAPPED" | "USER_INPUT_DISCOUNTED"
    | "SETTING_USER_MIN" | "OPERATOR_LOWER" | "EXT_CHARGE_UNKNOWN" | "USER_AGE_IGNORED" | "MODEL_AI_UNCONFIRMED")[];
}
export type Lane = "MANUAL_REVIEW" | "PROPOSE_ASSIGN" | "FALLBACK_119" | "GAP_REDUCE"
  | "FALLBACK_SHELTER" | "HOLD" | "UNSERVED_VISIBLE";
export interface Recommendation {
  householdId: string; lane: Lane; order: number; L: LowerBound; R: RestorationView;
  resourceId?: string; etaH?: number; marginH: Range | null; slackH: number | null;
  tier: 0 | 1 | null;                       // 4.1절 5단계 순서 키 1단(MANUAL_REVIEW·HOLD는 null)
  reservedResourceId?: string;              // MANUAL_REVIEW만: 검토 예약 자원(4.1절 2단계)
  holdRecheckBy?: number;                   // HOLD만: L_end − 1.25·A_min (모의 시각)
  reason: { templateId: string; params: Record<string, string | number> };
}
export type DecisionStatus = "PROPOSED" | "APPROVED" | "MODIFIED";   // REJECTED는 없다(I6)
export interface AuditEntry {
  at: string; actor: "demo-operator" | "system"; householdId: string;   // system은 HOLD_EXPIRED·RECHECK_FLAG만
  action: "APPROVE" | "MODIFY" | "VERIFY_EXT" | "VERIFY_CYL" | "VERIFY_AGE" | "VERIFY_MODEL" | "MANUAL_REVIEW_DONE" | "HOLD_EXPIRED"
    | "RECHECK_FLAG"                        // 승인 행의 feasible·도착 조건 위반 감지(1.4절 재계산)
    | "POWER_SUPPLIED";                     // 자원 도착·복구 확인. 재신고로 L_end가 늘 수 있는 유일한 예외(3.9절)
  from: { lane: Lane; resourceId?: string }; to: { lane: Lane; resourceId?: string };
  reasonCode?: string; reasonText?: string;  // MODIFY·VERIFY_*·MANUAL_REVIEW_DONE은 필수
  payload?: { extSpecId?: string; count?: number; hoursLo?: number; specId?: string; operatorLowerH?: number; basis?: string;
              chargeConfirmed?: "device_screen"; extAgeY?: number; batteryAgeY?: number };
}
// I7: 3키 strict. 세 번째 값은 소진 하한의 절대 모의 시각(ISO 문자열)이다
export const View119 = z.object({ location: z.string(), device: z.string(), expectedSafeUntil: z.string() }).strict();
```

---

## 3. 엔진 공식 (`app/src/lib/engine/`, 비AI)

**상수 규칙**
- 모든 상수는 `spec/params.json`(매개변수 장부)에서 생성한 `PARAMS`로만 읽는다.
- 장부의 각 행은 `{key, value|range, unit, type, sourceIds, note}`이다.
- ESLint `no-magic-numbers`는 쓰지 않는다(라운드 3: 3600·1000·2^31−1·배열 인덱스마다 예외가 생겨 작성 속도만 떨어뜨림). 대신 9절 장부 층 시험이 '엔진 상수가 모두 params 키로 해결됨'을 확인한다.
- `sim/`, `engine/`, `alloc/`에서는 `Math.random`과 `Date`를 금지한다.
- **초월함수 규칙(라운드 3에서 완화).** 브라우저 해시 비교는 Chromium만 Must이고(WebKit은 Could), Node와 Chromium은 같은 V8의 같은 fdlibm 포트를 쓴다. Python 오라클은 materialize된 정수만 읽는다. 그래서 `sim/`의 materialize 단계에서는 `Math.exp`·`log`·`cos`를 허용하고(역정규 CDF·로그정규 배수·로그균등 축·이동시간 잡음), **그 결과를 qT·qE 정수로 저장하는 규칙만 유지한다**(3.1절). `engine/`·`alloc/`의 **결정 경로**(필요성·필터·slack·tier·배정·지표)에서만 '정수 초·정수 mWh·정수 유리수 계수' 규칙을 유지한다. 예외: CONFIRMED 범위 exp(±1.2816σ_e)·exp(0.8416σ_e)는 UI 엔진(`engine/restoration.ts`)에서 `Math.exp`로 계산한 직후 qT로 바꿔 결정 경로에 넘긴다. 이 경계는 ESLint `no-restricted-properties`를 `alloc/`과 `engine/` 결정 파일(`lowerBound`·`margin`·`quantize`)에만 걸어 지킨다. `Math.sqrt`는 계속 허용한다. **4,096점 정수 표는 WebKit을 다시 Must로 올릴 때만 도입한다**(정수 표는 u<1/4096 꼬리를 약 ±3.4σ에서 잘라 로그정규 배수 꼬리를 왜곡하는 문제도 있었다).

### 3.1 시간·에너지 양자화

- 비교와 정렬 전에 시간은 정수 초로 바꾼다: `qT(h) = floor(h*3600 + 0.5)`
- 에너지는 정수 mWh로 바꾼다: `qE(wh) = floor(wh*1000 + 0.5)`
- TS와 Python 오라클은 같은 식을 쓴다. Python `round()`는 은행가 반올림이라 쓰지 않는다.
- 결정에 쓰는 모든 부등호는 양자화한 정수로 평가한다. 그래서 차등 시험이 정확 일치로 끝난다.
- materialize JSON에는 초월함수가 들어간 모든 값(R80, CONFIRMED 범위, 로그정규 배수, 이동시간 잡음)을 **qT·qE로 양자화한 정수로 저장**한다. Python 오라클은 이 값을 다시 계산하지 않고 읽기만 한다. `ENGINE_SPEC.md`에 이 규칙을 적는다.
- 지표 합은 정수 초로 더한다: M2 = Σ qT(G_i). 부동소수 합산 순서에 따른 차이를 없앤다.

**TS·Python 정확 일치를 위한 추가 규칙** (`ENGINE_SPEC.md`에 그대로 옮기고, 다섯 가지 모두 경계 퍼즈 사례로 넣는다)
1. **무한대는 정수 감시값.** slack −∞, A* = ∞, 쉼터 거부 ∞는 qT 기준 `−(2^31−1)`, `2^31−1` 정수로 표현한다. JSON에는 정수로만 쓴다(JS `null`·Python `-Infinity` 차이를 없앤다).
2. **결정 경로는 정수 연산만.** 시간은 정수 초, 에너지는 정수 mWh로 두고, 계수는 정수 유리수로 장부에 적는다(0.8 → 4/5, 1.25 → 5/4, 0.85 → 17/20, f_age 9/10·8/10·7/10, c의 0.9 → 9/10, 0.5 → 1/2). 곱은 분자끼리 먼저 모두 곱하고 나눗셈은 마지막에 한 번만 한다. 나눗셈은 floor로 정의한다. 예: `L_dev_s = floor(T_spec_s × fa_num × c_num / (fa_den × c_den))`. 중간값이 2^53 미만임을 단언(assert)한다. 이용자 충전량은 정수 퍼센트(0~100)로 받는다.
3. **Python은 `math.floor`·`//`만 쓴다.** `int()`(0 방향 절삭)와 `round()`는 금지한다. 음수 slack 양자화에서 floor와 결과가 다르기 때문이다.
4. **`Math.sqrt` 허용**(위 상수 규칙). 정확 반올림이 보장되므로 엔진 간 차이가 없다. materialize의 `Math.exp`·`log`·`cos` 값은 정수로 저장된 뒤에만 쓰이므로 Python과 비교되지 않는다.
5. **역분위 동점 규칙.** `F(e) = max{u : Q(u) ≤ e}`로 정의한다. 72h 절단 구간처럼 Q가 평탄한 곳에서도 u가 하나로 정해진다.

### 3.2 하한 L

**설계 규칙: 보수 계수는 한 번만 곱한다.**
- 노후와 충전 두 계수만 쓴다.
- 인공호흡기 설정 계수(k_set)는 계획자 쪽에서 쓰지 않는다. 그 몫은 시뮬레이션 진실 쪽 스윕(5.3절)이 맡는다.
- 이 규칙은 `evidence` 시안의 0.45h 퇴화 문제를 고친 결과다.

**이용자 입력과 운영자 확인의 구분.** 하한을 올리는 항목(외장배터리, 실린더, 수동검토 하한, 배터리 연식, 기종 확정)은 운영자 확인(`AuditEntry`, 사유 필수)이 있을 때만 들어간다. 가구(이용자)가 입력하는 값(충전량, 기기 화면 남은 시간, setting)은 L을 바꿀 수 있지만 **제조사 사양의 90%(+운영자 확인분), 곧 L_cap을 넘기지 못한다**(답변서2 6번). 충전량을 '모름'(c = 1/2)에서 '100%'(c = 9/10)로 바꾸면 L이 1.8배까지 오를 수 있으며, 이것은 현재 상태 갱신이다. 실제로 지켜지는 불변식은 `qT(L) ≤ qT(L_cap)`(I2)뿐이고, 화면 문구도 이 뜻으로만 쓴다(1.6절).

```
L.status = MANUAL_REVIEW, L = null   if operatorLowerH == null && (specId == null || !continuous)   # I4
L       = operatorLowerH.hours (+OPERATOR_LOWER)   if operatorLowerH != null && (specId == null || !continuous)   # 수동검토 완료 ②(DB 밖 기종, 비연속 기기)
T_spec  = settingTable ? (setting != null && settingSource == "operator" ? interp(setting)
                          : min(runtimeH) (+SETTING_USER_MIN 이용자 입력이면)) : internalH.value
          specBy == "ai_label_user_confirmed"이면 T_spec = min over {판독 일치 기종} ∪ {판독 키와 편집거리 ≤2인 DB 이웃 기종}의
          T_spec(각 기종에 위 규칙 적용) (+MODEL_AI_UNCONFIRMED)    # 운영자 VERIFY_MODEL 전까지. 오독으로 더 긴 기종이 들어오는 경로 차단
age     = 운영자 VERIFY_AGE 값만 쓴다. 이용자 입력 연식은 null로 본다 (+USER_AGE_IGNORED)
f_age   = age < 1 → 0.9 | 1 ≤ age < 2 → 0.8 | age ≥ 2 또는 null → 0.7 (+AGE_UNKNOWN)  # assumed
c       = device_screen → min(value, 1) × 0.9   (+USER_INPUT_DISCOUNTED)   # 시제품에서는 기기 화면도 이용자가 고른 값
          user          → min(value, 1) × 0.9   (+USER_INPUT_DISCOUNTED)   # assumed, 답변서2 6번
          unknown       → 0.5                    (+CHARGE_UNKNOWN)          # assumed
          (device_screen과 user의 '구분'은 출처 표지로만 화면에 보인다)
L_dev   = T_spec × f_age × c
          screenRemainingH가 있으면 L_dev = min(L_dev, screenRemainingH) (+SCREEN_CAPPED)
L_ext   = Σ_{opVerified} opVerified.count × ExtSpec.runtimeH × f_age_ext × c_ext; 신고만 된 외장은 0 (+EXT_UNVERIFIED_ZERO)  # I3
          opVerified는 extSpecId 정확 일치 ∧ forSpecIds ∋ specId ∧ 운영자 VERIFY_EXT일 때만 생긴다
          c_ext     = opVerified.chargeConfirmed == "device_screen" → 9/10 | 그 밖 → 1/2 (+EXT_CHARGE_UNKNOWN)   # assumed
          f_age_ext = opVerified.extAgeY != null → 본체와 같은 연식 구간표(9/10·8/10·7/10) | null → 7/10        # 본체 연식을 빌려 쓰지 않는다
L_cyl   = cylinder.opVerified ? opVerified.hoursLo : 0     # hoursLo는 이미 하한(NHS 10h), zod: hoursLo ≤ 10h × count
L       = L_dev + L_ext + L_cyl
L_cap   = max(runtimeH 또는 internalH) × 0.9 × 1            # f_age 최대, c 최대
          + Σ_{opVerified} opVerified.count × ExtSpec.runtimeH × 0.9 × c_ext + L_cyl   # c_ext는 운영자 확인값이므로 L_cap에도 같은 계수
          # ai_label_user_confirmed이면 첫 항의 runtimeH는 위 T_spec과 같은 이웃 기종 최소값 집합에서 고른다
          # 이용자 입력 필드(declaredCount, setting(user), charge, screenRemainingH, 이용자 입력 연식)는 L_cap 계산에 쓰지 않는다
assert  qT(L) ≤ qT(L_cap)                                    # I2: 이용자 입력이 사양 + 운영자 확인 상한을 넘지 못함
```

예시
- Trilogy 100, 연식·충전 모름: 3 × 0.7 × 0.5 = 1.05h → 도착 상한 0.84h
- 같은 기기, 기기 화면 충전 90%: 3 × 0.7 × 0.9 × 0.9 = 1.701h
- INOGEN G5, 이용자가 '설정 1'이라고 입력: min(6.5, 3.75) = 3.75h를 쓴다. 운영자가 설정을 확인해야 보간값을 쓴다.

3일차 '퇴화 점검'(11.2절 K-DEG)에서 이 기본값으로 배정기가 살아 있는지 확인한다.

시뮬레이션에서는 '운영자 확인'도 결정적 규칙으로 흉내 낸다: 가구 생성 시 외장 확인 비율(5.2절)만큼의 신고 외장이 `opVerified`를 받고, 나머지는 신고만 된 상태로 남는다. `extWorks`(진실)는 확인 여부와 별개로 뽑는다. 시뮬레이션의 `opVerified`는 `chargeConfirmed = null`, `extAgeY = null`로 만든다(c_ext 1/2, f_age_ext 7/10). 시뮬레이션 가구의 기종은 시나리오 데이터이므로 `specBy = "db_exact"`이고, 연식은 생성기의 '배터리 연식' 값을 운영자 확인값으로 본다(미상 비율만큼 null).

### 3.3 기기 사양 DB 시드 (`spec/device_db.json`)

| specId | 등급 | 내장 (조건) | 외장·탈착 | 소비 W | 연결 | 출처·유형 |
|---|---|---|---|---|---|---|
| LTV1150 | VENT_1H | 1h | — | 30~60 (assumed) | AC220, DC12 | [astho-advancing-preparedness-for-life-support-users-during-power-outages-aug-202] spec |
| TRILOGY100 | VENT_3H | 3h | 탈착 3h (ExtSpec) | 30~60 (assumed) | AC220, DC12 | 같은 출처, [interim-report-korean-restoration-tail-vs-device-runtime-hook] |
| TRILOGY_EVO | VENT_8H | 7.5h (시험법 조건, 배터리당) | 탈착 7.5h | 30~60 (assumed) | AC220, DC12 | [philips-trilogy-evo-home-ventilation-workshop-deck-battery-runtime-method] |
| ASTRAL150 | VENT_8H | 8h | 외장 8h/개 | 30~60 (assumed) | AC220, DC12 | [astral-100-and-astral-150-ventilators-therapeutic-goods-administration-tga] |
| PERFECTO2 | O2_STAT | 0h (배터리 없음) | — | 280 @3L/min | AC220 | [invacare-perfecto2-oxygen-concentrator-user-manual-1143482-h-00] |
| INOGEN_G5 | O2_PORT | 설정1 6.5h, 설정5 3.75h (선형 보간 assumed) | 이중 배터리 6.5h | 40~90 (assumed) | AC220, DC12 | [inogen-one-g5-portable-oxygen-concentrator-spec-sheet] |
| CYL_LARGE | (실린더 보유) | 하한 10h (범위 10~20h) | — | 0 | O2_FLOW | [nhs-highland-contingency-planning-for-power-outages-home-oxygen-2022] |
| COUGH_E70 | INTERMITTENT | 자동 계산 없음 (continuous=false). 수동검토 완료의 사람 입력 하한(`operatorLowerH`)으로만 L을 갖는다(3.2절) | — | — | — | 수동검토 전용 |

- 모든 인공호흡기는 `inverterSensitive=true`(assumed)이고, 산소발생기는 false다.
- 석션기는 DB에 넣지 않는다. 미등록 모델이 수동검토로 가는 시연 사례로 쓴다.
- 모든 등급의 7행 분류는 5.3절 손익분기표의 등급과 같다. `VENT_8H_EXT2`는 Astral에 확인된 외장 2개가 있는 경우다.

### 3.4 원인별 복구 표본기 (`restoration.ts`)

**표 생성**
- 원인마다 1,001점 역누적분포 표를 둔다: `spec/restoration_quantiles.json`, u = 0, 0.001, …, 1
- 생성기는 `tools/build_quantiles.py`(scipy 1.18 확인됨)다.
  - 감마 분포를 P10·P90 두 점에 이분법으로 맞추고, 상한 72h에서 자른다.
  - 맞춘 분포의 P50을 표 옆에 기록해 참고용 중앙값과 대조한다.
- 표는 봉인한다(S1).

**표본 추출**
- `u → 표 선형보간`으로 뽑는다.
- TS와 Python이 같은 표를 쓰므로 감마 적합이나 PRNG를 서로 재현할 필요가 없다.

**배수와 민감도**
- 공통 척도 배수 `scaleMult`를 둔다. 범위는 로그균등 0.5~2.0이고 반증용이다(assumed).
- **Must**: 같은 P10·P90에 로그정규를 맞춘 대안 표로 E1을 다시 돌린다. 이것이 E1의 안정성 시험이다(5.4절). ROBUST 표지가 하나라도 뒤집히면 그 칸을 강등하고 공개한다.

| Cause | 분포 | P10 / P90 (h), (참고 P50) | 근거 | 유형 |
|---|---|---|---|---|
| KEPCO_DIST | 감마 | 0.5 / 2.0 (1.0) | [충남-서산-아파트-1980가구-정전14시간-만에-복구-ytn] 음암면 약 1h, CAIDI 69~83분 [한전-세계-최저수준-정전-더-줄인다] | event + inferred |
| APT_SHORT | 감마 | 0.5 / 3.0 (1.5) | [오산시-폭염-속-아파트-정전에-시청-냉방버스-긴급-지원] 2.5h, [폭염-속-아파트-정전전국-곳곳서-주민-피해-잇따라-세계일보] 고양 2h | event |
| APT_NIGHT_XFMR | 감마 | 5 / 12 (9) | [수원-영통구-아파트-10개-동-정전7개-동은-복구-ytn], [인천-계양구-아파트서-11시간-정전370여세대-밤새-큰-불편] | event |
| APT_PARTS | 감마 | 8 / 20 (13) | 서산 13~14h 단일 사건. P10·P90 폭은 assumed | event + assumed |
| APT_FIRE | 감마 | 12 / 48 (25) | [부품이-없어폭염-속-무안-아파트-정전-복구-지연-488세대-냉방-중단-뉴스1] 약 25h, P90은 정부 48h 목표 [readnewsaspx] | event + policy |
| TYPHOON_WEAK | 혼합 | 0.995×감마(1/10) + 0.005×감마(12/48) | [한전-태풍-타파로-2만7천여-가구-정전대부분-복구] D+1 99.5% | calibrated + assumed |
| TYPHOON_STRONG | 구간선형 CDF | F(6)=0.30ᵃ, F(12)=0.65, F(15)=0.72, F(36)=0.992, F(72)=1.0 | [마이삭-위력-전국-27만세대-정전-집계송전복구율-71], [한전-태풍-힌남노-피해-99-복구완료-전력ㆍ발전-뉴스-기사본문-인사이트n파워insight-nuclear-power-news] | calibrated + assumed (시각을 경과시간으로 바꾼 대응은 가정) |
| ROTATING | 고정 | 1.0 | [산업통상자원부-보도설명자료-2013-06-10-순환단전-제외대상순위-motie-pdf-추출] | policy |

ᵃ assumed. 태풍 두 행은 'calibrated'이므로 헤드라인에 쓰지 않는다.

### 3.5 운영자가 보는 복구 추정

| status | 발생 | 화면 범위 | 배정기가 쓰는 R80 |
|---|---|---|---|
| ASSUMED_RANGE | 기본 | 원인 표 P10~P90 | 원인 표 P80 |
| NEAR_CERTAIN | ROTATING(정책상 1h 블록) | 0.5~1.0 | 1.0 |
| CONFIRMED | UI: 운영자가 「복구 예정 통보」 입력. 시뮬레이션: 확률 p_confirm | R_est·exp(±1.2816σ_e) | R_est·exp(0.8416σ_e) |

- 시뮬레이션에서는 `R_est = R_true·exp(σ_e·Z)`로 만든다. exp(σ_e·Z)는 materialize 단계에서 `Math.exp`로 계산하고 qT 정수로 저장한다(3절 초월함수 규칙). UI의 CONFIRMED 범위도 `Math.exp` 직후 qT로 바꾼다.
- σ_e 스윕은 {0, 0.5, 1.0}이다(assumed).
- UI에서 σ_e는 운영자 입력값이고, 기본값은 0.3이다(assumed).
- 표의 값은 모두 정전 시작 `tOutage` 기준이다. 정전이 진행 중이면 3.9절의 조건부 분위로 바꿔 쓴다. CONFIRMED의 R_est는 운영자가 입력한 복구 예정 '시각'이므로 처음부터 절대 시각이다.

### 3.6 도착시간과 자원

```
A_ij(계획) = prepH.hi × prepMult + manhattan(i,j)/speed × congest + floorDelay(i)
floorDelay(i) = floor ≥ 4 && mobilityNeed && cause ∈ APT_* ? 0.25h : 0      # assumed; 이동지원 42% [mhlw-wg8-資料2-1-土畠稲生会-ブラックアウト時の在宅人工呼吸器患者への対応2019-03-18]
A_ij(진실) = U(prepH.lo, prepH.hi) × prepMult + manhattan/speed × congest × exp(N(0, 0.3)) + floorDelay
A_119(계획) = a119H.hi × stress,  A_119(진실) = U(a119H) × stress,  이송 완료 +0.33h   # assumed
```

| 자원 (모두 `mock: true`) | 출력 W | 에너지 Wh | 연결 | 준비 h | 근거 |
|---|---|---|---|---|---|
| ESS_S | 600 | 500 | AC220, DC12 | 0.3~1.0 | assumed [interim-report-allocation-and-korean-resource-supply] |
| ESS_L | 1800 | 2000 | AC220, DC12 | 0.3~1.0 | 같은 출처 |
| MOBILE_GEN | 5000 | 60000 (12h) | AC220 | 1~3 | 스키마는 [15151542do], 값은 assumed |
| RENTAL_EXT | 기기 전용 | 외장 h × 기기 W | VENDOR_EXT | 0.5~2 | 답변서2, assumed |
| O2_CYL_DELIVERY | — | 산소 10h 상당 | O2_FLOW | 1~3 | assumed |
| EV_V2L | 3600 | 8000 (가용) | AC220, inverterSafe "unknown" | 0.2~1.0 | [아이오닉-5-차량-전용-아이템과-v2l-완벽-활용법-인포그래픽스-현대자동차그룹] |
| 119 레인 | — | — | — | 10~30분 × stress(1~4), 시간당 k명(기본 2, 스윕 1~6) | 5분 이내 도착 30.8% [96초마다-출동하는-119구급차미이송-건수는-130만-공감언론-뉴시스], 나머지 assumed |
| 쉼터 레인 | — | — | AC | 0.5~2, 거부율 0~0.561 | [오산시-폭염-속-아파트-정전에-시청-냉방버스-긴급-지원], [disaster-evacuation-for-home-based-patients-with-special-healthcare-needs-a-cros] 56.1% |

속도는 기본 25km/h이고, 스윕은 15·25·40이다(assumed). 이동시간 분포는 세 가지다.

| 분포 | 준비 | 속도 | 혼잡 |
|---|---|---|---|
| 빠름 | prepMult 0.5 | 40km/h | ×1.0 |
| 표준 | prepMult 1.0 | 25km/h | ×1.5 |
| 느림(야간·악천후) | prepMult 2.0 | 15km/h | ×2.5 |

### 3.7 여유 (표시용)

```
A*_end = 배정 자원의 A_end (없으면 가능한 자원 중 최소 A_end, 그것도 없으면 ∞)
marginH = [ L_end − min(R90_end, A*_end),  L_end − min(R10_end, A*_end) ]   # 범위로만 표시(I8). 단일값 표시 금지
```

모든 항은 3.9절의 절대 모의 시각이다. 여유는 화면 표시용이며, 처리 순서는 slack(4.1절 5단계)이 정한다. 두 값이 다른 이유를 근거 문장에 적는다.

### 3.8 결과 판정 (`sim/outcome.ts`, WorldTruth만 사용)

- **공급 시각**: `T_serve = min(R_true, 배정 자원 실제 도착, 119 실제 도착 + 0.33, 쉼터 실제 도착(거부 시 ∞))`. 119 실제 도착 = 진실 대기열의 슬롯 시작 + A_119(진실)(4.3절 ③)
- **자원 지속**: `run = energyWh × 0.85 / drawW.hi`. 자원이 고장 나면(backupFails) 0이다. 효율 0.85는 assumed다.
- **공백시간**: `G_i = max(0, T_serve − L_true) + (자원 공급이면 max(0, R_true − (T_serve + run)))`
- **고위험 가구**: 도움이 없으면 공백이 생기는 가구(`R_true > L_true`)다. 미등록 가구도 포함한다.
- **시각**: 이 절의 모든 시각은 정전 시작을 0으로 둔 절대 모의 시각이다(3.9절). L_true도 `tReport` 기준으로 맞춘다.
- **지표**
  - **M1** 공백이 남은 고위험 가구 수 ─ M2와 **공동 주 지표**(S4에 봉인). 화면·카드·보고서에서 M1과 M2를 늘 함께 싣는다
  - **M2** Σ qT(G_i)(가구·시간, 정수 초 합)
  - **M3** 오대기율: 시뮬레이션 동안 **한 번이라도 HOLD였던 가구**(만료 뒤 다시 배정된 가구 포함) 중 G>0인 비율. 분모가 0이면 「해당 없음」(4.3절 ④)
  - **M4** 과대예측 건수: 표시 L > L_true
  - **M5** 미등록 가구 공백 비율(명단 한계)

### 3.9 시간 기준점 (모의 시각 절대값)

L은 신고 시점 기준, R은 정전 시작 기준, A는 '지금' 기준 길이라서 그대로 빼면 정전이 진행되는 동안 틀린 값이 나온다. 그래서 모든 판단은 절대 모의 시각으로 한다.

```
now      = 현재 모의 시각 h (PlannerView.now)
L_end    = tReport + L                                  # 첫 신고
L_end    = min(lEndPrev, tReport_new + L_new)           # 재신고: 정전 중에는 배터리가 다시 차지 않으므로 비증가(I2)
           예외: 운영자가 기록한 전원 공급 이벤트(AuditEntry `POWER_SUPPLIED`: 자원 도착·복구 확인) 뒤의 첫 신고만 min 없이 새로 계산한다
e        = now − tOutage                                # 경과시간
R_q_end  = tOutage + Q( F(e) + q·(1 − F(e)) )           # 조건부 분위: u를 [F(e), 1]로 재척도. F·Q는 3.4절 표
           (F(e) = 1이면 '모형상 이미 복구'로 보고 R_q_end = now, 근거 문장에 「가정 범위 초과 경과」 표시)
           CONFIRMED는 R_est_end = 운영자 입력 시각, 범위는 3.5절 배수를 남은 시간(R_est_end − now)에 적용
           NEAR_CERTAIN(ROTATING)은 tOutage + 1.0
A_end    = now + A_ij
L_rem    = L_end − now,  R80_rem = R80_end − now
slack    = 0.8·L_rem − (A_end − now)
tier     = qT(L_end) < qT(R90_end) ? 0 : 1                # 0: 가정 범위 안에서 공백이 생길 수 있음, 1: 가정 범위를 넘을 때만 공백
HOLD 재확인 시한 holdRecheckBy = L_end − 1.25·A_min       # A_min = 물리 필터 통과 자원 중 최소 A
```

- 4.1절의 필요성 판정·에너지 필터·도착 필터·slack·tier는 모두 `L_rem`, `R80_rem`, `R90_end`, `A`로 평가한다. 기본 상태(ASSUMED_RANGE)에서도 R은 tier를 통해 처리 순서에 들어간다.
- `now ≥ holdRecheckBy`가 되면 HOLD를 자동으로 '필요'로 되돌린다(1.4절, `HOLD_EXPIRED`).
- `ENGINE_SPEC.md`와 경계 퍼즈(8절)에 경과시간 사례(e = 0, e가 P10·P50·P90 근처, F(e) = 1, now = holdRecheckBy 정확히)를 넣는다.

---

## 4. 배정기와 기준선 (`app/src/lib/alloc/`, 비AI, 약 150줄)

### 4.1 원안 판단식 구현 규칙 `RULE` (margin-gated least-slack greedy)

'원안 판단식'은 답변서의 잔여대응여유 판단 구조이고, least-slack 순서와 0.8L 도착 기준은 그 판단식을 구현하려고 팀이 정한 것이다. 화면·보고서에서는 「원안 판단식 구현 규칙」으로 부르고 '원안 규칙'으로 줄이지 않는다.

모든 시간 항은 3.9절의 남은 시간(`L_rem`, `R80_rem`)과 A로 평가한다. 아래 식에서 L, R80은 각각 L_rem, R80_rem을 뜻한다.

**1. 보이는 가구.** 운영자 화면에는 `PlannerView.households`, 곧 등록 가구와 신고된 가구만 들어온다.

**2. 수동검토.** `L.status = MANUAL_REVIEW`이면 `MANUAL_REVIEW` 레인에 넣고 자동 계산하지 않는다. UI에서는 운영자가 「수동검토 완료」(1.4절)를 해야 빠져나온다.

**검토 예약.** 수동검토 가구가 검토를 기다리는 동안 자원이 다 소모되지 않도록, 5단계 루프에 들어가기 전에 가구마다 자원 1개를 잡아 둔다. 불확실하면 긴급도를 높인다는 제안서 원칙을 따르는 장치다.
- 고르는 자원: 그 가구 셀 기준 A가 가장 작은 것 중 커넥터가 가장 넓은 것(AC220+DC12 우선), 그다음 출력이 가장 큰 것, 그다음 id 사전순. 기기 사양을 모르므로 에너지·출력 필터는 적용하지 않는다.
- 119 용량도 1건을 같은 방식으로 예약한다(계획자 119 대기열에 L_end 이전 시작 가능한 슬롯이 남을 때만, 4.3절 ③).
- **예약 제약(라운드 3, I5).** 석션기(DB 밖)와 COUGH_E70(continuous=false)은 UI에서 늘 MANUAL_REVIEW가 되므로, 제약 없는 예약은 '기기군 이름'이 자원 선점권을 정하는 고정 우선순위가 된다. 그래서 다음을 둔다.
  - ① 예약 총수 ≤ `floor(가용 자원 수 × mrReserveCap)`. `mrReserveCap` = 0.2(assumed, S4 `thresholds` 봉인). 119 용량 예약도 같은 비율 상한(`floor(남은 슬롯 × 0.2)`)을 따른다. 상한에 걸린 수동검토 가구는 예약 없이 대기열 최상단 표시만 받는다.
  - ② 어떤 자원 j가, `tier 0 ∧ slack < mrHoldH`인 비수동검토 가구 중 하나의 `phys(i)`에서 유일한 자원이면 j는 예약 대상에서 뺀다(다음 순위 자원으로 넘어가고, 없으면 예약 없음).
  - ③ 대안 비교: 물리 자원을 잡지 않고 '대기열 최상단 + 검토 시한' 표시만 하는 `RULE_NO_RESERVE`를 E2 절제 기준선으로 둔다(4.2절).
  - 누락률 감사 표(1.4절)에 기기군별 예약률 열을 둔다.
- 예약 시한: `mrHoldH`(1h = mrDelayH 범위 상한, assumed, `params.json`, S4 봉인). 계획자는 진실 `mrDelayH`를 모르므로 상한을 쓴다. 검토가 끝나거나 시한이 지나면 예약을 푼다. 검토가 끝난 가구는 풀린 예약 자원을 포함한 전체 자원으로 5단계에 들어간다.
- 예약 순서: 수동검토 가구가 여럿이면 tReport 오름차순, 그다음 id 사전순.

시뮬레이션에서는 진실 `mrDelayH ∈ [0.25, 1]` 뒤에 사람이 확인을 마쳤다고 보고 다음 규칙으로 다시 들어온다(`sim/reentry.ts`).
- DB에 있는 연속 기기(판독 오류·라벨 미확인으로 수동검토된 경우): 사양 기반 L(3.2절)로 들어온다.
- DB 밖 기종(석션기, 미등록 기종)과 DB에 있는 비연속 기기(COUGH_E70 등, continuous=false): 운영자 입력 `operatorLowerH`를 **가구별 가정 범위 표본**으로 정한다. 범위는 `params.json`의 `operatorLowerRangeH`(예: U[0.5, 4]h, '다음 사용까지 남은 시간' 가정, assumed, S4 봉인)이고, 표본은 BEHAVIOR 스트림에서 가구 생성 때 뽑아 PlannerView 쪽에 둔다. 상수 0h나 등급별 상수가 아니므로 이 가구들이 기기군 단위로 같은 순번에 몰리지 않는다(답변서2 5번).
- 어느 경우에도 `WorldTruth.LTrueH`를 쓰지 않는다(2장 ESLint 규칙과 속성 시험).

**3. 필요성 판정.** 아래 세 조건을 모두 만족할 때만 `HOLD`로 둔다. 그 밖에는 모두 '필요'다.
- `status ∈ {CONFIRMED, NEAR_CERTAIN}`
- `σ_e ≤ 0.75` (후회 최소 규칙, assumed)
- `qT(R80) ≤ qT(min(0.8·L, L − 0.5))`

기본값이 배정인 이유는 오류 비용이 비대칭이기 때문이다. 잘못된 대기는 공백으로 이어지지만, 남는 자원은 비용일 뿐이다.

**4. 가능성 필터.** 아래를 모두 만족하는 (i,j)만 `feasible`이다.
- `available`
- 커넥터 교집합 ≠ ∅. 산소는 O2_FLOW 또는 AC다.
- 기기가 `inverterSensitive`이면 `inverterSafe === true`여야 한다. V2L의 `"unknown"`은 제외한다.
- `outputW ≥ 1.25 × drawW.hi` (O2_FLOW는 적용 안 함)
- 에너지: `qE(energyWh × 0.85) ≥ qE(drawW.hi × H_need)`
  - `H_need = clamp(R80_end − A_end, 1h, 24h)`. 자원은 도착한 뒤부터 복구될 때까지 기기를 돌린다. 하한 1h와 상한 24h는 assumed이며 S4 `thresholds`에 봉인한다.
  - O2_CYL_DELIVERY는 `10h ≥ H_need`로 판정한다.
- 도착: `qT(A_ij) ≤ qT(0.8 × L_i)`
- 위 조건 중 도착만 뺀 것(가용·호환·인버터·출력·에너지)을 **물리 필터** `phys(i)`라 부른다. `feasible ⊂ phys`다. 0.8L 도착 필터는 `PROPOSE_ASSIGN`의 정의로만 쓰고, 가구를 루프에서 빼는 데는 쓰지 않는다.

**5. least-slack 탐욕 배정.** 필요 가구 집합 U가 빌 때까지 다음을 반복한다. 하한이 짧거나 불확실한 가구가 남은 자원 처리로 밀리지 않도록, 도착 필터를 통과하지 못하는 가구도 **같은 루프에서** 처리한다.
1. `slack_i = 0.8·L_i − min_{j ∈ phys(i)} A_ij`와 `tier_i`(3.9절: `qT(L_end) < qT(R90_end)`이면 0, 아니면 1)를 계산한다. `phys(i)`가 비면 min A 자리에 119 레인 계획 도착(`A_119 계획 + 이송 0.33h`)을 넣는다(라운드 4. 이전 판의 −∞는 하한이 10시간 남은 가구도 맨 앞에서 119 첫 슬롯을 가져가게 했다). slack이 음수여도 U에서 빼지 않는다. tier 1 가구도 U에 남는다(기본값은 배정이라는 3단계 원칙 유지).
2. 순서 키 `(tier, slack)`이 가장 작은 가구를 고른다. 곧 tier 0 가구를 모두 먼저 처리하고, 각 tier 안에서는 slack이 작은 순이다. 동점이면 L이 작은 쪽, 그다음 id 사전순이다. 이 2단 키는 S4 `thresholds`에 봉인한다.
3. 그 가구를 처리한다.
   - `feasible(i)`가 있으면 → `PROPOSE_ASSIGN`. 낭비 `energyWh×0.85 − drawW.hi×H_need`가 가장 작은 가능 자원을 준다. 동점이면 A가 작은 쪽, 그다음 id 사전순이다.
   - 없으면(slack < 0) 다음 순서로 처음 맞는 것 하나:
     - ① 계획자 119 대기열(4.3절 ③)의 다음 슬롯 시작 s에 대해 `qT(s + A_119 계획 + 0.33) ≤ qT(L_end)`이면 → `FALLBACK_119`
     - ② `phys(i)`의 자원 j마다 예상 공백 단축 `Δ_ij = min(R80_end, A_end + run_j) − max(A_end, L_end)`를 계산한다(`run_j = energyWh×0.85/drawW.hi`). 최대 Δ가 `Δ_min`(1h, assumed, `params.json`, S4 봉인) 이상이면 → 그 자원으로 `GAP_REDUCE`를 즉시 배정한다. 동점이면 A가 작은 쪽, 그다음 id 사전순이다.
     - ③ 계획자 119 대기열에 L_end 전에 시작 가능한 슬롯(`qT(s) < qT(L_end)`)이 있으면 → `FALLBACK_119`(지연 플래그). 라운드 4: 6단계로 미루면 하한이 긴 가구가 루프의 ①로 이른 슬롯을 먼저 가져갔다
     - ④ 그 밖에는 U에서 빼서 6단계로 넘긴다.
4. 고른 자원과 119 용량을 소모 처리하고 남은 가구의 slack을 다시 계산한다.

이 규칙은 L·R·A·호환·가용을 모두 쓴다. R은 HOLD 판정(CONFIRMED·NEAR_CERTAIN)과 에너지 필터 H_need뿐 아니라, 기본 상태(ASSUMED_RANGE)에서도 tier를 통해 처리 순서에 들어간다. 그래서 I1을 만족한다(답변서1 1번: 잔여안전시간·복구시간·호환·가용을 함께 고려). 기기 등급은 입력이 아니므로 I5를 만족한다. 충전 모름(c = 0.5)으로 하한이 짧아진 가구는 slack이 작아져 먼저 처리되고, 수동검토 가구는 2단계 검토 예약으로 자원을 먼저 잡아 두므로, 두 종류의 불확실성 모두 배정 탈락 사유가 되지 않는다(제안서 '불확실하면 긴급도를 높여').

**6. 대체 레인.** 5단계 ③으로 넘어온 가구를 마감(L) 오름차순으로 돌며, 아래 순서대로 처음 맞는 레인 하나를 준다.
- (a) 계획자 119 대기열의 다음 슬롯 시작 s에 대해 `qT(s + A_119 계획 + 0.33) ≤ qT(L_end)`이면 → `FALLBACK_119`
- (b) 남은 자원 중 4단계 필터에서 **도착 조건만 뺀 물리 필터**(가용·호환·인버터·출력·에너지)를 통과하는 것이 있으면 → `GAP_REDUCE`
  - 가장 이른 A를 고른다.
  - 근거 문장은 「도착 전 공백 예상 · 공백 단축 목적」이다.
  - 이 레인은 물리 필터를 지키므로 '호환 위반 0' 불변식과 모순되지 않는다.
- (c) 계획자 119 대기열에 L_end 이전에 시작 가능한 슬롯(`qT(s) < qT(L_end)`)이 있으면 → `FALLBACK_119`(지연 플래그)
- (d) 이동지원 필요 + 보호자 없음이 아니고 쉼터 좌석이 남으면 → `FALLBACK_SHELTER`
- (e) 그 밖에는 → `UNSERVED_VISIBLE`. 이것은 숨기지 않는 라우팅 결과다. '실패' 판정이 아니다.

**7. 출력.**
- 모든 결과는 `PROPOSED` 상태다. 승인 이벤트가 있어야만 `APPROVED`나 `MODIFIED`가 된다(I6).
- 근거 문장은 템플릿 약 12개(`reasons.ts`)로만 만든다.
- 문장 속 숫자가 결정 레코드의 숫자와 같은지 단위 테스트로 확인한다.

**근거 문장 템플릿 예시**
- `R-ASSIGN`: 「남은 하한 {L}h < 복구 가정 P80까지 {R80}h → 전원 필요. 처리 순서 키 tier {tier}(복구 가정 P90 {R90}h 대비) · slack {s}h. {res} 도착 {A}h ≤ 0.8×하한 {L08}h, 출력 {W}W ≥ 1.25×{w}W, {conn} 호환. 여유 {mlo}~{mhi}h」
- `R-HOLD`: 「복구 통보 P80 {R80}h ≤ 하한 기준 {th}h → 대기(재확인). 언제든 배정으로 전환 가능」
- `R-EXT0`: 「외장배터리 {n}개 미확인 → 0시간으로 계산」
- `R-GAP`: 「0.8×하한 {L08}h 안에 도착 가능한 호환 자원 없음(최단 {A}h, slack {s}h) → 예상 공백 {d}h 단축 목적 배정 제안」
- `R-HOLD-EXP`: 「재확인 시한 {t} 경과 → 대기 해제, 필요 판정으로 전환(승인 필요)」

### 4.2 기준선 (같은 시드, 공통 난수)

허수아비 비교를 막기 위해 모든 기준선은 **같은 물리 필터(가용·호환·인버터·출력·에너지)와 같은 대체 레인**을 쓴다. 차이는 필요성 판정, 도착 0.8L 필터, 처리 순서뿐이다.

| id | 규칙 | 용도 |
|---|---|---|
| `KR_BASELINE` | 도구 없음. 한국 현행 DSL(6.2절)만 적용한다. 가구는 자가관리하다가 119를 부른다(KR-07). **호출 시점은 스윕 축이다**: 확률 `p_early ∈ [0, 0.8]`(assumed)로 조기 호출(시각 = 정전 시작 + U[0, L_true]), 나머지는 배터리 소진 시점(L_true). '소진 시점 호출'은 출처가 없는 가정이므로 고정하지 않는다. 119는 용량 제한을 받는다 | E1 표지의 기준 |
| `NONE` | 아무 도움 없음(공백 = R_true − L_true) | 참조 |
| `B1_SHORTEST` | 필요성 판정과 도착 필터 없음. L 오름차순으로 가장 가까운 물리 가능 자원을 준다. ASTHO 가동시간 우선 권고(P5)와 같다 | 지배율 |
| `B2_NEAREST` | 필요성 판정과 도착 필터 없음. 물리 가능 (i,j) 쌍을 A 오름차순으로 탐욕 매칭한다 | 지배율 |
| `R_L` | RULE에서 slack 대신 L 오름차순으로 돈다. 예비 실험 설정을 재현한다 | 절제 |
| `RULE_NO_R` | RULE에서 tier를 빼고 slack만으로 돈다(라운드 2 이전 판) | 절제(E2). RULE과의 차이로 '복구 가정 범위를 순서에 넣은 것'의 기여를 잰다 |
| `RULE_FEASIBLE_FIRST` | 이전 판(v1) RULE. 도착 필터를 통과하는 가구만 least-slack 루프에서 처리하고, 나머지는 자원이 소모된 뒤 6단계로 보낸다 | 절제(E2). RULE과의 차이로 '짧은·불확실한 하한 가구 먼저'의 기여를 잰다 |
| `RULE_NO_RESERVE` | RULE에서 2단계 검토 예약을 물리 자원 예약 대신 '대기열 최상단 + 검토 시한' 표시로만 한다 | 절제(E2). 검토 예약이 tier 0 가구에게서 자원을 뺏는 효과와 수동검토 가구 보호 효과를 함께 잰다 |
| `ORACLE_INFO` | RULE에 R_true·L_true를 넣는다 | 정보 상한 |

RULE 정의(4.1절 2·5단계, tier·예약 제약 포함)와 `RULE_FEASIBLE_FIRST`, `RULE_NO_R`, `RULE_NO_RESERVE`는 D7 사전등록(S4) 전에 확정하고, 봉인 뒤에는 바꾸지 않는다.

미등록 가구는 모든 정책에서 KR-07 행동(위 `p_early` 축을 따르는 119 호출)을 따르고 같은 119 진실 대기열을 나눠 쓴다(4.3절 ③).

### 4.3 이산 사건 규약 (시뮬레이션, `sim/run.ts`. S2a 전에 `ENGINE_SPEC.md`에 옮긴다)

TS와 Python 오라클이 빈칸을 서로 다르게 메우지 않도록 사건 모델을 고정한다. 규약마다 경계 퍼즈 사례를 1개 이상 넣는다(8절).

- **① 신고 시각.** 등록 가구마다 `tReport = tOutage + U[0, 0.5]h`(BEHAVIOR 스트림, assumed, `params.json` `reportDelayH`). 미등록 가구는 신고하지 않는다(도구에 안 보임). 수동검토 가구의 검토 완료 시각은 `tReport + mrDelayH`다(검토는 신고 뒤에만 시작되므로 tOutage가 아니라 tReport 기준. 지적 원문의 `tOutage + mrDelayH`에서 바꾼 점은 라운드 3 기록에 적는다). `mrDelayH ≤ mrHoldH`(1h)이므로 시뮬레이션에서 예약 시한 만료는 생기지 않는다.
- **② 결정 시점.** 결정 시점 집합 = {t₀ = max(등록 가구 tReport)} ∪ {각 수동검토 가구의 tReport + mrDelayH} ∪ {각 HOLD 가구의 holdRecheckBy}. 시각 오름차순, 같은 시각이면 한 번만 돈다. 각 시점에서 `now`를 그 시각으로 두고, **아직 배정되지 않은 가구**(재진입한 수동검토 가구, 만료된 HOLD 가구, `UNSERVED_VISIBLE` 가구)만 남은 자원·남은 119 슬롯으로 RULE(4.1절)을 다시 돌린다. 이미 배정된 행(`PROPOSE_ASSIGN`·`GAP_REDUCE`·`FALLBACK_119`·`FALLBACK_SHELTER`)은 고정한다. 시뮬레이션의 승인 지연은 0이다(6.1절 EVAC_AT과 같음). 기준선(4.2절)도 같은 결정 시점 집합을 쓴다. KR_BASELINE은 결정 시점이 없고 ③의 호출만 한다.
- **③ 119 대기열.** 119는 대기열 하나로 두고, 서비스 시간 = 1/k h(k = 시간당 용량)로 정의한다(k명/시간과 같은 처리량). 슬롯 시작 = max(호출 시각, 앞 슬롯 종료). 순서는 호출 시각 오름차순, 같으면 가구 id 사전순. 호출 시각: RULE·기준선의 `FALLBACK_119`는 그 레인을 받은 결정 시점, KR_BASELINE·미등록 가구의 KR-07 호출은 4.2절 `p_early` 규칙의 시각. 실제 도착 = 슬롯 시작 + A_119(진실). **계획자 대기열**은 계획자가 아는 호출(자기 `FALLBACK_119`와 예약)만 담고, 진실 대기열은 미등록·KR-07 호출까지 모두 담는다. 계획자의 '용량 남음'은 계획자 대기열에서 L_end 이전에 시작 가능한 슬롯이 있는지로 판정한다(4.1절 ①, 6단계 (a)(c)).
- **④ M3.** 시뮬레이션 동안 한 번이라도 `HOLD`였던 가구 중 G>0인 비율(3.8절). HOLD 만료 뒤 ②에 따라 다시 배정된 가구도 분모에 남는다.

---

## 5. 리허설 랩 (`app/src/lib/sim/`, 비AI)

### 5.1 결정성

- **PRNG**: `xoshiro128**` 하나만 쓴다. 시드는 `splitmix32(hash(master, scenarioId, stream))`로 만들고, 균등값은 `(x>>>8)/2^24`다.
- **스트림 분리**: `HH=1, RES=2, TRUTH_R=3, EST=4, ARRIVAL=5, BEHAVIOR=6, LANE=7, LHS=8, PATCH=9`. 정책끼리 공통 난수를 쓰므로 짝 비교가 성립한다.
- **정규 난수**: materialize 단계에서 Box–Muller(`Math.log`·`cos`·`sqrt`)로 만들고, 로그정규 배수·로그균등 축도 `Math.exp`·`log`로 계산한 뒤 결과를 qT·qE 정수로 저장한다(3절 초월함수 규칙, 라운드 3). Node와 Chromium은 같은 V8이라 비트가 같고, Python 오라클은 저장된 정수만 읽는다. WebKit을 Must로 올릴 때만 정수 표 방식으로 돌아간다.
- **브라우저 검증**: Worker 재현 해시는 Playwright Chromium 프로젝트에서 시험한다(Must). WebKit 프로젝트 추가는 Could로 내린다(11.3절). 시험하지 않았거나 불일치가 나는 브라우저에서는 `/judge`에 「이 브라우저는 수치 라이브러리가 달라 해시 비교 불가」를 표시하고 '불일치'로 표시하지 않는다.
- **materialize**: 시나리오의 모든 난수 추출 결과를 `PlannerView + WorldTruth` JSON으로 펼친다. Python 오라클은 이 JSON만 읽으므로 **PRNG 비트 일치 요구는 없다.**
- **출력**: 키를 정렬한 JSON, 숫자는 1e-6에서 반올림, sha256을 기록한다.
- **실행 위치**
  - 정본: Node CLI `tsx scripts/sweep.ts --config prereg/sweep.json`가 `out/sweeps/*.json`과 해시를 남긴다.
  - 브라우저: 같은 모듈을 Web Worker(`src/workers/sweep.worker.ts`)로 불러 N=500 부분집합을 돌린다. 표지는 「실시간 500회 · 기준 [N]회」다([N]은 evidence.json에서 읽는다. 2단 절단 확정으로 기본 1,000).
  - Node와 Worker의 N=500 해시가 같은지 Playwright로 확인한다. **N=500의 정의**: `prereg/sweep.json`의 기본 θ, 시드 1~500(개발 시드 범위), 원인은 시드 순서대로 8종 순환. Node 기준 해시를 `evidence.json`(`workerRef.sha256`)에 저장하고 Worker 결과와 비교한다.

### 5.2 합성 가구 생성기 (`generator.ts`)

가구는 코드가 공개 분포에서 뽑는다. LLM은 가구를 만들지 않는다.

| 변수 | 분포 | 근거 |
|---|---|---|
| 인공호흡기 : 산소 | 0.15 : 0.85 | inferred, NHIS 지급건수 비율이며 사람 수가 아님 [nhis-요양비-2025-가정산소-386441건-인공호흡기-68520건-기침유발기-15215건-및-지역별-산소치료-2020-2026] |
| 인공호흡기 기종 | LTV 21.8 / Trilogy100 50.7 / EVO 22.4 / Astral 5.0 | 루이지애나 분포 [astho-advancing-…], 한국 적용은 assumed |
| 산소 하위 구성 | 거치형 단독 / 거치형+실린더 / 휴대형 = 스윕 | assumed |
| 배터리 연식 | U(0, 4)년, 미상 비율 0~0.5 | assumed |
| 충전량 출처 | 기기 화면 비율 0.5~1.0, 나머지는 자가입력·모름 | assumed |
| 외장 보유 / 확인 비율 | 0~0.6 / 0~1 | 59.2% [平成30年北海道胆振東部地震における大規模停電時の札幌市在宅人工呼吸器患者への対応の実態と課題] |
| 미등록 비율 | 0~0.45 | [preparedness-for-blackouts-in-iberian-peninsula-patients-using-home-respirator-2] |
| 이동지원 필요 | 0.42 | [mhlw-wg8-資料2-1-…] |
| 미확인 모델 비율 | 0~0.3 | assumed |
| 신고 시각 `tReport` | tOutage + U[0, 0.5]h (BEHAVIOR 스트림, 등록 가구만) | assumed, 4.3절 ① |
| 시작 충전량(진실) | 예보·통지 사건이면 1.0, 그 밖에는 U(0.5, 1.0) | assumed |
| 좌표 | 10×10km 합성 격자, 주소는 「가상동 12-3」 형식 | — |

### 5.3 스윕 축 θ (LHS)

| 축 | 범위 | 근거 |
|---|---|---|
| scaleMult (복구 배율) | 로그균등 0.5~2.0 | 반증용 assumed |
| k_set_true (설정 소모) | U[0.5, 1.0] | assumed |
| k_age_true | U[0.5, 1.0], 5%는 [0.3, 0.5] | [astral-100-…-tga] 경보 없는 정지 |
| σ_e / p_confirm | {0, 0.5, 1.0} / [0, 0.8] | assumed |
| 가구/자원 비 | 로그균등 1.5~6 | [interim-report-allocation-and-korean-resource-supply] |
| 이동시간 분포 | 빠름·표준·느림 | assumed |
| 119 용량 k / stress | 1~6 / 1~4 | assumed |
| 쉼터 거부율 | 0~0.561 | 후쿠오카 노트 |
| 예비전원 고장 확률 | 0~0.8 | 15대 중 12대 [evaluation-of-solar-powered-battery-systems-for-individuals-using-electricity-de], [泉佐野保健所-…] |
| 미등록 비율, 외장 보유, 미확인 모델 비율 | 5.2절 | |
| 충전량 과대입력 확률 | 0~0.2 | assumed |
| KR-07 조기 119 호출 확률 `p_early` | 0~0.8 (조기 호출 시각 = 정전 시작 + U[0, L_true]) | assumed. '소진 시점 호출'에 출처가 없어 축으로 둔다(4.2절) |
| 패치 coverage·failProb (E3 전용) | 각 패치 기본값의 ×0.5~×1.0 (coverage), 0.1~0.8 (failProb) | assumed. [M]을 가정 범위 구간으로 내기 위한 축(12.3절) |

### 5.4 실험

> **라운드 5에서 바뀜.** 헤드라인 비교·E1/E2 규모·관문 2·끝 카드는 맨 끝 「반영 기록 (라운드 5)」이 이 절보다 우선한다.

| id | 설계 | 출력 | 등급 |
|---|---|---|---|
| **E1 빈틈 견고성** | LHS 4,000추첨 × 원인 8, 가구 N=60(**11.3절 2단 절단 확정으로 기본 1,000추첨**). 7등급 각 5가구 이상을 층화하고 나머지 25가구는 실제 구성. 정책은 `KR_BASELINE` | 셀(등급×원인 56개)마다 추첨별 지표 = '그 등급 가구의 과반이 G>0'. 지속률 p와 Wilson 95% CI. **ROBUST**(CI 하한 ≥0.9), **CONDITIONAL**(CI ⊂ [0.3, 0.9], 경계 정전시간 = R_true 10분위에서 조건부 p가 0.5를 지나는 지점. 지나지 않으면 「경계 없음(전 구간 p>0.5 또는 <0.5)」으로 쓴다. ROTATING 열은 R이 1.0 고정이라 CONDITIONAL 판정에서 제외한다), **FRAGILE**(CI 상한 <0.3), **BORDERLINE**(나머지, 공개). **ROBUST 칸마다 축별 1차원 반증**: 각 축을 범위 끝값에 고정했을 때 p가 0.9 아래로 떨어지는 축이 있으면 그 축과 값을 「뒤집힘 조건」으로 코드가 생성한다(손으로 쓰지 않음). **`p_early` 축(KR-07 호출 시점)의 끝값 0.8에서도 p의 CI 하한 ≥ 0.9가 유지될 때만 ROBUST를 붙이고**, 아니면 CONDITIONAL 이하로 내린다. 배터리 없는 산소발생기(PERFECTO2, 사양상 0시간)는 공백이 물리적으로 자명하므로 E1 표지 집계·헤드라인에서 빼고 「사양상 0시간(물리 사실)」 행으로 따로 싣는다 | Must |
| **E1b 손익분기** | 등급별 해석 구간 `[spec × 진실 하단 계수, spec]`과 시뮬레이션 공백 비율 곡선(정전 0~48h) 겹침 | 5.3절 손익분기표 대조 | Must |
| **E1c C2 하류 동등성** | KR 기준선 중 C2 코퍼스에 있는 한국 문서의 규칙을 C2 다수결 DSL로 바꿔 끼우고(나머지 규칙은 오라클 DSL 유지) E1과 같은 설정·같은 시드로 다시 돌린다. API 비용 0 | 56칸 표지 일치율(「하류 행동 동등성」)과 표지가 달라진 칸 목록. C2 주 지표 옆과 `/lab/manuals`에 싣는다(7.3절) | Should. 하지 못하면 12.1절 AI 기술명에서 '절차 문서 규칙화'를 뺀다 |
| **E2 지배율** | 비율 {1.5, 3, 6} × 이동 {빠름, 표준, 느림} × σ_e {0, 0.5, 1.0} = **27칸** × 짝 시드 200(**11.3절 2단 절단 확정으로 기본 9칸, σ_e = 0.5 고정.** 27칸 확장은 S4 이전에 시간만 보고 정한 경우에만 하고, 봉인 뒤에는 결과를 보고 칸을 늘리지 않는다). 원인은 시드마다 7종(ROTATING 제외)에서 균등 추출. 기본 N=30 | 칸마다 RULE 대 B1, B2의 M1 승/무/패 비율, M2 짝 차이 중앙값, 짝 부트스트랩(2,000) 95% CI. 칸 판정은 둘로 나눈다. (a) **비열등**: 패배율 ≤5%. (b) **우세**: 승률 > 패배율 이고 M2 짝 차이(RULE − 기준선) 95% CI 상한 < 0. 대칭으로 **열등**: 패배율 > 승률 이고 M2 CI 하한 > 0. 나머지는 '차이 없음'. 헤드라인·ClosingCard에는 (b)만 쓰고 무승부율은 따로 싣는다. **기준선을 합친 칸 판정(라운드 3, S4 봉인)**: [P1] = B1과 B2 **둘 다**에 대해 우세(b)인 칸 수, [P2] = 둘 중 **하나에라도** 열등인 칸 수, [P0] = 나머지 칸 수. 기준선별 칸 판정은 `/lab` ③에 따로 싣는다. R_L·RULE_FEASIBLE_FIRST·RULE_NO_R·RULE_NO_RESERVE 절제와 ORACLE_INFO 격차, 검토 예약 때문에 공백이 생긴 사례 수 | Must |
| **E3 보완안 순위** | 패치 P1~P8(6.3절)과 C3 후보를 두 바탕에 얹는다: (가) KR_BASELINE, (나) RULE. 보류 시드 1,000. 원인 계열별. coverage·failProb는 5.3절 E3 전용 축으로 스윕한다. **P5(가동시간 우선)와 PRIORITIZE(runtime_asc|distance)는 답변서가 거부한 규칙이므로 바탕 (나)의 보완안 순위에 넣지 않고** E2의 B1 행으로만 보인다 | 공백 가구-시간 ΔM2와 CI, coverage·failProb 축에 대한 ΔM2 P10~P90 구간, 패치 자체 표지, 비대상 원인 회귀, 같은 비용 조건 | Should |
| **E4 일관성 점검** | 입력에 쓰지 않은 양만 비교. 예: 홋카이도형 45h 계통 정전에서 예비전원 없는 인공호흡기 가구의 공백 구조 | 'calibrated to' / 'consistency' / 'reproduces' 구분 표기 | Should |
| E1a 해석 대조 | P(gap) = 1−Φ(…) θ 적분 대 몬테카를로 | — | Could |
| numpy 독립 재계산 | 별도 난수로 1,000추첨, 컷오프 ±5%p 밖 칸의 표지 일치 | — | Could |

**CI의 뜻.** Wilson CI는 LHS 추첨의 몬테카를로 오차만 잰다. 가정 범위(assumed 값들) 자체의 불확실성은 담지 않는다. `/lab` 툴팁 문구는 「추첨 오차만 반영 · 가정 범위 자체의 불확실성 아님」으로 고정한다. 가정 범위에 대한 견고성은 축별 1차원 반증(E1 행)과 아래 안정성 시험으로만 말한다.

**안정성.**
- N 변경이나 시드 변경이 아니라 **복구 분포 대안(같은 P10·P90의 로그정규, 3.4절) 교체 시 표지 유지**로 시험한다.
- 바뀐 칸은 BORDERLINE으로 강등하고 공개한다.
- **통과 기준**: 대안 표로 E1이 끝까지 실행되고 뒤집힌 칸 목록이 공개되면 통과다. 단, 원래 ROBUST 칸(무배터리 산소 제외)이 **전부** 뒤집히면 관문 2 실패로 본다(S4 `thresholds` 봉인).

**시드.**
- 개발 시드는 1~10,000이다. K-DEG, A/B 카운터, 개발 중 확인은 이 범위만 쓴다.
- 보류 시드(E3·C3 최종 평가)는 1,000,001~1,001,000이다.
- **E1·E1c 전용 시드는 2,000,001~2,004,000, E2 전용 시드는 3,000,001~3,005,400**(27칸 × 200, 9칸이면 앞 1,800개)이다. S4 전에는 어떤 실행에도 쓰지 않는다.
- 위 범위는 이 명세와 사전등록 파일에 적어 봉인한다. drand는 쓰지 않는다.
- `scripts/check-seal-order.mjs`에 검사를 더한다: S4 커밋 이전의 모든 `out/` 파일과 git 이력에 E1·E2 전용 범위의 시드가 0개여야 한다(시드는 출력 JSON의 `seed` 키로 기록한다).

### 5.5 사전등록 (`prereg/predictions.md` + `prereg/sweep.json`)

> **라운드 5에서 바뀜.** 헤드라인 비교·E1/E2 규모·관문 2·끝 카드는 맨 끝 「반영 기록 (라운드 5)」이 이 절보다 우선한다.

E1·E2를 실행하기 **전에** 커밋하고 OTS로 봉인한다(S4. 라운드 3 Q11⑨로 OTS는 S4·S5에만 건다). 담는 내용:
- 전략 보고서 5.3절 표의 판정 7개(사전등록본)
- E2 예상: 자원이 넉넉한 칸(r=1.5)은 무승부가 많다
- E3 가설: P2·P3·P7은 원인과 무관하고, P6·P8은 예보 가능한 사건에서만 효과가 있다
- 스윕 설정 전체, 보류 시드 범위, 표지 컷오프
- **`prereg/sweep.json`의 `thresholds` 블록**: 모든 관문 임계값과 배정기 상수, 강등 기준을 여기에 넣어 함께 봉인한다. 최소 목록: 관문 2(ROBUST 개수, E2 우세 칸 수 **N = 9칸 중 3칸**, 27칸으로 확장하면 27칸 중 9칸. 이 명세가 지금 고정한다), 관문 3(10%), K-DEG(실패 조건은 9절), K-DSL(70%, 5건, '기계 판독 가능' 정의는 7.3절), σ_e ≤0.75, H_need 하한 1h·상한 24h, Δ_min 1h, 0.8L, 1.25×W, E2 비열등 5%, M1·M2 공동 주 지표 지정, **순서 키 (tier, slack)**, `mrHoldH` 1h, `operatorLowerRangeH`, `p_early` 범위, E1·E2 전용 시드 범위. **라운드 3 추가**: `mrReserveCap` 0.2와 예약 제약 ②, [P1]·[P0]·[P2] 칸 정의(5.4절 E2)와 「9칸 중 k칸」 표기 규칙, 안정성 시험 실패 조건(ROBUST 전부 뒤집힘), K-PATCH 강등 컷(7.4절), 표준 θ 정의(9절 K-DEG), `reportDelayH`(4.3절)
- 봉인 뒤 임계값을 바꾸면 `seal/CHANGELOG.md`에 기록하고, 바꾸기 전과 후의 결과를 **둘 다** 싣는다(의무)

`predictions.md` 머리에는 「예비 몬테카를로(L 오름차순, 중간보고) 결과를 본 뒤 작성함」을 적는다.

결과에는 맞힌 수와 틀린 수를 그대로 싣는다.

### 5.6 표준 50건 (`spec/standard50.json`, 봉인 S2b)

- **구성**: 등급 7(INTERMITTENT 제외) × 원인 7(ROTATING 제외) = 49건, 여기에 ROTATING 1건(60가구, 전 주택 1순위)을 더한다.
- **각 건**: N=30, 초점 등급 12가구(40%) + 혼합 18가구. 가구/자원 비는 1.5/3/6을 순환한다(17/16/16). 시드는 `20261017 + idx`다.
- **원안 KPI 대체 지표**: 모두 「모델 내 실측」으로 표기하고 '달성'이라고 쓰지 않는다.

| 원안 KPI | 시제품 측정 |
|---|---|
| 매칭 ≥95% | C1 봉인 시험셋의 DB 매칭률과 Wilson CI |
| 미확인 모델 검토 100% | 미등록 모델 자동 계산 0 (속성 시험) |
| 과대예측 0건 | M4 건수. 0이 아니면 그대로 보고하고, 충전량 과대입력 주입분은 따로 센다 |
| 2분 내 분류 | 정전부터 순위 표시까지 지연 p95(ms). 쉽게 충족된다는 점을 밝힌다 |
| 배정시간 50% 단축 | 측정 불가. 클릭 수로 대체한다 |
| 호환 확인 100% | 호환 위반 0 (속성 시험) |

### 5.7 프리셋 3개 (`spec/presets/*.json`)

Q11⑤로 5개에서 3개로 줄였다: 수원형, 서산형, 순환단전. 30가구, 자원 10개, 시드를 고정한다. 랜딩 CTA는 수원형으로 간다.

- **봉인.** 프리셋 JSON 3개(시드 포함)는 S2b 매니페스트에 넣어 **배정기 첫 커밋 전에** 봉인한다. `scripts/check-seal-order.mjs`가 `spec/presets/*.json`의 sha256이 S2b 매니페스트와 같고 S2b 커밋이 `src/lib/alloc/` 첫 커밋보다 앞서는지 검사한다. 그래서 RULE이 이기는 시드를 고른 뒤 고정하는 체리피킹을 할 수 없다.
- **A/B 카운터 값.** `scripts/presets-ab.ts`(Node, sim 모듈)가 봉인된 프리셋마다 RULE·B1·B2를 돌려 `out/presets_ab.json`을 만들고, `sync-evidence`가 `evidence.json`에 넣는다. 화면은 이 값만 읽는다(1.4절).

### 5.8 `/lab` 탭

| 탭 | 내용 | 등급 |
|---|---|---|
| ① 손익분기 | 등급별 하한 분포와 사건 구간 열(E1b), 사전등록표 대조 | Must |
| ② 빈틈 지도 | 등급×원인 격자. 4색 + 패턴으로 색맹 대응, Wilson CI 툴팁, BORDERLINE 공개 | Must |
| ③ 배정 지배율 | 9칸 격자(S4 전에 확장을 정했으면 27칸), 기준선 선택(B1·B2 각각의 칸 판정과 둘을 합친 [P1]·[P0]·[P2]), 단순 규칙이 이긴 칸 강조. 비율은 %가 아니라 「9칸 중 k칸」으로 표기 | Must |
| ④ 보완안 순위 | P1~P8(P5는 「답변서가 거부한 규칙 · 비교용」 표지로 순위 밖에 따로), C3 후보(「AI 생성 제안 · 담당자 승인 전」), 기준선, 같은 비용 표지 | Should |
| ⑤ 반증 슬라이더 | Worker N=500 재계산. 축 5개(scaleMult, k_age 하단, 비율, 예비전원 고장, 미등록) | Should |
| ⑥ 사전등록 대조 + 표준 50건 | 예측 대 결과, KPI 대체 지표 | Must |

---

## 6. 정책 DSL, 한국 기준선, 해외 보완안

### 6.1 스키마 (`app/src/lib/dsl/schema.ts`, zod 4)

```ts
const Target = z.enum(["ALL_HOMES","RANK1_FEEDERS","INSTITUTIONS","DEVICE_HH_REGISTERED","DEVICE_HH_ALL",
  "DEVICE_HH_EXT2","DEVICE_HH_WITH_PLAN","SAFETY_VULNERABLE"]);
// 재귀 스키마 금지: Claude 구조화 출력은 재귀(z.lazy) 스키마를 받지 않는다. 조건은 DNF(바깥 OR, 안쪽 AND)로 평탄화한다.
const Atom = z.discriminatedUnion("op", [
  z.object({ op: z.literal("cmp"), field: z.enum(["reserveMW","outageMW","durationMin","leadTimeH","elapsedH"]),
             cmp: z.enum(["<","<=",">=",">","=="]), value: z.number() }),
  z.object({ op: z.literal("in"), field: z.enum(["cause","stage","region"]), values: z.array(z.string()) }),
  z.object({ op: z.literal("hh"), field: z.enum(["registered","verifiedExtCount","hasPlan","flagged"]),   // verifiedExtCount = opVerified 개수 합(신고 개수 아님)
             cmp: z.enum(["==",">="]), value: z.union([z.boolean(), z.number()]) }),
  z.object({ op: z.literal("forecastable"), value: z.boolean() }),
  z.object({ op: z.literal("always") }),
]);
const Trigger = z.object({ anyOf: z.array(z.array(Atom)) });   // anyOf[i]의 원자는 AND, anyOf끼리는 OR
// 인터프리터 내부용 재귀 Pred(and/or)로 바꾸는 변환은 코드(`dnf.ts`)가 한다. 오라클 DSL도 처음부터 이 DNF 형식으로 쓴다(S5 봉인 뒤 형식 변경 없음).
const Action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("NOTIFY"), target: Target, channel: z.enum(["SMS","MEDIA","DISASTER_TEXT","PHONE"]), leadTimeH: z.number().min(0).max(120).nullable() }),
  z.object({ type: z.literal("PRECHARGE"), target: Target }),                  // 예보 사건에서 시작 충전 1.0(순응 확률 적용)
  z.object({ type: z.literal("PREPOSITION_POWER"), target: Target, holder: z.enum(["HOUSEHOLD","RENTAL","MUNICIPALITY","KEPCO"]),
             energyWh: z.number().max(5000), coverage: z.number().min(0).max(1), failProb: z.number().min(0.1).max(1), requiresPlan: z.boolean() }),
  z.object({ type: z.literal("RECHARGE_LOOP"), minExt: z.number().int().min(1), delayH: z.number().max(48), cycleH: z.number().max(24) }),
  z.object({ type: z.literal("RUNTIME_SHARE"), target: Target }),              // 평시 계획 기록: DB 기종의 라벨 미확인만 해제. 충전 모름(c=0.5)은 유지. DB 밖 모델은 그대로 수동검토
  z.object({ type: z.literal("PRIORITIZE"), order: z.enum(["runtime_asc","margin_gated","distance"]) }),   // C3 관문은 margin_gated만 허용(7.4절)
  z.object({ type: z.literal("EVAC_AT"), target: Target, rule: z.enum(["L_minus_A119_minus_1h","fixedH"]), fixedH: z.number().nullable(),
             afterOperatorApproval: z.literal(true) }),                         // 119·이송은 운영자 승인 뒤에만(I6)
  z.object({ type: z.literal("EXEMPT_SHEDDING"), target: Target }),
  z.object({ type: z.literal("SHED"), target: Target, blockH: z.number().max(4) }),
  z.object({ type: z.literal("NONE_DOCUMENTED") }),
]);
export const Rule = z.object({
  id: z.string(), docId: z.string(), clauseRef: z.string(),
  quote: z.string().min(8).max(400),                  // 원문 부분문자열이어야 함(코드 검사, 7.3절 정규화 뒤)
  actor: z.enum(["KEPCO","KPX","MOTIE","LOCAL_GOV","HEALTH_CENTER","FIRE_119","NHIS","RENTAL","APT_MGMT","HOUSEHOLD","UTILITY_FOREIGN","GOV_FOREIGN"]),
  trigger: Trigger, actions: z.array(Action).min(1),
  deviceHouseholdFlag: z.boolean().nullable(),        // 문서가 침묵하면 null. 지어내기 금지
  confidence: z.enum(["verified","inferred"]),
});
export const Policy = z.object({ docId: z.string(), rules: z.array(Rule),
  notEncoded: z.array(z.object({ claim: z.string(), why: z.string() })) });
```

**API로 보내는 스키마(wire)와 내부 검증 스키마(strict)를 나눈다.** 위 정의가 strict다. 문자열 길이(`.min`·`.max`), 배열 길이(`.min(1)`·`.max`·`.length`), 수치 범위(`.min`·`.max`)는 API 구조화 출력이 지원하지 않아 SDK가 빼고 클라이언트에서만 검사한다. 그래서 `toWire()`가 이 제약을 뺀 wire 스키마를 만들고, 응답은 strict로 다시 검사해 어긋나면 **재호출 없이 무효로 집계**한다. 제약값은 프롬프트 문장으로도 알려 준다(예: 「quote는 8~400자」). D8 스키마 작업 첫 단계에서 wire 스키마로 Sonnet 1회 스모크 호출을 해 400이 나지 않는지 확인한다(스모크 예산 안).

**인터프리터.** `interpret(policy, event, household) → ActionSet`(`interp.ts`)은 결정적이다. 각 Action이 시뮬레이터 초기 상태나 배정 훅으로 바뀐다. **Action마다 '진실 효과'(WorldTruth)와 '계획자 효과'(PlannerView)를 따로 정의하고, 계획자 효과는 3.2절 하한 규칙(I2·I3)을 우회하지 못한다.**
- NOTIFY+PRECHARGE: 진실 — 예보 사건이고 leadTimeH>0이면, 순응한 가구(순응 확률 0.5~0.9, assumed)의 c_true를 1.0으로 만든다. 계획자 — 없음(충전량은 가구가 다시 신고해야 바뀐다).
- PREPOSITION_POWER: 진실 — coverage 비율의 대상 가구에 자원을 두고, failProb로 고장을 뽑는다. 계획자 — **L에 더하지 않는다.** 그 가구 셀에 `ResourceView`(energyWh, `prepH` 0~0, outputW·connectors·inverterSafe는 holder별 `params.json` 행(assumed), `mock: true`)를 그 가구 전용으로 만든다. 4.1절 물리 필터를 통과할 때만 배정에 쓰인다.
- RECHARGE_LOOP: 진실 — 확인된 외장 minExt개 이상인 가구의 런타임을 delay 뒤 cycle마다 연장한다. 계획자 — L을 바꾸지 않는다. 운영자가 충전 이벤트(`POWER_SUPPLIED`)를 기록했을 때만, 그 시점의 `opVerified` 개수로 L을 다시 계산한다.
- RUNTIME_SHARE: 평시 계획 기록으로 **DB 기종의 판독 오류(라벨 미확인)만** 해제한다. 평시 기록은 정전 시점 충전량을 모르므로 **충전 모름(c = 0.5)은 유지한다.** DB 밖 모델(석션기, 미등록 기종)은 계속 `MANUAL_REVIEW`로 둔다(I4). 이 경우를 I4 속성 시험에 넣는다.
- PRIORITIZE: 배정 순서 키를 바꾼다. runtime_asc는 B1, distance는 B2와 같다. 둘 다 답변서1 1번이 거부한 단일 키 정렬이므로 기준선·비교용으로만 쓰고 C3 후보로는 받지 않는다(7.4절).
- EVAC_AT: 정해진 시점에 119 또는 쉼터로 선제 이송을 **제안**한다. `afterOperatorApproval: true`라서 결과는 `PROPOSED`이고, 승인 이벤트가 있어야 실행된다(I6). 시뮬레이션에서는 승인 지연을 0으로 두되 승인 단계를 건너뛰는 코드 경로는 없다.
- `deviceHouseholdFlag: null`은 '기기 가구에 대한 행동 없음'으로 실행된다.

**탐침** (`probes.ts`, 문서마다 300개)
- **오라클과 후보 DSL 양쪽** 조건 원자 경계값의 합집합: 직하·동일·직상. 예) 예비력 1,499/1,500/1,501MW, 정전 64/65MW, 4/5분, 서울·광역시 52MW. 후보 쪽 경계는 후보 출력이 나온 뒤 결정적으로 생성한다(보류셋 오염 없음). Claude가 새로 넣은 조건(다른 필드, 다른 임계값)도 경계에서 잡힌다
- 범주값 전부
- **오라클 구조와 무관한 무작위 30%**
- 결정 벡터: `{notified, leadBucket, precharge, powerWhBucket, exempt, shed, triageOrder, evacTrigger, runtimeShare}`

### 6.2 한국 기준선 (`data/dsl/kr/*.json`, Claude Opus 서브에이전트 작성 · 사람 검수 오라클)

**용어.** 이 명세의 '오라클 DSL'과 '독립 계산'은 사람이 손으로 쓴 것이 아니다. 작성자는 Claude Opus 서브에이전트(opus-worker)이고, 개발자도 AI 코딩 에이전트다. 명세·장부·보고서·화면에서는 「Claude Opus 서브에이전트 작성 · 사람 검수 오라클」, 「명세 기반 독립 계산(에이전트 작성)」으로 쓰고 '손작성', '손계산', 'hand-written'이라고 쓰지 않는다. 사람 검수 범위는 7.3절과 8절에 적는다.

[interim-report-korea-status-quo-baseline-encoding]을 따른다.

| id | 내용 | flag | 출처 |
|---|---|---|---|
| KR-01 | MOTIE 2013 사전통지: '주의' 단계 → 1순위 선로 SMS, 0.5~1h 전 | null | [산업통상자원부-보도설명자료-2013-06-10-순환단전-제외대상순위-motie-pdf-추출] |
| KR-02 | 예비력 1,500MW 미만 → 순환단전, 주택 1순위, 블록 1h(500MW) | null | [kepco-비상시-수급조절-순환단전긴급-부하차단-대상선정-기준-현행-사이버지점] |
| KR-03 | 같은 기준의 면제: 병원급·요양병원 면제, 단순요양원은 차단, 재택 기기 가구 범주 없음 | null | 같은 출처 |
| KR-04 | 한전 정전복구 5단계: 우선순위·목표시간 없음 | NONE_DOCUMENTED | [정전복구-정전피해배상제도-고객소통-한국전력공사] |
| KR-05 | 태풍 D-5~D+1: 기기 가구 단계 없음 | NONE_DOCUMENTED | 같은 출처 |
| KR-06 | 복지할인 등록: 진단서 보관, 정전 표지 없음 | null | [서비스-상세-보조금24-정부24] |
| KR-07 | 자가관리 + 119안심콜: 증상·불안 시 119 호출(inferred). 호출 시점은 출처가 없으므로 `p_early` 축으로 스윕한다(4.2절, 5.3절) | null | [장애인-지원자를-위한-재난-안전-가이드-디딤돌], [기고-골든타임-지키는-작은-약속-119안심콜] |
| KR-08 | 주민대피계획 의무(2026 개정, 2027 시행): 2026 기준선에서는 비활성 | null | [대피명령-시-구체적인-장소대피-방법도-안내해야-헤럴드경제-미주판] |
| KR-09 | 약관 제47조: 계획정전 신문·방송 사전통지, 긴급 시 예외 | null | [kepco-기본공급약관-제5장-제47-49조의2-공급중지-사전통지신문방송와-손해배상] |
| KR-10 | 요양비 대여 고시: 배터리·정전 조항 없음 | null | [lawfullcontents] |
| KR-11 | 재난문자: 65MW 이상(서울·광역시 52MW) & 5분 이상 → 사후 방송, leadTimeH 0 | null | [한전-국지성-대규모-정전-대응-체계-강화] |
| KR-12 | 손해배상 면책 | NONE_DOCUMENTED | [대법원-2002-4-12-선고-98다57099-판결-손해배상기] |
| notEncoded | 「생명유지장치 등록 시 우선 통지·복구」 | — | 공식 출처 없는 블로그 주장이라 넣지 않는다 |

위 12행은 사용자가 행 단위로 검수한다(Q9, 약 30분). 라운드 3부터 검수는 S4 봉인을 막지 않는다: 봉인은 에이전트 산출물로 예정일에 하고, 검수에서 고친 내역과 수정 전후 결과를 둘 다 `seal/CHANGELOG.md`에 남긴다. 예정일까지 검수가 없으면 `/ledger`에 「사람 검수 없음」이 자동 표시된다.

D7의 `KR_BASELINE`은 위 규칙의 효과를 시뮬레이터 내장 동작으로 구현한다. D8에 같은 규칙을 DSL로 옮긴 뒤 **두 방식의 스윕 해시가 같아야 한다**. 이 동등성 시험으로 DSL 인터프리터를 검증한다.

### 6.3 해외 보완안 라이브러리 (`data/dsl/patches/`, 에이전트 작성 · 사람 검수 오라클 + 템플릿 한국화)

| id | 원 절차 | 한국 템플릿 행위자 | DSL 핵심 | 출처 |
|---|---|---|---|---|
| P1 | 마치다시 개인계획 | 보건소 | `hasPlan` 가구에 RUNTIME_SHARE + EVAC_AT(L − A_119 − 1h) | [町田市-在宅人工呼吸器使用者のための災害時個別支援計画-様式] |
| P2 | 와카야마 의료기관 무상 대여 | 준요양기관(대여업체) | PREPOSITION_POWER(RENTAL, 1000Wh, coverage 0.8) | [人工呼吸器利用者の電源確保事業について-和歌山県] |
| P3 | 이나기 보조(발전기 21.2만엔, 축전지 10.4만엔) | 지자체 | P2와 같되 requiresPlan | [disaster-support-program-for-home-ventilator-users-official-website-of-inagi-cit] |
| P4 | 루이지애나 충전 순환 | 행정복지센터·관리사무소 | RECHARGE_LOOP(minExt 2, delay 2h, cycle 8h) | [astho-louisiana-aims-to-recharge-neighbors-battery-powered-life-support-equipmen] |
| P5 | ASTHO 가동시간 우선 | 지자체 운영자 | PRIORITIZE(runtime_asc). 답변서가 거부한 '짧은 순'과 같다. **「답변서가 거부한 규칙 · 비교용」 표기, 바탕 (나) 보완안 순위에서 빼고 E2 B1 행으로만 보인다(5.4절)** | [astho-advancing-…] |
| P6 | NYC emPOWER 사전경보 | 보건소 | forecastable → NOTIFY(REGISTERED, 24h) + PRECHARGE | [astho-leveraging-the-hhs-empower-program-to-enhance-power-outage-planning-nov-20] |
| P7 | PG&E 휴대 배터리 | 한전 | PREPOSITION_POWER(HOUSEHOLD, 1000Wh, coverage 0.6) | [portable-battery-program-pge] |
| P8 | 한국형 SMS 확장 | 한전 | 할인 기록(flagged) 가구에 NOTIFY(SMS) + PRECHARGE(예보 사건과 ROTATING만) | MOTIE 2013 노트 |

P1~P8의 핵심 매개변수(coverage, failProb, delay, energyWh)는 사용자가 검수한다(Q9, 약 20분). 검수는 E3 실행을 막지 않고, 고친 경우 수정 전후 E3 결과를 둘 다 `seal/CHANGELOG.md`와 `/lab` ④에 싣는다. 검수 기록이 없으면 「사람 검수 없음」이 자동 표시된다.

**비용표** `spec/costs.json`
- 이나기 금액은 sourced다.
- 환율, ESS·SMS 단가, 대여 운반비는 assumed다.
- 같은 비용 조건 검증기가 이 표를 쓴다(7.4절).

---

## 7. Claude 구성요소 (세 곳만, 모두 코드가 채점)

### 7.1 공통 인프라

형제 저장소의 자기 코드를 **복사**하고 출처 주석을 단다. import는 하지 않는다.
- 복사 대상: `app/src/lib/claude/{models,client,budget}.ts`, `app/src/lib/ratelimit.ts`, `app/src/app/api/health/route.ts`
- 복사 대상: `tools/{seal_manifest.py, ots_stamp.py, fill_report_docx.py}`

바꿀 점:
- `Stage`: `PW_C1_label | PW_C1_haiku_arm | PW_C2_dsl | PW_C3_patch | PW_C3_repair`
- `Pool`: `dev | sealed | public | judge | reserve`
- 키는 `pl26:budget:<pool>`로, **월 단위가 아닌 누적**이다. `monthKey()`를 쓰지 않는다.
- 환경변수 `CLAUDE_TOTAL_BUDGET_USD=45`. 앱 내부 상한이고, 콘솔 상한은 50이다(월 리셋 대응은 Q4).
- **`CLAUDE_INFERENCE_GEO`는 설정하지 않는다.** 형제 `budget.ts`는 이 값이 `us`이면 비용에 ×1.1을 곱하는데, 7.5절 예산표는 ×1.0 기준이다. 설정하게 되면 예산표를 ×1.1로 다시 계산한다.
- 풀 비율: dev 0.45($20.25: C1 개발, C2 개발, C3, 스모크) / sealed 0.22($9.9: C1·C2 봉인 측정) / public 0.12($5.4) / reserve 0.21($9.45, 이 중 $3.0을 `judge` 풀로 떼어 둔다. 남은 reserve $6.45)
- **ratelimit 키**: 형제의 `rl:dev:…`, `rl:ip:…`를 `pl26:rl:dev:…`, `pl26:rl:ip:…`로 바꾸고 `EXPIRE`를 단다(시간 키 2h, 일 키 48h). 형제 키에는 접두사와 TTL이 없다. IP 키는 `x-forwarded-for` 첫 값이 아니라 `@vercel/functions`의 `ipAddress(req)`로 얻고, IPv6는 /64 접두사로 묶어 만든다(7.2절).
- **Message Batches API는 Must에서 뺀다(라운드 3).** 형제 저장소에 없는 새 코드이고 결과 지연이 최대 24h라 한 날에 배치 왕복 여러 번을 넣을 수 없다. 절단 확정 규모로 다시 계산하면 전부 실시간이어도 ×1.3 합계 약 $30으로 중단선 $35 안이다(7.5절). 오프라인 스크립트(C1 봉인 측정, C2 개발·최종, C3)는 **실시간 직렬 호출**로 고정한다. Batches는 C3(Should)에서 시간이 남을 때만 쓰는 Could다.
- **이미지 입력**: 형제 `callStructured`는 `user: string`(텍스트)만 받으므로 그대로는 C1이 돌지 않는다. `CallInput`에 `images?: { mediaType: "image/jpeg" | "image/png" | "image/webp"; base64: string }[]`를 추가하고, user content를 `[image..., text]` 블록 배열로 만들게 고친다. 이 수정에 단위 테스트(블록 순서, mediaType, 이미지 없을 때 기존 동작 동일)를 둔다.
- **스크립트 진입점**(`scripts/*`의 Claude 호출): Upstash 환경변수가 없으면 즉시 종료한다. `NODE_ENV`와 무관하게 MemoryStore 폴백을 금지한다. 형제 `budget.ts`의 MemoryStore 폴백은 실행마다 0부터 세므로 누적 상한이 강제되지 않기 때문이다.
- **지출 이중 기록**: 로컬 스크립트도 `/api/vision`과 **같은 예약 함수**(7.2절 Lua 예약·정산)를 반드시 쓴다. append-only `out/spend.jsonl`에는 세 종류 행을 모두 적는다: `reserve`(호출 전 예약액), `settle`(호출 뒤 실제 비용과의 차액 되돌림 = release), `hold`(시간 초과 등 과금 불명, 되돌림 0). 스크립트 실행 전 사전점검은 **Σreserve − Σrelease**를 **Upstash `pl26:budget:dev` + `pl26:budget:sealed` 두 키의 합**과 대조하고, 차이가 $0.10을 넘으면 중단한다. 그래서 시간 초과 1건(예약 유지)만으로 거짓 불일치가 나지 않는다. public·judge 풀과 운영 URL 스모크 지출은 Vercel에서 생기므로 `spend.jsonl`에 없다. 이 지출은 Upstash 단독 기록으로 두고 `/api/health`에 따로 표시한다. 대조 로직 단위 테스트에 'public 지출이 있어도 통과' 사례를 넣는다.

호출 규칙:
- 모든 호출은 `callStructured`를 거친다: zod 구조화 출력(wire 스키마, 6.1절), maxRetries 0, 본문 로그 없음.
- **재시도 규칙을 형제와 다르게 고친다.** 형제 구현은 `max_tokens`나 `parse_failed`에서 같은 요청을 그대로 한 번 더 보내 비용만 2배가 되고 같은 이유로 다시 실패한다. 복사본은 ① `stop_reason = max_tokens`이면 max_tokens를 올려 1회만 재시도하고(C1은 2배, **C2·C3는 24000 상한**) ② `parse_failed`(strict 재검사 실패 포함)이면 재시도하지 않고 실패로 기록한다. 예산 추정(7.5절)은 ①만 반영한다.
- **시간 초과·네트워크 오류 규칙(라운드 3).** 형제 `client.ts`는 `new Anthropic({ timeout: 60_000 })`이 고정이고, 5xx·네트워크 오류·시간 초과에서 `continue`로 같은 요청을 다시 보내 이중 과금될 수 있다. 복사본은 다음처럼 고친다.
  - `StageConfig`에 단계별 `timeoutMs`를 둔다: C1 20s, C2·C3 300s.
  - C2·C3는 `client.messages.stream(...).finalMessage()`로 부르고(긴 출력의 비스트리밍 시간 초과 회피), 구조화 출력은 받은 뒤 zod strict로 다시 검사한다.
  - 시간 초과(`APIConnectionTimeoutError`)는 **재시도하지 않고** '과금 불명'으로 기록한다(예약분 유지, `spend.jsonl` `hold` 행).
  - 5xx 재시도는 C1 dev 스크립트에만 1회 허용하고, `/api/vision`·C2·C3는 0회다.
  - 단위 테스트: 시간 초과 → 재시도 0회, 기록 1행(`hold`).
- maxTokens: C1 1500, C2 16000, C3 16000. 쓰지 않은 토큰은 과금되지 않는다. C2·C3는 스트리밍이므로 비스트리밍 시간 한도의 제약을 받지 않는다.
- D5 C1 dev 첫 20회와 D9 C2 첫 라운드에서 `stop_reason` 분포와 parse_failed 원인을 `docs/DEVLOG.md`에 기록한다.
- 문서와 이미지는 '데이터 구획'으로만 넘긴다. 그 안의 지시문은 무시하라고 프롬프트에 명시한다.
- 이미지는 메모리에서만 처리하고 Blob·분석 도구로 보내지 않는다.

**중단 규칙.**
- 누적 지출이 $35에 이르면 `sealed`, `public`, `judge` 풀을 뺀 모든 호출을 동결한다.
- 콘솔 상한 429(retry-after 없음)를 받으면 모든 스크립트를 즉시 종료한다.
- 사전점검에서 `spend.jsonl`의 Σreserve − Σrelease와 Upstash dev+sealed 합계 차이가 $0.10을 넘으면 중단한다.

### 7.2 C1 라벨 비전 (`src/lib/vision/`, Sonnet, thinking `between_tools`, effort low, maxTokens 1500)

thinking 설정을 생략하면 Sonnet이 adaptive로 사고해 maxTokens 1500 안에서 사고 토큰과 출력이 경쟁한다(레드팀 라운드 2 지적). 그래서 `between_tools`를 명시한다. 이 설정값의 동작은 D5 첫 호출 전에 claude-api 문서로 확인하고, 첫 20회의 usage에서 사고 토큰이 0인지 기록한다.

**프롬프트가 할 일**
- 이미지 속 문자를 그대로 옮긴다.
- 잘린 모델명을 보완하지 않고, 기기 지식으로 값을 채우지 않는다. 읽을 수 없으면 null이다.
- 단위는 인쇄된 그대로 둔다.
- 성명·일련번호는 값을 옮기지 않고 `personalInfoVisible`만 표시한다.

**스키마**

```ts
const Field = z.object({ verbatim: z.string().nullable(), legibility: z.enum(["clear","partial","illegible"]),
                         confidence: z.enum(["high","low"]) });
export const LabelOut = z.object({ manufacturer: Field, model: Field, ratedPower: Field, voltage: Field,
  batteryText: Field, personalInfoVisible: z.boolean(), language: z.enum(["ko","en","mixed"]),
  otherText: z.array(z.string()).max(10) });
```

**업로드 처리**
- 클라이언트: 긴 변 1568px, JPEG q85로 줄여 1.5MB 이하로 만든다. EXIF는 지운다.
- 서버: zod로 base64 길이 ≤ 2MB를 검사하고, 매직바이트로 jpeg/png/webp만 받는다. 그 밖에는 400이다. Vercel 함수 본문 상한(4.5MB) 안에 들어온다.
- route에 `export const maxDuration = 30`을 둔다. 이 경로는 **시도 1회(재시도 없음), SDK timeout 20초**로 둔다. 함수가 30초에 강제 종료되어 과금은 되고 기록은 빠지는 일을 막기 위해서다.
- **예약 후 실행.** 형제 `assertBudget`은 잔액을 읽고 호출 뒤에 기록하므로 동시 요청이 모두 검사를 통과한다. 또 형제 UpstashStore는 명령 1개마다 REST 호출이라, 풀 키와 일일 키에 `INCRBY`를 따로 두 번 보내면 원자성이 없다(첫 INCRBY 뒤 함수가 끊기거나 두 번째에서 초과가 나면 되돌리기가 어긋남). 그래서 **예약은 Upstash `EVAL` Lua 스크립트 1회**로 한다: 풀 키·일일 키를 GET → 둘 다 `현재값 + 최대 비용 ≤ 상한`이면 두 키에 INCRBY하고 1 반환, 아니면 아무것도 바꾸지 않고 0 반환(→ 재생 모드). 최대 비용은 이미지 1장 Sonnet 기준 $0.03이다. **정산도 Lua 1회**로 두 키에서 차액을 함께 뺀다. 실패하거나 시간이 초과되면 예약분을 그대로 둔다(과금 여부를 모르므로 보수적으로 남기고 `spend.jsonl`에 `hold` 행). **스크립트도 반드시 이 예약·정산 함수를 쓴다**(7.1절). 단위 테스트: 시간 초과 1건 뒤에도 사전점검 대조 통과, 동시 20요청에서 상한 초과 0(Lua 경로).
- 호출 제한: IP당 시간 10회. IP는 `@vercel/functions`의 `ipAddress(req)`로 얻고, IPv6는 /64 접두사로 묶어 키를 만든다(`x-forwarded-for` 첫 값을 쓰는 형제 방식은 /64 하나로 주소를 바꿔 가며 우회된다). Vercel Firewall rate-limit 규칙과 BotID가 현재 요금제에서 쓸 수 있는지 **D1에 확인**하고, 쓸 수 있으면 `/api/vision`에 IP 기준 1분 3회 규칙을 건다. 쓸 수 없으면 앱 수준 제한(ratelimit + 예약)을 1차 방어로 명시한다. 클라이언트 UUID 기반 '기기' 토큰은 curl로 우회되므로 보조 수단으로만 쓴다.
- 전역 일일 상한 키 `pl26:budget:public:day:<KST날짜>`(7.5절). 넘거나 public 풀이 소진되면 503이 아니라 **재생 모드**(샘플 6장 기록 재생 + 「오늘 실시간 판독 한도에 도달했습니다. 기록된 판독을 보여 드립니다」)로 떨어진다.
- **심사용 접근 코드.** IP를 바꿔 가며 요청하는 한 사람이 매일 아침 공개 일일 상한을 소진하면 심사위원은 늘 재생 모드만 보게 된다. 그래서 실시간 업로드에 접근 코드 경로를 둔다.
  - 코드는 성과보고서와 심사용 안내에만 적고 공개 페이지·저장소에는 노출하지 않는다(환경변수 `JUDGE_ACCESS_CODE`). 코드는 **22자 이상 무작위**(예: base64url 16바이트 이상)로 만든다.
  - `JUDGE_ACCESS_CODE`는 쉼표로 구분한 **다중 값**으로 받아, 보고서 공개 등으로 코드가 퍼지면 재배포 없이 새 코드를 추가하고 옛 코드를 뺄 수 있게 한다(Vercel env 수정 + redeploy 절차를 D14 체크리스트에 적는다).
  - 서버는 `crypto.timingSafeEqual`로 비교한다(길이가 다르면 같은 길이 더미와 비교한 뒤 거부). 다중 값은 모든 값과 비교한 뒤 결과를 합친다(조기 반환 없음).
  - **틀린 코드 시도 제한**: IP(/64) 키 `pl26:rl:badcode:<ip>`로 시간 5회를 넘으면 그 IP의 코드 입력을 1시간 차단한다.
  - 코드로 들어온 요청은 공개 일일 상한과 별도인 `judge` 풀($3.0, 약 100장)을 쓰고, 코드당 시간 30회 제한에 더해 **judge 일일 상한 키 `pl26:budget:judge:day:<KST날짜>`($0.40, 약 13장)**를 둔다. 코드가 퍼져도 judge 풀이 하루 만에 바닥나지 않는다.
  - 국민투표 방문자는 샘플 재생이 기본이고, 코드 없는 공개 업로드는 위 규칙(일일 상한, IP 10회)을 그대로 따른다.
  - 임의 이미지가 이 출품 키로 Anthropic에 가는 경로가 줄어들어, 정책 위반 업로드로 키·조직 단위 제재를 받을 위험(같은 조직의 먼저살기도 영향)도 줄인다.

**코드가 할 일**
- `model.verbatim`을 정규화(대문자, 공백·하이픈 제거)한 뒤 `matchKeys`와 **정확히 일치하고 legibility=clear ∧ confidence=high일 때만** specId를 정한다. 그 밖에는 MANUAL_REVIEW다.
- 이렇게 정한 specId는 가구 확인 뒤에도 `specBy = "ai_label_user_confirmed"`이고 검증 사양이 아니다. 운영자 「기종 확인」(`VERIFY_MODEL`) 전까지 L은 판독 키와 편집거리 ≤2인 DB 이웃 기종 중 runtimeH가 가장 작은 값으로 계산한다(`MODEL_AI_UNCONFIRMED`, 3.2절). 혼동 미끼(Astral 100→150, LTV 1105→1150 등)를 자신 있게 잘못 읽어도 더 긴 가동시간이 수동검토 없이 하한에 들어가지 않는다.
- 퍼지 후보(편집거리 ≤2)는 운영자 화면의 「후보」 표시와 위 이웃 기종 최소값 계산에만 쓰고, 후보 자신의 사양으로 L을 올리지 않는다.

**데이터셋** (`datasets/labels/`, 실제 환자 데이터 0)
- 템플릿: HTML 8종. 해외 명판형과 국내 표시기재형(품목명·모델명·제조원·수입원·정격) 혼합이고, 한/영/혼용, 세로·가로다. 로고와 원본 라벨 이미지는 쓰지 않는다.
- 값: 3.3절 사양 DB의 공개 사양값만 넣는다. 시리얼·성명 자리는 `SN-XXXX-0000` 같은 합성 문자열이다.
- 렌더: Playwright(`tools/render_labels.ts`)로 PNG를 만든다. 정답은 렌더 입력 JSON이고, 렌더가 글자 위치(bbox)도 함께 기록한다.
- 열화: `tools/degrade.py`(Pillow, 시드 고정). 블러 σ 0~3, 반사 타원, 원근 ±25°, 회전, JPEG q20~60, 저조도, 부분 가림.
- **가림 정답 규칙.** `degrade.py`는 가린 영역과 겹치는 글자 범위를 필드별로 기록한다. 가림이 닿은 필드의 정답은 '보이는 부분 문자열' 또는 `legibility = partial | illegible`이다. 가린 글자를 기기 지식으로 채운 출력(렌더 입력 JSON과는 일치)은 정답이 아니라 **'보완 위반'**으로 따로 세어 자신 있게 틀린 비율 옆에 싣는다. 그래서 프롬프트가 금지한 행동이 정답으로 채점되지 않는다.
- 혼동 미끼: LTV 1150/1200/1105, Trilogy 100/200/10O, Astral 100/150/105, Inogen G4/G5, O/0, I/1, DB에 없는 모델.
- 분할:
  - dev 40
  - **봉인 시험 120**: 열화 60, 깨끗 30, 혼동·미등록 30
  - 인쇄 촬영 30: Q8 승인 시
- **템플릿 분리.** HTML 템플릿 8종 중 2종은 봉인 시험셋 전용으로 빼 두고 dev 40장에는 쓰지 않는다(템플릿 배치 과적합 방지). 어느 2종인지는 S3 매니페스트에 함께 봉인한다. 시험셋 지표는 전용 템플릿 분과 공용 템플릿 분을 나눠서도 싣는다.
- 시험셋은 **프롬프트 개발 전에** SHA-256 매니페스트 커밋으로 봉인한다(S3. 라운드 3 Q11⑨로 OTS는 걸지 않는다). S3 매니페스트에 **C1 봉인 측정 회차 수(1회)와 헤드라인 규칙(그 회차)**을 함께 봉인한다.

**지표**: 모든 비율에 Wilson 95% CI를 붙인다.
- 필드 정확 일치율
- **자신 있게 틀린 비율**(헤드라인 지표)
  - 정의: 틀림 = 정규화 값 ≠ 정답, confident = `confidence=high ∧ legibility=clear`. 자신 있게 틀림 = 틀림 ∧ confident
  - 주 분모: **열화셋 60장 × `model` 필드**(60). 보조: 같은 60장 × 전 필드
  - 봉인 시험셋은 Sonnet **1회** 실행하고 헤드라인은 **그 회차**다(S3 봉인, Q11②). 회차 간 불일치율은 dev 40장을 2회 실행한 결과에서만 내고 「dev 셋 기준」으로 표기한다
- **DB 수준 무플래그 오매칭**: 미끼나 오독이 엉뚱한 모델과 일치한 경우. 목표 0건, 기준 **건수 ≤ 2/120**. n=120에서는 0건이어도 Wilson 상한이 약 3.1%라 비율 상한으로는 입증할 수 없으므로 건수로 판정하고 CI 상한을 병기한다. 건별로 공개한다.
- 원시 응답 JSON(요청 ID 포함)은 `out/sealed/c1/`에 저장해 장부가 재호출 없이 재현되게 한다.
- DB 최종 매칭률
- 미등록 → 수동검토 재현율: 100%여야 한다.
- 이미지당 비용·지연

**기준선과 절제**
- tesseract.js(kor+eng) + 정규식 → 같은 매처. **C1 기준선 중 Must는 이것 하나다**(11.3절)
- Haiku 전체 120장(Should)
- Opus는 Could

**관문 3.** 열화셋 60장 × model 필드에서 자신 있게 틀린 비율(봉인 측정 1회, S3에 봉인)의 **점추정**이 10%를 넘으면 UI를 「기종 선택 + 사진 보조 확인」으로 낮추고 수치를 그대로 보고한다. Wilson CI는 병기만 하고 판정에 쓰지 않는다.

**보고 한계.** 렌더·인쇄 이미지 성능이며 실제 기기 사진 성능이 아니다.

### 7.3 C2 문서 → 정책 DSL (`src/lib/dsl/translate.ts`, 오프라인 스크립트, 실시간 직렬 호출(스트리밍), Sonnet adaptive, effort medium, maxTokens 16000). 라운드 3 Q11 기본안 (가)에서는 Should

**프롬프트가 할 일**
- 실행 가능한 조항만 Rule로 옮긴다. 모든 Rule에 원문 인용(quote)을 단다.
- 문서가 침묵하면 `deviceHouseholdFlag: null`이다.
- 어휘에 맞지 않거나 근거가 없는 주장은 `notEncoded`에 넣는다.
- 해석이 필요하면 `confidence: inferred`로 둔다.
- 일반 상식으로 보호 조항을 만들어 넣지 않는다.
- 일본어 원문도 그대로 받는다.

**코퍼스 15건** (`corpus/*.txt` + `meta.json`: URL, 수집일, note id). vault 노트 본문에서 해당 절만 발췌한다.
- 한국 6: KR-02/03 현행 순환단전 기준, MOTIE 2013, 약관 제47조, 정전복구 5단계, 주민대피계획 기사, 요양비 고시
- 해외 9: 마치다, 와카야마, 이나기, 이즈미사노, 루이지애나, ASTHO, emPOWER, PG&E, WG+E
- **보류 4건**: 약관 제47조(KR), 이나기, PG&E, WG+E. 모두 비자명 규칙이 있는 문서다. 개발에는 11건을 쓴다.
- **2단 절단 확정(11.3절)에 따른 기본 규모: 개발 7건 + 보류 3건.** 개발 7건은 한국 5건(약관 제47조 제외 전부) + 해외 2건(마치다, 와카야마), 보류 3건은 약관 제47조·이나기·PG&E다. 나머지 5건(이즈미사노, 루이지애나, ASTHO, emPOWER, WG+E)은 C2에 넣지 않는다. 오라클 DSL은 P1~P8(E3)에 필요하므로 15건 모두 쓴다.
- 분할은 프롬프트 작업 전에 봉인한다.

**오라클 DSL** (Claude Opus 서브에이전트 작성 · 사람 검수)
- 15건 전부를 별도 서브에이전트(opus-worker)가 쓴다. 이 에이전트는 프롬프트, 앱 코드, Claude 출력을 보지 않는다. 작성은 D5부터 병렬로 시작한다(11.2절).
- **사람 검수**: 사용자가 보류 문서(절단 확정으로 3건)의 오라클 DSL을 조항 단위로 검수한다(약 1~2시간, Q9). 라운드 3부터 검수는 S5 봉인을 막지 않는다. 봉인 뒤 검수에서 고친 조항은 `seal/CHANGELOG.md`에 남기고, C2 점수를 수정 전 오라클과 수정 후 오라클 둘 다로 싣는다(헤드라인은 수정 후, 두 값 병기).
- **천장**: 사람이 다시 쓴 1~2건과 에이전트 오라클의 행동 일치로 잰다. 사람 재작성이 없으면 두 번째 에이전트 작성자와의 일치를 '천장'이 아니라 **「모델 간 일치(같은 계열)」**로 표기하고, 85% 관문을 어휘 수정 근거로 쓰지 않는다. 사람 재작성이 있을 때만 '천장 85% 미만이면 봉인 전에 어휘를 고친다'를 적용한다.
- 모두 SHA-256 매니페스트와 OTS로 봉인한다(S5). 봉인 커밋은 첫 C2 호출보다 앞서야 한다.
- 한계: 정답 작성자와 피평가자가 같은 계열(Claude)이라 상관오류로 일치율이 실제 정확도보다 높게 나올 수 있다. 이 문구를 `/ledger` C2 행 한계 칸에 고정한다(7.6절). 전부 null 기준선과 키워드 기준선은 그대로 둔다.

**실행.** 문서마다 3회 실행하고, 결정 벡터 다수결과 자기일관성(3회 간 일치율)을 함께 보고한다. 탐침 하나에서 3회의 결정 벡터가 모두 다르면 다수결이 없으므로 그 탐침은 **불일치**로 센다. 개발 호출 수는 **라운드당 개발 문서 × 1회, 최대 3라운드**다(절단 전 11 × 3 = 33호출, 절단 확정 7 × 3 = 21호출. 7.5절 예산표와 같은 값).

**하류 연결(E1c, 5.4절).** C2 다수결 DSL은 채점에만 쓰지 않는다. KR 기준선에서 C2 코퍼스에 있는 한국 문서 규칙을 C2 DSL로 바꿔 끼워 E1을 다시 돌리고, 오라클 DSL 경로와의 56칸 표지 일치율(「하류 행동 동등성」, API 비용 0)을 C2 주 지표 옆에 싣는다. `/lab/manuals`에서는 문서별로 'C2 DSL로 돌린 빈틈 지도 대 오라클'의 차이 칸을 보인다. E1c를 하지 못하면 12.1절 AI 기술명에서 '절차 문서 규칙화'를 빼고, 장부 C2 행에 「평가용 측정 · 제품 경로 미사용」을 적는다.

**보류셋 1회 측정 규칙.**
- 보류 문서(절단 확정으로 3건)는 프롬프트를 동결한 뒤 **단 한 번(3회 실행)** 측정한다.
- 동결은 프롬프트 파일의 sha256을 측정 전에 커밋하는 것으로 한다.
- 측정 뒤 프롬프트를 고쳐 다시 쟀다면 두 수치를 모두 싣고, 헤드라인은 **첫 측정값으로 고정**한다.

**지표**
- **주 지표**: 보류 문서의 **비자명 탐침**(오라클이 가구에 영향 있는 행동을 내는 탐침) 행동 일치율
- 전체 탐침 일치율
- 조항 재현율·정밀도: 인용 구간 겹침 50% 이상이면 일치
- 슬롯 정확도: 수치 허용오차 1%
- **근거 없는 규칙 비율**: quote가 원문 부분문자열이 아닌 규칙. 검사 전에 원문과 quote 양쪽을 NFKC로 정규화하고 공백·줄바꿈 연속을 공백 하나로 줄인다(일본어 전각·반각 차이 흡수). 이 정규화 함수(`normalizeQuote`)는 S5에 함께 봉인한다
- **지어낸 보호 규칙 비율**: 오라클이 null·부재인데 기기 가구 보호 행동이나 flag를 만든 경우
- 컴파일 성공률: 보조 지표로만 쓰고 헤드라인에 쓰지 않는다

**기준선**
- 키워드·정규식 번역기
- **전부 null DSL**: 한국 문서 다수가 null이라 겉보기 일치율이 얼마나 부풀려지는지 보여 준다

**강등 관문 (K-DSL)**: 다음 중 하나면 「보조 초안 + 사람 검토」로 표기한다.
- 보류 비자명 일치 < 70%
- 기계 판독 가능 문서 < 5건. **'기계 판독 가능' = 다수결 DSL이 컴파일되고, 그 문서의 비자명 탐침 일치율이 70% 이상인 문서**(개발·보류 합산, S5에 봉인)

### 7.4 C3 보완안 한국화 루프 (`src/lib/patch/`, 오프라인, 실시간 직렬 호출(스트리밍). 시간이 남을 때만 Batches API(Could), Sonnet adaptive, effort medium, maxTokens 16000). Should

**입력**
- E1에서 ROBUST·CONDITIONAL인 빈틈 칸 상위 최대 25개: 등급, 원인, p와 CI, 공백 시간
- 해외 절차의 오라클 DSL
- 한국 행위자 등록부: 행위자별 허용 Action, 매개변수 상한(예: prep ≥ 0.2h, failProb ≥ 0.1)
- 비용 상한: 해당 템플릿 패치 비용 이하

C3는 C2 보류 측정(D9)이 끝난 **뒤**에 돌린다. 보류 문서의 오라클 DSL이 C2 측정 전에 프롬프트에 섞이지 않게 하기 위해서다.

**출력 스키마**
```ts
z.object({ gapId: z.string(), candidates: z.array(z.object({
  baseRuleId: z.string(), titleKo: z.string(), stepsKo: z.array(z.string()).max(5),
  koreanActors: z.array(z.string()), rules: z.array(Rule), assumptions: z.array(z.string()),
  costItems: z.array(z.object({ item: z.string(), krw: z.number() })), rationaleKo: z.string().max(500) })).length(5) })
```

위는 strict 스키마다. API로는 길이 제약(`.max(5)`, `.max(500)`, `.length(5)`)을 뺀 wire 스키마를 보내고(6.1절), 후보가 5개가 아니거나 길이를 넘으면 코드 관문에서 해당 후보를 무효로 집계한다(5개 미만이면 모자란 수만큼 무효). 제약값은 프롬프트 문장으로도 알려 준다.

**코드 관문**: 하나라도 걸리면 무효로 집계한다.
- zod strict 검사
- 행위자-행동 허용 여부, 행위자 실재 여부
- 매개변수 범위
- 같은 비용 조건(템플릿 비용 이하)
- KR 기준선 규칙과 충돌 여부
- **충실도 관문**(답변서 판단구조를 보완안이 깨지 못하게 한다)
  1. `PRIORITIZE`는 `margin_gated`만 허용한다. `runtime_asc`·`distance`는 답변서1 1번이 거부한 단일 키 정렬이다.
  2. 기기 등급을 대상으로 하는 규칙을 금지한다(I5). 스키마에 등급 필드는 없지만, rules의 문자열 값(region·stage 등)에 `DeviceClass` 이름이나 기기군 이름이 들어가도 무효다.
  3. 119·이송 Action(`EVAC_AT`)은 `afterOperatorApproval: true`가 필수다(I6).
  4. `MANUAL_REVIEW` 해제는 DB 기종의 라벨 미확인에만 허용한다(`RUNTIME_SHARE`, I4). DB 밖 기종을 자동 계산으로 넘기는 규칙은 무효다.

**비용 계산.** '같은 비용 조건'은 Claude가 출력한 `costItems`가 아니라 **코드가 계산한 비용**(rules의 Action × `spec/costs.json`)으로 판정한다. `costItems`는 표시 전용(`AiTag` '생성')이다. 두 값의 차이가 10%를 넘으면 그 후보를 무효로 집계한다.

**루프**
1. 개발 시드 500으로 평가한 수치를 돌려주고 수리 1회를 허용한다.
2. **후보 선택은 개발 시드 500에서 끝낸다.** 빈틈마다 후보 5개 중 개발 시드 성적이 가장 좋은 1개를 고른다.
3. 최종 평가는 **보류 시드 1,000에서 한 번만** 하며, 선택된 1개만 템플릿·무작위·패치 없음과 비교한다.

**기준선**
- 패치 없음
- 해외 원안 그대로
- 템플릿 한국화: 행위자 대응표로 치환하고 매개변수는 유지
- 무작위 유효 수정: 같은 관문과 비용 조건으로 5개를 만들고, 개발 시드에서 같은 방식으로 1개를 고른다

**지표**
- 주 지표: 선택된 1개가 템플릿보다 상대 5% 이상 낫고 짝 부트스트랩 CI가 0을 제외하는 빈틈의 비율(보류 시드)
- pass@5는 보조로만 싣는다. 실을 때는 무작위 5개의 pass@5를 나란히 싣고 Bonferroni(α/5)를 적용한다
- 악화 비율
- 비대상 원인 회귀

**승인과 표지**
- 화면 표지: 「AI 생성 제안 · 시뮬레이션 검증 · 담당자 승인 전」
- rationaleKo에 `AI 생성` 태그를 단다.
- 채택 버튼은 감사로그에 남긴다.

**강등 (K-PATCH)**: 보류 시드에서 주 지표(템플릿 대비 상대 5% 이상 ∧ 짝 부트스트랩 CI가 0 제외인 빈틈 비율)가 **무작위 유효 수정 기준선의 같은 비율보다 높지 않거나 20% 미만이면** 「문장 다듬기 보조」로 강등하고 결과를 공개한다(이 컷은 S4 `thresholds`에 봉인). D10 15시까지 유효 후보가 없으면 루프를 빼고 AI 지점 2개로 보고한다. P1~P8 오라클 DSL 순위(E3)는 유지한다.

### 7.5 예산 (Sonnet $2/$10, Haiku $0.1/$0.5, 전부 실시간)

추정은 7.1절 재시도 규칙(max_tokens일 때만 한도를 올려 1회)을 넣어 **'재시도 포함 최악 ×1.3'**으로 계산한다. C1 dev 첫 20회의 실측 max_tokens 비율이 나오면 배수를 그 값으로 갱신한다. `CLAUDE_INFERENCE_GEO`는 설정하지 않으므로 ×1.1은 넣지 않는다(7.1절). **라운드 3에서 절단 확정 규모 × 실시간 기준으로 다시 썼다**(Batches 제거, C1 봉인 1회, C2 개발 7건·최종 10건).

| 항목 | 호출 설계 | 실시간 기본 USD | ×1.3 USD | 풀 |
|---|---|---|---|---|
| C1 개발 | dev 40장 × 5판 × (입력 약 2.5k, 출력 0.5k). 5판 중 마지막 1판은 직전 판(동결 프롬프트)의 반복 실행으로 써서 회차 간 불일치율을 낸다(호출 수 그대로) | 2.0 | 2.6 | dev |
| C1 봉인 측정 | Sonnet 120장 × **1회** + 샘플 6장 재생용 기록(인쇄 30장은 Q8일 때만 +$0.3, Haiku 120장은 Should +$0.1) | 1.2 | 1.6 | sealed |
| C2 개발 | 개발 7건 × 1회 × 최대 3라운드 = **21호출** × ($0.018 입력 + $0.08 출력) | 2.1 | 2.7 | dev |
| C2 최종 | 10건 × 3회 = 30호출(보류 3건은 1회 측정 규칙, 7.3절) | 2.9 | 3.8 | sealed |
| C3 | 25칸 × (제안 + 수리) × 2회 × (입력 8k, 출력 4k) | 5.6 | 7.3 | dev |
| 공개 데모(C1 업로드만) | 샘플 호출 0. 전역 일일 상한 × 잔여 일수, IP(/64)당 시간 10회 | 5.4(풀 상한) | 5.4 | public |
| 심사용 접근 코드 | 코드 입력 업로드만. judge 일일 상한 $0.40 | 3.0(풀 상한) | 3.0 | judge |
| 스모크·잡비 | 운영 URL 일 1회 실호출, wire 스키마 스모크 등 | 3.0 | 3.9 | dev |
| **계획 합계 / 콘솔 상한 50 대비 예비** | | 25.2 | **30.3 / 19.7** | |

풀 대조(×1.3): dev 2.6 + 2.7 + 7.3 + 3.9 = 16.5 ≤ $20.25, sealed 1.6 + 3.8 = 5.4 ≤ $9.9. 합계 $30.3은 중단선 $35 안이다(public·judge 8.4는 풀 상한값이라 실제 지출은 더 작다). Q11 기본안 (가)로 C2를 하지 않으면 C2 두 행($6.5)은 쓰지 않는다. 중단 규칙은 sealed·public·judge를 빼고 동결하므로 봉인 측정과 공개·심사 데모는 살아남는다. 실측 배수가 1.3을 넘으면 C3 수리 라운드부터 줄인다.

**공개 데모 일일 상한.**
- 전역 키 `pl26:budget:public:day:<KST날짜>`. 일일 상한 = min($0.30, public 풀 잔액 ÷ 심사·국민투표 종료일(Q10)까지 남은 일수). $0.30이면 하루 약 30회다.
- 예) 10/22~12/31 71일이면 $5.4 ÷ 71 ≈ $0.076(하루 약 7회)이다. D12에 개발 지출이 확정되면 reserve에서 public으로 옮겨 풀을 (잔여 일수 × 일일 상한)으로 다시 잡는다.
- 상한을 넘으면 503이 아니라 재생 모드로 떨어진다(7.2절).
- judge 풀은 별도 일일 상한 `pl26:budget:judge:day:<KST날짜>` = $0.40을 둔다(7.2절). 접근 코드가 퍼져도 $3.0 풀이 최소 약 8일은 버틴다.

### 7.6 AI 사용 장부 (`/ledger`, `spec/ledger.json` + `evidence.json`에서 자동 생성)

**열**: 단계 / Claude가 하는 일 / 코드가 하는 일 / 측정값과 CI(파일 링크) / 실측 비용 USD / 알려진 실패율 / 실패 사례 1건 / 강등 여부 / 한계.

**고정 한계 문구**
- C2 행: 「정답 작성자도 Claude(Opus) · 같은 계열 상관오류로 일치율 과대 가능」. E1c(하류 행동 동등성)를 하지 못했으면 「평가용 측정 · 제품 경로 미사용」을 덧붙인다(7.3절)
- C1 행: 「렌더·인쇄 이미지 성능 · 실제 기기 사진 성능 아님」

**개발 보조 AI 구획.** 제품 안의 AI 세 곳과 별도로, 개발 단계에서 Claude Opus 서브에이전트(opus-worker)가 쓴 산출물을 따로 싣는다. 행은 오라클 코드(Python), KR 기준선 DSL(KR-01~12), P1~P8 DSL, 오라클 DSL 15건, 명세 기반 독립 계산 20건이다. 행마다 '사람 검수 여부·범위·일시·수정 건수'를 `evidence.json`의 `humanReview` 블록(입력은 `seal/CHANGELOG.md`)에서 자동으로 표시하고, 검수하지 않은 행은 「사람 검수 없음」으로 표시한다. 앱 코드 자체도 AI 코딩 에이전트가 작성했음을 이 구획 첫 줄에 적는다.

**외부 계정 작업 기록.** 콘솔 지출 상한의 월별 조정(Q4)과 심사용 접근 코드 교체(날짜만, 코드 값은 적지 않음)를 날짜·설정값과 함께 적는다.

**`#judge` 절.** 12.4절의 3분 확인 경로를 이 페이지 안의 한 절로 싣는다(Q11⑩).

장부 하단에 1.4절의 누락률 감사 표(등급·충전출처별 레인 비율)를 싣는다.

**'AI 아님' 행으로 명시하는 것**
- 하한 산술
- 복구 표본기(통계 모델). 원안의 '확률 예측'을 이렇게 다시 표기한다.
- 도착 계산
- 배정기
- 스윕
- DB 대조
- 근거 문장 템플릿

---

## 8. 독립 오라클 (Python) 차등 시험

**위치와 실행**
- 위치: `oracle/{engine.py, alloc.py, outcome.py, run.py, diff.py}`
- **범위(라운드 3, Q11⑥으로 축소)**: lowerBound(3.2절), RULE(4.1절, 4.3절 이산 사건 규약 포함), outcome의 M1·M2(3.8절)만 독립 구현한다. 기준선 6종(`baselines.py`)과 `dsl_interp.py`는 만들지 않는다. 기준선은 RULE과 같은 물리 필터·대체 레인 모듈을 공유하므로 TS 단위·속성 시험으로만 확인하고, DSL 인터프리터는 KR 내장 대 DSL 동등성(6.2절)으로 확인한다. 이 한계를 `/ledger`와 `/judge`에 적는다
- Python 3.12 표준 라이브러리만 쓰고 `python -I`로 실행한다.
- 입력은 materialize된 시나리오 JSON, `spec/params.json`, `spec/restoration_quantiles.json`이다.

**독립성 절차**
1. 이 명세의 3·4·6.1절을 발췌한 `spec/ENGINE_SPEC.md`만 받은 서브에이전트(opus-worker)가 작성한다. `app/src` 읽기를 금지한다.
2. 명세 기반 독립 계산 20건(에이전트 작성)은 세 번째 서브에이전트가 명세만 보고 쓴다(`spec/hand_calc/*.json`, 경로 이름은 유지). 그중 5건은 사용자(사람)가 직접 검산하고 결과를 `seal/CHANGELOG.md`에 남긴다(Q9). 검산은 S2a 봉인을 막지 않는다(봉인 후 검수 가능, 고치면 전후 결과 병기).
3. 봉인은 둘로 나눈다. 둘 다 **TS 배정기 첫 커밋보다 먼저**이고, 라운드 3(Q11⑨)부터 OTS 없이 sha256 매니페스트 커밋만 한다.
   - **S2a (새 D3)**: 오라클 코드 + 독립 계산 20건
   - **S2b (새 D3)**: `standard50.json` + 경계 퍼즈 생성 규칙 + **프리셋 JSON 3개(시드 포함, 5.7절)**
   - 배정기 첫 커밋은 S2b 이후에만 한다. CI 스크립트(`scripts/check-seal-order.mjs`)가 git log에서 S2a < S2b < `src/lib/alloc/` 첫 커밋 순서를 검사한다.
4. OTS(S4·S5)와 커밋 순서(S1·S2a·S2b·S3)가 증명하는 것은 시간 순서뿐이고 '보지 않았다'는 증명이 아니다. S1·S2a·S2b·S3은 git 커밋 시각만 근거라 외부 시각 증명이 없다는 점도 함께 `seal/CHANGELOG.md`에 밝힌다.
5. 불일치가 나면 명세 문장의 모호성부터 기록하고, 어느 쪽을 고쳤는지 로그에 남긴다.

**시험 집합**
- 표준 50건
- (무작위 2,000건은 라운드 3 Q11⑥으로 제외)
- **경계 퍼즈 500건**: slack 동점, A = 0.8L 정확히, R80 = min(0.8L, L−0.5) 정확히, 출력 = 1.25×W 정확히, L = 0, 미확인 모델, 119 용량 경계, Δ = Δ_min 정확히, slack 음수·−∞, 경과시간 사례(3.9절: e = 0, P10·P50·P90 근처, F(e) = 1, now = holdRecheckBy 정확히). **라운드 3 추가**: 4.3절 이산 사건 규약 사례(tReport 동시각, 결정 시점 동시각 병합, 재진입 시점 = holdRecheckBy, 119 슬롯 시작 = 앞 슬롯 종료 정확히, 슬롯 시작 = L_end 정확히, 호출 시각 동점의 id 순, 한 번 HOLD였다가 재배정된 가구의 M3 분모), c_ext 1/2·9/10, 예약 상한 `floor(가용×0.2)` 경계, `ai_label_user_confirmed` 이웃 기종 최소값

**통과 기준: 100% 일치**
- 레인, 배정, 처리 순서, 지표(M1·M2)가 완전히 같다(오라클 범위 축소로 M3·M4는 TS 단위 시험만).
- 연속값은 양자화한 정수로 정확히 같다. 초월함수 값은 materialize의 정수를 그대로 쓴다(3.1절).
- 독립 계산 20/20이 일치한다.
- (TS 내부 시험) KR 기준선의 DSL 경로와 내장 경로의 결과가 같다.

---

## 9. 시험 계획

| 층 | 대상 | 통과 기준 |
|---|---|---|
| 단위 (vitest) | L 분해, 보간, 양자화, 표본기 분위(P10·P90 ±2%, n=10⁵), 조건부 분위(3.9절), 도착, 템플릿 숫자 일치, 비용 검증기, 정규화·매처, `callStructured` 이미지 블록 | 독립 계산 20/20, engine·alloc 라인 커버리지 90% 이상 |
| 속성 (fast-check, 버전 고정, 불변식마다 10,000회) | **I1** 변형 시험: R만 늘리면 HOLD가 필요로 바뀐다. 비호환·비가용·A>0.8L이면 PROPOSE_ASSIGN이 아니다. RULE 결과가 L만으로 한 정렬, 거리만으로 한 정렬과 다른 사례가 존재한다. **ASSUMED_RANGE에서 R 분위(원인 표)만 바꿔도 처리 순서가 바뀌는 사례가 존재한다**(tier 경로). **I2** L(임의의 이용자 입력) ≤ L(사양 + 운영자 확인 항목, c=1, f_age=0.9), 곧 qT(L) ≤ qT(L_cap). L_cap에는 이용자 입력 필드가 들어가지 않으므로 동어반복이 아니다. 추가로 이용자 쪽 입력(신고 개수, setting(user), 충전량, 충전 출처)을 무작위로 바꿔도 운영자 확인 항목이 같으면 L이 L_cap을 넘지 않음을 10,000회 확인한다. **정전 중 재신고 시퀀스(충전량·시각 무작위)를 10,000회 넣어도 `POWER_SUPPLIED` 이벤트가 없으면 L_end가 단조 비증가.** `VERIFY_EXT`의 count > declaredCount는 저장 불가. **라운드 3 추가**: `VERIFY_CYL`의 hoursLo > 10h × count는 저장 불가. 이용자 입력 연식을 무작위로 바꿔도 L 불변(`USER_AGE_IGNORED`). `specBy = ai_label_user_confirmed`인 가구의 L ≤ 판독 키 이웃 기종(편집거리 ≤2) 각각으로 계산한 L의 최솟값이고, `VERIFY_MODEL` 전에는 혼동 미끼 쌍(Astral 100/150, LTV 1105/1150)에서 더 긴 기종의 L이 나오지 않는다. **I3** 신고만 된(운영자 확인 없는) 외장·실린더를 추가·삭제해도 L 불변. **외장 충전 미확인**(`chargeConfirmed = null`)이면 c_ext = 1/2이고, 그 외장 항은 `count × runtimeH × f_age_ext × 1/2`를 넘지 않는다. 외장 연식 미확인이면 본체 연식과 무관하게 f_age_ext = 7/10. **P1~P8을 적용한 상태에서도** 같은 조작에 L 불변(PREPOSITION_POWER는 L이 아니라 가구 전용 ResourceView로만, RECHARGE_LOOP는 `POWER_SUPPLIED` 없이는 L 불변, RUNTIME_SHARE 뒤에도 c = 0.5 유지). **I4** specId null이고 운영자 하한이 없으면 L=null이고 자원 배정 0. RUNTIME_SHARE를 적용해도 DB 밖 모델은 MANUAL_REVIEW 유지. 수동검토 재진입 L은 L_true를 바꿔도 불변. **I5** L·전력·커넥터가 같고 등급 이름만 바꾸면 결정 동일. 수동검토를 거쳐 재진입한 비연속 기기·DB 밖 기종 가구가 모두 같은 순번(같은 order 구간)을 받지는 않는다(operatorLowerH 가구별 표본). 수동검토 가구마다 검토 예약 자원이 있거나, 예약 가능한 자원이 0이었거나 예약 상한에 걸렸음이 기록된다. 예약 총수 ≤ `floor(가용 자원 × 0.2)`이고, tier 0 ∧ slack < mrHoldH 가구의 유일한 phys 자원은 예약되지 않는다. **I6** 결정 타입에 REJECTED 없음, 승인 이벤트 없는 APPROVED 0. 승인 뒤 재신고로 L_end가 줄어 도착 조건이 깨지면 `RECHECK_FLAG`가 생기고 새 `PROPOSED` 대안이 생기며, 승인된 배정은 자동으로 바뀌지 않는다. **I7** `View119`는 strict 3키, 승인 전 빈 값, 파기 뒤 빈 값. **I8** RestorationView는 범위와 리터럴 표지 필수, margin은 Range. 추가: PROPOSE_ASSIGN은 전체 필터를 충족하고, GAP_REDUCE와 모든 기준선 배정은 물리 필터를 충족. 경과시간이 늘면 L_rem·slack이 줄고, now ≥ holdRecheckBy이면 HOLD가 남지 않음. 수동검토 완료 전 PROPOSE_ASSIGN 0 | 반례 0 |
| 결정성 | Node 2회 실행 해시 동일, Node와 Worker N=500 해시 동일(Chromium. WebKit은 Could. N=500 정의는 5.1절), `alloc/`과 `engine/` 결정 파일의 초월함수 사용 0(ESLint `no-restricted-properties`, `Math.sqrt` 허용. sim materialize와 `engine/restoration.ts`의 CONFIRMED 변환은 허용, 3절), 3.1절 정확 일치 규칙 5종(감시값, 정수 유리수 연산 순서, floor, sqrt, F(e) 동점) | 동일 |
| 차등 | 8절 | 100% |
| DSL | 오라클 DSL 자기 일치, KR 내장 대 DSL 동등성, quote 부분문자열 검사기(NFKC·공백 정규화 사례 포함), wire 스키마에 재귀·길이·범위 제약 0, DNF ↔ 재귀 Pred 변환 왕복 동일, C3 충실도 관문 4종(runtime_asc·distance 거부, 등급 대상 거부, EVAC_AT 승인 플래그, DB 밖 수동검토 해제 거부) 단위 테스트 | 100% |
| 장부 | 엔진 상수가 전부 params 키로 해결되고, 모든 행에 type과 sourceIds가 있음 | 누락 0 |
| 퇴화 점검 (K-DEG) | 수원형·표준 θ(**각 스윕 축 범위의 중앙값, 로그균등 축은 기하평균, 범주 축은 '표준'. `params.json`의 `standardTheta`로 고정, S4 봉인**)에서 **등급별** `PROPOSE_ASSIGN` 또는 `GAP_REDUCE` 배정 비율, RULE 배정 수 | **실패 조건**: 필요 가구가 있는 등급 중 PROPOSE+GAP 비율이 0인 등급이 1개 이상. 실패하면 S4 전에 장부(params)를 수정하고, 수정 전후 결과를 둘 다 `seal/CHANGELOG.md`에 기록한다(S4 `thresholds`에 봉인) |
| E2E (Playwright, 데스크톱 + Pixel 7) | `/`: 배너·H1·두 시계·CTA가 첫 화면, 위젯은 API 호출 0. `/ops`: 정전 → 119 레인 1행 승인 → `/ops/119` 3필드(세 번째는 절대 시각) → 파기, 수정은 사유 없이 저장 불가, 승인 전 119 빈 화면, **PROPOSE_ASSIGN 승인 행은 119 화면에 없음**, 외장 확인 전 L에 외장 0, 수동검토 완료 전 수정 목록에 PROPOSE_ASSIGN 없음, 모의시계 ×600에서 HOLD 시한 경과 → HOLD_EXPIRED. `/household`: 샘플 → 재생 AiTag → 확인 → 분해식, **샘플 선택 시 `/api/vision` 호출 0**, 업로드는 체크 2개 전 비활성, 미등록 샘플은 수동검토(CI는 고정 응답 모킹). `/judge`: **경로를 따라가도 클릭 없이 APPROVED 0**. `/lab`: 슬라이더 이동 시 재계산과 '실시간 500회' 표기. `/ledger`: 숫자 = evidence.json. 모든 페이지 배너. `navigator.geolocation` 호출 0. 업로드 뒤 localStorage·IndexedDB 이미지 0. 호출 제한 429, **예산 소진 → 재생 모드 + 안내문**(503 아님). **라운드 3 추가**: `/household` '문구 = 실제 동작'(충전 모름 → 100% 입력 시 L이 오르되 L_cap 이하이고, 화면 문구가 1.6절 6항 문안과 같음), `/ops` 승인 뒤 재신고로 L 감소 → 「재검토 필요」 배지 + `RECHECK_FLAG` 감사 행 + 승인 서랍에 새 PROPOSED, `ai_label_user_confirmed` 행에 「AI 판독 기종 미확인」 표시와 「기종 확인」 뒤 해제, 접근 코드 오답 6회째 차단(1시간), judge 일일 상한 소진 → 재생 모드, `/` 두 시계 막대에 시간 숫자 없음 | 전부 통과, axe 심각 위반 0, LCP ≤ 2.0초(**Lighthouse CI 모바일 프리셋·simulated throttling 3회 중앙값**, 1.3절) |
| 문구 검사 (`scripts/lint-claims.mjs`) | 빌드 HTML, 보고서 MD, 영상 자막 | 0건이면 통과(아래 목록과 한정어 규칙) |
| 보안·운영 | 클라이언트 번들에 `sk-ant`·`ANTHROPIC_API_KEY` 0, 서버 로그에 본문 없음, Upstash 장애 시 `/api/vision` 실호출 닫힘(형제 방식) + 화면은 재생 모드, 운영 URL 실호출 스모크 하루 1회, 스크립트는 Upstash env 없으면 즉시 종료, `spend.jsonl`·Upstash(dev+sealed 키만) 차이 ≤ $0.10(public 지출이 있어도 통과), 업로드 400 규칙(크기·매직바이트), **동시 20요청 부하 시험에서 public·judge 풀과 일일 상한 초과 0**(예약 후 실행), `/api/vision` 시도 1회·SDK timeout 20초, 접근 코드 오답·길이 불일치 거부(timingSafeEqual), ratelimit 키 `pl26:rl:` 접두사와 TTL, `/api/health` deep 토큰 없으면 403(운영). **라운드 3 추가**: 예약·정산은 Upstash `EVAL` Lua 1회(동시 20요청 상한 초과 0을 Lua 경로로 재확인), 시간 초과 1건 뒤에도 `spend.jsonl`(Σreserve − Σrelease) 대 Upstash 대조 통과, `callStructured` 시간 초과 → 재시도 0회·`hold` 기록 1행, `/api/vision`·C2·C3 5xx 재시도 0회, C2·C3 max_tokens 재시도 한도 24000, IP 키가 `ipAddress(req)` + IPv6 /64 접두사(같은 /64의 다른 주소가 같은 키), 틀린 코드 IP(/64)당 시간 5회 초과 시 1시간 차단, `JUDGE_ACCESS_CODE` 다중 값 중 아무 값이나 통과·옛 값 제거 후 거부, judge 일일 상한 $0.40, **`status = "APPROVED"` 대입이 `ApproveDrawer` 핸들러 1곳에만 있음**(ESLint `no-restricted-syntax` 예외 1곳 + grep 시험, 관문 1) | 전부 |
| 레드팀 | red-judge 2라운드(라운드 3 재배치: 1라운드 새 D12, 2라운드 새 D13): 과장, ROBUST 공격, 순환논리, 키 노출, 호출 제한, 모방 조항, 원안 충실도 | 직전 라운드 치명·중대 0 |

**금지 표현 (구문 단위, 자기 문구와 충돌하지 않게 좁힘)**

| 분류 | 금지 구문 |
|---|---|
| 생명·안전 과장 | 「생명을 구」「생명을 지킵」「안전을 보장」「안전 보장」「사망을 막」「사망 예방」「인명 구조」「구조합니다」「끊겼」「살렸」「골든타임을 지키」「골든타임을 확보」「골든타임 확보」「막았」 |
| 개인정보 고지 | 「저장되지 않습니다」(제3자 보관 가능성을 지우는 단독 구문) |
| 단정 | 「예측합니다」「정확히 예측」「검증됨」「검증된 안전」 |
| 단독 수치 | 「정확도 \d+%」(CI나 범위가 없을 때) |
| 의료 오인 | 「환자 상태 모니터링」「실시간 모니터링」 |
| 성과 단정 | 「KPI 달성」 |
| JEONJO 문법 | 「세계 수」「1만 개 세계」「페르소나」「검토 지수」「취약점 카드」 |

- 단독 단어 '구조', '세계', '모니터링'은 금지하지 않는다. '구조적 단절', '평균은 세계 최저' 같은 표현이 가능하다.
- **한정어 규칙**: 성과보고서 기대효과 칸, `ClosingCard`, 영상 자막에서 %가 들어간 문장은 같은 문장 안에 「모의」나 「시뮬레이션」이 있어야 한다. 봉인 시험셋 실측 수치(C1·C2)를 쓰는 문장은 「봉인 시험셋」으로 대신할 수 있다. 없으면 1건으로 센다.
- **소분모 % 금지(라운드 3)**: 분모가 20 미만인 비율은 %로 쓰지 않고 「n칸 중 k칸」「n건 중 k건」으로 쓴다(예: E2 9칸). `lint-claims`는 `evidence.json`에서 각 % 자리표시자의 분모를 읽어 20 미만이면 1건으로 센다.
- **출처 없는 시간 차 수치 금지(라운드 3)**: 「n시간」「n시간 차이」처럼 두 출처 수치를 빼서 만든 시간 수치는 `params.json`의 `inferred` 행 키를 각주로 달지 않으면 1건으로 센다(1.3절 두 시계 막대의 「21시간」 삭제 근거).
- **영상 콘티·자막의 '실측'**: 모의 결과(A/B 카운터, E1·E2)에 '실측'을 쓰면 1건으로 센다. '실측'은 봉인 시험셋 측정(C1·C2)과 지연·비용 측정에만 쓴다.
- HOLD 표기는 「대기(재확인)」를 쓴다.

---

## 10. 저장소 구조

```
전력안심망 AI/
  app/                         Next.js 16.4, React 19.3, TS 5, Tailwind 4, vitest 5, zod 4, @anthropic-ai/sdk 0.133 (형제와 같은 버전 고정)
    src/app/{page.tsx, ops/, ops/119/, household/, lab/, lab/manuals/, ledger/, judge/, about/, api/vision/, api/health/}
    src/lib/domain/types.ts
    src/lib/engine/{params,quantize,lowerBound,restoration,arrival,margin}.ts
    src/lib/alloc/{need,feasible,rule,fallback,baselines,reasons,project119}.ts
    src/lib/sim/{prng,generator,materialize,lhs,run,outcome,labels,breakeven,dominance,stats}.ts
    src/lib/dsl/{schema,dnf,interp,probes,compare,translate}.ts
    src/lib/vision/{prompt,schema,normalize,match}.ts
    src/lib/patch/{prompt,schema,validate,loop,templated,random}.ts
    src/lib/claude/{models,client,budget}.ts   src/lib/ratelimit.ts   src/app/api/health/route.ts   (형제에서 복사·수정, 출처 주석. batch.ts는 라운드 3에서 제거)
    src/workers/sweep.worker.ts
    src/components/{Banner,AiTag,ClosingCard,TwoClocks,GapWidget,LaneTable,ApproveDrawer,ResourcePanel,GridMap,GapMap,DominanceGrid}.tsx
    src/data/evidence.json      (sync-evidence가 생성)
    scripts/{sweep,std50,presets-ab,export-scenarios,dsl-run,dsl-score,vision-run,vision-score,patch-loop,sync-evidence,lint-claims,ledger-build,check-seal-order}.ts|mjs
    e2e/*.spec.ts
  spec/      ENGINE_SPEC.md params.json device_db.json ext_db.json restoration_quantiles.json resources_mock.json costs.json standard50.json presets/ hand_calc/
  corpus/    *.txt meta.json split.json
  data/dsl/  kr/ patches/ oracle/        (오라클 DSL은 봉인)
  oracle/    Python 차등 오라클 (engine, alloc, outcome, run, diff. 라운드 3 범위 축소, 8절)
  datasets/labels/  templates/ dev/ test/(봉인) print/
  eval/      vision_score.py dsl_score.py patch_score.py stats.py
  prereg/    predictions.md sweep.json
  seal/      manifest_S*.json(.ots) CHANGELOG.md
  tools/     seal_manifest.py ots_stamp.py fill_report_docx.py (복사) build_quantiles.py render_labels.ts degrade.py
  out/       sweeps/ sealed/ diff/ vitest.json presets_ab.json spend.jsonl
  docs/      spec.md design/ ODD.md ledger.md limits.md DEVLOG.md compliance/README.md (4개 절: AI기본법 제31·33·34조, 민감정보·국외 이전, 의료기기 비해당, 점검표 10. Q11①)
  submission/ report.docx(.pdf) video/
  README.md  (착안 한 줄 + JEONJO 차이표, Q1·Q2 확정 후)
```

**JEONJO 회피 원칙**
- 코드 0줄 재사용
- 3D, 세계 수, 페르소나, 검토 지수, LED·LCD 없음
- 2D 표와 차트만 쓴다
- README에 차이표를 둔다

---

## 11. 일정과 관문 (10/17~10/30)

### 11.1 원칙

- 하루 5~6시간을 가정한다(assumed).
- 매일 끝에는 테스트 → `docs/DEVLOG.md` → 커밋 → (Q6에 따라) push·배포 순으로 마무리한다.
- `DEVLOG.md`의 필수 항목: 「남은 시간 대비 잔여 Must」 점검. 남은 작업일 × 5시간과 잔여 Must 추정 시간(11.2절 항목별 시간표의 '절단 후' 열에서 끝난 항목을 뺀 값)을 나란히 적고, 잔여 Must가 더 크면 다음 날 아침에 Q11 추가 절단 후보를 위에서부터 적용한다. Must 2단 절단은 이미 확정 적용했다(11.3절).
- **제품 면을 먼저 만든다.** 라운드 3 재배치로 9일차(10/25, G1)까지 운영 URL에서 전체 체인이 돌아가야 한다(이전 판의 6일차는 하루 8~9h를 전제한 계획이라 지킬 수 없었다). 증거층은 그 위에 쌓는다.
- **하루 5h 상한.** 11.2절 날짜별 표는 어느 날도 5h를 넘지 않게 항목별 시간표에서 도출한다. 서브에이전트 병렬 작업(오라클 코드, 독립 계산, 오라클 DSL, 코퍼스 발췌)은 이 5h에 넣지 않지만, 그 결과를 검토·통합하는 시간은 항목 시간에 들어 있다.

### 11.2 일정

**현재 상태(10/17 D1).** 저장소에 커밋이 0개이고 `app/src`는 빈 폴더 골격(`app`, `lib`)뿐이다.

**Must 항목별 시간표** (레드팀 라운드 2 추정 + 라운드 3 재계산, assumed. DEVLOG 잔여 Must 계산의 기준선)

| # | 항목 | 기본 h | 라운드 2 절단 후 h | **라운드 3 h** | 라운드 3 변경 |
|---|---|---|---|---|---|
| 1 | 골격·배포·형제 코드 복사 | 3 | 3 | 3 | |
| 2 | 장부·분위 표·S1 | 5 | 5 | 3 | 정수 표 제거 −2(Q11⑦), S1은 sha256 커밋만(Q11⑨) |
| 3 | 엔진·PRNG·생성기·속성 시험 | 8 | 8 | 8 | 초월함수 규칙 완화·`no-magic-numbers` 제거 −1(Q11⑦), c_ext·연식 확인·이웃 기종 최소값 +1 |
| 4 | 배정기·기준선·퍼즈·차등 100% | 10 | 11 | 7 | 오라클 범위 축소 −4(Q11⑥), S2a·S2b OTS 제거 −1(Q11⑨), 4.3절 이산 사건 규약·예약 제약 +1 |
| 5 | `/ops`·`/ops/119`·프리셋·E2E | 10 | 10 | 10 | 프리셋 3개 −1(Q11⑤), 재검토 배지·기종/연식 확인 조작·`presets_ab` +1 |
| 6 | 라벨 렌더·열화·`/household`·`/api/vision`·C1 dev | 10 | 10 | 11 | Lua 예약·정산, IP /64, 접근 코드 다중 값·오답 차단·judge 일일 상한, timeout 규칙 +1 |
| 7 | 랜딩·위젯·G1 | 5 | 5 | 5 | Lighthouse CI 포함 |
| 8 | 사전등록·E1·E1b·E2·랩 탭 4개·로그정규 안정성 | 10 | 8 | 7 | E1b 축소 −1(Q11③) |
| 9 | DSL 인터프리터(DNF)·탐침·KR 동등성·S5 | 8 | 8 | 8 | Q11 기본안 (가)면 Should |
| 10 | C2 개발·보류 측정 | 6 | 5 | 4 | Batches 제거 −1(Q11⑧). Q11 기본안 (가)면 Should |
| 11 | C1 봉인·장부·`/about`·준법 문서·ODD | 8 | 7 | 3 | 준법 1문서 −2(①), C1 봉인 1회 −1(②), `/about` 축소 −1(④) |
| 12 | 레드팀 2라운드·수정 | 5 | 5 | 5 | |
| 13 | 보고서·영상 | 6 | 6 | 6 | 녹화는 D13, 편집은 D14 |
| | **합계** | **94** | **91** | **80** | 절단 −15h, 라운드 3 추가 +4h. **Q11 기본안 (가)(항목 9·10을 Should로)이면 Must 68h ≤ 가용 70h(D1~D14 × 5h)** |

이 표가 말하는 것은 '라운드 3 절단(−15h)을 적용해도 C2까지 Must로 두면 약 10h가 넘친다'는 것이다. 그래서 C2의 Must 유지 여부를 Q11 잔여 결정으로 D1에 올렸고, 아래 날짜별 표는 기본안 (가) 기준(68h)으로 도출했다. (나)를 택하면 Q11 (나)의 절단 5개(−6h)를 적용한 뒤 항목 9·10을 D8~D13에 끼워 넣는 표를 그날 다시 내고, 남는 약 4h는 10/31 오전을 쓴다. E1c·C3·E3 같은 Should는 이 합계에 넣지 않았다.

**이전 D 표기 대응.** 이 명세의 다른 절에 남아 있는 'D숫자'는 라운드 2 일정 기준이다. 새 일정에서는 다음처럼 읽는다: 이전 D2(엔진·S2a) → 새 D2~D3 / 이전 D3(S2b·배정기·K-DEG·K0) → 새 D3~D5 / 이전 D4(`/ops`·관문 1) → 새 D5~D7 / 이전 D5(라벨·S3·`/household`·`/api/vision`·C1 dev 시작) → 새 D7~D9 / 이전 D6(랜딩·G1) → 새 D9~D10 / 이전 D7(S4·E1·E2·관문 2) → 새 D10~D11 / 이전 D8(DSL·S5)·D9(C2)·D10(E3·C3) → 기본안 (가)에서는 Must 일정 밖(남는 시간에만), (나)에서는 별도 표 / 이전 D11(C1 봉인·장부) → 새 D11~D12 / 이전 D12(레드팀·S6) → 새 D12~D13 / 이전 D13(보고서·영상) → 새 D13~D14 / D1·D14는 같다.

**날짜별 표 (라운드 3 재도출, Q11 기본안 (가) 기준 Must 68h, 하루 5h 상한)**. 괄호 안 숫자는 항목 번호와 그날 쓰는 시간이다.

| 날짜 | 산출물 | h | 통과 기준 / 관문 |
|---|---|---|---|
| D1 10/17 토 | (1·3h) Next 골격, Vercel 연결, 배너, 정적 `/` 뼈대, 형제 코드 복사(7.1절 수정점 포함), `/api/health`. (2·2h) `params.json`·사양 DB·원인·자원 v0, `ENGINE_SPEC.md`(4.3절 이산 사건 규약 포함). `ENGINE_SPEC.md`가 끝나면 오라클·독립 계산 서브에이전트 착수(병렬). **사용자 요청 한 메시지**: Q4 키(기한 D3 종료), Q9 검수 4건의 날짜·소요 시간, **Q11 잔여 결정((가)/(나))**. Vercel Firewall rate-limit·BotID 요금제 확인(7.2절). 새 Upstash DB 생성(Q7) | 5 | 배포 URL 열림. Q1 미해결이어도 진행 |
| D2 10/18 일 | (2·1h) `build_quantiles.py` → 분위 표, **S1**(sha256 매니페스트 커밋). (3·4h) 엔진(L·표본기·도착·여유·양자화·시간 기준점) | 5 | 장부 모든 행에 type·sourceIds, S1 커밋 |
| D3 10/19 월 | (3·4h) PRNG, 생성기(tReport 포함), materialize, 속성 시험 I2·I3·I4·I8. (4·1h) **S2a**(오라클 + 독립 계산 20) → **S2b**(표준 50·퍼즈 규칙·프리셋 3개) sha256 커밋 | 5 | 단위·속성 녹색, S2a < S2b 커밋. **Q4 기한**. 독립 계산 5건 검산은 이날 이후 사용자가 언제든(Q9, 봉인을 막지 않음) |
| D4 10/20 화 | (4·5h) 배정기 RULE 첫 커밋(예약 제약 포함), 4.3절 사건 루프·119 대기열, 기준선, 근거 템플릿, 경계 퍼즈, 차등 시험 | 5 | S2a < S2b < 배정기 첫 커밋(`check-seal-order.mjs`, 프리셋 sha256 포함). **K-DEG**(표준 θ, 9절). **K0**: 차등이 D5까지 닫히지 않으면 범위를 표준 50 + 경계 퍼즈 중 레인·배정만으로 줄인다 |
| D5 10/21 수 | (4·1h) 차등 100% 마무리. (5·4h) `/ops` 표·자원·격자도·승인/수정·감사, 확인 조작(외장·실린더·연식·기종·수동검토) | 5 | 차등 100% |
| D6 10/22 목 | (5·5h) 재검토 배지·`RECHECK_FLAG`, A/B 카운터(`presets_ab.json` 경유), `/ops/119`, E2E ops | 5 | |
| D7 10/23 금 | (5·1h) E2E 마무리·배포. (6·4h) 라벨 템플릿·렌더·열화·미끼, **S3**(시험셋·전용 템플릿 2종·C1 봉인 회차 1회와 헤드라인 규칙, sha256 커밋) | 5 | **관문 1**: E2E 녹색, `status = "APPROVED"` 대입 1곳(9절 grep·ESLint), 배포. 실패하면 D8 오전 2h를 보수에 쓰고 C1 dev를 D9로 민다 |
| D8 10/24 토 | (6·5h) `/household`(샘플 재생·업로드 체크 2개), `/api/vision`(이미지 블록·업로드 검사·Lua 예약·IP /64·접근 코드·일일 상한·재생 모드), C1 dev 시작 | 5 | 운영 URL 실호출 1회 성공, 이미지 비저장 확인, **이미지 1장 입력 토큰 실측 ≤3k**, 첫 20회 max_tokens·parse_failed 비율 기록(7.5절 배수 갱신) (Q4 필요) |
| **D9 10/25 일** | (6·2h) C1 dev 반복. (7·3h) `/` 랜딩(두 시계, 위젯, ClosingCard '측정 전'). **MVP 관문 G1** | 5 | **G1**: 운영 URL에서 라벨 → 하한 → 순위 → 승인 → 119 → 파기가 끝까지 돈다. 문구 검사, 키 노출 점검, 「측정 전」 자동 대체 시험(11.4절). **red-judge 10초 판독 합격 기준**: 랜딩·`/ops` 스크린숏만 보고 red-judge가 '배터리 하한과 복구 시간을 비교한다'는 뜻을 한 문장으로 말한다. **실패 시** D10의 (7·2h)를 MVP 보수에 쓰고 `/lab`은 탭 ①②③만 |
| D10 10/26 월 | (7·2h) OG 이미지, Lighthouse CI(1.3절), G1 잔여. (8·3h) **사전등록 커밋 + OTS(S4)** → E1 스윕 시작 | 5 | S4 커밋이 E1·E2 전용 시드 첫 사용보다 앞섬. KR-01~12 검수는 S4 뒤 사용자가 언제든(Q9) |
| D11 10/27 화 | (8·4h) E1·E1b(축소)·E2, 안정성 시험(로그정규 교체), `/lab` ①②③⑥, Worker 해시. (11·1h) `sync-evidence`, `/ledger` 골격 | 5 | 안정성 시험 통과(5.4절 기준). **관문 2**: 무배터리 산소 외에 ROBUST가 1개 이상이고, [P1] ≥ N(9칸 중 3칸, S4 봉인). 미달이면 헤드라인을 '명단-절차 단절 + 지배율'로, 끝 훅을 12.3절 대체안으로 |
| D12 10/28 수 | (11·2h) C1 봉인 측정 1회(Sonnet·Tesseract, 샘플 6장 재생용 출력 기록), `/ledger`(`#judge` 절 포함)·`/about`·준법 1문서·ODD. (12·3h) 레드팀 1라운드(red-judge)와 수정 | 5 | **관문 3**: 열화셋 자신 있게 틀린 비율 10% 이하(봉인 측정 1회), 미등록 라우팅 100%. 미달이면 강등. 장부 수치 = 측정 파일 |
| D13 10/29 목 | (12·2h) 레드팀 2라운드(새 세션)와 수정, **S6 기능 동결**. (13·3h) 영상 녹화(`/ops`, `/household`, `/lab`, `/ledger`, 끝 카드), 성과보고서(`fill_report_docx.py`, 수치는 evidence.json에서 주입) | 5 | 2라운드 치명·중대 0. 처음 보는 사람 3명 10초 시험(사용자 진행, 3명 중 2명이 문제를 한 문장으로 말함) |
| D14 10/30 금 | (13·3h) 영상 편집·내레이션, 보고서 PDF, 최종 태그, README(Q1·Q2 반영). 신청서 서명과 이메일 제출(사용자). 2h 여유. **체크리스트**: 10/31 또는 11/1 오전 콘솔 지출 상한을 (50 − 10월 실지출)로 낮추기(사용자, Q4), 심사용 접근 코드를 보고서·안내에 적었는지, `JUDGE_ACCESS_CODE` 교체 절차(Vercel env에 새 값을 쉼표로 추가 → redeploy → 옛 값 제거 → redeploy) 기록 | 3 (+2 여유) | 양식 7칸·2장, 수치 문장마다 출처나 측정 파일 연결, 수신 확인 보관. 10/31은 예비일(먼저살기 제출과 같은 날) |

**합계 68h**(D1~D13 각 5h + D14 3h). 항목별 합은 위 시간표와 같다: 1=3, 2=2+1, 3=4+4, 4=1+5+1, 5=4+5+1, 6=4+5+2, 7=3+2, 8=3+4, 11=1+2, 12=3+2, 13=3+3.

**키 지연 규칙** (Q4가 D3 종료까지 오지 않을 때). 새 일정에서 키가 처음 필요한 날은 D8(C1 실호출)이다. D7 종료까지 키가 없으면 D8은 `/household`·`/api/vision`을 고정 응답 모킹으로 만들고, D9 G1의 라벨 단계는 모킹 응답으로 통과하되 실호출은 「키 대기」로 표기한다. 키가 들어온 날부터 C1 dev → C1 실호출 1회 → (Q11 (나)일 때만) C2 개발 → C2 보류 측정 순으로 몰아서 하고, C1 봉인 측정(D12)이 키 도착 뒤 최소 2일 dev 반복을 거치지 못하면 관문 3 결과에 「dev 반복 부족」을 병기한다.

### 11.3 MoSCoW와 절단 순서

| 등급 | 항목 |
|---|---|
| **Must** (항목은 자르지 않고, 규모는 아래 2단 절단을 **확정 적용**한 규모다) | `/ops`·`/ops/119`·감사로그, RULE·기준선·A/B, 오라클 차등, 표준 50, E1·E1b·E2, 로그정규 민감도(E1 안정성 시험), `/lab` ①②③⑥, `/household` + C1(실호출 + 봉인 측정 1회, 기준선은 Tesseract만), C2(봉인 측정. **Q11 기본안 (가)면 Should**), `/`, `/ledger`, `/about`(축소), 준법 문서(1개 문서), 문구 검사, 성과보고서, 영상, Worker 해시 검증(Chromium) |
| **Should** | E3 오라클 DSL 패치 순위, E1c C2 하류 동등성, C3 루프, `/lab` ④⑤, `/lab/manuals`, `/judge`(`/ledger#judge` 절), OG 이미지, E4, Haiku 절제, (Q11 (가)일 때) C2 |
| **Could** | E1a 해석 대조, numpy 독립 재계산, Kuhn 최대매칭 상한, Opus 절제(C1·C2), 인쇄 촬영 30장, 보호자용 쉬운 글 안내(디지털 포용), Worker 해시 WebKit 검증(이때 정수 표 도입, 3절), C3 Batches API, Python 오라클 기준선·DSL 인터프리터·무작위 2,000건(Q11⑥) |
| **Won't** | 12.3절 목록 |

**절단 순서** (먼저살기 지연이나 관문 실패 시, 위에서부터 자른다)
1. Could 전부
2. E4
3. C3 루프. P1~P8 오라클 DSL 순위는 유지한다
4. `/judge`, `/lab/manuals`
5. Worker 슬라이더. 정적 표지만 남긴다
6. E3 전체

**Must 2단 절단** (레드팀 라운드 2 반영으로 **지금 계획으로 확정 적용**한다. 11.2절 시간표상 절단 없이는 Must가 들어가지 않기 때문이다. 그래도 넘치는 분은 Q11)
- C2: 코퍼스 15건 → 개발 7 + 보류 3(문서 구성은 7.3절)
- E1: LHS 4,000추첨 → 1,000추첨(Wilson CI가 넓어지는 만큼 BORDERLINE이 늘어나는 것을 그대로 공개)
- E2: 27칸 → 9칸(σ_e = 0.5 고정)
- C1 기준선: Tesseract만 Must, Haiku는 Should
- 브라우저 해시 검증: Chromium만 Must, WebKit은 Could
- 절단한 항목과 규모는 S4·S5 봉인 파일에 적는다(확정 적용이므로 봉인 전에 들어간다).

**동결 규칙(Q3)**: 먼저살기가 하루 이상 밀리면 그 시점 기능으로 동결하고 문서화만 한다. 동결 시점별 제출물은 11.4절 표로 고정한다.

### 11.4 동결 시점별 제출물

보고서·`/ledger`·`ClosingCard`는 `evidence.json`에 없는 키를 「측정 전」 문장으로 자동 대체한다. 이 동작을 G1(새 D9)에 시험한다(키를 지운 evidence.json으로 보고서 스크립트 실행 → 「측정 전」 문장 확인, 숫자 하드코딩 0).

| 동결 시점 (라운드 3 날짜) | 제출되는 것 | 「측정 전」·표지로 대체되는 것 |
|---|---|---|
| G1 전(D9 이전) | `/ops`·`/ops/119`·봉인 프리셋 A/B(차등 통과분), `/` 뼈대 | C1·C2·E1·E2 전부. 보고서 헤드라인은 명단형 대안(전략 보고서 9.2절)과 작동 흐름 |
| G1(D9) | `/ops` + 봉인 프리셋 A/B + `/household` + C1 dev 수치에 '봉인 전' 표지 | C1 봉인 측정, C2, E1, E2. 끝 카드는 대체안에서 C1 dev 수치만('봉인 전') |
| 관문 2(D11) | 위 + E1·E1b·E2, `/lab` ①②③⑥ | C1 봉인, C2. 끝 카드 기본안의 [M]은 「측정 전」 |
| 관문 3(D12) | 위 + C1 봉인 측정, `/ledger` 완성 | C2(Q11 (가)면 Should), C3(Should) |
| S6(D13) | 전부(Must) | 하지 못한 Should는 「측정 전」 또는 해당 문장 자동 제거 |

---

## 12. 심사·투표 산출물

### 12.1 성과보고서 (Word 2장 이내, 7칸 고정)

| 칸 | 내용 |
|---|---|
| AI 기술명 | 라벨 판독·절차 문서 규칙화 AI + 비AI 배정 규칙: 전력의존 가구 잔여대응여유 도구. **'절차 문서 규칙화'는 E1c(C2 하류 행동 동등성, 5.4절)가 evidence.json에 있을 때만 넣는다.** 없으면 「라벨 판독 AI + 비AI 배정 규칙: …」로 스크립트가 자동 전환한다 |
| 아이디어명 | 12번. 전력안심망 AI |
| 기술요약(3줄, 첫 훅) | 전략 보고서 9.2절 추천안(평균 인정형)의 1·2줄 + 고친 3줄(아래). 14% 확인에 실패하면 사건형 대안으로 바꾼다 |
| 최종목표(2줄) | 복구 가정 범위(P90) 안에 하한이 끝날 수 있는 가구를 먼저 두고, 그 안에서 하한의 0.8배 안에 도착할 수 있는 시간 여유(slack)가 작은 가구부터 호환 자원을 제안한다(tier → slack. 복구 가정 범위는 처리 순서·필요성 판정·필요 에너지에 반영). 담당자가 승인한다 |
| 개발 내용 및 결과 | 작동 흐름, 원안 충실도 불변식 I1~I8 테스트 결과, 지배율, ROBUST 표, C1·C2·C3 실측과 CI, 선택 제출물 링크(저장소·ODD·장부·제34조 대응표·점검표) |
| 애로점 | 가정값, 당사자 참여 부재, 측정된 실패율, 렌더 라벨 한계 |
| 기대효과(끝 훅) | 12.3절의 기대효과 최종 문장. [N][P1][P0][P2][M_lo][M_hi][ROBUST 쌍]은 `evidence.json`에서 스크립트가 채운다. 관문 2·3 결과에 따라 같은 절의 대체 문장으로 자동 전환한다 |

**기술요약 3줄 (확정 문안)**
1. 「한국의 정전은 한 집당 1년에 9분이지만, 정부 추산으로 아파트 정전 7건 중 1건은 12시간을 넘깁니다.」
2. 「가정용 인공호흡기 내장배터리는 1~8시간이고, 정부의 새 목표는 최악의 단지 고장에도 24시간 내 임시 전력입니다.」
3. 「AI가 기기 라벨을 판독하면, 규칙 엔진이 배터리 하한과 가정 복구 범위·전원 도착 시각을 비교하고 담당자가 승인합니다.」

근거는 9분 [한전-세계-최저수준-정전-더-줄인다], 7건 중 1건과 24시간 목표 [readnewsaspx], 1~8시간 [astho-advancing-preparedness-for-life-support-users-during-power-outages-aug-202]이다. 3줄째는 비교의 주어를 '규칙 엔진'으로 두고 복구를 '가정 범위'로 적는다(I8, 7.6절 'AI 아님').

### 12.2 3분 영상 콘티

| 시간 | 화면 | 내레이션·자막 |
|---|---|---|
| 0:00–0:03 | 두 시계(3h 대 24h 목표) | 「정전. 인공호흡기 배터리 3시간. 최악의 단지 고장에 대한 정부 임시전력 목표는 24시간」 |
| 0:03–0:07 | 왼쪽 0, 빨간 막대(시간 숫자 없음, 라벨 「목표 상한까지 남는 차이 · 내장배터리만, 외장·이송 없을 때의 단순 비교」, 1.3절), 하단 '7건 중 1건 12시간 초과(정부 추산)' | 「어느 집이 먼저 꺼지는지 계산하는 절차는 공개된 문서에서 찾지 못했습니다」. 자막 각주 '공개 문서 기준' |
| 0:07–0:10 | `/ops` 실물, 승인 버튼 | 「전력안심망은 그 시간을 계산하고, 담당자가 결정합니다」 |
| 0:10–0:35 | 평균 9분 인정 → 2026-08 사건 표(인천 11h, 서산 14h) → 순환단전 기준에 가구 칸 없음, 할인 기록은 있음 | 「평균은 세계 최저. 문제는 꼬리입니다」 |
| 0:35–1:00 | `/household`: 라벨 → `AI 추출` → DB 일치 → 분해식, 미등록 → 수동검토 | 「이 화면에서 AI는 라벨을 읽기만 합니다. 계산은 코드가 합니다」 |
| 1:00–1:45 | `/ops` 수원형(봉인 프리셋): 순위, A/B 카운터(모의, 「결과 보기 전 봉인된 프리셋」 툴팁 노출), 수정 사유, 승인 → 119 탭 **3필드** | 「짧은 배터리 순, 가까운 자원 순과 같은 정전으로 비교합니다」 |
| 1:45–2:25 | `/lab`: 손익분기 → 빈틈 지도 → 보완안 순위 → 슬라이더로 표지 하나 뒤집기 | 「시험한 가정 범위 안에서 남는 빈틈만 말합니다」 |
| 2:25–2:50 | `/ledger`: 세 지점 실측, 실패 사례 1건, 비용 | 「AI가 틀린 비율도 공개합니다」 |
| 2:50–3:00 | 끝 카드와 URL | 「AI는 읽고, 코드는 계산하고, 결정은 사람이 합니다」 |

### 12.3 ClosingCard

> **라운드 5에서 바뀜.** 헤드라인 비교·E1/E2 규모·관문 2·끝 카드는 맨 끝 「반영 기록 (라운드 5)」이 이 절보다 우선한다.

- **기본안**: 「모의정전 [N]회 · '짧은 순'·'가까운 순' 두 단순 규칙 모두보다 공백 고위험 가구가 적은 조건 9칸 중 [P1]칸, 같은 조건 [P0]칸, 어느 한쪽보다라도 많은 조건 [P2]칸(모의) · coverage·고장률 가정 범위에서 공백 가구·시간 [M_lo]~[M_hi]% 감소(모의)」와. [M] 구간 하한이 0 이하이면 「· 공백 가구·시간 …」 부분을 뺀다(아래 [M] 정의) 「기록은 이미 공공기관에 있습니다. 남은 것은 그 기록을 시간과 잇는 일입니다」
  - [P1] = B1과 B2 **둘 다**에 대해 우세(b)인 칸 수, [P2] = 둘 중 **하나에라도** 열등인 칸 수, [P0] = 나머지 칸 수(5.4절, S4 봉인). 기준선별 칸 판정은 `/lab` ③에 따로 싣는다. 승·무·패를 따로 싣고, 무승부를 '우세'로 묶지 않는다. 분모가 9칸뿐이므로 %가 아니라 「9칸 중 k칸」으로 쓴다(9절 소분모 % 금지). 27칸으로 확장했으면 「27칸 중 k칸」이다.
- **대체안**(관문 2 실패 또는 C3 강등): 「열화 라벨 [n]장 중 [x]%만 자신 있게 틀림 · 처음 보는 절차 문서 [k]건 [y]% 일치」. 대체안의 %는 모의 수치가 아니라 봉인 시험셋 실측이므로 「봉인 시험셋 실측」을 같은 줄에 단다(한정어 규칙은 「모의」 또는 「시뮬레이션」 또는 「봉인 시험셋」으로 충족).
- 하단 고정 문구: 「AI 기반 운용 · 시연용 합성 데이터」

**기대효과 최종 문장 (성과보고서 끝 칸, 전략 보고서 9.3절에서 옮겨 고침)**
- 기본안: 「같은 정전을 같은 시드로 [N]회 다시 돌렸습니다(모의정전). 원안 판단식 구현 규칙은 '배터리 짧은 순'·'가까운 자원 순' 두 규칙 모두보다 공백이 남은 고위험 가구가 적은 조건이 9칸 중 [P1]칸, 같은 조건이 [P0]칸, 어느 한쪽보다라도 많은 조건이 [P2]칸이었고(모의), 예비전원을 미리 두는 해외 절차를 한국 조건에 옮기자 coverage·고장률 가정 범위에서 공백 가구·시간이 [M_lo]~[M_hi]% 줄었습니다(모의). 시험한 가정 범위의 추첨 90% 이상(95% 신뢰하한)에서 [ROBUST 쌍] 가구 유형에 공백이 남았습니다(모의정전). 배터리 없는 산소발생기는 사양상 0시간이라 정전과 동시에 전원이 필요합니다(제조사 사양). 그 가구의 기록은 이미 공공기관에 있습니다. 남은 것은 그 기록을 시간과 잇는 일입니다.」
- **[M]의 정의(출처 키 하나).** `evidence.json`의 `e3.baseA.topSameCost`: E3 바탕 (가) KR_BASELINE에서 같은 비용 조건을 통과한 오라클 패치 중 ΔM2가 가장 큰 1개다. [M_lo]~[M_hi]는 그 패치의 상대 ΔM2를 coverage·failProb 축(5.3절 E3 전용)에 대해 구한 P10~P90 구간이다. 구간 하한이 0 이하이면 이 문장을 빼고 ROBUST 문장만 남긴다. C3 결과는 [M]에 섞지 않고, 따로 「AI 생성 제안 · 담당자 승인 전」 표지로만 쓴다.
- **[ROBUST 쌍]의 정의.** `evidence.json`에서 ROBUST로 나온 (등급, 원인) 쌍만 넣는 템플릿으로 스크립트가 만든다(배터리 없는 산소발생기는 E1 표지에서 빠지므로 여기에 들어가지 않는다). 예: 「야간 변압기·부품 조달형 정전에서 3시간 이하 인공호흡기」. 원인 한정 없이 등급만 쓰지 않는다. ROBUST 쌍이 0개이면 이 문장을 빼고 대체안을 쓴다.
- 대체안(관문 2 실패): 「그 가구의 기록은 이미 공공기관에 있습니다. 이 도구의 AI는 열화 라벨 [n]장 중 [x]%만 자신 있게 틀렸고(봉인 시험셋 실측), 처음 보는 절차 문서 [k]건을 [y]%의 일치율로 실행 규칙에 옮겼습니다(봉인 시험셋 실측). 남은 것은 그 기록을 시간과 잇는 일입니다.」

### 12.4 `/judge` 3분 경로 (정적, Claude 호출 없음. 라운드 3부터 `/ledger#judge` 절)

1. **30초**: 두 시계와 판단식 한 줄.
2. **60초**: 버튼은 수원형 시나리오를 실행한 뒤 `/ops`로 이동해 첫 행의 승인 서랍을 열고 포커스만 준다. **승인 클릭은 심사위원이 직접 한다**(I6, 관문 1 '승인 우회 경로 0'). 녹화가 필요하면 「기록된 승인 재생(시연)」 표지를 단 감사 로그 재생으로 보여 주고, 재생된 결정은 `APPROVED`로 바꾸지 않는다. Worker 재현 해시가 저장된 해시와 같은지 보여 준다(5.1절 브라우저 검증).
3. **90초**: 1.7절 대응표를 체크리스트로 보여 주고, 각 칸을 다음 근거로 연결한다.
   - 측정 파일
   - 봉인 해시
   - 커밋 순서(봉인이 엔진·프롬프트보다 앞섬). S2a·S2b를 따로 표시하고, `scripts/check-seal-order.mjs` 결과를 함께 싣는다
   - 차등 100%
   - 테스트 수
4. 질의 대비 5문답(전략 보고서 8.4절)을 접이식으로 둔다.

---

## 13. 위험과 범위 밖

### 13.1 위험

| 위험 | 확률·영향 | 대응 |
|---|---|---|
| 먼저살기와 시간 충돌 | 고·치명 | Q3 동결 규칙, D6 관문 이후는 전부 절단 가능하게 설계, 11.3절 절단 순서, Must 2단 절단 확정 적용, 라운드 3 절단 −15h 확정 적용, 11.2절 항목별 시간표와 하루 5h 상한 날짜별 표(C2까지 Must면 약 10h 초과 → Q11 잔여 결정, 기본안 (가)는 Must 68h) |
| 모방 조항(JEONJO) | 중·치명 | Q1, 코드 0줄, 화면 문법 차단, 금지어 검사, README 차이표 |
| '가정의 반복' 공격 | 고·치명 | ROBUST만 앞에 냄, Wilson CI와 BORDERLINE, 사전등록, 반증 슬라이더, calibrated/consistency 구분, 해외 실절차와의 비교 |
| 하한 과보수로 배정기 퇴화 | 중·중대 | 보수 계수 한 번 원칙, K-DEG, 장부 수정은 사전등록 전에만 |
| 오라클 작성자 = 구현자 | 중·중대 | 서브에이전트 분리, 봉인 선행, 천장 측정, 무작위 탐침 30%, OTS 한계 명시 |
| 오라클·피평가자가 같은 계열 모델(Claude) | 고·중대 | '손작성' 표기 금지, 사람 검수(보류 문서·독립 계산 5건·KR-01~12·P1~P8 핵심 매개변수, Q9), `/ledger` 개발 보조 AI 구획, 사람 재작성 천장 또는 '모델 간 일치' 표기, `/ledger` C2 고정 한계 문구 |
| 정전 진행 중 시간 기준점 오류 | 중·치명 | 3.9절 절대 모의 시각, HOLD 재확인 시한·자동 해제, 경과시간 퍼즈 |
| 한국 문서 null 편향으로 C2 부풀림 | 고·중대 | 비자명 탐침 주 지표, 전부 null 기준선, 지어낸 보호 규칙 비율 |
| 렌더 라벨이 실제보다 쉬움 | 고·중 | 열화·미끼·인쇄셋, 한계 문단, 관문 3 |
| 보완안이 비용으로 이김 | 중·중 | 같은 비용 조건 검증기 |
| 공개 URL 비용 남용 | 고·중대 | 샘플은 기록 재생(호출 0), 업로드만 실호출, 전역 일일 상한, IP당 시간 10회 + Vercel Firewall·BotID(요금제 확인 후, 안 되면 앱 수준 제한이 1차 방어), 소진 시 재생 모드(503 아님), 풀 = 잔여 일수 × 일일 상한, **예약 후 실행(Upstash `EVAL` Lua 1회 원자 예약·정산), IP는 `ipAddress(req)` + IPv6 /64, 심사용 접근 코드(22자 이상·다중 값 교체·오답 시간 5회 초과 1시간 차단) + `judge` 풀과 judge 일일 상한 $0.40(공개 상한이 소진돼도 심사위원 실호출 유지), 정책 위반 업로드로 인한 키 제재 위험 축소** |
| 출품 간 장애 전파(먼저살기와 Upstash 공유) | 중·중대 | 새 무료 Upstash DB(Q7), `pl26:rl:` 키 + TTL |
| 콘솔 상한 월 리셋 | 확정·중 | 10/31·매월 1일 콘솔 상한 하향(Q4, D14 체크리스트) |
| 구조화 출력 스키마 미지원(재귀·길이 제약) | 확정·치명(대응 전) | DNF wire 스키마, strict 재검사, D8 스모크 1회 |
| 예산 키 월 리셋 | 확정·중 | 누적 키(0.2절) |
| 생명 과장·민감정보 | 중·고 | 구문 금지어, 전량 합성, 업로드 경고, 이미지 비저장, 119 3필드, 의료기기 비해당 문서 |
| 강한 태풍 분포의 시각→경과시간 대응 가정 | 고·중 | calibrated 표지, 헤드라인 금지 |
| 결과가 자명하거나 FRAGILE뿐 | 중·중대 | 관문 2 대체 헤드라인을 미리 작성, 사전등록 대조로 정직성을 점수화 |

### 13.2 범위 밖 (Won't)

- 실제 환자·가구 데이터, 실제 라벨 사진 수집, GPS·실시간 위치, 지도 타일
- 실제 기기 방전 시험
- 한전 OMS·AMI, 119, SMS 실연동, 서버 DB 영속화, 로그인·다중 사용자
- 3D, LLM 페르소나, 군중 시뮬레이션, LED·LCD
- 자유문·음성 신고 파싱, 복구시간 ML 예측기
- MILP·최적화기(Kuhn 상한만 Could), 다중 경유 경로, 브리지 배정(부분 에너지), 자원 재출동·충전 순환 최적화
- 석션기·기침유발기 자동 계산(수동검토로만 표시)
- 순위나 결과에 진단명·장애등급 사용
- 임상 조언(수동식 소생기 전환 시점 등)
- 생명·사망·구조 성과 주장, 절대 피해 수치, KPI '달성' 표기
- 공개 URL에서 C2·C3 실호출(`/judge` 재실행 포함)

---

## 레드팀 반영 기록 (라운드 1)

- 일시: 2026-10-17. 지적 25건(치명 5, 중대 20). 반영 24건, 부분 반영 1건, 기각 0건.
- 중복 지적 2쌍은 하나로 합쳐 반영했다: #11·#24(업로드 경고문), #9·#17(무승부를 우세로 읽히게 하는 문제).
- 이 반영으로 생긴 사용자 확인 사항은 0.1절 Q4(기한), Q9(사람 검수 시간), Q10(심사 종료일)에 넣었다.

| # | 심각도 | 지적 요지 | 처리 | 반영 위치 |
|---|---|---|---|---|
| 1 | 치명 | 가구 체크 하나로 외장·실린더 하한이 올라가고, L_cap도 같은 이용자 입력을 써서 I2가 동어반복 | 반영. 가구는 보유 신고만 하고, 확인은 운영자 `VERIFY_EXT`·`VERIFY_CYL`(ext_db 정확 일치 + forSpecIds, 사유 필수)로만 생긴다. L_cap은 사양 상한 × 0.9 + 운영자 확인 항목으로만 계산한다. I2를 'L(이용자 입력) ≤ L(사양 + 운영자 확인, c=1, f_age=0.9)'로 다시 쓰고 무작위 입력 10,000회를 추가했다. 이용자 입력 setting이면 min(runtimeH)를 쓰고, 기기 화면 충전도 ×0.9를 적용한다(예시 1.89h → 1.701h) | 1.4, 1.6, 2, 3.2, 9 |
| 2 | 치명 | 짧거나 불확실한 하한 가구가 PROPOSE에서 구조적으로 빠지고 남은 자원으로만 처리됨 | 반영. 5단계에서 도착 불가 가구를 U에서 빼지 않고 같은 least-slack 루프에서 ① 119 ② GAP_REDUCE(Δ ≥ Δ_min 1h) ③ 6단계 순으로 처리한다. 이전 판은 `RULE_FEASIBLE_FIRST` 절제 기준선으로 E2에 넣었다. 등급·충전출처별 누락률 감사 표, A/B·끝 카드의 M1+M2 병기, K-DEG 기준 변경(등급별 PROPOSE·GAP 비율 > 0)을 넣었다. `/ops` 표 기본 정렬도 처리 순서로 바꿨다 | 1.4, 4.1, 4.2, 7.6, 9, 11.2 |
| 3 | 치명 | '손작성 오라클·손계산'은 실제로 Claude 서브에이전트 작성이므로 출처를 거짓으로 적게 됨 | 반영. 용어를 「Claude Opus 서브에이전트 작성 · 사람 검수 오라클」, 「명세 기반 독립 계산(에이전트 작성)」으로 바꿨다. 사람 검수(보류 4건 조항 단위, 독립 계산 5건 검산)를 넣었다. 사람 재작성이 없으면 '천장' 대신 '모델 간 일치(같은 계열)'로 표기하고 85% 관문을 어휘 수정 근거로 쓰지 않는다. `/ledger` C2 고정 한계 문구를 넣었다. 파일 경로 `spec/hand_calc/`는 바꾸지 않았다(이름만으로 주장하지 않으므로 유지) | 0.1 Q9, 6.2, 6.3, 7.3, 7.6, 8, 13.1 |
| 4 | 중대 | L·R·A의 시간 기준점이 달라 정전 진행 중 slack이 줄지 않고 HOLD가 고착 | 반영. 3.9절을 새로 두어 모든 양을 절대 모의 시각으로 정의했다(L_end, 조건부 분위 R_q_end, A_end). slack·margin·필요성 판정을 남은 시간으로 평가한다. HOLD 재확인 시한과 자동 해제(`HOLD_EXPIRED`)를 넣고, 경과시간 퍼즈 사례를 추가했다 | 1.4, 2, 3.5, 3.7, 3.8, 3.9, 4.1, 8, 9 |
| 5 | 중대 | DB 밖 기종의 수동검토 재진입 L 출처가 없고(진실 누출 위험), UI에 완료 조작이 없으며, RUNTIME_SHARE가 I4와 충돌 | 반영. 「수동검토 완료」(DB 기종 선택 또는 사람 입력 보수 하한, prov `operator`)를 넣고, 완료 전 PROPOSE_ASSIGN을 막았다. 시뮬레이션 재진입은 DB 기종이면 사양 L, DB 밖이면 0h(assumed)다. L_true 사용은 ESLint와 속성 시험으로 막는다. RUNTIME_SHARE는 DB 기종의 라벨 미확인·충전 모름만 해제한다 | 1.4, 2, 3.2, 4.1, 6.1, 9 |
| 6 | 중대 | 승인만 하면 모든 레인이 119로 전달되고, 안전시간에 기준 시각이 없음 | 반영. `/ops/119`는 APPROVED ∧ FALLBACK_119(수정으로 바꾼 경우 포함)만 싣는다. 세 번째 필드를 절대 시각 `expectedSafeUntil`(ISO 문자열)로 바꾸고 strict 3키는 유지했다. E2E에 'PROPOSE_ASSIGN 승인 행은 119 화면에 없음'을 넣었다. 지적문의 '키 이름 유지'와 'expectedSafeUntil' 중 후자를 택했다(값의 뜻이 바뀌므로 키 이름도 바꾸는 편이 타입 오용을 막는다) | 1.4, 1.5, 2, 9 |
| 7 | 중대 | `/judge`의 '버튼 하나로 승인까지'가 승인 우회 경로 | 반영. 버튼은 승인 서랍을 열고 포커스만 준다. 녹화용은 「기록된 승인 재생(시연)」으로만 하고 APPROVED로 바꾸지 않는다. E2E 'APPROVED 0'을 넣었다 | 9, 12.4 |
| 8 | 중대 | 최종목표 문구(하한 − min(복구, 도착))와 실제 순서 키(slack)가 다르고, '원안 규칙' 표기와 A/B 문구가 부정확 | 반영. 최종목표 문구 교체, `/ops`에 slack 열과 근거 문장 반영, 「원안 판단식 구현 규칙」으로 개칭, A/B 문구를 M1에 맞췄다 | 1.4, 3.7, 4.1, 12.1 |
| 9 | 중대 | 기대효과 문장이 ROBUST를 '어떤 가정에서도'로 과장하고, 끝 카드에 '모의' 한정어가 없으며 무승부를 우세로 읽게 함 | 반영(#17과 합침). 셋째 문장을 「시험한 가정 범위의 추첨 90% 이상(95% 신뢰하한)… (모의정전)」으로 고치고, 기대효과 원문을 12.3절로 옮겨 '9.3절' 교차참조를 지웠다. 끝 카드는 우세·차이 없음·열등 칸 비율을 따로 싣는다. lint-claims에 한정어 규칙과 금지 구문(「끊겼」「살렸」「골든타임을 지키/확보」「막았」)을 넣었다. 대체안은 봉인 시험셋 실측이라 「봉인 시험셋」 한정어도 허용했다 | 9, 11.2 D7, 12.1, 12.3 |
| 10 | 중대 | 영상 첫 10초의 '절차가 없습니다' 단정, 'AI는 읽기만' 서술이 C2·C3와 충돌 | 반영. 「공개된 문서에서 찾지 못했습니다」 + '공개 문서 기준' 각주, 「이 화면에서 AI는…」으로 범위를 한정했다. 같은 이유로 1:45 내레이션도 「시험한 가정 범위 안에서」로 고쳤다(#22 연관) | 12.2 |
| 11 | 중대 | 업로드 경고문이 제3자 보관을 부정하고 국외 이전을 빠뜨림 | 반영(#24와 합침). 경고문 교체, 공개 배포 기본값 샘플, 업로드 체크 2개, sensitive-info.md 국외 이전 항목 | 1.6 |
| 12 | 중대 | AI 기술명·기술요약이 결정론 판단·배정의 주어를 AI로 둠 | 반영. AI 기술명을 「라벨 판독·절차 문서 규칙화 AI + 비AI 배정 규칙: …」으로, 기술요약 3줄째를 규칙 엔진 주어 + '가정 복구 범위'로 바꿨다. 3줄 전체를 명세에 옮겨 적었다 | 12.1 |
| 13 | 중대 | C3 pass@5가 보류 데이터에서 5개 중 최고를 골라 부풀려지고, 비용 관문에 AI 자기보고 비용이 쓰일 수 있음 | 반영. 후보 선택은 개발 시드에서 끝내고 보류 시드에서는 선택된 1개만 비교한다. pass@5는 무작위 5개 pass@5와 나란히, Bonferroni(α/5)로만 보조 보고한다. 비용은 코드 계산으로 판정하고 costItems와 10% 넘게 다르면 무효다 | 7.4 |
| 14 | 치명 | 공개 C1 비용 방어가 뚫림(샘플도 실호출, 기기 토큰 우회, 소진 시 503으로 화면 사망) | 반영. 샘플은 봉인 측정 출력 재생(D11 전에는 개발 기록 재생), 업로드만 실호출, 전역 일일 상한, IP 시간당 10회 + Firewall·BotID, 소진 시 재생 모드, 풀 = 잔여 일수 × 일일 상한. 심사 종료일은 Q10으로 사용자 확인을 받는다 | 0.1 Q10, 1.2, 1.6, 7.2, 7.5, 9, 13.1 |
| 15 | 치명 | Must가 13일 안에 끝나지 않고, 절단 순서가 Must를 하나도 자르지 않으며, 동결 시 제출물이 정의되지 않음 | 반영. 11.4절 '동결 시점별 제출물' 표와 「측정 전」 자동 대체 D6 시험, Must 2단 절단(C2 7+3, E1 1,000추첨, E2 9칸), D8 작업을 D5부터 병렬화, DEVLOG '남은 시간 대비 잔여 Must' 필수 항목을 넣었다 | 11.1, 11.2, 11.3, 11.4 |
| 16 | 중대 | 세 AI 지점이 모두 Q4(키)에 묶였는데 기한·대체 경로가 없음 | 반영. Q4 기한을 D3 종료로 명시하고 D1 요청을 일정에 넣었다. '키 지연 재배치 표'를 추가했다. 실제 요청 메시지는 이 명세가 아니라 메인 세션이 사용자에게 보내야 한다 | 0.1 Q4, 11.2 |
| 17 | 중대 | E2 칸 통과 '(승+무) ≥95%'가 무승부를 승리로 세어 검정력이 없음 | 반영(#9와 합침). 비열등(패배율 ≤5%)과 우세(승률 > 패배율 ∧ M2 짝 차이 CI 상한 < 0)를 나누고, 헤드라인은 우세만 쓴다. 관문 2를 '우세 칸 ≥ N(S4 봉인)'으로 바꾸고, M1·M2 공동 주 지표를 S4에 넣었다 | 3.8, 5.4, 5.5, 11.2 D7, 12.3 |
| 18 | 중대 | exp·Box–Muller·부동소수 합 때문에 TS·Python·Safari 사이 비트 일치가 깨질 수 있음 | 반영. 초월함수 값을 materialize에 정수로 저장하고 Python은 읽기만 한다. M2는 정수 초 합이다. sim·engine·alloc에서 초월함수를 ESLint로 금지하고 역정규 CDF·로그정규·로그균등을 정수 표(4,096점, S1 봉인) + 정수 보간으로 만든다. Playwright WebKit 프로젝트도 추가했고, 그래도 불일치하면 '해시 비교 불가'를 표시한다 | 3.1, 3.5, 5.1, 8, 9, 12.4 |
| 19 | 중대 | 보류 문서를 '1차·최종' 두 번 재면 보류셋이 개발셋이 됨 | 반영. 프롬프트 sha256 커밋 후 단 한 번(3회 실행) 측정하고, 재측정 시 두 수치를 싣되 헤드라인은 첫 측정값으로 고정한다 | 7.3, 11.2 D9 |
| 20 | 중대 | 로컬 스크립트가 MemoryStore로 떨어지면 누적 상한이 강제되지 않고, 재호출 비용이 추정에서 빠짐 | 반영. 스크립트는 Upstash env 없으면 즉시 종료, `out/spend.jsonl` 이중 기록과 $0.10 대조, 예산 '×1.3' 재계산(합계 34.4), D5 실측으로 갱신, 콘솔 429 즉시 종료 규칙 | 7.1, 7.5, 9, 11.2 D5 |
| 21 | 중대 | 형제 callStructured가 텍스트만 받아 C1이 동작하지 않고, 업로드 처리 명세가 없음 | 반영. `CallInput.images` 추가와 단위 테스트, 클라이언트 축소(1568px, q85, ≤1.5MB), 서버 zod·매직바이트 검사, `maxDuration = 30`, D5 '입력 토큰 ≤3k' 기준 | 7.1, 7.2, 9, 11.2 D5 |
| 22 | 중대 | Wilson CI가 추첨 오차만 재는데 가정 견고성처럼 읽히고, CONDITIONAL 경계가 정의되지 않는 경우가 있음 | 반영. CI 툴팁 문구 고정, ROBUST 칸마다 축별 1차원 반증을 코드가 생성, 경계 없음·ROTATING 제외 규칙, 안정성 시험을 로그정규 교체로 바꾸고 로그정규 민감도를 Must로 올렸다(절단 순서 2번에서도 뺐다) | 3.4, 5.4, 11.2 D7, 11.3, 12.2 |
| 23 | 중대 | 판정 임계값 다수가 '제안값'으로 남아 결과를 본 뒤 조정 가능 | 반영. 모든 관문 임계값·배정기 상수·강등 기준을 `prereg/sweep.json`의 `thresholds`로 S4에 봉인하고, 봉인 뒤 변경은 CHANGELOG + 전후 결과 병기를 의무로 했다. predictions.md 머리에 예비 몬테카를로를 본 뒤 작성했음을 적는다 | 4.1, 5.5, 9, 11.2 |
| 24 | 중대 | 「저장되지 않습니다」 고지가 사실과 다를 수 있음 | 반영(#11과 합침). 「제공자 정책에 따라 일정 기간 보관될 수 있습니다(링크)」 문구, 보관 기간은 구현 시점 Anthropic 정책 문서를 확인해 sensitive-info.md에 출처와 함께 기록, lint-claims에 「저장되지 않습니다」 금지 구문 추가. 보관 기간 수치는 이 명세에 적지 않았다(확인 전 수치를 쓰면 같은 오류를 반복하므로) | 1.6, 9 |
| 25 | 중대 | S2 봉인 순서 모순(표준 50이 D3 산출물인데 D2 S2에 포함) | 반영. S2a(D2: 오라클 + 독립 계산 20)와 S2b(D3 오전, 배정기 커밋 전: standard50 + 퍼즈 규칙)로 나누고, `check-seal-order.mjs`로 git log 순서를 검사해 `/judge`에 따로 표시한다 | 5.6, 8, 11.2 D2·D3, 12.4 |

**부분 반영 1건의 내용(#3).** 파일 경로 `spec/hand_calc/`는 이미 다른 절과 도구에서 쓰는 이름이라 바꾸지 않았다. 화면·장부·보고서 문구는 모두 바꿨다.

**이번 반영으로 새로 생긴 위험(다음 라운드 공격 대상)**
- 4.1절 5단계의 Δ 식 `min(R80_end, A_end + run_j) − max(A_end, L_end)`와 Δ_min 1h는 assumed다. E2에서 `RULE_FEASIBLE_FIRST`보다 나쁘게 나오면 그대로 공개한다.
- 7.5절 ×1.3 최악 합계 $34.4가 중단선 $35에 가깝다.
- 3.9절 조건부 분위는 정전 경과가 모형 상한(72h)을 넘는 경우 '가정 범위 초과 경과'로만 표시한다.

---

## 레드팀 반영 기록 (라운드 2)

- 일시: 2026-10-17. 지적 22건(치명 2, 중대 20). 반영 19건, 부분 반영 3건(#7, #11, #12), 기각 0건.
- 사실 확인: #16·#17·#13의 형제 코드 관련 주장은 형제 저장소 코드로 확인했다(`health/route.ts`의 60초 캐시·`HEALTH_DEEP_TOKEN`·운영 403, `ratelimit.ts`의 `rl:dev:`·`rl:ip:` 키에 접두사·TTL 없음, `budget.ts`의 `CLAUDE_INFERENCE_GEO=us` ×1.1). #11의 '커밋 0개'는 `git log`로 확인했다. #10·#12의 API 동작(재귀 스키마·길이 제약 미지원, thinking 생략 시 adaptive)은 이 반영에서 직접 검증하지 못했다. 그래서 D8 wire 스키마 스모크와 D5 첫 20회 usage 기록으로 확인하도록 일정에 넣었다.
- 이 반영으로 생긴 사용자 확인 사항: Q4 보강(콘솔 상한 월 리셋), Q7 기본안 변경(새 Upstash DB), Q9 범위 확대(KR-01~12, P1~P8 매개변수), Q11 신설(Must 시간 초과분).

| # | 심각도 | 지적 요지 | 처리 | 반영 위치 |
|---|---|---|---|---|
| 1 | 중대 | 기본 상태(ASSUMED_RANGE)에서 R이 처리 순서에 들어가지 않아 'L·A 두 키 정렬'로 읽힘 | 반영. 순서 키를 `(tier, slack)` 2단으로 바꿨다. tier 0 = `qT(L_end) < qT(R90_end)`, tier 1 = 그 밖. tier 1도 U에 남아 배정되므로 '기본값은 배정' 원칙은 유지된다. 이전 판은 `RULE_NO_R` 절제 기준선으로 E2에 넣었다. I1에 'ASSUMED_RANGE에서 R 분위만 바꿔도 순서가 바뀌는 사례 존재'를 추가하고, S4 `thresholds`·`/ops` 열·근거 템플릿·최종목표 문구를 고쳤다 | 1.4, 2, 3.9, 4.1, 4.2, 5.4, 5.5, 9, 12.1 |
| 2 | 중대 | 재신고로 이용자 입력이 L_end를 늘릴 수 있고, VERIFY_EXT 개수가 신고 개수를 넘을 수 있음 | 반영. 재신고 규칙 `L_end = min(lEndPrev, tReport_new + L_new)`, 예외는 운영자 기록 `POWER_SUPPLIED`(새 AuditEntry 종류) 뒤의 첫 신고뿐이다. I2에 재신고 시퀀스 10,000회 단조 비증가를 넣었다. `VERIFY_EXT`는 `count ≤ declaredCount`, `VERIFY_CYL`은 `declared === true`를 zod로 검사한다 | 1.4, 2, 3.9, 9 |
| 3 | 중대 | 패치 Action(PREPOSITION_POWER, RECHARGE_LOOP, RUNTIME_SHARE)이 하한 불변식 I2·I3을 우회 | 반영. Action마다 진실 효과와 계획자 효과를 나눴다. PREPOSITION_POWER는 L 가산이 아니라 가구 전용 `ResourceView`(prepH 0, mock)로만 들어가 물리 필터를 거친다. RECHARGE_LOOP는 진실 런타임만 연장하고, 계획자 L은 `POWER_SUPPLIED` 기록 시 `opVerified` 개수로만 바뀐다. RUNTIME_SHARE는 라벨 미확인만 해제하고 c = 0.5를 유지한다. hh 술어 `extCount`를 `verifiedExtCount`로 개명했다. I3을 'P1~P8 적용 상태에서도 L 불변'으로 넓혔다 | 6.1, 9 |
| 4 | 중대 | C3 코드 관문에 원안 충실도 검사가 없어 단일 키 정렬·승인 없는 이송이 '보완안'으로 오름 | 반영. 7.4절에 충실도 관문 4종(PRIORITIZE는 margin_gated만, 기기 등급 대상 규칙 금지, EVAC_AT `afterOperatorApproval: true` 필수, DB 밖 수동검토 해제 금지)을 넣었다. EVAC_AT 스키마에 승인 플래그를 리터럴로 넣었다. P5는 「답변서가 거부한 규칙 · 비교용」으로 표기하고 바탕 (나) 보완안 순위에서 빼 E2 B1 행으로만 보인다 | 5.4, 5.8, 6.1, 6.3, 7.4, 9 |
| 5 | 중대 | 수동검토 가구가 검토 지연 동안 자원을 잃어 구조적으로 뒤로 밀리고, 비연속 기기 재진입이 정의되지 않으며, DB 밖 기종 0h가 기기군별 고정 순위를 만듦 | 반영. 4.1절 2단계에 '검토 예약'을 넣었다(셀 기준 최단 A·가장 넓은 커넥터·최대 출력 자원 1개 + 119 용량 1건, 시한 `mrHoldH` 1h). 3.2절 MANUAL_REVIEW 조건을 고쳐 continuous=false 기기도 `operatorLowerH`로 L을 갖게 했다. 재진입 `operatorLowerH`는 상수 0h 대신 가구별 가정 범위 표본(`operatorLowerRangeH`, assumed, S4 봉인)이다. 누락률 감사 표에 '수동검토 경유' 행, I5에 '비연속 기기 가구가 모두 같은 순번은 아님'을 넣었다 | 1.4, 2, 3.2, 3.3, 4.1, 5.5, 9 |
| 6 | 중대 | KR-07 '소진 시점 119 호출' 고정 때문에 E1 ROBUST가 손익분기의 재진술이 되고, 무배터리 산소발생기를 통계 결과처럼 씀 | 반영. KR-07 호출 시점을 스윕 축 `p_early ∈ [0, 0.8]`(조기 호출 시각 = 정전 시작 + U[0, L_true])로 바꿨다. ROBUST는 `p_early` 끝값 0.8에서도 유지될 때만 붙인다. 무배터리 산소발생기는 E1 표지에서 빼고 「사양상 0시간(물리 사실)」 행으로 따로 싣는다. 기대효과 셋째 문장을 evidence.json의 ROBUST (등급, 원인) 쌍 템플릿으로 바꿨다 | 4.2, 5.3, 5.4, 5.5, 6.2, 12.3 |
| 7 | 중대 | C2 출력이 제품·증거층 어디에도 쓰이지 않아 'AI 워싱' 위험 | 부분 반영. E1c(C2 다수결 DSL로 KR 규칙을 바꿔 끼운 E1 재실행, 56칸 표지 일치율 '하류 행동 동등성')와 `/lab/manuals` 문서별 차이 칸을 넣었다. 다만 11.2절 시간표상 Must에 넣을 여유가 없어 **Should**로 두고, 하지 못하면 AI 기술명에서 '절차 문서 규칙화'를 자동으로 빼고 장부에 「평가용 측정 · 제품 경로 미사용」을 적는다(지적의 대안 경로) | 5.4, 7.3, 7.6, 11.3, 12.1 |
| 8 | 중대 | 헤드라인을 좌우하는 KR·P DSL이 AI 작성인데 사람 검수 범위 밖이고, 장부가 개발 단계 AI 저작을 드러내지 않음 | 반영. Q9에 KR-01~12 검수(S4 전, 약 30분)와 P1~P8 핵심 매개변수 검수(E3 전, 약 20분)를 넣었다. P DSL은 D10에 작성되므로 검수 시점을 'S4 전'이 아니라 'E3 첫 실행 전'으로 정했다. `/ledger`에 '개발 보조 AI' 구획을 두고, 산출물별 사람 검수 여부·범위를 `evidence.json` `humanReview`에서 자동 표시한다 | 0.1 Q9, 6.2, 6.3, 7.6, 11.2 D7·D10, 13.1 |
| 9 | 중대 | 기대효과 [M]이 assumed coverage·failProb로 정해지는 순환 주장이고 출처 키가 모호 | 반영. [M] 출처를 `e3.baseA.topSameCost`(E3 바탕 (가) 같은 비용 최상위 오라클 패치) 하나로 정했다. coverage·failProb를 E3 전용 스윕 축으로 두고 [M]을 P10~P90 구간 [M_lo]~[M_hi]와 「coverage·고장률 가정 범위에서」 한정어로 싣는다. 하한 ≤ 0이면 문장을 뺀다. C3 결과는 [M]에 섞지 않는다 | 5.3, 5.4, 12.1, 12.3 |
| 10 | 치명 | Pred가 `z.lazy` 재귀 스키마라 구조화 출력이 400 또는 변환 실패 | 반영. API용 조건을 DNF(`Trigger = { anyOf: Atom[][] }`)로 평탄화하고, 내부 재귀 Pred 변환은 `dnf.ts`가 한다. 오라클 DSL도 처음부터 DNF로 쓴다. D8 첫 단계에 wire 스키마 Sonnet 스모크 1회를 넣었다. DSL 시험에 'wire 스키마 재귀 0, DNF 왕복 동일'을 넣었다 | 6.1, 9, 10, 11.2 D8, 13.1 |
| 11 | 치명 | Must가 가용 시간을 넘고(약 94h 대 70~77h), 항목별 시간 추정이 없으며, D13에 영상·레드팀이 몰림 | 부분 반영. Must 2단 절단(C2 7+3, E1 1,000추첨, E2 9칸)을 지금 확정 적용했고, WebKit 해시 검증을 Could로, C1 기준선을 Tesseract만 Must로 내렸다. 11.2절에 항목별 시간표를 넣었다. 영상 녹화를 D11·D12로 나눠 당기고, 레드팀 2라운드를 D12 오후로 당겼다. **그러나 시간표상 절단 후에도 약 91h로 14~21h가 남는다**(라운드 2 추가분 +3h 포함). 이 초과분은 명세 안에서 닫히지 않으므로 Q11(추가 절단 후보 5개, −6h)을 신설했고, 그래도 8~15h가 남아 D6 G1 시점 재보고로 넘겼다 | 0.1 Q11, 5.1, 5.4, 7.2, 7.3, 9, 11.1, 11.2, 11.3, 13.1 |
| 12 | 중대 | zod 길이·범위 제약이 API에서 빠져 parse_failed가 잦고, 같은 요청 재전송으로 비용만 2배, C1 thinking 생략 시 adaptive, C2·C3 maxTokens 부족 | 부분 반영. wire·strict 스키마를 나누고 strict 실패는 재호출 없이 무효로 집계, 제약값은 프롬프트에도 적는다. 재시도는 max_tokens일 때 한도 2배로 1회만, parse_failed는 재시도 없음. C1은 thinking `between_tools`, C2·C3 maxTokens 16000. C3는 '5개 한 번에 + 길이 제약 제거 + 코드 관문 무효 집계' 쪽을 택했다(1개씩 5번 호출은 입력 비용이 5배라서). thinking 설정의 실제 동작은 직접 검증하지 못해 D5 첫 호출 전 문서 확인과 사고 토큰 0 기록을 조건으로 남겼다 | 6.1, 7.1, 7.2, 7.3, 7.4, 7.5 |
| 13 | 중대 | dev 풀 부족(×1.3 추정 $19.9 > $16.2), C2 개발 호출 수 불일치, GEO ×1.1 미반영 | 반영. 오프라인 호출을 Batches API로 돌리고 배치 usage 기록 경로(`recordBatchSpend`)를 따로 만든다. 풀을 dev 0.45 / sealed 0.22 / public 0.12 / reserve 0.21로 다시 나눴다. C2 개발 호출 수를 '라운드당 문서 1회 × 최대 3라운드 = 33호출'(절단 확정 21호출)로 명세·예산표에 같게 적었다. `CLAUDE_INFERENCE_GEO`는 설정하지 않는다고 명시했다. 다시 계산한 결과 배치 ×1.3 합계 $25.2, dev 풀 사용 $12.2 / $20.25다. 전부 실시간이면 합계 $35.5로 중단선을 넘으므로 배치 경로를 D9 전까지 만든다 | 7.1, 7.3, 7.4, 7.5, 10, 11.2 D9 |
| 14 | 중대 | spend.jsonl과 Upstash 전체 합을 대조해 public 지출만으로 모든 스크립트가 거짓 경보로 멈춤 | 반영. 대조 범위를 dev·sealed 두 키의 합으로 한정했다. public·judge·스모크 지출은 Upstash 단독 기록, `/api/health`에 따로 표시한다. 단위 테스트에 'public 지출이 있어도 통과' 사례를 넣었다 | 1.2, 7.1, 9 |
| 15 | 중대 | 확인 후 실행 구조라 동시 요청이 상한을 넘고, maxDuration 30초 대 SDK 60초 × 2회로 과금 후 기록 누락 | 반영. INCRBY 선예약 → 초과 시 DECRBY 후 재생 모드 → 호출 뒤 차액 보정(풀 키·일일 키 모두). 실패·시간 초과 시에는 과금 여부를 모르므로 예약분을 남긴다(지적에 없던 보수 규칙). `/api/vision`은 시도 1회·SDK timeout 20초. 동시 20요청 부하 시험 '상한 초과 0'을 9절 보안·운영 통과 기준에 넣었다 | 7.2, 9 |
| 16 | 중대 | 콘솔 지출 상한도 월 리셋되어 11월에 $50이 다시 열림 | 반영. 10/31(늦어도 11/1 오전)에 콘솔 상한을 (50 − 10월 실지출)로 낮추고 매월 1일 다시 맞추는 사용자 작업을 Q4·D14 체크리스트·`/ledger`에 넣었다 | 0.1 Q4, 7.1, 7.6, 11.2 D14, 13.1 |
| 17 | 중대 | Upstash 공유로 출품 간 장애 전파, ratelimit 키 접두사·TTL 없음, `/api/health` 무인증 모델 확인 | 반영. Q7 기본안을 새 무료 Upstash DB로 바꿨다. ratelimit 키를 `pl26:rl:…`로 바꾸고 EXPIRE(시간 키 2h, 일 키 48h)를 단다. `/api/health`는 형제 구현(60초 캐시, deep=1 토큰, 운영 무토큰 403)을 그대로 복사하고 모델 확인은 deep에서만 한다 | 0.1 Q7, 1.2, 7.1, 9, 10, 11.2 D1, 13.1 |
| 18 | 중대 | 전역 일일 상한을 한 사람이 매일 소진하면 심사위원은 재생 모드만 보고, 임의 이미지 전송으로 키 제재 위험 | 반영. 심사용 접근 코드(`JUDGE_ACCESS_CODE`, timingSafeEqual, 보고서·심사 안내에만 기재)와 일일 상한과 별도인 `judge` 풀($3.0, reserve에서 떼어 냄, 코드당 시간 30회)을 넣었다. 공개 업로드는 기존 규칙 유지. Firewall·BotID 요금제 확인을 D1에 넣고, 안 되면 앱 수준 제한이 1차 방어임을 명시했다 | 1.2, 1.6, 7.1, 7.2, 7.5, 9, 11.2 D1·D14, 13.1 |
| 19 | 중대 | E1·E2 시드 범위가 없어 사전등록이 '본 뒤 등록'이 되고, 관문 2의 N과 K-DEG 실패 조건이 없음 | 반영. E1·E1c 전용 시드 2,000,001~2,004,000, E2 전용 3,000,001~3,005,400을 명세에 고정하고, S4 이전 `out/`·git 이력에 이 범위 시드가 0개인지 `check-seal-order.mjs`로 검사한다. N을 9칸 중 3칸(27칸이면 9칸)으로 지금 고정했다. K-DEG 실패 조건을 '필요 가구가 있는 등급 중 PROPOSE+GAP 비율 0인 등급 ≥ 1'로 정하고, 실패 시 S4 전 장부 수정과 전후 결과 병기를 의무로 했다 | 5.4, 5.5, 9, 11.2 D7 |
| 20 | 중대 | TS·Python 정확 일치의 남은 구멍(무한대 직렬화, 곱셈 결합 순서, int() 절삭, sqrt 금지, F(e) 동점) | 반영. 3.1절에 다섯 규칙을 넣었다: 무한대 = ±(2^31−1) 정수 감시값, 결정 경로는 정수 초·정수 mWh·정수 유리수 계수로 '분자 곱 먼저, floor 나눗셈 마지막 한 번'(중간값 < 2^53 단언, 충전량은 정수 %), Python은 `math.floor`·`//`만, `Math.sqrt` 허용, `F(e) = max{u : Q(u) ≤ e}`. 다섯 가지를 경계 퍼즈 사례와 결정성 시험에 넣었다 | 3, 3.1, 9 |
| 21 | 중대 | C2 지표 정의 구멍('기계 판독 가능' 미정의, 3회 모두 다를 때 규칙 없음, 새 조건 탐침 누락, quote 정규화 없음) | 반영. (a) '기계 판독 가능 = 다수결 DSL 컴파일 ∧ 그 문서 비자명 탐침 일치 ≥ 70%'(S5 봉인), (b) 3회 모두 다르면 불일치, (c) 탐침 경계를 오라클과 후보 DSL 조건 원자의 합집합으로(후보 출력 뒤 결정적 생성), (d) quote 검사 전 NFKC + 공백 연속 축약, 정규화 함수를 S5에 봉인 | 6.1, 7.3, 9 |
| 22 | 중대 | 부분 가림 정답을 렌더 JSON으로 두면 '보완' 출력이 정답이 되고, 시험셋이 dev와 같은 템플릿에서 나와 과적합 | 반영. `degrade.py`가 가린 글자 범위를 필드별로 기록하고, 가림 필드 정답을 '보이는 부분 문자열 또는 partial/illegible'로 바꿨다. 가린 글자를 채운 출력은 '보완 위반'으로 따로 센다. 템플릿 8종 중 2종을 시험셋 전용으로 빼 S3에 봉인하고, 시험셋 지표를 전용·공용 템플릿으로 나눠서도 싣는다 | 7.2 |

**부분 반영 3건의 내용.**
- #7: E1c는 지적의 1안이지만 시간표상 Must에 넣지 못해 Should로 두었다. 못 하면 지적의 2안(AI 기술명에서 '절차 문서 규칙화' 제거, 장부에 '평가용 측정' 표기)이 스크립트로 자동 적용되므로, 어느 쪽이든 'C2가 제품을 바꾸지 않는데 기술명에 오르는' 상태는 생기지 않는다.
- #11: 지적이 요구한 조치(2단 절단 확정, WebKit·Haiku 강등, 시간표, 영상 분할 녹화, 레드팀 2라운드 D12)는 모두 넣었다. 다만 그 조치로도 Must가 가용 시간에 들어가지 않는다는 사실이 시간표에서 드러났다. 이 차이를 명세가 임의로 지우지 않고 Q11로 사용자에게 올렸다.
- #12: 처방은 모두 넣었으나, 'thinking 생략 시 adaptive', '`between_tools`로 끈다'는 API 동작은 이 반영 과정에서 공식 문서로 확인하지 못했다. D5 첫 호출 전 확인과 usage 기록을 통과 조건으로 걸었다.

**이번 반영으로 새로 생긴 위험(다음 라운드 공격 대상)**
- tier 경계를 R90으로 둔 것은 팀 선택이다(P80·P50도 가능). `RULE_NO_R` 대비 E2 결과가 나쁘면 그대로 공개한다.
- 검토 예약은 tier 0 가구가 쓸 수 있는 자원을 최대 `mrHoldH` 동안 묶는다. 예약 때문에 공백이 생긴 사례 수를 E2 부산물로 집계해 공개한다.
- `operatorLowerRangeH`(U[0.5, 4]h)와 `p_early` 범위(0~0.8)는 assumed다. 둘 다 S4에 봉인하고 축별 1차원 반증에 들어간다.
- 심사용 접근 코드는 성과보고서에 적히므로, 보고서가 공개되면 코드도 공개된다. 이때도 `judge` 풀 $3.0과 코드당 시간 30회가 상한이다.
- Batches API 경로와 `recordBatchSpend`는 형제 코드에 없는 새 코드다. 배치 결과 지연(최대 24시간)이 D9·D10 일정을 밀 수 있다.
- 11.2절 시간표 기준으로 Must가 여전히 14~21h 초과한다(Q11).

---

## 레드팀 반영 기록 (라운드 3)

- 일시: 2026-10-17. 지적 18건(치명 2, 중대 16). 반영 15건, 부분 반영 3건(#3, #9, #10), 기각 0건.
- 이 반영으로 생긴 사용자 확인 사항: **Q11 잔여 결정**(C2를 Must로 둘지, D1 종료까지. 답이 없으면 기본안 (가) = C2 Should), Q9 성격 변경(사람 검수가 봉인을 막지 않음, D1 요청 메시지에 4건 일정 기재).
- 사실 확인 한계: #12의 형제 `client.ts` 동작(timeout 60_000 고정, 5xx·시간 초과 `continue` 재전송), #13의 UpstashStore 명령 단위 REST 호출, #18의 `x-forwarded-for` 첫 값 사용은 이 반영 과정에서 형제 코드를 다시 열어 확인하지 않았다. 지적 내용을 전제로 처방을 넣었고, D1 형제 코드 복사 때 실제 코드와 대조해 다르면 `docs/DEVLOG.md`에 기록한다. `@vercel/functions`의 `ipAddress`, Upstash `EVAL`, SDK `messages.stream().finalMessage()`의 현재 버전 동작도 구현 시점에 문서로 확인한다.

| # | 심각도 | 지적 요지 | 처리 | 반영 위치 |
|---|---|---|---|---|
| 1 | 중대 | 운영자가 외장 모델·개수만 확인해도 완충으로 계산(c 없음), f_age를 본체에서 빌려 씀, L_cap도 같은 항이라 I2가 못 잡음, VERIFY_CYL hoursLo 상한 없음 | 반영. `L_ext = Σ count × runtimeH × f_age_ext × c_ext`. c_ext는 기본 1/2(+`EXT_CHARGE_UNKNOWN`), VERIFY_EXT payload `chargeConfirmed: "device_screen"`일 때만 9/10. f_age_ext는 `extAgeY` 확인 시에만 구간표, 없으면 7/10. L_cap 외장 항에도 c_ext를 곱했다. VERIFY_CYL에 `count`를 추가하고 zod로 `hoursLo ≤ 10h × count`를 강제했다. I2·I3 속성 시험에 'ext 충전 미확인 → c_ext 1/2'과 hoursLo 상한 사례를 넣었다 | 1.4, 2, 3.2, 9 |
| 2 | 중대 | 「입력은 하한을 낮출 수만 있습니다」가 명세 자신의 식(충전 모름→100%면 1.8배, 연식 입력으로 f_age 상승)과 모순, batteryAgeY 입력 주체 미정 | 반영. 화면 문구를 「입력해도 하한은 제조사 사양의 90%(+운영자 확인분)를 넘지 못합니다 · 충전량 입력은 현재 상태 갱신용」으로, 3.2절 문장을 'L_cap을 넘기지 못한다'로 고쳤다. batteryAgeY는 운영자 「연식 확인」(`VERIFY_AGE`, prov operator)으로만 채우고, 이용자 입력 연식은 null(7/10) + `USER_AGE_IGNORED`. `/household`에 연식 칸을 두지 않는다. E2E에 '문구 = 실제 동작'(모름→100%: L 상승 ∧ L ≤ L_cap) 사례를 넣었다 | 1.4, 1.6, 2, 3.2, 9 |
| 3 | 중대 | C1 매칭이 confidence=low도 받고 가구 확인만으로 `db_exact`가 되어, 자신 있는 오독이 더 긴 기종의 가동시간을 하한에 넣음 | 부분 반영. 매칭 조건에 `confidence=high`를 추가했다. `specBy = "ai_label_user_confirmed"`를 새로 두고, 운영자 「기종 확인」(`VERIFY_MODEL`) 전까지 판독 키와 편집거리 ≤2인 DB 이웃 기종 중 runtimeH 최소값으로 L을 계산한다(+`MODEL_AI_UNCONFIRMED`, 분해식·근거 문장 표시). I2 속성 시험(미끼 쌍)과 누락률 감사 표(기종 확인 상태 행)에 넣었다. 부분인 이유는 아래에 적었다 | 1.4, 1.6, 2, 3.2, 7.2, 9 |
| 4 | 중대 | 승인 행이 재계산에서 완전히 빠져, 재신고·자원 불가·시간 경과로 실현 불가능해져도 '처리됨'으로 보임 | 반영. 승인 배정은 자동으로 바꾸지 않되 매 재계산마다 feasible·도착 조건을 다시 평가해, 위반 시 「재검토 필요」 배지 + `AuditEntry(system, RECHECK_FLAG)` + 대안 1건을 새 `PROPOSED`로 승인 서랍에 올린다(승인 필요). I6 속성 시험(승인 뒤 L 감소 → 플래그)과 E2E 1건을 넣었다 | 1.4, 2, 9 |
| 5 | 중대 | 석션기·COUGH_E70은 늘 MANUAL_REVIEW라 무제한 검토 예약이 기기군 이름 기반 고정 선점권이 됨(I5 위반), 자원 적은 칸에서 tier 0 가구가 최대 1h 자원을 잃음 | 반영. ① 예약 총수 ≤ `floor(가용 자원 × mrReserveCap 0.2)`(119 슬롯도 같은 비율, S4 봉인) ② tier 0 ∧ slack < mrHoldH 가구의 유일한 phys 자원은 예약 제외 ③ 물리 예약 대신 '대기열 최상단 + 검토 시한' 표시만 하는 `RULE_NO_RESERVE`를 E2 절제로 추가. 누락률 감사 표에 검토 예약률 열, I5 속성 시험에 상한·제외 규칙을 넣었다 | 1.4, 4.1, 4.2, 5.4, 5.5, 9 |
| 6 | 중대 | 랜딩·영상의 수원형 프리셋 A/B 카운터가 봉인 없이 체리피킹 가능, 영상 콘티 '실측' 표기, WorldTruth import 금지와 카운터 채점 경로 충돌 | 반영. 프리셋 JSON(시드 포함, Q11⑤로 3개)을 S2b에 넣어 배정기 첫 커밋 전에 봉인하고 `check-seal-order.mjs`가 sha256과 순서를 검사한다. 카운터는 `scripts/presets-ab.ts`가 만든 `out/presets_ab.json`을 `evidence.json` 경유로만 읽는다(ESLint 규칙 유지). 툴팁을 「결과 보기 전 봉인된 프리셋 · … · 전체 9칸 승/무/패는 /lab」으로 고정, 영상 '실측' → '모의', lint-claims에 '모의 결과에 실측 금지'를 넣었다 | 1.4, 2, 5.7, 8, 9, 10, 12.2 |
| 7 | 중대 | [P1] '단순 규칙보다 적은 조건'이 B1·B2 둘 다인지 하나인지 미정의, 9칸 분모를 %로 써 정밀도 과장 | 반영. [P1] = B1·B2 둘 다에 우세(b)인 칸, [P2] = 하나에라도 열등인 칸, [P0] = 나머지로 정의해 S4에 봉인했다. 기준선별 판정은 `/lab` ③에 따로 싣는다. ClosingCard·기대효과 문장을 「9칸 중 k칸」으로 바꾸고, lint-claims에 '분모 < 20이면 % 금지'를 넣었다 | 5.4, 5.5, 5.8, 9, 12.3 |
| 8 | 중대 | 랜딩 빨간 막대의 「21시간」이 출처 없는 파생값(24−3)이고 '21시간 무전원'이라는 생명 결과로 읽힘 | 반영(1안). 「21시간」을 지우고 막대 라벨을 「목표 상한까지 남는 차이 · 내장배터리만, 외장·이송 없을 때의 단순 비교」로 바꿨다. 막대 길이는 `params.json`의 type inferred 행(`landingGapBarH`)에서 읽는다. lint-claims에 '출처 없는 시간 차 수치' 검사를 넣었다. 2안(「외장 1개 있으면 18시간」 병기)은 첫 10초에 숫자를 하나 더 얹어 읽기 부담을 늘리므로 택하지 않았다 | 1.3, 9, 12.2 |
| 9 | 치명 | 명세가 일정 불가를 스스로 밝히고 D6로 판단을 미룸, 날짜별 계획이 하루 5~6h와 맞지 않음(D3~D4에 21h) | 부분 반영. 지적의 절단 ①~⑥을 모두 D1 확정 적용했다(Q11⑥ 오라클 축소 −4h, ⑦ 초월함수 금지·정수 표 제거 −3h, ⑧ Batches 제거 −1h, ⑨ OTS는 S4·S5만 −1h, ①~⑤ −6h, ⑩ `/judge` → `/ledger#judge`). 항목별 시간표 91h → 76h, 라운드 3의 다른 반영분 +4h로 80h다. 날짜별 표를 항목 시간표에서 다시 도출해 **어느 날도 5h를 넘지 않게** 했고, G1은 재계산 결과 **D9(10/25)**가 되었다. 부분인 이유는 아래에 적었다. 다른 절의 라운드 2 기준 'D숫자'는 11.2절 '이전 D 표기 대응'으로 읽게 했다(전 절 일괄 치환은 하지 않음) | 0.1 Q11, 1.2, 3, 5.7, 7.1, 7.5, 8, 10, 11.1, 11.2, 11.3, 11.4, 13.1 |
| 10 | 치명 | 시뮬레이터 사건 모델 미정의(tReport 분포, 결정 시점, 119 용량 계수 방식, 공유 대기열 규칙, M3 정의)라 TS·Python 100% 일치를 정의할 수 없음 | 부분 반영. 4.3절 '이산 사건 규약'을 새로 두고 S2a 전에 `ENGINE_SPEC.md`로 옮기게 했다(D1 산출물). ① tReport = tOutage + U[0, 0.5]h(BEHAVIOR) ② 결정 시점 = {max tReport, 각 수동검토 가구 재진입 시각, 각 holdRecheckBy}, 각 시점에 미배정 가구만 남은 자원으로 RULE 재실행, 배정된 행 고정 ③ 119 = 서비스 시간 1/k h 대기열, 슬롯 시작 = max(호출, 앞 슬롯 종료), 호출 시각·id 순, 계획자 대기열(자기 호출만)과 진실 대기열(미등록·KR-07 포함) 분리, '용량 남음' = L_end 전 시작 가능 슬롯 ④ M3 = 한 번이라도 HOLD였던 가구 중 G>0. 4.1절 119 조건 3곳을 대기열 기준으로 고쳤고, 경계 퍼즈에 규약 사례를 넣었다. 부분인 이유는 아래에 적었다 | 3.8, 4.1, 4.2, 4.3, 5.2, 8 |
| 11 | 중대 | Batches 경로는 새 코드이고 결과 지연 최대 24h라 D9에 배치 왕복 4번이 들어가지 않음. 절단 확정 규모 실시간으로도 약 $30 | 반영. Batches를 Must에서 빼고 오프라인 스크립트는 실시간 직렬 호출로 고정했다. Batches는 C3에서 시간이 남을 때만 쓰는 Could. 7.5절 표를 절단 확정 규모 × 실시간으로 다시 썼다: 기본 $25.2, ×1.3 $30.3(dev 풀 $16.5 ≤ $20.25, sealed $5.4 ≤ $9.9), 중단선 $35 유지. `batch.ts`를 저장소 구조에서 뺐다 | 7.1, 7.3, 7.4, 7.5, 10, 11.3 |
| 12 | 중대 | 형제 client.ts 그대로면 timeout 60초 고정으로 C2·C3 실시간 호출이 과금 후 기록 누락, 5xx·시간 초과 재전송으로 이중 과금, max_tokens 32000 재시도는 비스트리밍 시간 한도 초과 | 반영. `StageConfig.timeoutMs`(C1 20s, C2·C3 300s), C2·C3는 `messages.stream().finalMessage()` + zod 재검사, 시간 초과는 재시도 0·'과금 불명'(`hold`) 기록·예약 유지, 5xx 재시도는 C1 dev 스크립트만 1회, `/api/vision`·C2·C3는 0회, C2·C3 max_tokens 재시도 상한 24000. 단위 테스트(timeout → 재시도 0, 기록 1행)를 넣었다 | 7.1, 9 |
| 13 | 중대 | 풀 키·일일 키 INCRBY 2회가 비원자적, 시간 초과 시 예약 유지분이 spend.jsonl에 없어 $0.10 대조가 거짓 불일치로 멈춤, 스크립트 예약 사용 여부 모호 | 반영. 예약·정산을 Upstash `EVAL` Lua 1회로 처리한다(두 키 GET → 둘 다 상한 이내면 INCRBY 둘, 아니면 0). 스크립트도 같은 함수를 반드시 쓴다. `spend.jsonl`에 reserve/settle/hold 세 종류 행을 적고 대조식을 Σreserve − Σrelease = Upstash(dev+sealed)로 바꿨다. 단위 테스트(시간 초과 1건 뒤 대조 통과, 동시 20요청 상한 초과 0)를 넣었다 | 7.1, 7.2, 9 |
| 14 | 중대 | 봉인 임계 경로에 사용자 수작업 4번(D2·D7·D8·D10)이 끼어 병행 출품 중 하루만 늦어도 배정기 착수가 막힘 | 반영. 사람 검수를 '봉인 전 필수'에서 '봉인 후 검수 가능'으로 바꿨다. 봉인은 에이전트 산출물로 예정일에 하고, 검수 결과·수정은 `seal/CHANGELOG.md`에 수정 전후 결과와 함께 싣는다(5.5절 규칙 재사용). 예정일까지 검수가 없으면 `/ledger`에 「사람 검수 없음」이 자동 표시된다. D1 요청 메시지에 4개 검수의 날짜·소요 시간을 한 줄씩 넣게 했다 | 0.1 Q9, 6.2, 6.3, 7.3, 8, 11.2 |
| 15 | 중대 | WebKit이 Could라 Node·Chromium(같은 V8)만 비교하므로 초월함수 금지·4,096점 정수 표·no-magic-numbers는 불필요한 비용, 정수 표는 ±3.4σ 꼬리 절단 | 반영. sim materialize에서 `Math.exp`·`log`·`cos`를 허용하고 결과를 qT·qE 정수로 저장하는 규칙만 유지했다. engine·alloc 결정 경로에서만 정수 규칙을 유지하고, CONFIRMED 범위 exp(±1.2816σ)는 UI 엔진에서 `Math.exp` 직후 qT로 바꾼다. `no-magic-numbers`를 빼고 9절 장부 층 시험으로 대체했다. 정수 표는 WebKit을 Must로 올릴 때만 도입한다(Could) | 3, 3.1, 3.5, 5.1, 9, 11.3 |
| 16 | 중대 | 관문 3·헤드라인은 'Sonnet 2회 중 더 나쁜 회차'인데 Q11②는 1회 → 결과를 보고 고를 수 있음, 예산표도 모호 | 반영. 권고안대로 C1 봉인 측정은 1회, 헤드라인 = 그 회차로 정하고 S3 매니페스트에 회차 수·헤드라인 규칙을 함께 봉인한다. 회차 간 불일치율은 dev 40장 2회에서만 낸다. 7.2절 지표·관문 3 문장과 7.5절 표(C1 봉인 120 × 1회 $1.2)를 같은 값으로 고쳤다 | 7.2, 7.5, 11.2 |
| 17 | 중대 | 관문 통과 기준 누락·측정 불가(K-PATCH 임계값, 안정성 실패 조건, '승인 우회 0' 입증, LCP 스로틀 없음, 표준 θ, Worker N=500 정의, G1 판독 합격 문장) | 반영. ① K-PATCH: 보류 시드 주 지표가 무작위 기준선 비율보다 높지 않거나 20% 미만이면 강등(S4 봉인) ② 안정성: 실행 완료 + 뒤집힌 칸 공개면 통과, ROBUST 전부 뒤집히면 관문 2 실패 ③ `status = "APPROVED"` 대입이 `ApproveDrawer` 핸들러 1곳에만 있는지 ESLint `no-restricted-syntax` + grep 시험 ④ LCP는 Lighthouse CI 모바일 프리셋(simulated throttling) 3회 중앙값 ⑤ 표준 θ = 각 축 범위 중앙값(로그균등은 기하평균), `params.json` `standardTheta` ⑥ Worker 기준 = 기본 θ, 시드 1~500, 원인 순환, 해시를 `evidence.json`에 저장 ⑦ G1 합격 = 스크린숏만 보고 red-judge가 '배터리 하한 대 복구 시간 비교'를 한 문장으로 말함 | 1.3, 5.1, 5.4, 5.5, 7.4, 9, 11.2 |
| 18 | 중대 | `x-forwarded-for` 첫 값 IP 키는 IPv6 /64로 우회, 접근 코드가 보고서로 퍼지면 judge 풀이 약 10시간에 소진, 틀린 코드 시도 제한 없음 | 반영. (a) IP는 `@vercel/functions` `ipAddress(req)`, IPv6는 /64 접두사로 키 생성, Firewall을 쓸 수 있으면 `/api/vision`에 IP 1분 3회 (b) judge 일일 상한 키 `pl26:budget:judge:day:<KST>`($0.40), `JUDGE_ACCESS_CODE` 쉼표 다중 값으로 재배포 없는 교체(교체 절차를 D14 체크리스트에 기재) (c) 코드 22자 이상 무작위, 틀린 코드 IP(/64)당 시간 5회 초과 시 1시간 차단. E2E·보안 시험에 사례를 넣었다 | 7.1, 7.2, 7.5, 7.6, 9, 11.2 D14, 13.1 |

**부분 반영 3건의 내용.**
- #3: 처방(confidence=high, `ai_label_user_confirmed`, VERIFY_MODEL, 이웃 기종 최소값, 속성 시험·감사 표)은 모두 넣었다. 7.2절 '무플래그 오매칭 ≤ 2/120' 지표는 판독 단계 측정이라 정의를 바꾸지 않았다. 대신 오매칭이 L 과대로 이어지는 경로를 막았다.
- #9: 지적이 요구한 절단 ①~⑥과 날짜별 표 재도출(하루 5h 상한)은 모두 했다. 그러나 재도출해 보니 C2까지 Must로 두면 70h 안에 들어가지 않았다. 남는 결정(C2 강등 또는 10/31 오전 사용)은 출품의 AI 지점 수를 바꾸는 방향 결정이다. 그래서 명세가 혼자 정하지 않고 Q11 잔여 결정으로 D1에 올렸다. 답이 없으면 기본안 (가)로 진행하며, 그 경우에도 C2는 Should로 남아 시간이 나면 한다.
- #10: 규약 4개는 모두 넣었으나 두 군데를 지적 원문과 다르게 정했다. (a) 수동검토 재진입 시각을 `tOutage + mrDelayH`가 아니라 `tReport + mrDelayH`로 정했다. 검토는 신고 뒤에만 시작되므로, tOutage 기준이면 신고 전에 검토가 끝나는 모순이 생긴다. (b) 지적의 '서버 k개'와 '서비스 시간 1/k h, 앞 슬롯 종료'는 서로 다른 모형이다. 그래서 처리량이 같은 단일 대기열(서비스 1/k h)로 정했다.

**이번 반영으로 새로 생긴 위험(다음 라운드 공격 대상)**
- G1이 D6에서 D9로 밀렸다. 제품 면이 늦게 서므로 D9 G1이 실패하면 증거층(항목 8)을 줄일 여유가 이틀(D10~D11)뿐이다.
- 하루 5h 상한은 assumed다. 오늘(D1, 10/17)은 명세 작성과 레드팀 3라운드에 이미 시간을 썼으므로 D1 5h가 실제로 남아 있는지 확인되지 않았다. D1 종료 DEVLOG의 '남은 시간 대비 잔여 Must'로 바로 다시 잰다.
- Q11 기본안 (가)에서 C2가 빠지면 Must인 Claude 지점은 C1 하나뿐이다. 12.1절 AI 기술명이 「라벨 판독 AI + 비AI 배정 규칙」으로 자동 전환되어 'AI 구현' 심사항목 점수가 낮아질 수 있다.
- Python 오라클이 기준선·DSL 인터프리터를 다루지 않으므로 E2의 B1·B2 결과는 TS 단독 구현이다. 같은 모듈을 공유하는 단위·속성 시험만으로 확인한다는 한계를 `/ledger`에 적는다.
- S1·S2a·S2b·S3은 OTS 없이 git 커밋 시각만 근거다. 커밋 시각은 작성자가 바꿀 수 있으므로 이 네 봉인의 증명력은 S4·S5보다 약하다.
- `mrReserveCap` 0.2, c_ext 1/2·9/10, `reportDelayH` U[0, 0.5]h는 assumed다. 모두 S4에 봉인하고, 축별 1차원 반증 대상에 넣을지는 S4 전에 정한다.
- 승인 행 재검토(`RECHECK_FLAG`)의 대안 계산은 '나머지 승인 배정 고정'을 전제로 한다. 자원이 모자라면 대안이 `UNSERVED_VISIBLE`로만 나올 수 있다. 이 경우도 숨기지 않고 서랍에 올린다.

## 반영 기록 (라운드 4, Phase 2 화면 점검, 10/17)

| # | 등급 | 지적(화면을 실제로 돌려 보고 메인 세션이 발견) | 반영 | 절 |
|---|---|---|---|---|
| 1 | 중대 | 4.1절 5-1의 「phys(i)가 비면 slack = −∞」 때문에 호환 자원이 없는 가구가 하한과 무관하게 가장 급한 가구로 처리됨. 수원형 프리셋에서 하한 10시간 가구 4곳이 119 첫 슬롯 4개를 먼저 가져가고 하한 1.9~2.3시간 가구는 지연 119를 받음 | 반영. 빈 phys면 119 레인 계획 도착으로 slack을 잰다. TS·Python 오라클 동시 수정, 차등 553/553 유지. 개발 시드 80건에서 M1·M2는 사실상 같음(2037→2035, 6122.5→6120.5h) | 4.1 |
| 2 | 중대 | 루프 안 '제때 119'가 지금 시각으로 슬롯을 잡아, 하한이 긴 가구가 이른 슬롯을 차지하고 6단계로 넘어간 짧은 가구는 슬롯을 못 받음(수원형 H021 1.85h 미배정 vs H002 10h 119) | 반영. 5단계에 ③ '지연 119'를 넣어 처리 순서대로 슬롯을 준다(TS·오라클). 개발 시드 80건 M2 5201→5148h, M1 2029→2033(사실상 같음). 늦출 수 있는 호출을 늦게 예약하는 달력형 대기열은 효과 대비 변경 범위가 커서 하지 않았다 | 4.1 |
| 5 | 중대 | 자원이 고장 나거나 복구 전에 바닥나면 그 가구는 복구까지 수단이 없는 것으로 채점됨(119 재호출 없음). 표준 θ(고장 0.4)에서 도구가 현행(KR)보다 공백 가구·시간이 많게 나오는 인위적 결과 | 반영. 자원이 멈춘 시각에 가구가 119를 부른다(진실 대기열에 들어감). 끝까지 미배정·수동검토인 등록 가구의 KR-07 자가 호출도 기본값으로 둔다. TS·오라클 동시, 차등 553/553. 개발 시드 80건 RULE M2 6121→5201h(KR 6042h) | 3.8, 4.3 |
| 3 | 경미 | 1.5절 「수정에서 '119 연계'로 바꾼 행 포함」과 `project119`(APPROVED만)가 어긋남. 수동검토 중 119 연계 행은 L_end가 없어 빠짐 | 반영. 운영자 결정(APPROVED·MODIFIED)을 싣고, 하한 미계산 행은 세 번째 필드에 「하한 미확인(수동검토 중)」을 보낸다(3필드 유지) | 1.5 |
| 4 | 경미 | 1.3절 품질 예산 '초기 JS gzip 120KB'는 Next 16 App Router 기본 런타임(react-dom 약 70KB + 런타임 약 85KB)만으로 넘는다. 랜딩 자체 코드는 약 5KB | 예산을 '앱 코드 20KB 이하 + LCP 2.0초'로 읽는다. LCP는 Lighthouse로 따로 잰다 | 1.3 |

## 반영 기록 (라운드 5, 헤드라인 방향 결정과 S4 사전등록, 10/17)

사용자가 헤드라인 방향 (가)를 골랐다: 「도구 대 현행 절차 + 손익분기·ROBUST 빈틈」. 개발 시드 예비 실행(E2 5,400건, E1 400추첨)에서 원안 규칙과 단순 규칙(B1·B2)의 차이가 ±2% 안이라, 이전 끝 훅(지배율 [P1])은 관문 2를 넘기 어렵다는 것이 근거다. 아래 항목이 같은 번호 절의 본문보다 우선한다. 모두 S4 봉인 전에 정했다.

| # | 바뀐 것 | 이전 | 라운드 5 | 절 |
|---|---|---|---|---|
| 1 | 헤드라인 비교 | RULE 대 B1·B2 지배율 [P1] | **RULE 대 KR_BASELINE**(현행 공개 절차: 자원 연결 단계 없음, KR-07 119 자가 호출). 칸 판정은 E2 판정식(승 > 패 ∧ M2 짝 차이 평균 95% CI 상한 < 0)을 그대로 쓴다. [P1]·[P0]·[P2]는 계속 계산해 `/lab` ③에 싣고, 끝 훅에는 「단순 규칙과 차이 없음 칸 수」로만 쓴다 | 5.4, 12.3 |
| 2 | 해석의 정직성 | — | KR_BASELINE은 자원을 쓰지 않는다. 그래서 RULE 대 KR 차이는 '자원 + 등록 기기 정보로 호환 자원을 잇는 것' 전체의 효과이고, 순서 규칙의 정교함이 아니다. 이 분해(NONE → KR → B1·B2 → RULE → ORACLE_INFO)를 `/lab` ③ 첫 줄에 싣는다. 끝 카드 문장도 이 해석을 쓴다 | 5.8, 12.3 |
| 3 | E2 규모 | 9칸(σ_e 0.5) | **27칸**(σ_e {0.5, 0, 1.0} × 비율 × 이동, σ_e 0.5 칸이 앞 9칸). 결과를 보기 전, 시나리오 1건 10정책 약 50ms라는 계산 시간 실측만 보고 정했다(5.4절이 허용한 경로). 시드 3,000,001~3,005,400 전부 | 5.4, 11.3 |
| 4 | E2 세부 | 미정 | 칸 밖 θ 축은 표준 θ. 원인은 시드마다 `rngFor(seed, "E2-cause", LHS)`로 7종 균등. 정책: RULE, KR_BASELINE, B1, B2, ORACLE_INFO, NONE, R_L, RULE_NO_R, RULE_FEASIBLE_FIRST, RULE_NO_RESERVE. 부트스트랩은 **M2 짝 차이 평균**의 백분위 CI(2,000회, 새 난수 스트림 BOOT=10). 상대 감소율 = 1 − ΣM2(RULE)/ΣM2(비교)와 같은 재표본의 CI | 5.1, 5.4 |
| 5 | E1 규모 | 1,000추첨 | **4,000추첨**(원래 설계로 복원, 시드 2,000,001~2,004,000 전부. 계산 시간 실측 시나리오당 약 21ms). LHS master `E1`. 축별 1차원 반증은 **앞 500추첨**에서 38개 끝값 변형(19축 × lo·hi)을 같은 시나리오 id·시드로(공통 난수) 돌린다. p_early 끝값 0.8 변형의 Wilson 하한 < 0.9면 ROBUST를 CONDITIONAL로 내린다 | 5.4 |
| 6 | E1 보조 표지 | KR_BASELINE만 | 같은 시나리오에서 **RULE 표지도** 낸다(「도구를 써도 남는 빈틈」). 헤드라인 표지 정책은 KR_BASELINE 그대로. 등급 지표는 등록 가구만(층화 대상) | 5.4 |
| 7 | 관문 2 | ROBUST ≥1 ∧ [P1] ≥ 9칸 중 3칸 | **(a) KR 표지 ROBUST가 무배터리 산소(O2_STAT) 밖에 1개 이상 ∧ (b) RULE이 KR_BASELINE보다 우세인 칸이 27칸 중 18칸 이상.** 실패하면 12.3절 대체안 | 5.5, 11.2 |
| 8 | 끝 카드·기대효과 문장 | 지배율 문장 | 아래 '라운드 5 끝 카드' | 12.1, 12.3 |
| 9 | 사전등록 예측 | 전략 보고서 5.3절 7개 | 그 7개를 칸 판정 규칙으로 옮겨 그대로 봉인(예비 실행 전 예측)하고, 예비 실행을 본 뒤의 예측을 따로 절로 나눠 싣는다(`prereg/predictions.md`). 채점은 두 절을 따로 센다 | 5.5 |
| 10 | 코드 봉인 | 임계값만 | `prereg/sweep.json`에 실행할 코드(`app/src/lib/{alloc,engine,sim}`의 시험 아닌 .ts, 장부 JSON)의 sha256을 함께 넣는다. 봉인 뒤 바뀌면 `seal/CHANGELOG.md`와 전후 결과 둘 다(5.5절 규칙) | 5.5 |
| 11 | 봉인 순서 검사 | 미구현 | `tools/check-seal-order.mjs`: S4 태그 커밋까지의 git 이력과, S4 이전에 수정된 로컬 `out/` JSON에 E1·E2 전용 시드가 0개 | 5.4 |

**라운드 5 끝 카드(12.3절 기본안 대체).** 값은 전부 `evidence.json`에서 스크립트가 채운다.
- 큰 줄: 「현행 절차보다 공백 가구·시간 [pooled]% 감소 · [K]개 조건 중 [S]개에서 우세(모의정전 [N]회)」
- 둘째 줄: 「짧은 순·가까운 순 단순 규칙과는 [K]개 중 [P0]개 조건에서 차이 없음 — 효과는 정교한 순서가 아니라 등록 기록을 호환 자원과 잇는 데서 나옵니다(모의)」
- 셋째 줄(E1, RULE ROBUST 쌍이 있을 때만): 「도구를 써도 [ROBUST 쌍]에는 가정 범위 추첨 90% 이상(95% 신뢰하한)에서 공백이 남습니다 — 정전 뒤 배정이 아니라 사전 배치가 필요한 곳(모의정전)」
- 고정 문구: 「기록은 이미 공공기관에 있습니다. 남은 것은 그 기록을 시간과 잇는 일입니다.」
- 관문 2 실패 시: 12.3절 대체안.
