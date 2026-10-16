import { Suspense } from "react";
import { OpsScreen } from "@/components/ops/OpsScreen";

export default function OpsPage() {
  return (
    <Suspense fallback={<main className="p-6 text-[16px]">불러오는 중…</main>}>
      <OpsScreen />
    </Suspense>
  );
}
