# 출처: 형제 저장소 AI 라이프 솔루션 챌린지/tools/fill_report_docx.py 복사(spec.md 7.1절). 고친 점 없음.
# -*- coding: utf-8 -*-
"""성과보고서 Word 양식에 submission/report_draft.md 1부를 채운다(제출물 37).
  python -I tools/fill_report_docx.py <양식.docx> <report_draft.md> <출력.docx>
표 0의 2열(행 1~7)에 칸별 문안을 넣는다. 기존 첫 문단의 글꼴·크기를 그대로 쓰고 안내 문구는 지운다. 2장 제한은 Word로 렌더링해 확인한다.
"""
import copy, re, sys
import docx

FIELDS = ["AI 기술명", "아이디어명", "기술요약 (3줄 이내)", "최종목표 (2줄 이내)", "개발 내용 및 결과", "개발 과정에서 애로점", "기대효과"]

def part1(md: str) -> dict:
    body = md.split("## 1부.")[1].split("\n---")[0]
    out = {}
    for i, f in enumerate(FIELDS):
        nxt = FIELDS[i + 1] if i + 1 < len(FIELDS) else None
        seg = body.split(f"### {f}\n")[1]
        if nxt: seg = seg.split(f"### {nxt}\n")[0]
        # [KEIT 확인 …]·[사용자 기입 …] 같은 작성 표기는 제출본에서 보이지 않게 둔다(검토용 docx에는 남긴다)
        seg = seg.strip("\n")
        out[f] = re.sub(r"\*\*(.+?)\*\*", r"\1", seg).replace("`", "")  # 마크다운 굵게·백틱 제거(양식은 일반 글)
    return out

URL_RE = re.compile(r"https?://[^\s)]+[^\s).,]")  # 끝의 닫는 괄호·마침표는 링크에서 뺀다

def add_hyperlink(para, url: str, rpr):
    """문단에 외부 링크 run을 붙인다(PDF에서도 링크 주석이 생기게)."""
    from docx.opc.constants import RELATIONSHIP_TYPE as RT
    from docx.oxml.ns import qn
    from docx.oxml import OxmlElement
    rid = para.part.relate_to(url, RT.HYPERLINK, is_external=True)
    h = OxmlElement("w:hyperlink"); h.set(qn("r:id"), rid)
    r = OxmlElement("w:r")
    if rpr is not None: r.append(copy.deepcopy(rpr))
    t = OxmlElement("w:t"); t.text = url; t.set(qn("xml:space"), "preserve"); r.append(t)
    h.append(r); para._p.append(h)

def set_cell(cell, text: str):
    first = cell.paragraphs[0]
    run0 = first.runs[0] if first.runs else None
    font = (run0.font.name, run0.font.size, run0.font.bold) if run0 else (None, None, None)
    rpr = copy.deepcopy(run0._r.rPr) if run0 is not None and run0._r.rPr is not None else None
    ppr = copy.deepcopy(first._p.pPr) if first._p.pPr is not None else None
    for p in cell.paragraphs[1:]:
        p._p.getparent().remove(p._p)
    for r in list(first.runs): r._r.getparent().remove(r._r)
    lines = text.split("\n")
    para = first
    for i, line in enumerate(lines):
        if i > 0:
            para = cell.add_paragraph()
            if ppr is not None: para._p.insert(0, copy.deepcopy(ppr))
        m = URL_RE.search(line)
        head = line[: m.start()] if m else line
        run = para.add_run(head)
        if rpr is not None: run._r.insert(0, copy.deepcopy(rpr))
        run.font.bold = False
        if m:
            add_hyperlink(para, m.group(0), rpr)
            if line[m.end():]:
                tail = para.add_run(line[m.end():])
                if rpr is not None: tail._r.insert(0, copy.deepcopy(rpr))

def main(form, md_path, out):
    md = open(md_path, encoding="utf-8").read()
    vals = part1(md)
    d = docx.Document(form)
    t = d.tables[0]
    for i, f in enumerate(FIELDS):
        set_cell(t.rows[i + 1].cells[1], vals[f])
    d.save(out)
    print("wrote", out, {k: len(v) for k, v in vals.items()})

if __name__ == "__main__":
    main(*sys.argv[1:4])
