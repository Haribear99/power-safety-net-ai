"""성과보고서 1부의 숫자를 evidence.json(봉인 실행 집계)에서 다시 만들어 보고서에 그대로 있는지 대조한다.
실행: python -I tools/check_report_numbers.py [--final]   (저장소 루트에서). 하나라도 없으면 종료 코드 1.
--final: 제출 직전 검사. [사용자 기입 …]·[KEIT 확인 …] 같은 작성 표기가 1부·2부에 남아 있으면 실패. 쪽수는 tools/render_report.ps1로 따로 본다.
"""
import csv
import io
import json
import re
import sys
import zipfile
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

REPO = Path(__file__).resolve().parents[1]
ev = json.loads((REPO / "app" / "src" / "data" / "evidence.json").read_text(encoding="utf-8"))
md = (REPO / "submission" / "report_draft.md").read_text(encoding="utf-8")
part1 = md.split("## 1부.")[1].split("\n---")[0]

pct = lambda x: f"{x * 100:.1f}%"
pc = lambda x: f"{x * 100:.1f}"
lab, c1 = ev["lab"], ev["c1"]
e2, e1, e3 = lab["e2"], lab["e1"], lab["e3"]
s, t = c1["sonnet"], c1["tesseract"]
rate = lambda r: f"{r['k']}/{r['n']}"

