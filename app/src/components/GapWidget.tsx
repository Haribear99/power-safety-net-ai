"use client";
// 30초 비교 위젯 (spec.md 1.3절). 계산은 빌드 때 서버에서 끝낸 값만 쓰고, 클라이언트는 고르기만 한다. API 호출 없음.
import { useState } from "react";

export interface WidgetDevice { key: string; label: string; specH: number; lowerH: number; formula: string; source: string }
export interface WidgetCause { key: string; label: string; p10: number; p50: number; p90: number; source: string }

const fmt = (h: number) => (h >= 10 ? h.toFixed(0) : h.toFixed(1));

export function GapWidget({ devices, causes }: { devices: WidgetDevice[]; causes: WidgetCause[] }) {
  const [di, setDi] = useState(2);
  const [ci, setCi] = useState(1);
  const d = devices[di];
  const c = causes[ci];
  const maxH = Math.max(12, Math.ceil(c.p90 / 6) * 6);
  const pct = (h: number) => `${Math.min(100, (h / maxH) * 100)}%`;
  const surely = Math.max(0, c.p10 - d.lowerH);
  const possibly = Math.max(0, c.p90 - d.lowerH);
  return (
    <section aria-labelledby="gw-title" className="card p-5" data-testid="gap-widget">
      <h2 id="gw-title" className="text-[20px] font-extrabold text-brand-strong">30초 비교: 우리 집 기기와 정전 유형</h2>
      <fieldset className="mt-3">
        <legend className="text-[14px] text-muted">기기</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {devices.map((x, i) => (
            <button key={x.key} type="button" aria-pressed={i === di} onClick={() => setDi(i)}
              className={`rounded-full border px-3 py-1.5 text-[15px] ${i === di ? "border-brand bg-brand text-white" : "border-line bg-white"}`}>
              {x.label}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="mt-3">
        <legend className="text-[14px] text-muted">정전 유형</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {causes.map((x, i) => (
            <button key={x.key} type="button" aria-pressed={i === ci} onClick={() => setCi(i)}
              className={`rounded-full border px-3 py-1.5 text-[15px] ${i === ci ? "border-brand bg-brand text-white" : "border-line bg-white"}`}>
              {x.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 space-y-2" aria-hidden>
        <div className="flex items-center gap-2 text-[13px]">
          <span className="w-16 shrink-0 text-muted">배터리</span>
          <div className="relative h-4 flex-1 rounded bg-paper">
            <div className="absolute h-4 rounded bg-batt" style={{ width: pct(d.lowerH) }} />
          </div>
        </div>
        <div className="flex items-center gap-2 text-[13px]">
          <span className="w-16 shrink-0 text-muted">복구 범위</span>
          <div className="relative h-4 flex-1 rounded bg-paper">
            <div className="absolute h-4 rounded bg-restore-soft" style={{ left: pct(c.p10), width: `calc(${pct(c.p90)} - ${pct(c.p10)})` }} />
            <div className="absolute h-4 w-0.5 bg-restore" style={{ left: pct(c.p50) }} />
          </div>
        </div>
        <div className="flex items-center gap-2 text-[13px]">
          <span className="w-16 shrink-0 text-muted">공백</span>
          <div className="relative h-4 flex-1 rounded bg-paper">
            {surely > 0 && <div className="absolute h-4 bg-gap" style={{ left: pct(d.lowerH), width: `calc(${pct(c.p10)} - ${pct(d.lowerH)})` }} />}
            {possibly > 0 && (
              <div className="absolute h-4 bg-gap-soft"
                style={{ left: pct(Math.max(d.lowerH, c.p10)), width: `calc(${pct(c.p90)} - ${pct(Math.max(d.lowerH, c.p10))})`,
                  backgroundImage: "repeating-linear-gradient(45deg, transparent 0 4px, rgba(180,35,24,.45) 4px 6px)" }} />
            )}
          </div>
        </div>
        <div className="flex justify-between pl-[4.5rem] text-[12px] text-muted"><span>0</span><span>{maxH / 2}시간</span><span>{maxH}시간</span></div>
      </div>

      <p className="mt-3 text-[16px] leading-7" data-testid="gw-summary" aria-live="polite">
        배터리 하한 <strong>{fmt(d.lowerH)}시간</strong> · 복구 범위 <strong>{fmt(c.p10)}~{fmt(c.p90)}시간</strong>(중앙 {fmt(c.p50)}시간)
        {surely > 0 ? (
          <> → 범위의 가장 이른 복구에서도 <strong className="text-gap">{fmt(surely)}시간</strong> 동안 전원이 비고, 늦으면 최대 {fmt(possibly)}시간</>
        ) : possibly > 0 ? (
          <> → 복구가 늦어지면 최대 <strong className="text-gap">{fmt(possibly)}시간</strong> 공백</>
        ) : (
          <> → 이 범위 안에서는 배터리가 먼저 끝나지 않음</>
        )}
      </p>
      <p className="mt-2 text-[13px] text-muted">가정 시나리오 범위 · 한전 실시간 예측 아님</p>
      <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-[12px] text-muted">
        <li>배터리 하한: {d.formula}. {d.source}</li>
        <li>복구 범위: {c.source}</li>
      </ol>
    </section>
  );
}
