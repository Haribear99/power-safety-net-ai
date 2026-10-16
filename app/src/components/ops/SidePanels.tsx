"use client";
// 자원 패널·2D 격자도·감사 로그·누락률 감사 표 (spec.md 1.4절). 지도 타일·GPS는 쓰지 않는다.
import type { Lane } from "@/lib/domain/types";
import { computeLowerBoundDetail } from "@/lib/engine/lowerBound";
import { DEVICE_CLASS_LABEL } from "@/lib/alloc/project119";
import { DB, deviceClass, laneOf, type Session } from "@/lib/ops/session";
import { useOps } from "./OpsProvider";
import { KIND_KO, LANE_KO } from "./labels";

function resourceStatus(s: Session, id: string): string {
  const d = Object.values(s.decisions).find((x) => x.resourceId === id && (x.lane === "PROPOSE_ASSIGN" || x.lane === "GAP_REDUCE"));
  if (d) return `배정(${d.status === "APPROVED" ? "승인" : "수정"}) · ${d.householdId}`;
  const r = s.result?.rows.find((x) => x.rec.resourceId === id);
  if (r) return `추천 · ${r.rec.householdId}`;
  const mr = s.result?.rows.find((x) => x.rec.reservedResourceId === id);
  if (mr) return `검토 예약 · ${mr.rec.householdId}`;
  return "가용";
}

