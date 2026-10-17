import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 보안 헤더(레드팀 10/18): 다른 사이트 안에 넣기 금지, MIME 추측 금지, 리퍼러 최소화
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ],
    }];
  },
  // 엔진이 저장소 루트 spec/*.json(정본)을 import하므로 루트를 한 단계 위로 둔다(engine/params.ts 주석)
  outputFileTracingRoot: path.resolve(__dirname, ".."),
  turbopack: {
    root: path.resolve(__dirname, ".."),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
