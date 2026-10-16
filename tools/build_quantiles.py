"""spec/restoration_quantiles.json 생성기 (spec.md 3.4절).

- 원인마다 1,001점 역누적분포 표 (u = 0, 0.001, ..., 1).
- 감마: P10·P90 두 점에 형상 k를 이분법으로 맞추고(척도는 P10에서 결정), 72h에서 자른다(min(Q, 72), 평탄 구간).
- 대안 표(안정성 시험, 5.4절): 같은 P10·P90 로그정규. 혼합은 두 성분을 각각 로그정규로 바꾼다.
  구간선형 CDF(TYPHOON_STRONG)와 고정(ROTATING)은 감마가 아니므로 대안 표에서도 같은 표를 쓴다.
- 값은 qT(h) = floor(h*3600 + 0.5) 정수 초로 저장한다(3.1절). 소비자는 다시 계산하지 않고 읽기만 한다.

실행: python tools/build_quantiles.py  (scipy 필요)
"""
import json
import math
import os
import sys

import scipy
from scipy import optimize, stats

GRID = 1001
CAP_H = 72.0
Z90 = stats.norm.ppf(0.9)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "spec", "restoration_quantiles.json")


def qT(h: float) -> int:
    return math.floor(h * 3600 + 0.5)


def fit_gamma(p10: float, p90: float):
    target = p90 / p10

    def ratio(k):
        return stats.gamma.ppf(0.9, k) / stats.gamma.ppf(0.1, k) - target

    lo, hi = 1e-3, 1e4
    for _ in range(200):  # 이분법 (ratio는 k에 대해 감소)
        mid = math.sqrt(lo * hi)
        if ratio(mid) > 0:
            lo = mid
        else:
            hi = mid
    k = math.sqrt(lo * hi)
    theta = p10 / stats.gamma.ppf(0.1, k)
    return {"k": k, "theta": theta}


def fit_lognorm(p10: float, p90: float):
    sigma = (math.log(p90) - math.log(p10)) / (2 * Z90)
    mu = (math.log(p10) + math.log(p90)) / 2
    return {"mu": mu, "sigma": sigma}


def gamma_cdf(f):
    return lambda t: stats.gamma.cdf(t, f["k"], scale=f["theta"])


def lognorm_cdf(f):
    return lambda t: stats.lognorm.cdf(t, f["sigma"], scale=math.exp(f["mu"])) if t > 0 else 0.0


def table_from_cdf(cdf):
    """Q(u) = min(inf{t : cdf(t) >= u}, 72). u=0 -> 0."""
    out = []
    c_cap = cdf(CAP_H)
    for i in range(GRID):
        u = i / (GRID - 1)
        if u <= 0:
            out.append(0)
            continue
        if u >= c_cap:
            out.append(qT(CAP_H))
            continue
        t = optimize.brentq(lambda x: cdf(x) - u, 0.0, CAP_H, xtol=1e-12, rtol=1e-14, maxiter=500)
        out.append(qT(min(t, CAP_H)))
    return out


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


def pct(table, u):
    return table[round(u * (GRID - 1))]


GAMMA_CAUSES = {
    # cause: (P10, P90, 참고 P50)
    "KEPCO_DIST": (0.5, 2.0, 1.0),
    "APT_SHORT": (0.5, 3.0, 1.5),
    "APT_NIGHT_XFMR": (5.0, 12.0, 9.0),
    "APT_PARTS": (8.0, 20.0, 13.0),
    "APT_FIRE": (12.0, 48.0, 25.0),
}
TYPHOON_WEAK = {"w": 0.995, "a": (1.0, 10.0), "b": (12.0, 48.0)}
# F(0)=0은 assumed(3.4절 표에 F(6) 아래 점이 없음), 나머지는 3.4절 표
TYPHOON_STRONG_KNOTS = [(0.0, 0.0), (6.0, 0.30), (12.0, 0.65), (15.0, 0.72), (36.0, 0.992), (72.0, 1.0)]
ROTATING_H = 1.0


