"use client";
// /household 보호자 등록 (spec.md 1.6절). AI는 라벨 글자를 옮기기만 하고(AI 추출), DB 대조·하한 계산은 코드가 한다.
// 샘플은 API를 부르지 않고 봉인 측정 때 받은 실제 출력을 재생한다. 업로드는 체크 2개를 모두 해야 열린다.
import { useMemo, useState } from "react";
import Link from "next/link";
import samplesRaw from "@/data/samples.json";
import { AiTag } from "@/components/AiTag";
import { FLAG_KO } from "@/components/ops/labels";
import type { HouseholdView } from "@/lib/domain/types";
import { computeLowerBoundDetail, DEFAULT_DB } from "@/lib/engine/lowerBound";
import { prepInput } from "@/lib/notice/facts";
import { NoticePanel } from "@/components/NoticePanel";
import { LABEL_FIELDS, matchLabel, type LabelField, type LabelOutT, type MatchResult } from "@/lib/vision/label";

interface Sample { key: string; title: string; src: string; label: LabelOutT; recorded: string; latencyMs: number }
const SAMPLES = (samplesRaw as unknown as { samples: Sample[] }).samples;

const FIELD_KO: Record<LabelField, string> = { manufacturer: "제조사", model: "모델명", ratedPower: "정격 소비전력", voltage: "정격 전압", batteryText: "배터리 표기" };
const LEG_KO = { clear: "또렷함", partial: "일부만 보임", illegible: "읽을 수 없음" } as const;
const REASON_KO: Record<string, string> = { NO_MODEL: "모델명을 읽지 못했습니다", NOT_CONFIDENT: "판독이 불확실합니다(일부만 보이거나 확신 낮음)", NOT_IN_DB: "검증 사양 DB에 없는 모델명입니다" };

type Result = { label: LabelOutT; match: MatchResult; source: string };

/** 긴 변 1568px, JPEG q85로 줄인다(캔버스로 다시 그려 EXIF 제거) */
async function shrink(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 1568 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  const url = c.toDataURL("image/jpeg", 0.85);
  return url.slice(url.indexOf(",") + 1);
}

