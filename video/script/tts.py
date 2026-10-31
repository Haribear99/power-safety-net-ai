"""장면 원고(scenes.json) → 문장별 TTS mp3 + 타이밍(timing.json).

화면 자막은 narration 문장, 음성은 tts 문장(숫자 읽기만 다름)을 쓴다. 두 배열의 문장 수가 같아야 한다.
사용: python -I script/tts.py  (video/ 폴더에서)
"""
import asyncio
import json
import re
import subprocess
import sys
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "tts"
GAP = 0.3  # 문장 사이 쉼(초)
SCENE_PAD = 0.45  # 장면 끝 여유(초)


def split(t: str) -> list[str]:
    return [x for x in re.split(r"(?<=[.!?])\s+", t.strip()) if x]


def duration(p: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)], capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


async def main() -> None:
    d = json.loads((ROOT / "script" / "scenes.json").read_text(encoding="utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    timing = {"voice": d["voice"], "rate": d["rate"], "gap": GAP, "scenePad": SCENE_PAD, "scenes": []}
    total = 0.0
    for s in d["scenes"]:
        shown, spoken = split(s["narration"]), split(s.get("tts", s["narration"]))
        if len(shown) != len(spoken):
            sys.exit(f"{s['id']}: 자막 {len(shown)}문장 ≠ 음성 {len(spoken)}문장")
        t, lines = 0.0, []
        for i, (a, b) in enumerate(zip(shown, spoken)):
            f = OUT / f"{s['id']}-{i:02d}.mp3"
            await edge_tts.Communicate(b, d["voice"], rate=d["rate"]).save(str(f))
            dur = duration(f)
            lines.append({"file": f"tts/{f.name}", "text": a, "start": round(t, 3), "dur": round(dur, 3)})
            t += dur + GAP
        sd = round(t - GAP + SCENE_PAD + s.get("hold", 0), 3)  # hold: 보조 자막을 읽을 추가 시간
        timing["scenes"].append({"id": s["id"], "dur": sd, "lines": lines})
        total += sd
        print(f"{s['id']:<10} {sd:6.2f}s")
    timing["total"] = round(total, 3)
    (ROOT / "script" / "timing.json").write_text(json.dumps(timing, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"합계 {total:.2f}s")


asyncio.run(main())
