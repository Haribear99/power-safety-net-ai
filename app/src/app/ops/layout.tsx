import type { Metadata } from "next";
import { OpsProvider } from "@/components/ops/OpsProvider";

export const metadata: Metadata = { title: "운영자 화면 · 전력안심망 AI" };

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return <OpsProvider>{children}</OpsProvider>;
}
