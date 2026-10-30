"""OTS 파일의 모든 대기 캘린더 경로에서 완성된 증명을 받아 합친다(ots upgrade는 증명 하나가 완성되면 나머지 경로를 받지 않는다).
tools/s10-seed.mjs 규칙(B = alice 경로 증명)을 적용하려면 alice 경로 증명이 파일에 있어야 한다.
실행: python -I tools/ots_fetch_all.py seal/S10.txt.ots
"""
import sys

from opentimestamps.calendar import RemoteCalendar
from opentimestamps.core.notary import PendingAttestation
from opentimestamps.core.serialize import BytesSerializationContext, StreamDeserializationContext
from opentimestamps.core.timestamp import DetachedTimestampFile


def walk(ts, out):
    for a in list(ts.attestations):
        if isinstance(a, PendingAttestation):
            out.append((ts, a))
    for c in ts.ops.values():
        walk(c, out)


path = sys.argv[1]
with open(path, "rb") as f:
    dtf = DetachedTimestampFile.deserialize(StreamDeserializationContext(f))
pend = []
walk(dtf.timestamp, pend)
for ts, att in pend:
    try:
        got = RemoteCalendar(att.uri).get_timestamp(ts.msg)
        ts.merge(got)
        print("merged", att.uri)
    except Exception as e:  # 아직 완성 전이거나 연결 실패
        print("skip", att.uri, type(e).__name__, e)
ctx = BytesSerializationContext()
dtf.serialize(ctx)
open(path, "wb").write(ctx.getbytes())
