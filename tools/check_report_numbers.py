"""성과보고서 1부의 숫자를 evidence.json(봉인 실행 집계)에서 다시 만들어 보고서에 그대로 있는지 대조한다.
실행: python -I tools/check_report_numbers.py   (저장소 루트에서). 하나라도 없으면 종료 코드 1.
"""
import json
import sys
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

expected = {
    "E2 시나리오 수": f"{e2['n']:,}",
    "E2 합산 감소율": pct(e2["pooledRel"]),
    "E2 CI": f"{pc(e2['pooledRelLo'])}~{pct(e2['pooledRelHi'])}",
    "E2 조건별 범위": f"{pc(e2['relRange']['lo'])}~{pct(e2['relRange']['hi'])}",
    "E2 칸 수·우세": f"{e2['nCells']}개 모두 우세" if e2["superiorVsKr"] == e2["nCells"] else f"{e2['superiorVsKr']}개",
    "E2 단순 규칙 차이 없음": f"{e2['P0']}개 조건에서 차이 없음",
    "E2 단순 규칙이 나음": f"{e2['P2']}개는 단순 규칙이 나음",
    "E1 시나리오 수": f"{e1['scenarios']:,}회",
    "E1 ROBUST 현행": f"현행 {len(e1['robustKr'])}곳",
    "E1 ROBUST 도구": f"도구를 써도 {len(e1['robustRule'])}곳",
    "E3 시나리오 수": f"{e3['n']:,}회",
    "E3 실효 보급 범위": f"{pc(e3['effLo'])}~{pct(e3['effHi'])}",
    "E3 빈틈 해소": f"{e3['robustBefore']}곳 중 {e3['closed']}곳",
    "C1 헤드라인": rate(s["degradedModelConfidentWrong"]),
    "C1 무플래그 오매칭": rate(s["unflaggedMismatch"]),
    "C1 미등록 수동검토": rate(s["unregisteredToReview"]),
    "C1 기준선 모델명": rate(t["modelExact"]),
    "C1 기준선 오매칭": f"오매칭 {t['unflaggedMismatch']['k']}건",
    "사전등록 1절": f"{lab['prereg']['section1']['hit']}/{lab['prereg']['section1']['total']}",
    "사전등록 2절": f"{lab['prereg']['section2']['hit']}/{lab['prereg']['section2']['total']}",
    "사전등록 E3": f"{e3['prereg']['hit']}/{e3['prereg']['total']}",
    "오라클 차등": f"{ev['diff']['total']['pass']}/{ev['diff']['total']['scenarios']}",
}
miss = {k: v for k, v in expected.items() if v not in part1}
for k, v in expected.items():
    print(("✓ " if k not in miss else "✗ ") + f"{k}: {v}")
if not c1["gate3"]["pass"] or not lab["gate2"]["pass"]:
    print("✗ 관문 2 또는 3 미통과 — 보고서 대체안 문장을 써야 한다")
    sys.exit(1)
sys.exit(1 if miss else 0)
