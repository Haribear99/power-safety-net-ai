import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "전력안심망 AI",
  description: "배터리가 먼저 끝날까, 전기가 먼저 올까",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
