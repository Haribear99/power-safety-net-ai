"""OpenTimestamps 클라이언트(ots) 실행 감싸개. Windows에서 python-bitcoinlib이 OpenSSL을 못 찾으면
ctypes.util.find_library가 Python DLLs\libcrypto-3.dll을 돌려주게 한다(seal/CHANGELOG.md S4 절과 같은 방법).
실행: python -I tools/ots.py <ots 인자...>   예: python -I tools/ots.py info seal/S10.txt.ots
"""
import ctypes.util
import os
import sys

_orig = ctypes.util.find_library


def _find(name):
    r = _orig(name)
    if r is None and name in ("ssl", "libeay32", "crypto", "libcrypto"):
        p = os.path.join(sys.base_prefix, "DLLs", "libcrypto-3.dll")
        if os.path.exists(p):
            return p
    return r


ctypes.util.find_library = _find
from otsclient.ots import main  # noqa: E402

sys.argv[0] = "ots"
main()