# E1 빈틈 지도·E3 보완안·E4 추첨 수는 10/30 개편에서 1부 줄을 뺐다(2장 한도). 자세한 값은 /lab ②④⑦
expected = {
    "E2 시나리오 수": f"{e2['n']:,}",
    "E2 합산 감소율": pct(e2["pooledRel"]),
    "E2 가까운 순 합산 우위": f"가까운 순이 {abs(e2['vsB2']['rel']) * 100:.1f}% 나음" if e2["vsB2"]["rel"] < 0 else "가까운 순보다",
    "E2 조건별 범위": f"{pc(e2['relRange']['lo'])}~{pct(e2['relRange']['hi'])}",
    "E2 칸 수·우세": f"{e2['nCells']}개 조건 모두 우세" if e2["superiorVsKr"] == e2["nCells"] else f"{e2['superiorVsKr']}개",
    "E2 단순 규칙 차이 없음": f"{e2['P0']}개 조건에서 차이 없음",
    "E2 단순 규칙이 나음": f"{e2['P2']}개는 단순 규칙이 나음",
    "C1 헤드라인": rate(s["degradedModelConfidentWrong"]),
    "C1 모델명 정확": rate(s["modelExact"]),
    "C1 DB 자동 확정": rate(s["dbMatchRate"]),
    "C1 미등록 수동검토": rate(s["unregisteredToReview"]),
    "C1 기준선 모델명": rate(t["modelExact"]),
    "C1 기준선 오매칭": f"오매칭 {t['unflaggedMismatch']['k']}건",
    "사전등록 결과 전 예측": f"실행 전 예측 {ev['preregSplit']['before']['hit']}/{ev['preregSplit']['before']['total']}",
    "사전등록 예비 뒤 재현": f"예비·사전 분석 뒤 확인 {ev['preregSplit']['afterPilot']['hit']}/{ev['preregSplit']['afterPilot']['total']}",
    "사전등록 미검정 수": f"미검정·판정 불가 {ev['preregSplit']['before']['untested']}건",
    "사전등록 틀린 수": f"틀린 {ev['preregSplit']['before']['total'] - ev['preregSplit']['before']['hit'] + ev['preregSplit']['afterPilot']['total'] - ev['preregSplit']['afterPilot']['hit']}개",
    "오라클 차등": f"{ev['diff']['total']['pass']}/{ev['diff']['total']['scenarios']}",
    "정부 집계 건수": f"{ev['calib']['apt']['n']}건",
    "정부 집계 12h 초과": f"{ev['calib']['apt']['gt12h']}건",
    "E4 도구 감소율": pct(ev["e4"]["ruleVsKr"]["rel"]),
    "E4 1시간급 도구": pct(ev["e4"]["hhGap"]["VENT_1H"]["RULE"]),
    "E5 AI 대 판독 없음": f"AI +{pct(ev['e5']['aiVsNo']['rel'])}",
    "E5 완전 판독 대 판독 없음": f"완전 판독 −{pct(-ev['e5']['perfVsNo']['rel'])}" if ev['e5']['perfVsNo']['rel'] < 0 else "완전 판독 +",
    # E6(표적 배치)는 10/30 개편에서 1부 줄을 빼고 E7 문장의 비교 기준(E6식 배터리)으로만 남긴다. 자세한 값은 /lab ⑧
    "E5 OCR 자동 확정": f"OCR {rate(t['dbMatchRate'])}, 판독 없음 0/{t['dbMatchRate']['n']}",
    "E5 도구 감소율": f"도구 {pct(ev['e5']['aiVsKr']['rel'])} 감소",
    "E5 미확정률": f"미확정 {c1['sonnet']['dbMatchRate']['n'] - c1['sonnet']['dbMatchRate']['k']}/{c1['sonnet']['dbMatchRate']['n']}",
    "N1 AI 통과": f"AI 글 통과 {ev['n1']['aiSent']['k']}/{ev['n1']['aiSent']['n']}(95% {ev['n1']['aiSent']['lo'] * 100:.0f}~{ev['n1']['aiSent']['hi'] * 100:.0f}%)",
    "N1 놓침": f"{ev['n1']['badMissed']['n']}건 중 {ev['n1']['badMissed']['k']}건 통과({ev['n1']['badMissed']['k'] / ev['n1']['badMissed']['n'] * 100:.1f}%, 95% {ev['n1']['badMissed']['lo'] * 100:.1f}~{ev['n1']['badMissed']['hi'] * 100:.1f}%",
    "N1 오거부": f"맞는 글 잘못 막음 {ev['n1']['goodFalseReject']['k']}/{ev['n1']['goodFalseReject']['n']}(95% {ev['n1']['goodFalseReject']['lo'] * 100:.1f}~{ev['n1']['goodFalseReject']['hi'] * 100:.1f}%)",
    "N1 쌍 비교(탐색 표지)": f"AI 판정 탐색 {ev['n1']['judge']['ai']}:{ev['n1']['judge']['template']}·같음 {ev['n1']['judge']['same']}(AI:고정)",
    "N1 나간 글 결함": f"결함 판정 {ev['n1']['sentDefects']}/60(모순·외장 미표기·경고 누락·없는 약속",
    "원안 KPI 과대예측(사후)": f"하한이 모의 실제보다 긴 가구·회 {ev['kpiOverPredict']['rule']['k'] / ev['kpiOverPredict']['rule']['n'] * 100:.1f}%",
    "N1 쌍 비교 유의성": "AI 우세 근거 없음(p≈" + format(ev['n1']['judgeSplit']['signP'], '.1f'),
    "N1 측정 버전 표기": "봉인 당시 검사 기준",
    "N1 사용 규칙(9.1 틀림 시 표기)": "시연용·담당자 확인 뒤 발송",
    # 실패 가정 점검(10/30): E7(S10)·사후 집계. 사용 규칙(prereg/predictions_e7.md 2절)의 표지도 함께 본다
    "기술요약 AI 실측": f"AI 판독 모델명 {rate(s['modelExact'])}(OCR {rate(t['modelExact'])})·자동 확정 {rate(s['dbMatchRate'])}(렌더 라벨 봉인 시험)",
    "E7 10.5 본문": f"먼저 주면 {pct(ev['e7']['compares']['noOverlap']['rel'])} 더 감소(층화 없음 {pct(ev['e7']['compares']['uNoOverlap']['rel'])}, 그 감소의 약 {round(ev['e7']['cylShare']['strat']['rel'] * 100)}%가 산소통 몫)",
    "E7 10.1": f"산소통(10시간)만 두면 공백 {pct(ev['e7']['compares']['cylVsNone']['rel'])} 감소(층화 없음 {pct(ev['e7']['compares']['uCylVsNone']['rel'])})",
    "E7 10.1 규모 표지": f"60가구 중 약 {round(ev['e7']['usedMean']['RULE+CYL10S'][0])}개, 자기신고 완전 정확 가정",
    "E7 비AI·층화·가정 표지": "비AI 정책, 등급 층화 등록부·보급률·고장률 가정",
    "E7 1시간급 짝": f"E7 1시간급 인공호흡기 공백 가구 {pct(ev['e7']['hhGap']['VENT_1H']['none'])}(대비 없음)→{pct(ev['e7']['hhGap']['VENT_1H']['battery'])}(E6식 배터리)→{pct(ev['e7']['hhGap']['VENT_1H']['matched'])}",
    "E7 끝 훅": f"정전 뒤 배정만 {pct(ev['e7']['hhGap']['VENT_1H']['none'])}, 평시 산소통·배터리를 더하면 {pct(ev['e7']['hhGap']['VENT_1H']['matched'])}(층화 모의·비AI)",
    "E7 사전등록": f"E7 {ev['e7']['prereg']['hit']}/{ev['e7']['prereg']['total']} 별도",
    "E7 AI 몫(10.7)": f"AI 판독만보다 {pct(ev['e7']['compares']['selfVsAi']['rel'])} 낫다",
    "119 실측 중앙값": f"중앙값 {ev['e119']['p50Min']:.1f}분",
    "119 실측 도구 대 현행": f"{pct(ev['e119']['empirical']['toolVsKr'])} 감소(사후)",
    "공백 분해 산소": f"남는 공백의 {pct(ev['gapDecomp']['byClassShare']['O2_STAT'])}가 배터리 없는 산소발생기",
    "하한 v2": f"{pct(ev['lbV2']['v2']['k'] / ev['lbV2']['v2']['n'])}(운영 화면 적용, 모의 실제와 같은 계수라 대부분 구성상 감소)",
    "알림 새 사례": f"틀린 글 통과 {ev['n1Fresh']['badMissed']['k']}/{ev['n1Fresh']['badMissed']['n']}, 오거부 {ev['n1Fresh']['goodFalseReject']['k']}/{ev['n1Fresh']['goodFalseReject']['n']}",
}
# 건보 요양비 CSV(datasets/external, cp949): 인공호흡기 최신 연도 지급건수 → 'N.N만 건'
with zipfile.ZipFile(REPO / "datasets" / "external" / "nhis_yoyangbi_payments_20251231.zip") as z:
    name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
    rows = list(csv.reader(io.TextIOWrapper(z.open(name), encoding="cp949")))
