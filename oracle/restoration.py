"""복구 분위(spec 3.4·3.5·3.9절). 표는 spec/restoration_quantiles.json의 qS(정수 초, u = i/1000).

정확 계산: F(e)와 Q(u)는 fractions.Fraction(유리수)로 계산하고 Q는 마지막에 floor 한 번.
- Q(u): 표 선형보간.
- F(e) = max{u : Q(u) ≤ e} (3.1절 규칙 5). Q(0) > e이면 0, Q(1) ≤ e이면 1.
- R_q_end = tOutage + floor(Q(F(e) + q·(1 − F(e)))), F(e) = 1이면 now.
- NEAR_CERTAIN: tOutage + 1.0h. CONFIRMED: now + floor(max(0, R_est_end − now) × multPpm / 10^6).
"""
import math
from fractions import Fraction

from common import chk


def F_of(qs, e):
    n = len(qs) - 1
    if qs[0] > e:
        return Fraction(0)
    if qs[n] <= e:
        return Fraction(1)
    lo, hi = 0, n - 1          # qs[lo] ≤ e < qs[n]: 가장 큰 i (qs[i] ≤ e)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if qs[mid] <= e:
            lo = mid
        else:
            hi = mid - 1
    i = lo
    return (Fraction(i) + Fraction(e - qs[i], qs[i + 1] - qs[i])) / n


def Q_of(qs, u):
    n = len(qs) - 1
    x = u * n
    i = math.floor(x)
    if i >= n:
        return Fraction(qs[n])
    if i < 0:
        return Fraction(qs[0])
    return qs[i] + (x - i) * (qs[i + 1] - qs[i])


def quantile_end(rest, qs, now_s, t_out_s, q, P, q_key):
    """절대 모의 시각(초)의 복구 분위. q는 Fraction, q_key는 'p10'|'p50'|'p80'|'p90'."""
    status = rest.get("status", "ASSUMED_RANGE")
    if status == "NEAR_CERTAIN":
        return t_out_s + P.hours_s("restoration.nearCertainR80H")
    if status == "CONFIRMED":
        c = rest["confirmed"]
        rem = max(0, c["rEstEndS"] - now_s)
        mult = c["multPpm"][q_key]
        return now_s + chk(rem * mult) // 1000000
    e = max(0, now_s - t_out_s)
    F = F_of(qs, e)
    if F == 1:
        return now_s
    u = F + q * (1 - F)
    return t_out_s + math.floor(Q_of(qs, u))
