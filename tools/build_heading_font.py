"""제목용 Pretendard 하위집합을 만든다(10/30 디자인 개편).
본문까지 Pretendard 동적 하위집합(92조각)을 쓰면 랜딩이 조각 20여 개(약 520KB)를 받아 로컬 Lighthouse FCP 4.1초·LCP 5~6초가 됐다
(글꼴 없이 FCP 0.8초·LCP 2.2초). 그래서 본문은 시스템 글꼴로 두고, 제목(h1~h3)·로고에 실제로 쓰인 글자만 담은 파일 하나를 쓴다.
실행: python -I tools/build_heading_font.py <Pretendard-ExtraBold.otf 경로>
  → app/public/fonts/pretendard-display.woff2 (+ 쓰인 글자 수 출력). 새 제목 글자는 다시 실행해야 들어간다(없으면 시스템 글꼴로 보임).
랜딩 전용 작은 파일(10/30 레드팀: 41KB 글꼴이 LCP 전에 받아져 로컬 LCP +0.4초): 랜딩 제목·로고 글자만 담은
  pretendard-display-landing.woff2를 함께 만들고, globals.css의 unicode-range(표시 줄 사이)를 다시 쓴다.
  두 파일은 글자가 겹치지 않고 각자 unicode-range를 단다(범위 없는 큰 파일은 Chrome이 랜딩에서도 받았다, 10/30 측정).
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
# 제목에 동적으로 들어가는 글자(10/30 레드팀 2R): 운영 화면 시나리오 이름 h2, 서랍 제목 h2의 기기 이름
import json
for f in (SRC / "data" / "presets").glob("*.json"):
    chars |= set(re.findall(r"[가-힣]", json.loads(f.read_text(encoding="utf-8"))["meta"]["name"]))
_lab = re.search(r"DEVICE_CLASS_LABEL[^{]*\{(.*?)\};", (SRC / "lib" / "alloc" / "project119.ts").read_text(encoding="utf-8"), re.S)
chars |= set(re.findall(r"[가-힣]", _lab.group(1)))
# 랜딩(/)에서 이 글꼴로 그려지는 글자: 랜딩 파일들의 h1~h3 + 로고
LANDING = [SRC / "app" / "page.tsx", *(SRC / "components" / n for n in ("TwoClocks.tsx", "GapWidget.tsx", "ClosingCard.tsx"))]
landing = set("전력안심망") | set(" ,.?!·()~%-0123456789")
for f in LANDING:
    for m in pat.finditer(f.read_text(encoding="utf-8")):
        landing |= set(re.findall(r"[가-힣ㄱ-ㆎ]|[ -~]", re.sub(r"\{[^}]*\}|<[^>]+>", "", m.group(1))))
landing &= chars | set(" ")


def build(text: str, name: str) -> Path:
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    font = subset.load_font(sys.argv[1], opts)
    s = subset.Subsetter(opts)
    s.populate(text=text)
    s.subset(font)
    out = REPO / "app" / "public" / "fonts" / name
    subset.save_font(font, str(out), opts)
    return out


rest = chars - landing
for text, name in (("".join(sorted(rest)), "pretendard-display.woff2"), ("".join(sorted(landing)), "pretendard-display-landing.woff2")):
    out = build(text, name)
    print(len(text), "글자 →", out, out.stat().st_size, "B")

# globals.css의 두 unicode-range를 실제 글자에 맞춘다
css = SRC / "app" / "globals.css"
t = css.read_bytes().decode("utf-8")  # 줄바꿈(CRLF) 그대로
for key, cs in (("landing", landing), ("rest", rest)):
    if f"{key}-range:start" not in t:
        raise SystemExit(f"globals.css에 {key}-range 표시 줄이 없음")
    rng = ", ".join(f"U+{ord(c):04X}" for c in sorted(cs))
    t = re.sub(rf"(/\* {key}-range:start \*/).*?(/\* {key}-range:end \*/)", lambda m: f"{m.group(1)} unicode-range: {rng}; {m.group(2)}", t, flags=re.S)
css.write_bytes(t.encode("utf-8"))
