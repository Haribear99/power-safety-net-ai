"""합성 기기 라벨 데이터셋 (spec.md 7.2절 '데이터셋'). 실제 환자 데이터 0, 로고·원본 라벨 이미지 미사용.

렌더(Pillow, 템플릿 8종) + 열화(블러·반사·원근·회전·JPEG·저조도·부분 가림)를 시드 고정으로 만든다.
명세의 HTML + Playwright 렌더 대신 Pillow로 그린다(이 저장소에 Playwright 노드 패키지가 없음, DEVLOG Phase 4).

출력: datasets/labels/<split>/<id>.png|jpg + <id>.json(정답: 필드 원문, 필드 글자 상자, 가림 기록, 열화 매개변수)
      datasets/labels/<split>/manifest.json(파일별 sha256)
템플릿 T7·T8은 봉인 시험셋 전용(dev에 쓰지 않음).

실행: python -I tools/labels/make_labels.py   (저장소 루트에서)
"""
from __future__ import annotations

import hashlib
import io
import json
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "datasets" / "labels"
FONTS = Path("C:/Windows/Fonts")
DB = json.loads((REPO / "spec" / "device_db.json").read_text(encoding="utf-8"))

# ---------- 기기(공개 사양값만) ----------
DEVICES = {d["specId"]: d for d in DB["devices"]}
ITEM_KO = {"VENT": "인공호흡기", "O2": "산소발생기", "COUGH": "기침유발기"}


def item_of(spec_id: str) -> str:
    if spec_id.startswith("PERFECTO") or spec_id.startswith("INOGEN"):
        return "O2"
    if spec_id.startswith("COUGH"):
        return "COUGH"
    return "VENT"


# 모델 표기 변형(같은 기종을 다르게 인쇄) — 정규화(대문자, 공백·하이픈 제거) 뒤 matchKeys와 같다
MODEL_VARIANTS = {
    "LTV1150": ["LTV 1150", "LTV1150", "LTV-1150"],
    "TRILOGY100": ["Trilogy 100", "TRILOGY 100", "Trilogy100"],
    "TRILOGY_EVO": ["Trilogy Evo", "TRILOGY EVO"],
    "ASTRAL150": ["Astral 150", "ASTRAL 150", "Astral150"],
    "PERFECTO2": ["Perfecto2", "PERFECTO2", "IRC5PO2"],
    "INOGEN_G5": ["Inogen One G5", "INOGEN ONE G5", "Inogen G5"],
    "COUGH_E70": ["CoughAssist E70", "COUGHASSIST E70"],
}
# 혼동 미끼와 DB 밖 모델(7.2절). truthSpecId None = DB에 없음 → 수동검토가 정답
DECOYS = [
    ("LTV 1200", "Vyaire(CareFusion)", "VENT"), ("LTV 1105", "Vyaire(CareFusion)", "VENT"), ("LTV 115O", "Vyaire(CareFusion)", "VENT"),
    ("Trilogy 200", "Philips Respironics", "VENT"), ("Trilogy 10O", "Philips Respironics", "VENT"), ("Trilogy I00", "Philips Respironics", "VENT"),
    ("Astral 100", "ResMed", "VENT"), ("Astral 105", "ResMed", "VENT"), ("Astral I50", "ResMed", "VENT"),
    ("Inogen One G4", "Inogen", "O2"), ("Inogen One G3", "Inogen", "O2"), ("Perfecto3", "Invacare", "O2"),
    ("Stellar 150", "ResMed", "VENT"), ("VentiCare X3", "MediBreath", "VENT"), ("OxyLite 5", "AirWell", "O2"),
]

