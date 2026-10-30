# 외부 1차 자료

| 파일 | 출처 | 받은 날 | sha256 | 쓰는 곳 |
|---|---|---|---|---|
| `mcee_apt_outage_press_2026-05-20.pdf` | 기후에너지환경부 보도자료(2026-05-20) 붙임 「아파트 정전현황」 https://mcee.go.kr/home/web/board/read.do?boardId=1864960&boardMasterId=939&menuId=10598 | 2026-10-17 | `421ae242874bd669a3aa3bef950559af7dfcc1c84bb3a49281cb63bf97c04720` | 정전시간 7구간 382건 → `tools/check_apt_calibration.py`, `tools/build_empirical_quantiles.py`, E4(S6) |
| `nhis_yoyangbi_payments_20251231.zip` | 공공데이터포털 15128170 「국민건강보험공단_요양비 지급건수 및 금액 현황_20251231」 https://www.data.go.kr/data/15128170/fileData.do (CSV cp949 + 설명 hwp, 이용허락 제한 없음) | 2026-10-17 | `52c68be54a13c44b13089628ad886efb1916e5dec33a34ab143799b8275d58f6` | 규모 교차확인용(엔진·시뮬 입력 아님) |

요양비 CSV 2025년 행(지급건수, 지역 구분 없음): 산소치료 386,441건, 인공호흡기 68,520건, 기침유발기 15,215건. **지급건수는 사람 수가 아니다**(월 단위 청구가 쌓인 건수로 보인다. 설명 hwp 미확인). 사람 수로 바꿔 쓰지 않는다.
| (저장소 밖) `구급 현황_2025_전국.csv`, `구급 현황_2024_전국.csv` | 소방청 「전국 구급 현황」 건 단위 원자료(bigdata-119.kr, 사용자 로그인 다운로드, 연도별 약 1.8GB) | 2026-10-30 | `spec/arrival_119_empirical.json`의 years.*.sha256 | 119 신고→현장도착 분포 `tools/build_119_arrival.py` → `spec/arrival_119_empirical.json`, 사후 민감도 `app/scripts/posthoc-119.ts`. 원자료는 용량·재배포 문제로 저장소에 넣지 않는다 |
| `nhis_o2_provider_criteria_annex2.pdf` | 「요양비의 보험급여 기준 및 방법」 [별표 2] 산소치료 서비스 제공업소 등록 등 기준(국가법령정보센터 첨부 https://www.law.go.kr/LSW/flDownload.do?flSeq=163722231, 2026-04-24 생성) | 2026-10-30 | `3cf949cea255302e7921a5da1cf1d6d28b8bc6ac3620355e360ed06d903c162d` | E7(평시 산소통) 실현 경로 근거: 등록 업체의 365일 24시간 콜센터·전국 응급 조직망·전원 중단 경보, 가정용 산소발생기 소비전력 300W 이하(모의 280W 가정과 대조). 예비 산소통이 요양비 대상인지는 이 문서에 없다 |
