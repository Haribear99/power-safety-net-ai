"""소방청 「전국 구급 현황」 건 단위 원자료에서 119 도착 시간 분포를 만든다(실패 가정 점검 10/30, 사후 외부 대조).

원자료는 저장소에 넣지 않는다(연도별 CSV 0.5~1.8GB, bigdata-119.kr, 사용자가 로그인해 받음). 요약과 sha256만 남긴다.
실행: python -I tools/build_119_arrival.py "<원자료 폴더>" 2025 [2024 ...]
출력: spec/arrival_119_empirical.json

- 신고→현장도착 = grnds_arvl(ymd+tm) − dclr(ymd+tm), 출동→현장도착 = grnds_arvl − dspt. 분 단위.
- 현장 체류 = grnds_dptre − grnds_arvl(현장 출발 기록이 있는 건만).
- 시각이 비었거나 음수이거나 24시간을 넘는 건은 뺀다(뺀 수를 같이 적는다).
- 나눔: 전체, 도시/농촌(cty_frmvl_se_nm), 시도(ctpv_nm), 질병 여부(ptn_ocrn_type_nm == '질병').
"""
import csv
import hashlib
import json
import sys
from datetime import datetime
from pathlib import Path

QS = [0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99]
CUTS = [5, 10, 20, 30, 60]


def ts(ymd: str, tm: str):
    ymd, tm = (ymd or "").strip(), (tm or "").strip()
    if len(ymd) != 8 or len(tm) != 6 or not ymd.isdigit() or not tm.isdigit():
        return None
    try:
        return datetime.strptime(ymd + tm, "%Y%m%d%H%M%S")
    except ValueError:
        return None


class Hist:
    """분 단위 0.1분 격자 히스토그램(메모리 고정)"""

    def __init__(self):
        self.c = [0] * (24 * 600 + 1)
        self.n = 0

    def add(self, m: float):
        self.c[min(len(self.c) - 1, int(round(m * 10)))] += 1
        self.n += 1

    def summary(self):
        if self.n == 0:
            return None
        out, acc, qi = {}, 0, 0
        for i, k in enumerate(self.c):
            acc += k
            while qi < len(QS) and acc >= QS[qi] * self.n:
                out[f"p{int(QS[qi] * 100)}"] = i / 10
                qi += 1
        share = {f"le{c}": round(sum(self.c[: c * 10 + 1]) / self.n, 4) for c in CUTS}
        # 1% 간격 분위 격자(0~100%, 사후 민감도에서 역함수로 씀)
        grid, acc, qi = [], 0, 0
        for i, k in enumerate(self.c):
            acc += k
            while qi <= 100 and acc >= max(1, qi / 100 * self.n):
                grid.append(i / 10)
                qi += 1
        return {"n": self.n, "quantilesMin": out, "shareWithinMin": share, "grid1pct": grid}


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for b in iter(lambda: f.read(1 << 22), b""):
            h.update(b)
    return h.hexdigest()


def run_year(root: Path, year: str):
    p = root / f"구급 현황_{year}_전국" / f"구급 현황_{year}_전국.csv"
    groups: dict[str, dict[str, Hist]] = {}
    drop = {"no_time": 0, "neg_or_gt24h": 0}
    rows = 0

    def g(name: str) -> dict[str, Hist]:
        return groups.setdefault(name, {"callToScene": Hist(), "dispatchToScene": Hist(), "onScene": Hist()})

    with p.open(encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            rows += 1
            t0, t1, ta, td = ts(r["dclr_ymd"], r["dclr_tm"]), ts(r["dspt_ymd"], r["dspt_tm"]), ts(r["grnds_arvl_ymd"], r["grnds_arvl_tm"]), ts(r["grnds_dptre_ymd"], r["grnds_dptre_tm"])
            if t0 is None or ta is None:
                drop["no_time"] += 1
                continue
            m = (ta - t0).total_seconds() / 60
            if not (0 <= m <= 24 * 60):
                drop["neg_or_gt24h"] += 1
                continue
            keys = ["ALL", f"area:{r['cty_frmvl_se_nm'] or '미상'}", f"ctpv:{r['ctpv_nm'] or '미상'}"]
            if r["ptn_ocrn_type_nm"] == "질병":
                keys += ["disease:ALL", f"disease:area:{r['cty_frmvl_se_nm'] or '미상'}"]
            for k in keys:
                gg = g(k)
                gg["callToScene"].add(m)
                if t1 is not None and 0 <= (ta - t1).total_seconds() / 60 <= 24 * 60:
                    gg["dispatchToScene"].add((ta - t1).total_seconds() / 60)
                if td is not None and 0 <= (td - ta).total_seconds() / 60 <= 24 * 60:
                    gg["onScene"].add((td - ta).total_seconds() / 60)
    return {
        "file": p.name, "sha256": sha256(p), "rows": rows, "dropped": drop,
        "groups": {k: {kk: h.summary() for kk, h in v.items()} for k, v in sorted(groups.items())},
    }


def main():
    root = Path(sys.argv[1])
    years = sys.argv[2:] or ["2025"]
    out = {
        "format": "pl26-arrival-119/1",
        "note": "사후 외부 대조(봉인 아님, 실패 가정 점검 10/30). 소방청 전국 구급 현황 건 단위 원자료(bigdata-119.kr). 원자료는 저장소에 없다. 단위 분",
        "years": {y: run_year(root, y) for y in years},
    }
    dst = Path(__file__).resolve().parent.parent / "spec" / "arrival_119_empirical.json"
    dst.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    for y, d in out["years"].items():
        a = d["groups"]["ALL"]["callToScene"]
        print(y, d["rows"], d["dropped"], a["quantilesMin"], a["shareWithinMin"])


if __name__ == "__main__":
    main()
