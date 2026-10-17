"""사후 외부 대조(봉인 아님): 아파트 정전 복구시간 가정 분포 4종이 정부 실측 분포와 모순되지 않는지 본다.

1차 출처: 기후에너지환경부 보도자료 「공동주택(아파트) 정전, 24시간 내로 임시 전력복구 체계 마련한다」(2026-05-20)
붙임 「아파트 정전현황」 — datasets/external/mcee_apt_outage_press_2026-05-20.pdf (sha256 아래 SRC_SHA256).
최근 3개년('23~'25) 아파트 정전 382건의 정전시간별 건수:
  ~1h 42 · ~2h 77 · ~3h 47 · ~6h 90 · ~12h 71 · ~24h 40 · 24h~ 15
원인별: 기자재 233 · 차단기동작 60 · 침수 34 · 외물접촉 33 · 화재 10 · 기타 12

방법: APT_SHORT·APT_NIGHT_XFMR·APT_PARTS·APT_FIRE 분위 표(spec/restoration_quantiles.json)를 비중 w로 섞은
7구간 확률을 만들고, 1/200 격자의 모든 w 중 다항 우도가 가장 큰 것을 찾는다. 적합도는 G-검정(자유도 7−1−3 = 3).
p ≥ 0.05이면 '모순 없음'. 원인별 비중이 실측 원인 분포와 같은 뜻은 아니다(가정 분포의 원인 이름은 복구 양상 묶음).
봉인 실험(E1·E2·E3)은 원인별 조건부 결과라 이 대조로 바뀌지 않는다. 결과는 out/calib/apt_calibration.json.
실행: python -I tools/check_apt_calibration.py   (저장소 루트에서). 모순이면 종료 코드 1.
"""
import hashlib
import json
import math
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

REPO = Path(__file__).resolve().parents[1]
SRC = REPO / "datasets" / "external" / "mcee_apt_outage_press_2026-05-20.pdf"
SRC_SHA256 = "421ae242874bd669a3aa3bef950559af7dfcc1c84bb3a49281cb63bf97c04720"
Q = json.loads((REPO / "spec" / "restoration_quantiles.json").read_text(encoding="utf-8"))
CAUSES = ["APT_SHORT", "APT_NIGHT_XFMR", "APT_PARTS", "APT_FIRE"]
EDGES_H = [1, 2, 3, 6, 12, 24]  # 구간 상단(시간). 마지막 구간은 24h 초과
OBS = [42, 77, 47, 90, 71, 40, 15]
BY_CAUSE = {"기자재": 233, "차단기동작": 60, "침수": 34, "외물접촉": 33, "화재": 10, "기타": 12}
N = sum(OBS)
STEP = 200
EPS = 1e-9

assert N == 382 and sum(BY_CAUSE.values()) == 382
if hashlib.sha256(SRC.read_bytes()).hexdigest() != SRC_SHA256:
    sys.exit("출처 PDF sha256 불일치")


def bins(qs):
    """분위 표 점 중 각 구간에 든 비율(u 격자 1/1000이라 근사)."""
    cnt = [0] * (len(EDGES_H) + 1)
    for x in qs:
        h = x / 3600
        i = next((k for k, e in enumerate(EDGES_H) if h <= e), len(EDGES_H))
        cnt[i] += 1
    return [c / len(qs) for c in cnt]


def chi2_sf_df3(x):
    return math.erfc(math.sqrt(x / 2)) + math.sqrt(2 * x / math.pi) * math.exp(-x / 2)


def gstat(p):
    return 2 * sum(o * math.log(o / (N * max(pi, EPS))) for o, pi in zip(OBS, p) if o)


out = {
    "kind": "post-hoc external check (not sealed)",
    "source": {
        "title": "기후에너지환경부 보도자료 「공동주택(아파트) 정전, 24시간 내로 임시 전력복구 체계 마련한다」 붙임 「아파트 정전현황」",
        "date": "2026-05-20",
        "url": "https://mcee.go.kr/home/web/board/read.do?boardId=1864960&boardMasterId=939&menuId=10598",
        "file": "datasets/external/mcee_apt_outage_press_2026-05-20.pdf", "sha256": SRC_SHA256,
        "vaultNoteIds": ["기후에너지환경부-보도자료-상세-공동주택아파트-정전-24시간-내로-임시-전력복구-체계-마련한다", "기후부-공동주택-정전-24시간-내-임시-전력-복구-체계-마련"],
        "maxObservedNote": "세종 조치원 수전실 화재 2026-05-01(집계 기간 밖), 1,429세대 닷새 정전 — 분위 표 상한 72h를 넘는다",
    },
    "observed": {"n": N, "years": 3, "binsUpperH": EDGES_H, "counts": OBS, "byCause": BY_CAUSE,
                 "gt12h": OBS[5] + OBS[6], "gt24h": OBS[6], "perYear": round(N / 3, 1),
                 "gt12hPerYear": round((OBS[5] + OBS[6]) / 3, 1), "gt24hPerYear": round(OBS[6] / 3, 1)},
    "capH": Q["meta"]["capH"],
    "families": {},
}

for fam, tables in Q["tables"].items():
    B = [bins(tables[c]["qS"]) for c in CAUSES]
    best, cands = None, []
    for a in range(STEP + 1):
        for b in range(STEP + 1 - a):
            for c in range(STEP + 1 - a - b):
                w = (STEP - a - b - c, a, b, c)
                p = [sum(w[k] * B[k][j] for k in range(4)) / STEP for j in range(len(OBS))]
                g = gstat(p)
                cands.append((g, w))
                if best is None or g < best[0]:
                    best = (g, w, p)
    g, w, p = best
    # 우도비 95% 집합: G − G_min ≤ 7.815(자유도 3) 안의 비중 범위
    ok = [wv for gv, wv in cands if gv - g <= 7.815]
    rng = lambda f: [round(min(map(f, ok)) / STEP, 3), round(max(map(f, ok)) / STEP, 3)]
    out["families"][fam] = {
        "binProbByCause": {c: [round(x, 4) for x in B[k]] for k, c in enumerate(CAUSES)},
        "bestWeights": dict(zip(CAUSES, [x / STEP for x in w])),
        "expected": [round(N * x, 1) for x in p],
        "G": round(g, 3), "df": 3, "p": round(chi2_sf_df3(g), 4),
        "consistent": chi2_sf_df3(g) >= 0.05,
        "weightRange95": {c: rng(lambda v, i=i: v[i]) for i, c in enumerate(CAUSES)},
        "partsPlusFireRange95": rng(lambda v: v[2] + v[3]),
    }

dst = REPO / "out" / "calib" / "apt_calibration.json"
dst.parent.mkdir(parents=True, exist_ok=True)
dst.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"관측 {N}건: {OBS}")
for fam, r in out["families"].items():
    print(f"{fam}: G = {r['G']}, p = {r['p']} → 모순 없음 = {r['consistent']}")
    print(f"  최적 비중 {r['bestWeights']}  기대 {r['expected']}")
    print(f"  95% 비중 범위 {r['weightRange95']}  부품+화재 {r['partsPlusFireRange95']}")
sys.exit(0 if all(r["consistent"] for r in out["families"].values()) else 1)
