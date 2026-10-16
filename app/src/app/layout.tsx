import type { Metadata, Viewport } from "next";
import "./globals.css";
import { LegalBanner } from "@/components/LegalBanner";

export const metadata: Metadata = {
  title: "배터리가 먼저 끝날까, 전기가 먼저 올까 · 전력안심망 AI",
  description: "전력의존 가구의 배터리 하한과 정전 복구·비상전원 도착 시각을 비교하고 담당자가 승인하는 운영자 도구(시연용 합성 데이터)",
  openGraph: { title: "배터리가 먼저 끝날까, 전기가 먼저 올까", locale: "ko_KR", type: "website" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="min-h-screen antialiased">
        <LegalBanner />
        {children}
      </body>
    </html>
  );
}
