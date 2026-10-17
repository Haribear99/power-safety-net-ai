# 외부 1차 자료

| 파일 | 출처 | 받은 날 | sha256 | 쓰는 곳 |
|---|---|---|---|---|
| `mcee_apt_outage_press_2026-05-20.pdf` | 기후에너지환경부 보도자료(2026-05-20) 붙임 「아파트 정전현황」 https://mcee.go.kr/home/web/board/read.do?boardId=1864960&boardMasterId=939&menuId=10598 | 2026-10-17 | `421ae242874bd669a3aa3bef950559af7dfcc1c84bb3a49281cb63bf97c04720` | 정전시간 7구간 382건 → `tools/check_apt_calibration.py`, `tools/build_empirical_quantiles.py`, E4(S6) |
| `nhis_yoyangbi_payments_20251231.zip` | 공공데이터포털 15128170 「국민건강보험공단_요양비 지급건수 및 금액 현황_20251231」 https://www.data.go.kr/data/15128170/fileData.do (CSV cp949 + 설명 hwp, 이용허락 제한 없음) | 2026-10-17 | `52c68be54a13c44b13089628ad886efb1916e5dec33a34ab143799b8275d58f6` | 규모 교차확인용(엔진·시뮬 입력 아님) |

요양비 CSV 2025년 행(지급건수, 지역 구분 없음): 산소치료 386,441건, 인공호흡기 68,520건, 기침유발기 15,215건. **지급건수는 사람 수가 아니다**(월 단위 청구가 쌓인 건수로 보인다. 설명 hwp 미확인). 사람 수로 바꿔 쓰지 않는다.
