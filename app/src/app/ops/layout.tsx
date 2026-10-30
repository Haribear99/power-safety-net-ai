import type { Metadata } from "next";
import { OpsProvider } from "@/components/ops/OpsProvider";

export const metadata: Metadata = { title: "운영자 화면 · 전력안심망 AI" };

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return (
    <OpsProvider>
      <p className="mx-auto max-w-[1400px] px-4 pt-2 text-[13px] text-muted">이 운영자 화면(119 연계 화면 포함) 밖으로 나가면 모의 정전이 처음부터 다시 시작됩니다.</p>
      {children}
    </OpsProvider>
  );
}
