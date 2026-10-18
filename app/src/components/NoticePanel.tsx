"use client";
// 보호자 알림(쉬운 글·음성) 판. 왼쪽 = 규칙이 정한 사실·할 일(코드), 오른쪽 = 보낼 글(기본 고정 문안, 「AI로 쉬운 글 쓰기」를 누르면 AI 문장 → 1차·2차 검사).
// 음성은 브라우저 내장 낭독(서버 전송 없음). 전송되는 것은 기기 종류·시각 같은 숫자·열거값뿐이다.
import { useMemo, useState } from "react";
import { AiTag } from "@/components/AiTag";
import { compose, speechText, type Composed } from "@/lib/notice/compose";
import { buildFacts, type NoticeInputT } from "@/lib/notice/facts";
import { requirements } from "@/lib/notice/rules";

export function NoticePanel({ input, title }: { input: NoticeInputT; title: string }) {
  const facts = useMemo(() => buildFacts(input), [input]);
  const req = useMemo(() => requirements(facts), [facts]);
  const key = JSON.stringify(input);
  const [state, setState] = useState<{ key: string; composed: Composed; rejected?: string[]; source: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msgState, setMsg] = useState<{ key: string; text: string } | null>(null);
  const [code, setCode] = useState("");
  // 입력(결정·시각)이 바뀌면 이전 생성 결과·메시지는 버리고 고정 문안으로 돌아간다
  const cur = state?.key === key ? state : { key, composed: compose(facts, null), source: "고정 문안(규칙)" };
  const msg = msgState?.key === key ? msgState.text : null;
  const say = (text: string | null) => setMsg(text == null ? null : { key, text });

  async function generate() {
    setBusy(true); say(null);
    try {
      const c = code.replace(/\s+/g, "");
      const r = await fetch("/api/notice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input, ...(c ? { accessCode: c } : {}) }) });
      const j = await r.json();
      if (!r.ok) { say(j.message ?? `생성 실패(${j.error ?? r.status})`); return; }
      if (j.mode === "replay") { say(j.message); setState({ key, composed: j.composed, source: "고정 문안(규칙)" }); return; }
      if (!j.ok) say(`AI 생성 실패(${j.reason}) — 고정 문안을 보냅니다`);
      setState({ key, composed: j.composed, rejected: j.rejected, source: j.ok ? `실시간 생성 · ${j.meta.model} · ${(j.meta.latencyMs / 1000).toFixed(1)}초` : "고정 문안(규칙)" });
    } catch {
      say("생성 요청에 실패했습니다. 고정 문안을 보냅니다");
    } finally { setBusy(false); }
  }
  function speak() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) { say("이 브라우저는 음성 낭독을 지원하지 않습니다"); return; }
    const u = new SpeechSynthesisUtterance(speechText(cur.composed.sentences, cur.composed.source));
    u.lang = "ko-KR"; u.rate = 0.9;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  return (
    <section className="mt-3 rounded-lg border border-line p-3 text-[14px]" data-testid="notice-panel">
      <h3 className="text-[15px] font-bold">{title}</h3>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="font-semibold">규칙이 정한 사실·할 일(바꿀 수 없음)</p>
          <ul className="mt-1 list-disc pl-5" data-testid="notice-facts">
            {req.mustInclude.map((m) => <li key={m.text}><span className="font-mono">{m.text}</span> <span className="text-muted">— {m.hint}</span></li>)}
            {req.mustSentences.map((m) => <li key={m.all.join("+")} className="text-muted">{m.hint}</li>)}
            <li className="text-muted">119·123 문장은 늘 고정 문장으로 붙음</li>
          </ul>
          <p className="mt-1 text-[12px] text-muted">시각은 보수 쪽으로 10분 단위 반올림(배터리는 내림, 도착은 올림)</p>
        </div>
        <div>
          <p className="font-semibold">
            보낼 글 {cur.composed.source === "ai" ? <AiTag kind="생성" note="검증 통과" /> : <span className="rounded border border-line px-1.5 py-0.5 text-[12px]">고정 문안</span>}
          </p>
          <ol className="mt-1 space-y-0.5 text-[16px] leading-7" data-testid="notice-text">
            {cur.composed.sentences.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
          <p className="mt-1 text-[12px] text-muted">{cur.composed.footer} · {cur.source}</p>
        </div>
      </div>
      {cur.composed.violations.length > 0 && (
        <details className="mt-2 rounded bg-gap-soft p-2 text-gap" open data-testid="notice-rejected">
          <summary className="cursor-pointer font-semibold">AI 문장 {cur.composed.rejectedAt === "gate2" ? "2차(역추출) 검사" : "1차(규칙) 검사"} 탈락 {cur.composed.violations.length}건 — 보내지 않음</summary>
          <ul className="mt-1 list-disc pl-5 text-[13px]">{cur.composed.violations.map((v, i) => <li key={i}>{v.code}: {v.detail}{v.sentence ? ` — 「${v.sentence}」` : ""}</li>)}</ul>
          {state?.rejected && <p className="mt-1 text-[13px]">AI 원문: {state.rejected.join(" ")}</p>}
        </details>
      )}
      {msg && <p className="mt-2 rounded bg-warn-soft p-2 text-[13px] text-warn" role="status">{msg}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={generate} disabled={busy} className="rounded bg-ink px-3 py-1 font-semibold text-white disabled:opacity-40" data-testid="notice-generate">
          {busy ? "쓰는 중…" : "AI로 쉬운 글 쓰기"}
        </button>
        <button type="button" onClick={speak} className="rounded border border-ink px-3 py-1" data-testid="notice-speak">소리로 듣기</button>
        <details className="text-[12px]">
          <summary className="cursor-pointer text-muted">심사용 접근 코드</summary>
          <input type="password" className="mt-1 w-48 rounded border border-line px-1" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" aria-label="심사용 접근 코드" />
        </details>
      </div>
      <p className="mt-1 text-[12px] text-muted">AI(생성 Claude Sonnet, 검사 Claude Opus)에는 기기 종류·시각·수단으로 만든 사실표와 그 글만 국외(Anthropic, 미국)로 보냅니다. 이름·주소·가명은 보내지 않습니다. 음성은 이 브라우저가 읽고, AI 글이면 먼저 그 사실을 말합니다.</p>
    </section>
  );
}
