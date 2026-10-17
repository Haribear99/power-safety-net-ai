"use client";
// /ops/119 (spec.md 1.5절, I7). 운영자가 결정한 FALLBACK_119 행만, View119 정확히 3필드. 파기 버튼.
import Link from "next/link";
import { project119 } from "@/lib/alloc/project119";
import { sToH } from "@/lib/engine/quantize";
import { lEndH, purge119, visible119Ids } from "@/lib/ops/session";
import { useOps } from "@/components/ops/OpsProvider";

export default function Page119() {
  const { session, update, presetId } = useOps();
  const shown = session ? new Set(visible119Ids(session)) : new Set<string>();
  const rows = session
    ? project119(Object.values(session.decisions).filter((d) => shown.has(d.householdId)).map((d) => ({
      householdId: d.householdId, lane: d.lane, status: d.status, lEndH: lEndH(session.households.find((h) => h.id === d.householdId)!),
    })), session.households, session.preset.meta.baseIso)
    : [];
  const now = session ? sToH(session.nowS) : 0;
  const base = session ? session.preset.meta.baseIso : "";
  return (
    <main className="mx-auto max-w-2xl px-4 pb-12 pt-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[22px] font-extrabold">119 연계 화면</h1>
        <Link href={`/ops${presetId ? `?s=${presetId}` : ""}`} className="text-[15px] underline">← 운영자 화면</Link>
      </div>
      <p className="mt-1 text-[14px] text-muted">담당자가 승인한 119 연계 건만 보입니다. 전달 항목은 위치·기기·예상 안전시간 세 가지뿐입니다.</p>
      {rows.length === 0 ? (
        <p className="mt-6 rounded-lg border border-line p-4 text-[17px]" data-testid="empty-119">승인된 119 연계 건이 없습니다</p>
      ) : (
        <ul className="mt-4 space-y-3" data-testid="list-119">
          {rows.map((r, i) => {
            const t = r.expectedSafeUntil;
            const isTime = /^\d{4}-/.test(t);
            const remH = isTime && session ? (Date.parse(t) - Date.parse(base)) / 3600000 - now : null;
            return (
              <li key={i} className="rounded-lg border border-line p-3 text-[16px]" data-testid="row-119">
                <dl className="grid grid-cols-[7rem_1fr] gap-y-1">
                  <dt className="text-muted">위치</dt><dd data-field="location">{r.location}</dd>
                  <dt className="text-muted">기기</dt><dd data-field="device">{r.device}</dd>
                  <dt className="text-muted">예상 안전시간</dt>
                  <dd data-field="expectedSafeUntil">
                    {isTime ? <>소진 하한 시각 {t.slice(11, 16)}(모의시각) · 남은 하한 {Math.max(0, Math.round((remH ?? 0) * 10) / 10)}h</> : t}
                  </dd>
                </dl>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-6 rounded-lg bg-paper p-3 text-[14px]">
        <p>재난 대응 종료 시 파기(재난안전법 제74조의3⑤). 지금 보이는 건만 지우고 감사 기록에 남깁니다. 이후 새로 승인한 건은 다시 보입니다.</p>
        <button type="button" className="mt-2 rounded border border-gap px-3 py-1 font-semibold text-gap disabled:opacity-40" disabled={!session || rows.length === 0}
          onClick={() => update(purge119)} data-testid="purge-119">파기</button>
      </div>
    </main>
  );
}