def build():
    tables = {"gamma": {}, "lognormal": {}}
    for cause, (p10, p90, p50ref) in GAMMA_CAUSES.items():
        g = fit_gamma(p10, p90)
        l = fit_lognorm(p10, p90)
        tg = table_from_cdf(gamma_cdf(g))
        tl = table_from_cdf(lognorm_cdf(l))
        tables["gamma"][cause] = {"dist": "gamma", "targetP10H": p10, "targetP90H": p90, "refP50H": p50ref,
                                  "fit": g, "fitP50H": stats.gamma.ppf(0.5, g["k"], scale=g["theta"]), "qS": tg}
        tables["lognormal"][cause] = {"dist": "lognormal", "targetP10H": p10, "targetP90H": p90, "refP50H": p50ref,
                                      "fit": l, "fitP50H": math.exp(l["mu"]), "qS": tl}
    # 혼합
    w = TYPHOON_WEAK["w"]
    ga, gb = fit_gamma(*TYPHOON_WEAK["a"]), fit_gamma(*TYPHOON_WEAK["b"])
    la, lb = fit_lognorm(*TYPHOON_WEAK["a"]), fit_lognorm(*TYPHOON_WEAK["b"])
    cdf_g = lambda t: w * gamma_cdf(ga)(t) + (1 - w) * gamma_cdf(gb)(t)
    cdf_l = lambda t: w * lognorm_cdf(la)(t) + (1 - w) * lognorm_cdf(lb)(t)
    tg, tl = table_from_cdf(cdf_g), table_from_cdf(cdf_l)
    tables["gamma"]["TYPHOON_WEAK"] = {"dist": "mixture_gamma", "weights": [w, 1 - w],
                                       "components": [{"targetP10H": 1.0, "targetP90H": 10.0, "fit": ga},
                                                      {"targetP10H": 12.0, "targetP90H": 48.0, "fit": gb}],
                                       "fitP50H": pct(tg, 0.5) / 3600, "qS": tg}
    tables["lognormal"]["TYPHOON_WEAK"] = {"dist": "mixture_lognormal", "weights": [w, 1 - w],
                                           "components": [{"targetP10H": 1.0, "targetP90H": 10.0, "fit": la},
                                                          {"targetP10H": 12.0, "targetP90H": 48.0, "fit": lb}],
                                           "fitP50H": pct(tl, 0.5) / 3600, "qS": tl}
    ts = piecewise_table(TYPHOON_STRONG_KNOTS)
    for fam in ("gamma", "lognormal"):
        tables[fam]["TYPHOON_STRONG"] = {"dist": "piecewise_linear_cdf", "knots": TYPHOON_STRONG_KNOTS,
                                         "fitP50H": pct(ts, 0.5) / 3600, "qS": ts,
                                         "note": "감마가 아니므로 대안 표도 같은 표"}
        tables[fam]["ROTATING"] = {"dist": "fixed", "valueH": ROTATING_H, "fitP50H": ROTATING_H,
                                   "qS": [qT(ROTATING_H)] * GRID, "note": "정책상 1h 블록, 대안 표도 같은 표"}
    for fam in tables.values():
        for c in fam.values():
            q = c["qS"]
            assert len(q) == GRID and all(q[i] <= q[i + 1] for i in range(GRID - 1)), "단조 위반"
            c["checkP10S"], c["checkP50S"], c["checkP90S"] = pct(q, 0.1), pct(q, 0.5), pct(q, 0.9)
    return {
        "meta": {
            "generator": "tools/build_quantiles.py",
            "python": sys.version.split()[0],
            "scipy": scipy.__version__,
            "grid": GRID,
            "uStep": "1/1000",
            "unit": "s (qT 정수 초)",
            "capH": CAP_H,
            "truncation": "clamp: Q(u) = min(Q_fit(u), 72h) — 72h 평탄 구간(3.1절 규칙 5)",
            "families": {"gamma": "기본(3.4절)", "lognormal": "안정성 시험 대안 표(같은 P10·P90, 5.4절)"},
            "prov": {"type": "calibrated", "sourceIds": ["spec.md#3.4"],
                     "note": "원인별 P10·P90 출처는 spec/params.json의 restoration.* 행"},
        },
        "tables": tables,
    }


if __name__ == "__main__":
    data = build()
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        f.write("\n")
    for fam, cs in data["tables"].items():
        for c, v in cs.items():
            print(fam, c, v["checkP10S"] / 3600, v["checkP50S"] / 3600, v["checkP90S"] / 3600)
