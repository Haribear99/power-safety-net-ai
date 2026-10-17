# 봉인 기록

봉인 뒤 임계값·코드·설정을 바꾸면 여기에 적고, 바꾸기 전과 후의 결과를 둘 다 싣는다(spec.md 5.5절).

## S4 — 사전등록 (2026-10-17)

- 커밋: 태그 `S4`(5e7b529). 내용 요약과 파일 sha256은 `seal/S4.txt`.
- OpenTimestamps: `seal/S4.txt.ots`(2026-10-17 스탬프, 비트코인 확정 대기 상태로 커밋). 확정 뒤 `ots upgrade seal/S4.txt.ots`로 갱신한다.
- 검증: `ots verify seal/S4.txt.ots` → S4.txt의 sha256이 스탬프와 같은지. S4.txt의 각 줄은 `git show S4:<파일> | sha256sum`으로 다시 만들 수 있다.
  - Windows에서 python-bitcoinlib이 OpenSSL을 못 찾으면 `ctypes.util.find_library`가 Python `DLLs\libcrypto-3.dll`을 돌려주게 감싸서 실행한다(이번 스탬프도 그렇게 만들었다).
- 봉인 순서: `node tools/check-seal-order.mjs`(S4 이전 이력·out/에 E1·E2 전용 시드 0개).

### 봉인 뒤 변경

(없음)

### 봉인 뒤 변경 — 라운드 6 (2026-10-17)

- `app/src/lib/sim/sweep.ts`·`analyze.ts`에 E3 함수(runE3, e3Effect, labelsByVariant)를 **덧붙였다**. E1·E2 함수 본문은 바꾸지 않았다. `sweep.ts`가 `patches.ts`를 import하게 되어 파일 sha256은 S4와 다르다.
- 재현 확인: E2 봉인 실행을 같은 시드로 다시 돌려 5,400행 전부 같음, E1 봉인 주 실행 앞 200행을 다시 계산해 200/200 같음(정본 JSON 비교).
- 결과 변화: 없음.

## S5 — E3 사전등록 (2026-10-17)

- 커밋: 태그 `S5`. 요약·파일 sha256은 `seal/S5.txt`, OpenTimestamps `seal/S5.txt.ots`(확정 대기 상태로 커밋).
- 봉인 대상: `prereg/predictions_e3.md`, `prereg/e3.json`(설계·코드 sha256·재현 명령), `spec/patches.json`, 채점 `app/scripts/score-prereg-e3.ts`.

## S3 — C1 시험셋 (2026-10-17, 태그 S3)

### 봉인 뒤 변경(봉인 실행 전, 시험셋 호출·열람 0회)
- 정답 JSON에 `clipped`(오른쪽 테두리 밖으로 잘린 글자)를 기록하고 가림과 같은 규칙으로 채점하게 고쳤다. 이미지 160장은 바이트 단위로 그대로다. dev 판독에서 잘린 ' h'가 정답에 있던 것을 발견(dev 3장, test 13장). 새 매니페스트 sha256은 `prereg/c1.json` amendments.
- 채점 코드 버그 수정: 가림 표시 기호를 지우는 규칙이 소수점까지 지웠다(`7.5`). 봉인 실행 전.

### 봉인 뒤 변경 — S5 이후 E4 준비 (2026-10-17)

- `types.ts`에 원인 `APT_EMP`(Cause 타입만, 봉인 실험 원인 목록 `CAUSES`에는 넣지 않음), `restoration.ts`가 `spec/restoration_empirical.json`을 추가로 읽음, `sweep.ts`의 `e3Def`·`runE3`에 scenarioId 접두사 인자(기본값 "E3")와 E4 함수 추가. S4·S5의 해당 파일 sha256과 다르다.
- 재현 확인: E2 봉인 5,400행 중 50행, E1 봉인 주 실행 32,000행 중 100행, E3 봉인 8,000행 중 50행을 다시 계산해 전부 같음(정본 JSON 비교). vitest 239 통과.
- 결과 변화: 없음.

## S6 — E4 실측 정전시간 분포 사전등록 (2026-10-17)

- 커밋: 태그 `S6`(bda205d). 요약·파일 sha256은 `seal/S6.txt`, OpenTimestamps `seal/S6.txt.ots`(확정 대기 상태로 커밋).
- 봉인 대상: `prereg/predictions_e4.md`(1절은 예비 실행 전 커밋 520a10f, 2절은 예비 실행 뒤), `prereg/e4.json`(설계·코드 39개 sha256), `spec/restoration_empirical.json`, 채점 `app/scripts/e4-analyze.ts`, 출처 PDF.
- 봉인 실행은 시드 4,000,001~4,002,000(LHS master `E4`)을 한 번만 쓴다.