# ---------- 템플릿 ----------
TEMPLATES = {
    "T1": dict(size=(900, 560), bg=(250, 250, 248), fg=(20, 20, 20), font="arial.ttf", bold="arialbd.ttf", lang="en", head="plate"),
    "T2": dict(size=(900, 560), bg=(235, 238, 240), fg=(25, 30, 40), font="malgun.ttf", bold="malgunbd.ttf", lang="ko", head="kfda"),
    "T3": dict(size=(560, 900), bg=(255, 255, 255), fg=(0, 0, 0), font="malgun.ttf", bold="malgunbd.ttf", lang="mixed", head="plate"),
    "T4": dict(size=(900, 560), bg=(40, 44, 52), fg=(235, 235, 235), font="arial.ttf", bold="arialbd.ttf", lang="en", head="dark"),
    "T5": dict(size=(900, 560), bg=(248, 244, 230), fg=(40, 30, 20), font="consola.ttf", bold="consolab.ttf", lang="en", head="table"),
    "T6": dict(size=(560, 900), bg=(242, 247, 242), fg=(10, 40, 20), font="malgun.ttf", bold="malgunbd.ttf", lang="ko", head="table"),
    "T7": dict(size=(900, 560), bg=(255, 252, 240), fg=(30, 30, 60), font="gulim.ttc", bold="malgunbd.ttf", lang="ko", head="kfda"),
    "T8": dict(size=(900, 560), bg=(225, 230, 235), fg=(15, 15, 15), font="cour.ttf", bold="courbd.ttf", lang="mixed", head="table"),
}
TEST_ONLY = {"T7", "T8"}

KEYS = {
    "en": dict(mfr="Manufacturer", model="Model", power="Rated power", volt="Input", batt="Battery", sn="SN", user="Patient", item="Device"),
    "ko": dict(mfr="제조원", model="모델명", power="정격 소비전력", volt="정격 전압", batt="배터리", sn="제조번호", user="사용자", item="품목명"),
    "mixed": dict(mfr="제조원 Manufacturer", model="모델명 Model", power="정격 Rated", volt="전원 Input", batt="배터리 Battery", sn="S/N", user="사용자", item="품목명"),
}


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / name), size)


def make_fields(rng: random.Random, spec_id: str | None, decoy: tuple | None, lang: str) -> dict:
    if decoy:
        model, mfr, kind = decoy
        draw_hi = 60 if kind == "VENT" else 300
        batt_h = rng.choice([None, 1, 3, 6])
    else:
        d = DEVICES[spec_id]
        model = rng.choice(MODEL_VARIANTS[spec_id])
        mfr = d["manufacturer"]
        kind = item_of(spec_id)
        draw_hi = d["drawW"]["value"]["hi"]
        batt_h = d["internalH"]["value"] or None
    volt = rng.choice(["AC 100-240V ~ 50/60Hz", "AC 220V ~ 60Hz", "100-240 V~, 50/60 Hz"])
    power = f"{draw_hi} W" if rng.random() < 0.5 else f"{draw_hi}W"
    if batt_h is None:
        batt = None
    elif lang == "ko":
        batt = f"내장 리튬이온 약 {batt_h}시간"
    else:
        batt = f"Internal Li-ion approx. {batt_h} h"
    sn = f"SN-{rng.choice('ABCDEFGHJK')}{rng.choice('ABCDEFGHJK')}{rng.randint(10, 99)}-{rng.randint(1000, 9999)}"
    user = rng.choice(["김○○", "이○○", "박○○"]) if lang != "en" else rng.choice(["K. ○○", "L. ○○"])
    show_user = rng.random() < 0.35
    return dict(manufacturer=mfr, model=model, ratedPower=power, voltage=volt, batteryText=batt, sn=sn,
                user=user if show_user else None, item=ITEM_KO[kind] if lang != "en" else {"VENT": "Home ventilator", "O2": "Oxygen concentrator", "COUGH": "Cough assist"}[kind])


