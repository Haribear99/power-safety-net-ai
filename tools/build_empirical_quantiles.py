"""실측 경험 분포 분위 표(APT_EMP) 생성. spec/restoration_empirical.json을 쓴다(S1 봉인 표 spec/restoration_quantiles.json은 건드리지 않는다).

1차 출처: 기후에너지환경부 보도자료(2026-05-20) 붙임 「아파트 정전현황」 정전시간별 건수(최근 3개년 382건)
  ~1h 42 · ~2h 77 · ~3h 47 · ~6h 90 · ~12h 71 · ~24h 40 · 24h~ 15  (datasets/external/mcee_apt_outage_press_2026-05-20.pdf)
경험 CDF 매듭: (0,0) (1,42) (2,119) (3,166) (6,256) (12,327) (24,367) (72,382) /382.
가정 두 가지(assumed): ① 구간 안은 선형 보간 ② 24h 초과 15건은 24~72h에 고르게(72h는 기존 표 상한과 같다.
세종 2026-05 닷새 정전처럼 72h를 넘는 사례는 72h로 잘린다).
기존 build_quantiles.py의 piecewise_table과 같은 규칙(u = i/1000, qT = floor(h·3600 + 0.5), min(·, 72h))으로 만든다.
실행: python -I tools/build_empirical_quantiles.py   (저장소 루트에서)
"""
import json
import math
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

REPO = Path(__file__).resolve().parents[1]
GRID = 1001
CAP_H = 72.0
COUNTS = [42, 77, 47, 90, 71, 40, 15]
UPPER_H = [1.0, 2.0, 3.0, 6.0, 12.0, 24.0, 72.0]
N = sum(COUNTS)


def qT(h: float) -> int:
    return math.floor(h * 3600 + 0.5)


cum, knots = 0, [(0.0, 0.0)]
for c, h in zip(COUNTS, UPPER_H):
    cum += c
    knots.append((h, cum / N))


def piecewise_table(knots):
    out = []
    for i in range(GRID):
        u = i / (GRID - 1)
        t = knots[-1][0]
        for (t0, f0), (t1, f1) in zip(knots, knots[1:]):
            if f0 <= u <= f1 and f1 > f0:
                t = t0 + (t1 - t0) * (u - f0) / (f1 - f0)
                break
        out.append(qT(min(t, CAP_H)))
    return out


qs = piecewise_table(knots)
assert all(a <= b for a, b in zip(qs, qs[1:]))
pct = lambda u: qs[round(u * (GRID - 1))] / 3600
table = {
    "dist": "empirical_piecewise_linear_cdf", "knots": [[h, round(f, 6)] for h, f in knots], "counts": COUNTS, "n": N,
    "checkP10H": round(pct(0.1), 4), "checkP50H": round(pct(0.5), 4), "checkP80H": round(pct(0.8), 4), "checkP90H": round(pct(0.9), 4), "qS": qs,
}
doc = {
    "meta": {
        "capH": CAP_H, "grid": GRID, "generator": "tools/build_empirical_quantiles.py", "unit": "s (qT 정수 초)",
        "prov": {"type": "measured", "source": "기후에너지환경부 보도자료 2026-05-20 붙임 「아파트 정전현황」",
                 "file": "datasets/external/mcee_apt_outage_press_2026-05-20.pdf",
                 "assumed": ["구간 안 선형 보간", "24h 초과 15건을 24~72h에 고르게(72h 상한 절단)"]},
        "note": "E4(사후 등록 실험) 전용. 가구 쪽 사건 유형은 구분하지 않은 아파트 정전 전체의 경험 분포. 계획자도 같은 표를 '가정 범위'로 본다.",
    },
    # 분포 계열(gamma·lognormal)과 무관한 경험 표라 두 계열에 같은 표를 둔다(restoration.ts가 계열별로 읽는다)
    "tables": {"gamma": {"APT_EMP": table}, "lognormal": {"APT_EMP": table}},
}
dst = REPO / "spec" / "restoration_empirical.json"
dst.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
print(f"APT_EMP P10 {table['checkP10H']}h · P50 {table['checkP50H']}h · P80 {table['checkP80H']}h · P90 {table['checkP90H']}h → {dst.relative_to(REPO)}")
