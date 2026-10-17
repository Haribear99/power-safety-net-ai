// /api/vision 서버 보조 (spec.md 7.2절 '업로드 처리'). 서버 전용 — 클라이언트에서 import하지 않는다.
import { createHash, timingSafeEqual } from "node:crypto";
import type { UpstashBackend } from "../claude/budget";

/** 매직바이트로 jpeg·png·webp만 받는다 */
export function sniffImage(buf: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length >= 12 && String.fromCharCode(...buf.slice(0, 4)) === "RIFF" && String.fromCharCode(...buf.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

/** IP 키: IPv6는 /64 접두사(앞 4그룹)로 묶는다(주소를 바꿔 가며 우회하는 것을 막음) */
export function ipBucket(ip: string | null | undefined): string {
  if (!ip) return "unknown";
  const v = ip.trim();
  if (v.includes(":")) {
    const full = expandV6(v);
    return full ? `${full.slice(0, 4).join(":")}::/64` : v;
  }
  return v;
}
function expandV6(ip: string): string[] | null {
  const [head, tail] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : null;
  if (t === null) return h.length === 8 ? h.map((x) => x.toLowerCase().padStart(4, "0")) : null;
  const fill = 8 - h.length - t.length;
  if (fill < 0) return null;
  return [...h, ...Array(fill).fill("0"), ...t].map((x) => x.toLowerCase().padStart(4, "0"));
}

/** 접근 코드(쉼표로 여러 값). 모든 값과 비교한 뒤 합친다(조기 반환 없음). 길이 차이는 sha256으로 같은 길이로 만든다 */
export function accessCodeOk(code: string | null | undefined, env = process.env.JUDGE_ACCESS_CODE): boolean {
  if (!code || !env) return false;
  const want = env.split(",").map((s) => s.trim()).filter((s) => s.length >= 22);
  const h = (s: string) => createHash("sha256").update(s).digest();
  const got = h(code);
  let ok = false;
  for (const w of want) ok = timingSafeEqual(got, h(w)) || ok;
  return ok;
}

/** 시간 창 카운터(INCR + EXPIRE). 한도를 넘으면 false */
export async function hit(be: UpstashBackend, key: string, limit: number, ttlSec: number): Promise<boolean> {
  const n = Number(await be.raw(["INCR", key]));
  if (n === 1) await be.raw(["EXPIRE", key, ttlSec]);
  return n <= limit;
}

export const hourKey = (d = new Date()) => d.toISOString().slice(0, 13);