export function HouseholdScreen() {
  const [tab, setTab] = useState<"sample" | "upload">("sample");
  const [res, setRes] = useState<Result | null>(null);
  const [img, setImg] = useState<string | null>(null);
  const [ok1, setOk1] = useState(false), [ok2, setOk2] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function upload(f: File) {
    setBusy(true); setMsg(null); setRes(null);
    try {
      const b64 = await shrink(f);
      if (b64.length > 2 * 1024 * 1024) { setMsg("이미지가 너무 큽니다"); return; }
      setImg(`data:image/jpeg;base64,${b64}`);
      const r = await fetch("/api/vision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ imageBase64: b64, consent: { synthetic: ok1, overseas: ok2 }, ...(code.replace(/\s+/g, "") ? { accessCode: code.replace(/\s+/g, "") } : {}) }) });
      const j = await r.json();
      if (j.mode === "replay") { setMsg(j.message); setTab("sample"); return; }
      if (!r.ok || !j.ok) { setMsg(j.message ?? `판독 실패(${j.error ?? j.reason})`); return; }
      setRes({ label: j.label, match: j.match, source: `실시간 판독 · ${j.meta.model} · ${(j.meta.latencyMs / 1000).toFixed(1)}초` });
    } catch {
      setMsg("판독 요청에 실패했습니다");
    } finally { setBusy(false); }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 text-[16px] leading-7">
      <h1 className="text-[22px] font-extrabold">보호자 등록: 기기 라벨 읽기</h1>
      <p className="mt-1 text-[15px]">AI는 라벨의 글자를 옮겨 적기만 합니다. 어떤 기종인지 정하고 배터리 하한을 계산하는 것은 코드이고, 기종 확인은 담당자가 합니다.</p>
      <div className="mt-3 flex gap-2" role="tablist">
        {(["sample", "upload"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setRes(null); setImg(null); setMsg(null); }}
            className={`rounded-lg border px-3 py-1 text-[15px] ${tab === t ? "border-ink bg-ink text-white" : "border-line"}`}>
            {t === "sample" ? "샘플 라벨(기본)" : "사진 올리기"}
          </button>
        ))}
      </div>
      {msg ? <p className="mt-3 rounded-lg bg-warn-soft p-2 text-[14px] text-warn" role="status">{msg}</p> : null}

      {tab === "sample" ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="samples">
          {SAMPLES.map((s) => (
            <button key={s.key} className="rounded-lg border border-line p-1 text-left text-[13px] hover:border-ink"
              onClick={() => { setImg(s.src); setRes({ label: s.label, match: matchLabel(s.label), source: `${s.recorded} 재생 · ${(s.latencyMs / 1000).toFixed(1)}초` }); }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.src} alt={`샘플 라벨: ${s.title}`} className="aspect-[9/6] w-full rounded object-cover" />
              <span className="mt-1 block">{s.title}</span>
            </button>
          ))}
        </div>
      ) : (
        <section className="mt-3 rounded-lg border border-line p-3 text-[14px]" data-testid="upload">
          <p className="text-gap">이 서비스는 이미지를 저장하지 않습니다. 판독을 위해 국외 AI 사업자(Anthropic, 미국) API로 전송되며, 해당 사업자 정책에 따라 최대 30일(정책 위반으로 분류되면 최대 2년) 보관될 수 있습니다(<a className="underline" href="https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data" target="_blank" rel="noreferrer">정책</a>). 실제 환자 라벨·성명·시리얼은 올리지 마세요.</p>
          <label className="mt-2 flex gap-2"><input type="checkbox" checked={ok1} onChange={(e) => setOk1(e.target.checked)} />합성 라벨이거나 환자가 쓰지 않는 기기의 라벨입니다</label>
          <label className="mt-1 flex gap-2"><input type="checkbox" checked={ok2} onChange={(e) => setOk2(e.target.checked)} />국외 전송에 동의합니다</label>
          <label className="mt-2 block">심사용 접근 코드(선택) <input type="password" className="ml-1 w-56 rounded border border-line px-1" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" /></label>
          <input className="mt-2 block" type="file" accept="image/jpeg,image/png,image/webp" disabled={!ok1 || !ok2 || busy} data-testid="upload-input"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
          {busy ? <p className="mt-1">판독 중…</p> : null}
        </section>
      )}

      {res && img ? <ResultView res={res} img={img} /> : null}
      <p className="mt-8 text-[14px]"><Link className="underline" href="/">← 처음으로</Link> · <Link className="underline" href="/ops?s=PRESET-SUWON">운영자 화면</Link> · <Link className="underline" href="/ledger">AI 사용 장부(정확도 실측)</Link></p>
    </main>
  );
}

function ResultView({ res, img }: { res: Result; img: string }) {
  const { label, match } = res;
  const [confirmed, setConfirmed] = useState(false);
  return (
    <section className="mt-4" data-testid="result">
      <div className="grid gap-3 sm:grid-cols-[260px_1fr]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img} alt="판독한 라벨" className="w-full rounded border border-line" />
        <div>
          <p className="text-[13px] text-muted">{res.source}</p>
          <table className="mt-1 w-full text-[14px]" data-testid="extract-table">
            <tbody>
              {LABEL_FIELDS.map((f) => (
                <tr key={f} className="border-t border-line align-top">
                  <th className="w-28 py-1 text-left font-normal text-muted">{FIELD_KO[f]}</th>
                  <td className="py-1">
                    <AiTag kind="추출" /> <span className="font-mono">{label[f].verbatim ?? "—"}</span>
                    <span className="ml-1 text-[12px] text-muted">{LEG_KO[label[f].legibility]} · 확신 {label[f].confidence === "high" ? "높음" : "낮음"}</span>
                  </td>
                </tr>
              ))}
              <tr className="border-t border-line"><th className="py-1 text-left font-normal text-muted">개인정보</th><td className="py-1">{label.personalInfoVisible ? "사람 이름 칸이 보입니다(값은 옮기지 않음)" : "보이지 않음"}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      {match.status === "MATCHED" ? (
        <div className="mt-3 rounded-lg border border-batt bg-batt-soft p-3" data-testid="match-ok">
          <p className="font-bold">검증 사양 DB와 정확히 일치: {DEFAULT_DB.devices.get(match.specId)!.manufacturer} {DEFAULT_DB.devices.get(match.specId)!.model}</p>
          <p className="text-[14px]">제조사 사양 내장배터리 {DEFAULT_DB.devices.get(match.specId)!.internalH.value}시간 · 소비전력 최대 {DEFAULT_DB.devices.get(match.specId)!.drawW.value.hi}W</p>
          {!confirmed ? (
            <button className="mt-2 rounded-lg bg-ink px-3 py-1 text-white" onClick={() => setConfirmed(true)}>이 기종이 맞습니다</button>
          ) : <LowerBoundForm specId={match.specId} />}
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-gap bg-gap-soft p-3 text-gap" data-testid="match-review">
          <p className="font-bold">수동검토 대기 — 자동 계산하지 않습니다</p>
          <p className="text-[14px]">{REASON_KO[match.reason]}{match.normalized ? ` (판독 키 ${match.normalized})` : ""}. 담당자가 기종을 확인하면 하한이 계산됩니다.</p>
          {match.candidates.length ? <p className="mt-1 text-[14px]">후보(확인 필요, 계산에 쓰지 않음): {match.candidates.map((c) => DEFAULT_DB.devices.get(c)!.model).join(", ")}</p> : null}
        </div>
      )}
    </section>
  );
}

