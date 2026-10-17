# 봉인 기록

봉인 뒤 임계값·코드·설정을 바꾸면 여기에 적고, 바꾸기 전과 후의 결과를 둘 다 싣는다(spec.md 5.5절).

## S4 — 사전등록 (2026-10-17)

- 커밋: 태그 `S4`(5e7b529). 내용 요약과 파일 sha256은 `seal/S4.txt`.
- OpenTimestamps: `seal/S4.txt.ots`(2026-10-17 스탬프, 확정 대기 상태로 커밋 → 10/18 `ots upgrade`로 비트코인 블록 증명 포함, 아래 끝 절).
- 검증: `ots verify seal/S4.txt.ots` → S4.txt의 sha256이 스탬프와 같은지. S4.txt의 각 줄은 `git show S4:<파일> | sha256sum`으로 다시 만들 수 있다.
  - Windows에서 python-bitcoinlib이 OpenSSL을 못 찾으면 `ctypes.util.find_library`가 Python `DLLs\libcrypto-3.dll`을 돌려주게 감싸서 실행한다(이번 스탬프도 그렇게 만들었다).
- 봉인 순서: `node tools/check-seal-order.mjs`(S4 이전 이력·out/에 E1·E2 전용 시드 0개).

### 봉인 뒤 변경

(라운드 6 전까지 없음)

### 봉인 뒤 변경 — 라운드 6 (2026-10-17)

- `app/src/lib/sim/sweep.ts`·`analyze.ts`에 E3 함수(runE3, e3Effect, labelsByVariant)를 **덧붙였다**. E1·E2 함수 본문은 바꾸지 않았다. `sweep.ts`가 `patches.ts`를 import하게 되어 파일 sha256은 S4와 다르다.
- 재현 확인: E2 봉인 실행을 같은 시드로 다시 돌려 5,400행 전부 같음, E1 봉인 주 실행 앞 200행을 다시 계산해 200/200 같음(정본 JSON 비교).
- 결과 변화: 없음.

## S5 — E3 사전등록 (2026-10-17)

- 커밋: 태그 `S5`. 요약·파일 sha256은 `seal/S5.txt`, OpenTimestamps `seal/S5.txt.ots`(확정 대기로 커밋 → 10/18 비트코인 블록 증명 포함).
- 봉인 대상: `prereg/predictions_e3.md`, `prereg/e3.json`(설계·코드 sha256·재현 명령), `spec/patches.json`, 채점 `app/scripts/score-prereg-e3.ts`.

### 봉인 뒤 변경 — S5 이후 E4 준비 (2026-10-17)

- `types.ts`에 원인 `APT_EMP`(Cause 타입만, 봉인 실험 원인 목록 `CAUSES`에는 넣지 않음), `restoration.ts`가 `spec/restoration_empirical.json`을 추가로 읽음, `sweep.ts`의 `e3Def`·`runE3`에 scenarioId 접두사 인자(기본값 "E3")와 E4 함수 추가. S4·S5의 해당 파일 sha256과 다르다.
- 재현 확인: E2 봉인 5,400행 중 50행, E1 봉인 주 실행 32,000행 중 100행, E3 봉인 8,000행 중 50행을 다시 계산해 전부 같음(정본 JSON 비교). vitest 239 통과.
- 결과 변화: 없음.


## S3 — C1 시험셋 (2026-10-17, 태그 S3)

### 봉인 뒤 변경(봉인 실행 전, 시험셋 호출·열람 0회)
- 정답 JSON에 `clipped`(오른쪽 테두리 밖으로 잘린 글자)를 기록하고 가림과 같은 규칙으로 채점하게 고쳤다. 이미지 160장은 바이트 단위로 그대로다. dev 판독에서 잘린 ' h'가 정답에 있던 것을 발견(dev 3장, test 13장). 새 매니페스트 sha256은 `prereg/c1.json` amendments.
- 채점 코드 버그 수정: 가림 표시 기호를 지우는 규칙이 소수점까지 지웠다(`7.5`). 봉인 실행 전.
- (10/18 레드팀 지적에 대한 보충) 정답 수정은 라벨 생성기를 다시 실행해 만든 것이다(생성기 sha256은 `prereg/c1.json` amendments). 시험셋 이미지·정답을 사람이 열어 고친 것이 아니다. 수정 방향은 잘린 글자를 정답에서 빼는 쪽이라 판독 점수에 유리하다. 해당 글자는 배터리 문구 끝의 ' h'이고 보고서 헤드라인(모델명 자신 있게 틀림 0/60, 모델명 정확 118/120)은 모델명 필드라 영향이 없다. 배터리 문구 정확 114/120에는 영향이 있을 수 있다.

