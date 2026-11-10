import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // 예전 주소로 들어와도 새 주소로 보내기
  async redirects() {
    return [
      { source: "/notices", destination: "/notice", permanent: false },
      { source: "/possibility", destination: "/check", permanent: false },
    ];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
