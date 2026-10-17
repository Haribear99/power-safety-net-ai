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