## S6 — E4 실측 정전시간 분포 사전등록 (2026-10-17)

- 커밋: 태그 `S6`(bda205d). 요약·파일 sha256은 `seal/S6.txt`, OpenTimestamps `seal/S6.txt.ots`(확정 대기로 커밋 → 10/18 비트코인 블록 증명 포함).
- 봉인 대상: `prereg/predictions_e4.md`(1절은 예비 실행 전 커밋 520a10f, 2절은 예비 실행 뒤), `prereg/e4.json`(설계·코드 39개 sha256), `spec/restoration_empirical.json`, 채점 `app/scripts/e4-analyze.ts`, 출처 PDF.
- 봉인 실행은 시드 4,000,001~4,002,000(LHS master `E4`)을 한 번만 쓴다.

## 봉인 산출물 보관과 OTS 확정 (2026-10-18, 레드팀 대응)

- 봉인 실행 산출물이 `out/`(gitignore)에만 있어 심사자가 검증할 수 없다는 지적에 따라 `seal/outputs/`에 커밋했다. 큰 스윕 파일은 `gzip -9 -n`, 원본 sha256은 `seal/outputs/SHA256SUMS`(`gunzip -c … | sha256sum`으로 대조). 커밋 시각은 결과 생성 시각의 증명이 아니다.
- `ots upgrade`로 S4·S5·S6 스탬프에 비트코인 블록 증명이 붙었다(S4: 971793·971835, S5: 971799·971835, S6: 971870).
- 한계(공개): OpenTimestamps는 '예측이 그 시각 전에 있었다'만 증명한다. 시드가 결정적이라 봉인 전에 미리 돌려 보지 않았다는 것은 git 기록(예비 실행은 별도 시드)으로만 보인다. 다음 봉인부터는 봉인 뒤 공개되는 난수로 시드를 정한다.

## S7 — E5 AI 판독 기여·표적 사전 배치 사전등록 (2026-10-18)

- 커밋: 태그 `S7`(7774d2c). 요약·파일 sha256은 `seal/S7.txt`, OpenTimestamps `seal/S7.txt.ots`(확정 대기로 커밋).
- 봉인 대상: `prereg/predictions_e5.md`(1절 예측 6.1~6.8, E5 출력 0줄일 때 커밋), `prereg/e5.json`(설계·코드 39개 sha256), `app/src/lib/sim/e5.ts`, 채점 `app/scripts/e5-analyze.ts`.
- 순서: 예측 커밋(7774d2c) → 예비 실행(E5-dev, 시드 9,501~9,700, 버그 확인만, 예측 추가 없음) → S7 태그·OTS → 봉인 실행(시드 5,000,001~5,002,000, 2,000추첨) 1회.
- 예비 실행에서 본 것(공개): AI 대 판독 없음 차이가 거의 없음(+0.4%, CI가 0을 포함). 모형의 수동검토가 인력 제한 없이 0.25~1h 지연만 주기 때문으로 보인다. 예측과 모형은 바꾸지 않았다.
- S6 뒤 코드 변경: `app/scripts/sweep.ts`·`sweep-worker.ts`에 E5 분기를 **덧붙였다**(E1~E4 분기 본문은 그대로). `sync-evidence.ts`는 사전등록 분류에 6.x를 더했다. 재현 확인: E4 봉인 실행 2,000행을 바뀐 실행기로 다시 돌려 2,000/2,000 같음(정본 JSON 비교).