vent = max((r for r in rows[1:] if r[1].strip() == "인공호흡기"), key=lambda r: int(r[0]))
expected[f"인공호흡기 요양비 {vent[0]}"] = f"{vent[0]}년 {int(vent[2]) / 1e4:.1f}만 건(건보"
miss = {k: v for k, v in expected.items() if v not in part1}
for k, v in expected.items():
    print(("✓ " if k not in miss else "✗ ") + f"{k}: {v}")
# 시연 영상 콘티: 보고서와 같은 공개 단서(통합 레드팀 16라운드 — 콘티만 단서 없이 남아 있었다)
board = (REPO / "submission" / "video_storyboard.md").read_text(encoding="utf-8")
for k, v in {
    "콘티 하한 넘침": f"{ev['kpiOverPredict']['rule']['k'] / ev['kpiOverPredict']['rule']['n'] * 100:.1f}%는 실제보다 길게",
    "콘티 나간 글 결함": f"60건 중 {ev['n1']['sentDefects']}건은 봉인 뒤 결함 판정",
    "콘티 판독 보완 위반": f"채운 {c1['sonnet']['supplementViolations']}건은 모두",
    # 73%·60%는 같은 실험(E6 무작위 대 평시 표적)의 짝이어야 한다(E4 사전 배치 73.1%와 섞지 않음, 통합 레드팀 17라운드)
    "콘티 E6 짝": f"무작위로 두면 {round(ev['e6']['hhGap']['VENT_1H']['rand'] * 100)}%, 정전 전 등록 정보로 배터리가 짧은 집부터 두면 {round(ev['e6']['hhGap']['VENT_1H']['pre'] * 100)}%",
}.items():
    ok = v in board
    print(("✓ " if ok else "✗ ") + f"{k}: {v}")
    if not ok:
        miss[k] = v
if ev["e4"]["hhGap"]["VENT_1H"]["KR_BASELINE"] != ev["e4"]["hhGap"]["VENT_1H"]["RULE"]:
    print("✗ E4 1시간급 '그대로' 문장이 evidence와 다르다(현행 ≠ 도구)")
    miss["E4 그대로"] = "현행 = 도구"
if not c1["gate3"]["pass"] or not lab["gate2"]["pass"]:
    print("✗ 관문 2 또는 3 미통과 — 보고서 대체안 문장을 써야 한다")
    sys.exit(1)
if "--final" in sys.argv:
    # 1부와 2부 별첨(심사 안내의 접근 코드 포함, 통합 레드팀 17라운드)
    part2 = md.split("## 2부.")[1].split("## 3부.")[0]
    left = re.findall(r"\[(?:사용자 기입|KEIT 확인)[^\]]*\]", part1 + part2)
    for x in left:
        print(f"✗ 작성 표기가 남아 있음: {x}")
    if left:
        miss["작성 표기"] = "남음"
sys.exit(1 if miss else 0)
