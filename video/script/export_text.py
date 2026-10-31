"""납품용 텍스트: 자막 SRT, 내레이션 원고 MD (인수인계서 5.4절).

영상의 자막·음성과 같은 원천(scenes.json, timing.json)에서 만든다.
사용: python -I script/export_text.py  (video/ 폴더에서)
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT.parent / "submission" / "out" / "video"
INTRO, OUTRO = 0.3, 4.0  # src/Demo.tsx와 같은 값

d = json.loads((ROOT / "script" / "scenes.json").read_text(encoding="utf-8"))
tm = json.loads((ROOT / "script" / "timing.json").read_text(encoding="utf-8"))
OUT.mkdir(parents=True, exist_ok=True)


def ts(t: float) -> str:
    ms = int(round(t * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


srt, md, n, t = [], [f"# 시연영상 내레이션 원고 ({d['version']}, 최종)", "", f"음성: edge-tts `{d['voice']}`(속도 {d['rate']}) TTS. 자막은 아래 원고, 음성은 숫자 읽기만 다르게 넣은 낭독문입니다.", ""], 0, INTRO
for s, m in zip(tm["scenes"], d["scenes"]):
    md += [f"## {m['chapter'] or '여는 장면'} ({ts(t)[3:8]}–{ts(t + s['dur'])[3:8]})", "", f"화면: {m['screen']}", ""]
    for line in s["lines"]:
        n += 1
        a, b = t + line["start"], t + line["start"] + line["dur"] + 0.3
        srt += [str(n), f"{ts(a)} --> {ts(b)}", line["text"], ""]
        md.append(f"- {line['text']}")
    if m["captions"]:
        md += ["", "보조 자막: " + " / ".join(f"「{c}」" for c in m["captions"])]
    md.append("")
    t += s["dur"]
n += 1
srt += [str(n), f"{ts(t)} --> {ts(t + OUTRO)}", d["credits"], ""]
md += ["## 엔딩 카드", "", f"- 전력안심망 AI / AI는 읽고 쓰고, 코드는 계산하고, 결정은 사람이 합니다 / power-safety-net-ai.vercel.app", f"- 크레딧: {d['credits']}", "", f"총 길이 {t + OUTRO:.1f}초"]
(OUT / "subtitles.srt").write_text("\n".join(srt), encoding="utf-8")
(OUT / "narration.md").write_text("\n".join(md) + "\n", encoding="utf-8")

# 대조용 화면 글자 전체: 내레이션 자막 + 보조 자막 + 장 표시 + 그래픽 문구(src/Demo.tsx와 같은 문구)
OVERLAYS = [
    "아파트 정전 / 7건 중 1건 / 12시간을 넘김 / 기후에너지환경부 집계 · 최근 3년 382건 중 55건 (훅 셋째 문장)",
    "전력안심망 AI / 배터리가 버티는 시간을 계산하고, 담당자가 결정합니다 (해법 첫 문장)",
    "AI 읽고 쓴다: 라벨 글자 옮기기 · 보호자 알림 문장 / 코드 계산한다: 배터리 하한 · 처리 순서 · 검증 가능한 규칙 / 사람 결정한다: 기종 확인 · 모든 배정 승인 (해법 둘째 문장)",
    "담당자 행동: 합성 가구 H-030 「119 연계」 승인 (운영자 장면, 승인 클릭 순간)",
    "엔딩: 전력안심망 AI / AI는 읽고 쓰고, 코드는 계산하고, 결정은 사람이 합니다 / 의료 판단 도구가 아닙니다 · 모든 배정은 담당자가 승인합니다 · 시연용 합성 데이터 / power-safety-net-ai.vercel.app",
]
full = ["# 화면 글자 전체(대조용)", "", "## 내레이션 자막", ""] + [f"- {l['text']}" for s in tm["scenes"] for l in s["lines"]]
full += ["", "## 보조 자막(장면별)", ""] + [f"- [{m['id']}] {c}" for m in d["scenes"] for c in m["captions"]]
full += ["", "## 장 표시", ""] + [f"- [{m['id']}] {m['chapter']}" for m in d["scenes"] if m["chapter"]]
full += ["", "## 그래픽 문구", ""] + [f"- {o}" for o in OVERLAYS] + ["", f"- 크레딧: {d['credits']}"]
(OUT / "onscreen_text.md").write_text("\n".join(full) + "\n", encoding="utf-8")
print(f"자막 {n}개, 총 {t + OUTRO:.1f}초")
