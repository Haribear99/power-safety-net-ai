"""공통: 양자화(spec 3.1), 감시값, 장부(params.json) 읽기.

독립 오라클 규칙(spec 3.1):
- qT(h) = floor(h*3600 + 0.5), qE(wh) = floor(wh*1000 + 0.5). round()·int() 금지.
- 결정 경로는 정수 초·정수 mWh·정수 유리수 계수. 분자 곱 먼저, floor 나눗셈은 마지막 한 번.
- 무한대는 ±(2^31−1) 정수 감시값.
- 중간값 |x| < 2^53 단언.
"""
import json
import math
import os

SENT = 2 ** 31 - 1          # +∞ 감시값 (3.1절 규칙 1)
NEG_SENT = -SENT            # −∞ 감시값
LIMIT = 2 ** 53

ORACLE_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.dirname(ORACLE_DIR)
SPEC_DIR = os.path.join(REPO_DIR, "spec")


def qT(h):
    """시간(h) → 정수 초. 정수가 들어오면 그대로가 아니라 시간으로 본다."""
    return math.floor(h * 3600 + 0.5)


def qE(wh):
    """에너지(Wh) → 정수 mWh."""
    return math.floor(wh * 1000 + 0.5)


def chk(x):
    """중간값 2^53 미만 단언 (3.1절 규칙 2)."""
    if not (-LIMIT < x < LIMIT):
        raise AssertionError("intermediate value out of 2^53 range: %r" % (x,))
    return x


def mul_div(num_factors, den_factors):
    """floor(Π num / Π den). 분자끼리 먼저 곱하고 나눗셈은 마지막 한 번 (3.1절 규칙 2)."""
    n = 1
    for f in num_factors:
        n = chk(n * f)
    d = 1
    for f in den_factors:
        d = chk(d * f)
    if d <= 0:
        raise AssertionError("non-positive denominator")
    return n // d   # Python // 는 floor (규칙 3)


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def seconds(obj, base, default=None):
    """WorldTruth 등에서 `<base>S`(정수 초)를 우선 읽고, 없으면 `<base>H`(시간)를 qT로 바꾼다."""
    if obj is None:
        return default
    s = obj.get(base + "S")
    if s is not None:
        if not isinstance(s, int):
            raise AssertionError("%sS must be an integer (got %r)" % (base, s))
        return s
    h = obj.get(base + "H")
    if h is not None:
        return qT(h)
    return default


class Params:
    """spec/params.json 장부. 엔진 상수는 모두 여기서 읽는다(9절 장부 층)."""

    def __init__(self, data):
        self.rows = {r["key"]: r for r in data["rows"]}

    @classmethod
    def load(cls, path=None):
        return cls(load_json(path or os.path.join(SPEC_DIR, "params.json")))

    def row(self, key):
        if key not in self.rows:
            raise KeyError("params.json has no key %r" % key)
        return self.rows[key]

    def value(self, key):
        return self.row(key)["value"]

    def range(self, key):
        r = self.row(key)["range"]
        return r["lo"], r["hi"]

    def ratio(self, key):
        r = self.row(key)
        if "ratio" in r:
            n, d = r["ratio"]
            return int(n), int(d)
        v = r["value"]
        if isinstance(v, int) or (isinstance(v, float) and v == math.floor(v)):
            return int(v), 1
        raise KeyError("params.json key %r has no integer ratio" % key)

    def hours_s(self, key):
        """시간 값(h)을 정수 초로. ratio가 있으면 정수 유리수로 정확히 계산한다."""
        r = self.row(key)
        if "ratio" in r:
            n, d = r["ratio"]
            return mul_div([n, 3600], [d])
        return qT(r["value"])
