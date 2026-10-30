import type { Metadata, Viewport } from "next";
import "./globals.css";
import { LegalBanner } from "@/components/LegalBanner";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteNav } from "@/components/SiteNav";

export const metadata: Metadata = {
  metadataBase: new URL("https://power-safety-net-ai.vercel.app"),
  title: "배터리가 먼저 끝날까, 전기가 먼저 올까 · 전력안심망 AI",
  description: "전력의존 가구의 배터리 하한과 정전 복구·비상전원 도착 시각을 비교하고 담당자가 승인하는 운영자 도구(시연용 합성 데이터)",
  openGraph: { title: "배터리가 먼저 끝날까, 전기가 먼저 올까", locale: "ko_KR", type: "website", images: [{ url: "/og.jpg", width: 1200, height: 630, alt: "정전된 아파트 단지에서 한 집만 기기 불빛이 켜진 일러스트(AI 생성)" }] },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="min-h-screen antialiased">
        <LegalBanner />
        <SiteNav />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
