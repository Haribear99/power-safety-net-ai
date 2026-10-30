"""OTS 증명 확인(비트코인 노드 없이). 실행: python -I tools/ots_check.py <파일> <파일.ots>
- 대상 파일의 sha256이 .ots의 다이제스트와 같은지
- 각 BitcoinBlockHeaderAttestation(높이)의 메시지가 그 블록의 머클 루트와 같은지(blockstream.info·mempool.space 두 곳)
- 남은 PendingAttestation의 캘린더 URL
결과를 JSON으로 출력한다. tools/s10-seed.mjs가 쓴다.
"""
import hashlib
import json
import sys
import urllib.request

from opentimestamps.core.notary import BitcoinBlockHeaderAttestation, PendingAttestation
from opentimestamps.core.serialize import StreamDeserializationContext
from opentimestamps.core.timestamp import DetachedTimestampFile

APIS = ["https://blockstream.info/api", "https://mempool.space/api"]


def get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "pl26-ots-check"}), timeout=30) as r:
        return r.read()


def block(height: int) -> dict:
    seen = []
    for api in APIS:
        h = get(f"{api}/block-height/{height}").decode().strip()
        b = json.loads(get(f"{api}/block/{h}"))
        seen.append({"api": api, "hash": h, "merkle_root": b["merkle_root"], "timestamp": b["timestamp"]})
    if any((x["hash"], x["merkle_root"], x["timestamp"]) != (seen[0]["hash"], seen[0]["merkle_root"], seen[0]["timestamp"]) for x in seen):
        raise SystemExit(f"블록 탐색기 불일치 {seen}")
    return seen[0]


def main():
    target, ots = sys.argv[1], sys.argv[2]
    with open(ots, "rb") as f:
        dtf = DetachedTimestampFile.deserialize(StreamDeserializationContext(f))
    digest = hashlib.sha256(open(target, "rb").read()).digest()
    out = {"digestMatch": dtf.file_digest == digest, "bitcoin": [], "pending": [], "byCalendar": {}}
    for msg, att in dtf.timestamp.all_attestations():
        if isinstance(att, BitcoinBlockHeaderAttestation):
            b = block(att.height)
            out["bitcoin"].append({"height": att.height, "hash": b["hash"], "nTime": b["timestamp"], "merkleOk": msg[::-1].hex() == b["merkle_root"]})
        elif isinstance(att, PendingAttestation):
            out["pending"].append(att.uri)
    out["bitcoin"].sort(key=lambda x: x["height"])

    # 캘린더별 비트코인 높이: 대기 증명 URI가 하나뿐인 가장 큰 하위 트리의 비트코인 증명을 그 캘린더 몫으로 본다
    def walk(ts):
        uris, heights = set(), set()
        for a in ts.attestations:
            if isinstance(a, PendingAttestation):
                uris.add(a.uri)
            elif isinstance(a, BitcoinBlockHeaderAttestation):
                heights.add(a.height)
        kids = [walk(c) for c in ts.ops.values()]
        for u, h in kids:
            uris |= u
            heights |= h
        for u, h in kids:
            if len(u) == 1 and len(uris) > 1:
                (uri,) = u
                out["byCalendar"].setdefault(uri, set()).update(h)
        return uris, heights

    u, h = walk(dtf.timestamp)
    if len(u) == 1:
        (uri,) = u
        out["byCalendar"].setdefault(uri, set()).update(h)
    out["byCalendar"] = {k: sorted(v) for k, v in sorted(out["byCalendar"].items())}
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