function LowerBoundForm({ specId }: { specId: string }) {
  const [src, setSrc] = useState<"device_screen" | "user" | "unknown">("unknown");
  const [pct, setPct] = useState(100);
  const [ext, setExt] = useState(0);
  const [cg, setCg] = useState(true);
  const { d, prep } = useMemo(() => {
    const hh: HouseholdView = {
      id: "W", pseudonym: "W", cell: { x: 0, y: 0 }, floor: 1, mobilityNeed: false, caregiver: cg, tReport: 0, lEndPrev: null,
      device: { specId, specBy: "ai_label_user_confirmed", batteryAgeY: null, charge: { value: src === "unknown" ? null : pct, source: src } },
      ext: ext > 0 ? [{ extSpecId: null, declaredCount: ext, opVerified: null }] : [],
    };
    return { d: computeLowerBoundDetail(hh, DEFAULT_DB), prep: prepInput(hh, DEFAULT_DB) };
  }, [specId, src, pct, ext, cg]);
  const lb = d.lb;
  return (
    <div className="mt-3 rounded-lg border border-line bg-white p-3 text-ink" data-testid="lb-form">
      <fieldset className="text-[14px]">
        <legend className="font-bold">지금 충전량</legend>
        {(["device_screen", "user", "unknown"] as const).map((s) => (
          <label key={s} className="mr-3"><input type="radio" name="src" checked={src === s} onChange={() => setSrc(s)} /> {({ device_screen: "기기 화면", user: "직접 입력", unknown: "모름" })[s]}</label>
        ))}
        {src !== "unknown" ? <label className="ml-2">충전량 <input type="number" min={0} max={100} value={pct} onChange={(e) => setPct(Math.max(0, Math.min(100, Number(e.target.value))))} className="w-16 rounded border border-line px-1" />%</label> : null}
      </fieldset>
      <label className="mt-2 block text-[14px]">외장배터리 보유 개수(신고만) <input type="number" min={0} max={4} value={ext} onChange={(e) => setExt(Math.max(0, Math.min(4, Number(e.target.value))))} className="w-14 rounded border border-line px-1" /></label>
      <p className="mt-3 text-[18px] font-bold" data-testid="lb-hours">배터리 하한 {lb.hours == null ? "계산 안 함" : `${lb.hours.toFixed(2)}시간`}</p>
      <ul className="mt-1 text-[14px]">
        {lb.terms.map((t, i) => <li key={i}>{t.label}: {t.hours.toFixed(2)}h</li>)}
        {ext > 0 ? <li className="text-muted">신고한 외장배터리 {ext}개: 0시간으로 계산(운영자 확인 전)</li> : null}
      </ul>
      {lb.flags.length ? <p className="mt-1 text-[13px] text-warn">{lb.flags.map((f) => FLAG_KO[f]).join(" · ")}</p> : null}
      <p className="mt-2 text-[13px] text-muted">입력해도 하한은 제조사 사양의 90%(+운영자 확인분)를 넘지 못합니다 · 충전량 입력은 현재 상태 갱신용 · AI 판독 기종은 운영자 「기종 확인」 전까지 이웃 기종 최소값으로 계산합니다</p>
      <label className="mt-3 flex gap-2 text-[14px]"><input type="checkbox" checked={cg} onChange={(e) => setCg(e.target.checked)} />보호자가 있음(없으면 본인에게 쓰는 안내)</label>
      <NoticePanel input={prep} title="대비 안내(쉬운 글·음성): 완충·외장배터리·갈 곳·연락처" audience="household" />
    </div>
  );
}
