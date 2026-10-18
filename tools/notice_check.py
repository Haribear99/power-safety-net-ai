"""N1 보호자 알림 독립 재검사 (TypeScript 검증기와 따로 쓴 최소 검사).

보낸 글(composed.sentences)마다 사실 묶음(facts)에서 시각·시간·전화번호 표기를 직접 뽑고 다음을 본다.
  1. 그 표기가 글에 모두 있다.
  2. 그 표기를 지운 뒤 글에 숫자가 남지 않는다(없는 숫자 = 사실 오류).
  3. 한 문장에 시각·시간 표기가 둘 이상 들어 있지 않다.
TypeScript 검증기(app/src/lib/notice/rules.ts)를 import하지 않는다. 같은 결론이 나오면 '보낸 글 사실 오류 0'을 두 구현이 함께 확인한 것이다.

실행: python tools/notice_check.py out/sealed/n1      (또는 out/n1/<tag>)
"""
import glob
import json
import os
import re
import sys


def expected(facts: dict) -> tuple[list[str], list[str]]:
    """(시각·시간 표기, 전화번호)"""
    times = []
    b = facts["battery"]
    if b["state"] in ("UNTIL", "HOURS"):
        times.append(b["text"])
    if b["state"] == "UNDER30":
        times.append("30분")
    c = facts.get("cylinder") or {}
    if c.get("text"):
        times.append(c["text"])
    p = facts.get("plan") or {}
    for k in ("arriveBy", "doneBy"):
        if p.get(k):
            times.append(p[k])
    return list(dict.fromkeys(times)), ["119", "123"]


def check(facts: dict, sentences: list[str]) -> list[str]:
    times, phones = expected(facts)
    text = " ".join(sentences)
    errs = [f"없음: {t}" for t in times + phones if t not in text]
    for s in sentences:
        rest = s
        for t in sorted(times + phones, key=len, reverse=True):
            rest = rest.replace(t, "\0")
        if re.search(r"\d", rest):
            errs.append(f"없는 숫자: {s}")
        n = 0
        rest2 = s
        for t in sorted(times, key=len, reverse=True):
            n += rest2.count(t)
            rest2 = rest2.replace(t, "\0")
        if n > 1:
            errs.append(f"한 문장에 시각 {n}개: {s}")
    return errs


def main(d: str) -> int:
    # 보낸 글이 있는 생성 항목만(우회 모음 corpus-*.json은 보낸 글이 없다 — 봉인 뒤 수정, CHANGELOG)
    files = sorted(f for f in glob.glob(os.path.join(d, "*.json")) if not f.endswith("summary.json") and not os.path.basename(f).startswith("corpus-"))
    bad = 0
    for f in files:
        row = json.load(open(f, encoding="utf-8"))
        errs = check(row["facts"], row["composed"]["sentences"])
        if errs:
            bad += 1
            print(row["id"], errs)
    print(json.dumps({"dir": d, "n": len(files), "discrepancies": bad}, ensure_ascii=False))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "out/sealed/n1"))
