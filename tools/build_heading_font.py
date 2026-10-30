"""제목용 Pretendard 하위집합을 만든다(10/30 디자인 개편).
본문까지 Pretendard 동적 하위집합(92조각)을 쓰면 랜딩이 조각 20여 개(약 520KB)를 받아 로컬 Lighthouse FCP 4.1초·LCP 5~6초가 됐다
(글꼴 없이 FCP 0.8초·LCP 2.2초). 그래서 본문은 시스템 글꼴로 두고, 제목(h1~h3)·로고에 실제로 쓰인 글자만 담은 파일 하나를 쓴다.
실행: python -I tools/build_heading_font.py <Pretendard-ExtraBold.otf 경로>
  → app/public/fonts/pretendard-display.woff2 (+ 쓰인 글자 수 출력). 새 제목 글자는 다시 실행해야 들어간다(없으면 시스템 글꼴로 보임).
원본: Pretendard v1.3.9(github.com/orioncactus/pretendard, SIL OFL 1.1 — app/public/fonts/OFL-Pretendard.txt).
"""
import re
import sys
from pathlib import Path

from fontTools import subset

REPO = Path(__file__).resolve().parents[1]
SRC = REPO / "app" / "src"
chars = set(chr(c) for c in range(0x20, 0x7F))  # ASCII 전체
chars |= set("·「」『』‘’“”…→←①②③④⑤⑥⑦⑧⑨⑩×−~%()")
pat = re.compile(r"<h[123][^>]*>(.*?)</h[123]>", re.S)
for f in SRC.rglob("*.tsx"):
    t = f.read_text(encoding="utf-8")
    for m in pat.finditer(t):
        chars |= set(re.findall(r"[\uac00-\ud7a3\u3131-\u318e]", m.group(1)))
    # title 속성으로 넘기는 절 제목(lab Section) 등
    for m in re.finditer(r'title="([^"]+)"', t):
        chars |= set(re.findall(r"[\uac00-\ud7a3]", m.group(1)))
chars |= set("전력안심망")
opts = subset.Options()
opts.flavor = "woff2"
opts.layout_features = ["*"]
opts.name_IDs = ["*"]
opts.notdef_outline = True
font = subset.load_font(sys.argv[1], opts)
s = subset.Subsetter(opts)
s.populate(text="".join(sorted(chars)))
s.subset(font)
out = REPO / "app" / "public" / "fonts" / "pretendard-display.woff2"
subset.save_font(font, str(out), opts)
print(len(chars), "글자 →", out, out.stat().st_size, "B")
