"""scenes.json + timing.json → submission/video_storyboard.md (콘티 v5).

콘티는 lint:claims·check:report가 검사한다. 원고를 고치면 scenes.json을 고치고 tts.py → 이 스크립트 순서로 다시 만든다.
사용: python -I script/build_board.py  (video/ 폴더에서)
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parent
INTRO = 0.3  # 첫 음성 전 여백(초), Remotion 합성과 같은 값
OUTRO = 4.0  # 엔딩 카드(URL·크레딧) 길이(초)


def mmss(t: float) -> str:
    t = int(round(t))
    return f"{t // 60}:{t % 60:02d}"


d = json.loads((ROOT / "script" / "scenes.json").read_text(encoding="utf-8"))
tm = {s["id"]: s for s in json.loads((ROOT / "script" / "timing.json").read_text(encoding="utf-8"))["scenes"]}
rows, t = [], INTRO
for s in d["scenes"]:
    a, b = t, t + tm[s["id"]]["dur"]
    cap = " ".join(f"자막 '{c}'" for c in s["captions"])
    chap = f"[{s['chapter']}] " if s["chapter"] else ""
    rows.append(f"| {mmss(a if a > 1 else 0)}–{mmss(b)} | {chap}{s['screen']} | 「{s['narration']}」 {cap} |".replace("  ", " "))
    t = b
end = t + OUTRO
rows.append(f"| {mmss(t)}–{mmss(end)} | 엔딩 카드: URL과 크레딧 | 자막 '{d['credits']}' |")

md = f"""# 3분 시연 영상 콘티 ({d['version']}, 2026-10-31 · 공개 단서: 하한 14.9% 넘침, 나간 글 결함 21/60, 판독 보완 위반 7건 · 73%·60%는 같은 실험 E6 · 알림 장면은 /lab ⑨ 봉인 기록)

> 이 파일은 `video/script/build_board.py`가 `video/script/scenes.json`(원고)과 `timing.json`(TTS 실측 길이)으로 만든다. 직접 고치지 말고 원고를 고친 뒤 다시 만든다.
> 숫자는 모두 evidence.json에서 나오며(성과보고서와 같음), 모의 결과·봉인 시험셋 측정·사후 집계를 문장마다 구분해 적는다. 화면 녹화는 운영 URL https://power-safety-net-ai.vercel.app 에서 한다. 첫 10초와 마지막 10초가 훅이다.
> 구조는 `research/video-references.md`의 레퍼런스 분석(훅 → 문제 → 한 문장 해법 → 핵심 흐름 3개 → 근거 → 한계 → 다음 단계·URL)을 따랐다. 총 길이 {mmss(end)}({end:.1f}초).

| 시간 | 화면 | 내레이션·자막 |
|---|---|---|
""" + "\n".join(rows) + f"""

## 녹화 메모
- 해상도 1920×1080, 브라우저 확대 125%(CSS 1536×864 × 1.25). 녹화 스크립트 `video/record/record.mts`, 장면 길이는 timing.json을 따른다.
- 내레이션: edge-tts `{d['voice']}`(속도 {d['rate']}) TTS. 끝 자막에 TTS 사용을 밝힌다(인수인계서 5.1절).
- 자막의 숫자는 `tools/check_report_numbers.py` 통과본과 같아야 한다. 이 콘티의 공개 단서(14.9%·21/60·7건)도 같은 도구가 확인한다.
- 배너 「본 서비스는 AI 기반으로 운용됩니다 · AI: 라벨 판독·알림 문장 · 계산: 검증 가능한 규칙 · 결정: 담당자 · 시연용 합성 데이터」가 모든 장면에 보이게 한다.
- 보호자 알림 장면은 녹화 코드를 쓰지 않고 /lab ⑨의 '봉인 측정 때 AI가 쓴 글'을 보여 준다(심사위원 실시간 생성 예산 보존).
- 승인 장면: 기본 녹화는 녹화 스크립트가 커서를 움직여 승인 버튼을 누른다(화면의 버튼·한 가구씩 승인 구조는 실제 그대로). 인수인계서 5.2절 4번 「사람이 승인 버튼을 누르는 모습」을 글자 그대로 지키려면 `MANUAL_APPROVE=1`로 녹화해 사람이 직접 누른다.
- 레퍼런스 적용(`research/video-references.md` 적용 항목 번호): 1 질문형 훅(사이트 H1 문장), 3 큰 통계 카드 「7건 중 1건」, 5 해법 장면에서 제품명 크게, 6 역할 3칸(AI 읽는다·코드 계산한다·사람 결정한다), 8 설명 요소 확대(승인 서랍·알림 문장·요약 숫자), 9 사람 행동 바(「담당자 행동: 합성 가구 H-030 119 연계 승인」), 12 엔딩 한계 고지(의료 판단 도구 아님·모든 배정은 담당자 승인), 공통 규칙(번인 자막을 쉼표 단위 구로 끊음·최대 2줄·박스형).
- 적용하지 않음: 2 실제 기사 헤드라인 캡처(실제 기관·언론 이미지 금지, 인수인계서 5.2절 7번), 4 가상 인물 카드(합성 가구 번호 H-030으로 대신), 10 분할 화면·11 몽타주(3분 안에 들어가지 않음), 투표 독려 문구(공모전 규정 미확인).
"""
(REPO / "submission" / "video_storyboard.md").write_text(md, encoding="utf-8")
print(f"콘티 {len(rows)}행, 총 {end:.1f}초")