def render(tid: str, fields: dict, rng: random.Random) -> tuple[Image.Image, dict]:
    t = TEMPLATES[tid]
    W, H = t["size"]
    img = Image.new("RGB", (W, H), t["bg"])
    dr = ImageDraw.Draw(img)
    k = KEYS[t["lang"]]
    big = 34 if W > H else 30
    f_key, f_val, f_head = font(t["font"], big - 8), font(t["font"], big), font(t["bold"], big + 6)
    margin = 40
    y = margin
    dr.rectangle([8, 8, W - 9, H - 9], outline=t["fg"], width=3)
    head = {"plate": "MEDICAL DEVICE", "kfda": "의료기기 표시사항", "dark": "RATING LABEL", "table": "SPECIFICATIONS"}[t["head"]]
    dr.text((margin, y), head, fill=t["fg"], font=f_head)
    y += big + 26
    boxes: dict[str, dict] = {}
    order = ["item", "mfr", "model", "power", "volt", "batt", "sn", "user"]
    field_of = {"item": "item", "mfr": "manufacturer", "model": "model", "power": "ratedPower", "volt": "voltage", "batt": "batteryText", "sn": "sn", "user": "user"}
    vertical = H > W
    step = big + (22 if not vertical else 30)
    for key in order:
        val = fields[field_of[key]]
        if val is None:
            continue
        label = f"{k[key]}:"
        if vertical:
            dr.text((margin, y), label, fill=t["fg"], font=f_key)
            y += big - 2
            vx = margin + 10
        else:
            dr.text((margin, y + 6), label, fill=t["fg"], font=f_key)
            vx = margin + 330
        if t["head"] == "table" and not vertical:
            dr.line([margin, y + big + 12, W - margin, y + big + 12], fill=t["fg"], width=1)
        dr.text((vx, y), val, fill=t["fg"], font=f_val)
        # 글자 상자(가림 판정용)
        chars = []
        for i in range(len(val)):
            x0 = vx + f_val.getlength(val[:i])
            x1 = vx + f_val.getlength(val[: i + 1])
            chars.append([round(x0, 1), y, round(x1, 1), y + big + 6])
        boxes[field_of[key]] = dict(text=val, bbox=[vx, y, vx + f_val.getlength(val), y + big + 6], chars=chars)
        y += step
    return img, boxes


def occlude(img: Image.Image, boxes: dict, rng: random.Random) -> dict:
    """부분 가림(손가락·스티커). 모델 또는 다른 필드 값의 일부 글자를 가리고 가린 글자 위치를 돌려준다"""
    cand = [f for f in ("model", "manufacturer", "ratedPower", "batteryText") if f in boxes]
    f = "model" if rng.random() < 0.6 and "model" in boxes else rng.choice(cand)
    b = boxes[f]
    n = len(b["text"])
    if n < 3:
        return {}
    start = rng.randint(0, n - 2)
    length = rng.randint(1, max(1, min(n - start, n // 2)))
    x0, y0 = b["chars"][start][0] - 2, b["bbox"][1] - 6
    x1, y1 = b["chars"][start + length - 1][2] + 2, b["bbox"][3] + 6
    dr = ImageDraw.Draw(img)
    color = rng.choice([(60, 45, 35), (210, 170, 140), (230, 230, 80)])
    dr.rounded_rectangle([x0, y0, x1, y1], radius=8, fill=color)
    return {f: list(range(start, start + length))}


def solve(A: list[list[float]], B: list[float]) -> list[float]:
    n = len(B)
    M = [row[:] + [b] for row, b in zip(A, B)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(M[r][c]))
        M[c], M[p] = M[p], M[c]
        for r in range(n):
            if r != c:
                f = M[r][c] / M[c][c]
                M[r] = [a - f * b for a, b in zip(M[r], M[c])]
    return [M[i][n] / M[i][i] for i in range(n)]


def perspective(img: Image.Image, rng: random.Random, deg: float) -> Image.Image:
    W, H = img.size
    d = math.tan(math.radians(abs(deg))) * 0.25 * W
    sx = rng.choice([-1, 1])
    src = [(0, 0), (W, 0), (W, H), (0, H)]
    dst = [(d if sx > 0 else 0, 0), (W - (0 if sx > 0 else d), 0), (W - (0 if sx > 0 else d), H), (d if sx > 0 else 0, H)]
    dst = [(x, y + (d * 0.3 if i in (0, 1) and sx > 0 else 0)) for i, (x, y) in enumerate(dst)]
    # 투영 계수(8×8 연립방정식, 가우스 소거 — 외부 의존 없음)
    A, B = [], []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); B.append(v)
    coeffs = solve(A, B)
    return img.transform((W, H), Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=(120, 120, 120))


def degrade(img: Image.Image, boxes: dict, rng: random.Random, strength: str) -> tuple[Image.Image, dict, dict]:
    params: dict = {}
    occluded: dict = {}
    ops = ["blur", "glare", "persp", "rot", "jpeg", "dark", "occl"]
    k = rng.randint(2, 4) if strength == "full" else 1
    chosen = rng.sample(ops, k)
    if "occl" in chosen:
        occluded = occlude(img, boxes, rng)
        params["occlusion"] = occluded
    if "glare" in chosen:
        ov = Image.new("L", img.size, 0)
        W, H = img.size
        cx, cy = rng.uniform(0.2, 0.8) * W, rng.uniform(0.2, 0.8) * H
        rx, ry = rng.uniform(0.1, 0.25) * W, rng.uniform(0.08, 0.2) * H
        ImageDraw.Draw(ov).ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=rng.randint(150, 230))
        ov = ov.filter(ImageFilter.GaussianBlur(25))
        img = Image.composite(Image.new("RGB", img.size, (255, 255, 255)), img, ov)
        params["glare"] = [round(cx), round(cy), round(rx), round(ry)]
    if "persp" in chosen:
        deg = rng.uniform(8, 25)
        img = perspective(img, rng, deg)
        params["perspectiveDeg"] = round(deg, 1)
    if "rot" in chosen:
        a = rng.uniform(-10, 10)
        img = img.rotate(a, resample=Image.BICUBIC, expand=True, fillcolor=(120, 120, 120))
        params["rotateDeg"] = round(a, 1)
    if "blur" in chosen:
        s = rng.uniform(0.8, 3.0)
        img = img.filter(ImageFilter.GaussianBlur(s))
        params["blurSigma"] = round(s, 2)
    if "dark" in chosen:
        f = rng.uniform(0.35, 0.7)
        img = img.point(lambda v: int(v * f))
        params["dark"] = round(f, 2)
    q = rng.randint(20, 60) if "jpeg" in chosen else 90
    params["jpegQ"] = q
    return img, params, occluded


def save(img: Image.Image, path_noext: Path, q: int) -> Path:
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=q, optimize=False)
    p = path_noext.with_suffix(".jpg")
    p.write_bytes(buf.getvalue())
    return p


