import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // 서버에서 실행 중에 읽는 파일을 배포 묶음에 포함 (직접 입력 좌표)
  outputFileTracingIncludes: { "/api/coords": ["./data/coords.json"] },
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