export function ResourcePanel() {
  const { session } = useOps();
  const s = session!;
  const res = s.preset.planner.resources;
  return (
    <section aria-labelledby="res-title" className="rounded-lg border border-line p-3" data-testid="resource-panel">
      <h2 id="res-title" className="text-[16px] font-bold">비상전원 자원 <span className="text-[12px] font-normal text-muted">모의 값</span></h2>
      <GridMap />
      <ul className="mt-2 space-y-1 text-[13px]">
        {res.map((r) => (
          <li key={r.id} className="border-t border-line pt-1">
            <strong>{r.id}</strong> {KIND_KO[r.kind]} · {r.outputW.toLocaleString("ko-KR")}W · {r.energyWh.toLocaleString("ko-KR")}Wh · {r.connectors.join("+")}
            {r.inverterSafe === "unknown" ? " · 인버터 미확인" : ""} · 준비 {r.prepH.lo}~{r.prepH.hi}h · 격자 ({r.cell.x}, {r.cell.y})
            <div className="text-muted">{r.available ? resourceStatus(s, r.id) : "사용 불가"}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const LANE_COLOR: Record<Lane, string> = {
  MANUAL_REVIEW: "#b42318", PROPOSE_ASSIGN: "#1f7a4d", FALLBACK_119: "#1d5fa8", GAP_REDUCE: "#8a5a00",
  FALLBACK_SHELTER: "#4b5866", HOLD: "#4b5866", UNSERVED_VISIBLE: "#b42318",
};

function GridMap() {
  const { session } = useOps();
  const s = session!;
  const S = 28; // px per km
  const W = 10 * S;
  return (
    <svg viewBox={`-6 -6 ${W + 12} ${W + 12}`} className="mt-2 w-full" role="img" aria-label="합성 격자 개략도(10×10km). 원은 가구, 사각형은 자원">
      {Array.from({ length: 11 }, (_, i) => (
        <g key={i} stroke="#d5dbe1" strokeWidth={0.5}>
          <line x1={i * S} y1={0} x2={i * S} y2={W} />
          <line x1={0} y1={i * S} x2={W} y2={i * S} />
        </g>
      ))}
      {s.preset.planner.resources.map((r) => (
        <rect key={r.id} x={r.cell.x * S - 5} y={r.cell.y * S - 5} width={10} height={10} fill="#16202a">
          <title>{r.id} {KIND_KO[r.kind]}</title>
        </rect>
      ))}
      {s.households.map((h) => {
        const lane = s.started ? laneOf(s, h.id) : null;
        return (
          <circle key={h.id} cx={h.cell.x * S} cy={h.cell.y * S} r={4.5} fill={lane ? LANE_COLOR[lane] : "#9aa5b1"} fillOpacity={0.85}>
            <title>{h.pseudonym} {lane ? LANE_KO[lane] : ""}</title>
          </circle>
        );
      })}
    </svg>
  );
}

export function AuditLog() {
  const { session } = useOps();
  const s = session!;
  function download() {
    const blob = new Blob([JSON.stringify(s.audit, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-${s.preset.meta.scenarioId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section aria-labelledby="audit-title" className="mt-6">
      <div className="flex items-center gap-3">
        <h2 id="audit-title" className="text-[18px] font-bold">감사 로그</h2>
        <button type="button" className="rounded border border-line px-2 py-0.5 text-[14px]" onClick={download} data-testid="audit-download">JSON 내려받기</button>
      </div>
      {s.audit.length === 0 ? <p className="mt-1 text-[14px] text-muted">조작 기록이 없습니다.</p> : (
        <div className="mt-2 overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[720px] text-[13px]" data-testid="audit-table">
            <thead className="bg-paper text-left text-muted"><tr><th className="px-2 py-1">모의시각</th><th className="px-2 py-1">주체</th><th className="px-2 py-1">가구</th><th className="px-2 py-1">조작</th><th className="px-2 py-1">변경</th><th className="px-2 py-1">사유</th></tr></thead>
            <tbody>
              {s.audit.map((a, i) => (
                <tr key={i} className="border-t border-line" data-action={a.action}>
                  <td className="px-2 py-1 tabular-nums">{a.at.slice(11, 16)}</td>
                  <td className="px-2 py-1">{a.actor === "system" ? "시스템" : "담당자(시연)"}</td>
                  <td className="px-2 py-1">{a.householdId}</td>
                  <td className="px-2 py-1">{a.action}</td>
                  <td className="px-2 py-1">{LANE_KO[a.from.lane]}{a.from.resourceId ? ` ${a.from.resourceId}` : ""} → {LANE_KO[a.to.lane]}{a.to.resourceId ? ` ${a.to.resourceId}` : ""}</td>
                  <td className="px-2 py-1">{[a.reasonCode, a.reasonText].filter(Boolean).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const AUDIT_LANES: Lane[] = ["PROPOSE_ASSIGN", "FALLBACK_119", "GAP_REDUCE", "UNSERVED_VISIBLE"];

/** 누락률 감사 표: 기기군별로 한 레인에 몰리거나 배정이 0인 군을 드러낸다. 등급은 집계용이며 배정 입력이 아니다(I5) */
export function OmissionAudit() {
  const { session } = useOps();
  const s = session!;
  if (!s.result) return null;
  const reviewed = new Set(s.audit.filter((a) => a.action === "MANUAL_REVIEW_DONE").map((a) => a.householdId));
  const reservedIds = new Set(s.result.rows.filter((r) => r.rec.reservedResourceId || r.reservation?.slot119).map((r) => r.rec.householdId));
  const dims: { name: string; key: (id: string) => string }[] = [
    { name: "기기 등급", key: (id) => DEVICE_CLASS_LABEL[deviceClass(s.households.find((h) => h.id === id)!)] },
    { name: "충전량 출처", key: (id) => ({ device_screen: "기기 화면", user: "자가 입력", unknown: "모름" })[s.households.find((h) => h.id === id)!.device.charge.source] },
    { name: "수동검토 경유", key: (id) => (reviewed.has(id) ? "경유" : computeLowerBoundDetail(s.households.find((h) => h.id === id)!, DB).lb.status === "MANUAL_REVIEW" ? "검토 대기" : "비경유") },
    { name: "기종 확인 상태", key: (id) => s.households.find((h) => h.id === id)!.device.specBy ?? "미확인" },
  ];
  return (
    <section aria-labelledby="omit-title" className="mt-6">
      <h2 id="omit-title" className="text-[18px] font-bold">누락률 감사</h2>
      <p className="text-[13px] text-muted">칸 = 해당 레인 가구 수 / 그 행 가구 수. 분모가 작아 %로 쓰지 않습니다.</p>
      <div className="mt-2 overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[720px] text-[13px]" data-testid="omission-table">
          <thead className="bg-paper text-left text-muted">
            <tr><th className="px-2 py-1">구분</th><th className="px-2 py-1">행</th>{AUDIT_LANES.map((l) => <th key={l} className="px-2 py-1">{LANE_KO[l]}</th>)}<th className="px-2 py-1">검토 예약</th></tr>
          </thead>
          <tbody>
            {dims.flatMap((d) => {
              const groups = new Map<string, string[]>();
              for (const h of s.households) { const k = d.key(h.id); groups.set(k, [...(groups.get(k) ?? []), h.id]); }
              return [...groups.entries()].map(([k, ids]) => (
                <tr key={`${d.name}-${k}`} className="border-t border-line">
                  <td className="px-2 py-1 text-muted">{d.name}</td>
                  <td className="px-2 py-1">{k}</td>
                  {AUDIT_LANES.map((l) => {
                    const n = ids.filter((id) => laneOf(s, id) === l).length;
                    return <td key={l} className={`px-2 py-1 tabular-nums ${l === "UNSERVED_VISIBLE" && n > 0 ? "text-gap" : ""}`}>{n}/{ids.length}</td>;
                  })}
                  <td className="px-2 py-1 tabular-nums">{ids.filter((id) => reservedIds.has(id)).length}/{ids.length}</td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