def build(split: str, plan: list[tuple[str, str]], seed0: int) -> None:
    d = OUT / split
    d.mkdir(parents=True, exist_ok=True)
    manifest = []
    spec_ids = list(DEVICES)
    tids = [t for t in TEMPLATES if split == "test" or t not in TEST_ONLY]
    for i, (kind, strength) in enumerate(plan):
        rng = random.Random(seed0 + i)
        sid = f"{split}-{i:03d}"
        tid = rng.choice(tids) if split == "dev" else (rng.choice(sorted(TEST_ONLY)) if i % 4 == 0 else rng.choice([t for t in tids if t not in TEST_ONLY]))
        lang = TEMPLATES[tid]["lang"]
        if kind == "decoy":
            decoy = rng.choice(DECOYS)
            spec_id = None
        else:
            decoy = None
            spec_id = rng.choice(spec_ids)
        fields = make_fields(rng, spec_id, decoy, lang)
        img, boxes = render(tid, fields, rng)
        params, occluded = {}, {}
        if strength != "none":
            img, params, occluded = degrade(img, boxes, rng, strength)
        p = save(img, d / sid, params.get("jpegQ", 92))
        truth = dict(id=sid, split=split, kind=kind, strength=strength, template=tid, lang=lang,
                     truthSpecId=spec_id, decoy=decoy is not None, fields={k: v for k, v in fields.items() if k in ("manufacturer", "model", "ratedPower", "voltage", "batteryText")},
                     personalInfoVisible=fields["user"] is not None, occluded=occluded, degrade=params,
                     boxes={k: dict(bbox=v["bbox"]) for k, v in boxes.items()})
        (d / f"{sid}.json").write_text(json.dumps(truth, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
        for f in (p, d / f"{sid}.json"):
            manifest.append(dict(file=f.name, sha256=hashlib.sha256(f.read_bytes()).hexdigest()))
    (d / "manifest.json").write_text(json.dumps(dict(split=split, n=len(plan), files=manifest), ensure_ascii=False, indent=1), encoding="utf-8")
    print(split, len(plan), "장 →", d)


def main() -> None:
    # dev 40: 깨끗 16, 열화 16, 미끼 8 (템플릿 T1~T6)
    dev = [("real", "none")] * 16 + [("real", "full")] * 16 + [("decoy", "none")] * 4 + [("decoy", "light")] * 4
    random.Random(1).shuffle(dev)
    build("dev", dev, 70_000)
    # 봉인 시험 120: 열화 60, 깨끗 30, 혼동·미등록 30 (T7·T8 전용 템플릿 포함)
    test = [("real", "full")] * 60 + [("real", "none")] * 30 + [("decoy", "none")] * 15 + [("decoy", "light")] * 15
    random.Random(2).shuffle(test)
    build("test", test, 90_000)


if __name__ == "__main__":
    main()
