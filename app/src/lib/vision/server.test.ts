import { describe, expect, it } from "vitest";
import { accessCodeOk, ipBucket, sniffImage } from "./server";

describe("/api/vision 서버 검사(7.2절)", () => {
  it("매직바이트로 jpeg·png·webp만 받는다", () => {
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffImage(new TextEncoder().encode("RIFF1234WEBPVP8 "))).toBe("image/webp");
    expect(sniffImage(new TextEncoder().encode("GIF89a......"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("<svg xmlns="))).toBeNull();
  });
  it("IPv6는 /64로 묶고 IPv4는 그대로", () => {
    expect(ipBucket("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:0db8:0001:0002::/64");
    expect(ipBucket("2001:db8:1:2::9")).toBe(ipBucket("2001:db8:1:2:ffff::1"));
    expect(ipBucket("203.0.113.7")).toBe("203.0.113.7");
    expect(ipBucket(null)).toBe("unknown");
  });
  it("접근 코드: 여러 값 중 하나와 같으면 통과, 22자 미만 값은 무시", () => {
    const env = "short, AAAAAAAAAAAAAAAAAAAAAAAA ,BBBBBBBBBBBBBBBBBBBBBBBBBB";
    expect(accessCodeOk("BBBBBBBBBBBBBBBBBBBBBBBBBB", env)).toBe(true);
    expect(accessCodeOk("AAAAAAAAAAAAAAAAAAAAAAAA", env)).toBe(true);
    expect(accessCodeOk("short", env)).toBe(false);
    expect(accessCodeOk("wrong", env)).toBe(false);
    expect(accessCodeOk("x", undefined)).toBe(false);
  });
});
