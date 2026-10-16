import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
