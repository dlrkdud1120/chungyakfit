import type { MetadataRoute } from "next";

/** 안드로이드 "홈 화면에 추가"용 앱 정보 (/manifest.webmanifest로 제공됨) */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "청약핏",
    short_name: "청약핏",
    description: "내 청약 가점으로 관심 단지에 당첨 가능성이 있는지 한눈에 봅니다.",
    start_url: "/",
    display: "standalone",
    theme_color: "#1F4E46",
    background_color: "#F7F6F2",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
