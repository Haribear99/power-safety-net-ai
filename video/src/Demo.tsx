// 3분 시연영상 합성: 화면 녹화 클립 + 문장별 TTS + 자막 + 장 표시 + 확대(카메라) + 엔딩 카드.
// 원고는 script/scenes.json, 길이는 script/timing.json(TTS 실측), 클립은 record/record.mts가 만든다.
import { Audio, Video } from "@remotion/media";
import { loadFont } from "@remotion/google-fonts/NotoSansKR";
import { AbsoluteFill, Img, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import scenes from "../script/scenes.json";
import timing from "../script/timing.json";

const { fontFamily } = loadFont("normal", { weights: ["500", "700", "800"] });

export const FPS = 30;
export const INTRO = 0.3; // 첫 음성 전 여백(초), build_board.py와 같은 값
export const OUTRO = 4.0; // 엔딩 카드(초)
const W = 1920, H = 1080, BANNER = 44;
const C = { ink: "#16202a", brand: "#1d3a5f", strong: "#142a45", soft: "#e5ecf4", batt: "#1f7a4d", gap: "#b42318" };

type Line = { file: string; text: string; start: number; dur: number };
const T = timing.scenes as { id: string; dur: number; lines: Line[] }[];
const S = scenes.scenes as { id: string; chapter: string; captions: string[] }[];

/** 녹화 구간(record.mts의 SEGS와 같은 묶음) */
const SEGS: { clip: string; scenes: string[] }[] = [
  { clip: "landing-top", scenes: ["hook", "problem", "solution"] },
  { clip: "household", scenes: ["household"] },
  { clip: "ops", scenes: ["ops"] },
  { clip: "lab-notice", scenes: ["notice"] },
  { clip: "lab-proof", scenes: ["proof"] },
  { clip: "lab-limit", scenes: ["limit"] },
  { clip: "ledger", scenes: ["ledger"] },
  { clip: "landing-next", scenes: ["next"] },
];

/** 카메라: 장면 안 문장 번호(line)+초에서 배율 s, 초점(cx, cy)으로 1초 동안 옮겨 간다 */
type Key = { line: number; plus?: number; s: number; cx?: number; cy?: number };
const CAMERA: Record<string, Key[]> = {
  hook: [{ line: 0, s: 1.1, cx: 900, cy: 600 }],
  problem: [{ line: 0, s: 1 }],
  solution: [{ line: 0, s: 1 }],
  household: [{ line: 0, s: 1 }],
  ops: [{ line: 0, s: 1 }, { line: 2, plus: 1.5, s: 1.6, cx: 1600, cy: 560 }, { line: 3, s: 1 }],
  notice: [{ line: 0, s: 1 }],
  proof: [{ line: 0, s: 1 }, { line: 1, s: 1.45, cx: 640, cy: 420 }, { line: 2, s: 1 }],
  limit: [{ line: 0, s: 1 }, { line: 1, plus: 1.5, s: 1.12, cx: 960, cy: 540 }],
  ledger: [{ line: 0, s: 1.3, cx: 960, cy: 520 }],
  next: [{ line: 0, s: 1.15, cx: 960, cy: 560 }],
};

// 장면 시작 시각(초)
const sceneStart: Record<string, number> = {};
{
  let t = INTRO;
  for (const s of T) { sceneStart[s.id] = t; t += s.dur; }
}
export const TOTAL = INTRO + T.reduce((a, s) => a + s.dur, 0) + OUTRO;
const ease = (k: number) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);

function camAt(t: number): { s: number; x0: number; y0: number } {
  // 모든 장면의 키를 절대 시각으로 펼친다
  const keys: { t: number; s: number; cx: number; cy: number }[] = [];
  for (const sc of T) for (const k of CAMERA[sc.id] ?? []) keys.push({ t: sceneStart[sc.id] + sc.lines[k.line].start + (k.plus ?? 0), s: k.s, cx: k.cx ?? W / 2, cy: k.cy ?? H / 2 });
  keys.sort((a, b) => a.t - b.t);
  const view = (k: { s: number; cx: number; cy: number }) => {
    const vw = W / k.s, vh = H / k.s;
    const x0 = Math.min(Math.max(k.cx - vw / 2, 0), W - vw);
    // 확대 중에는 위 배너 띠 아래만 보여 준다(배너는 원본 띠를 따로 얹음)
    const y0 = k.s > 1 ? Math.min(Math.max(k.cy - vh / 2, BANNER), H - vh) : 0;
    return { s: k.s, x0, y0 };
  };
  let i = -1;
  for (let j = 0; j < keys.length; j++) if (keys[j].t <= t) i = j;
  if (i < 0) return view(keys[0]);
  const cur = view(keys[i]);
  // 장면이 바뀌는 첫 키(클립이 바뀜)는 바로 적용, 그 밖에는 1초 동안 옮겨 감
  const sceneBoundary = Object.values(sceneStart).some((st) => Math.abs(st - keys[i].t) < 0.01) || i === 0;
  if (sceneBoundary) return cur;
  const prev = view(keys[i - 1]);
  const k = ease(Math.min(1, (t - keys[i].t) / 1.0));
  return { s: prev.s + (cur.s - prev.s) * k, x0: prev.x0 + (cur.x0 - prev.x0) * k, y0: prev.y0 + (cur.y0 - prev.y0) * k };
}

/** 자막을 2~3초 단위 구로 나눠 보여 준다(레퍼런스 공통 규칙). 쉼표에서 끊고, 시간은 글자 수 비례 */
function chunkAt(l: Line, local: number): string {
  const parts: string[] = [];
  for (const p of l.text.split(/(?<=,)\s+/)) {
    if (parts.length && (parts[parts.length - 1].length < 14 || p.length < 10)) parts[parts.length - 1] += " " + p;
    else parts.push(p);
  }
  if (l.dur < 3.2 || parts.length < 2) return l.text;
  const total = parts.reduce((a, p) => a + p.length, 0);
  let acc = 0;
  const k = (local - l.start) / l.dur;
  for (const p of parts) { acc += p.length / total; if (k <= acc) return p; }
  return parts[parts.length - 1];
}

const Clip: React.FC<{ clip: string }> = ({ clip }) => <Video src={staticFile(`clips/${clip}.mp4`)} muted style={{ width: W, height: H }} />;

export const Demo: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const cam = camAt(t);
  const endAt = TOTAL - OUTRO;

  // 지금 장면·문장
  const sc = [...T].reverse().find((s) => t >= sceneStart[s.id]) ?? T[0];
  const meta = S.find((s) => s.id === sc.id)!;
  const local = t - sceneStart[sc.id];
  const line = [...sc.lines].reverse().find((l) => local >= l.start - 0.05);
  const showLine = line && local <= line.start + line.dur + 0.3 ? line : null;
  const sub = showLine ? chunkAt(showLine, local) : null;
  const inLine = (scene: string, i: number, a = 0, b = 0) => {
    const l = T.find((x) => x.id === scene)!.lines[i];
    const st = sceneStart[scene] + l.start;
    return t >= st + a && t <= st + l.dur + b;
  };
  const fadeIn = (scene: string, i: number, a = 0) => interpolate(t - (sceneStart[scene] + T.find((x) => x.id === scene)!.lines[i].start + a), [0, 0.35], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "white", fontFamily }}>
      {/* 화면 녹화(확대) */}
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <div style={{ width: W, height: H, transformOrigin: "0 0", transform: `scale(${cam.s}) translate(${-cam.x0}px, ${-cam.y0}px)` }}>
          {SEGS.map((g) => {
            const from = Math.round(sceneStart[g.scenes[0]] * fps);
            const dur = Math.round(g.scenes.reduce((a, s) => a + T.find((x) => x.id === s)!.dur, 0) * fps) + (g.clip === "landing-next" ? 0 : 1);
            return <Sequence key={g.clip} from={from} durationInFrames={dur} layout="none"><Clip clip={g.clip} /></Sequence>;
          })}
          {/* 첫 음성 전 여백에는 첫 클립의 첫 프레임 */}
          <Sequence from={0} durationInFrames={Math.round(INTRO * fps)} layout="none"><Clip clip="landing-top" /></Sequence>
        </div>
      </AbsoluteFill>

      {/* 법정 배너: 확대 중에도 원본 크기 띠를 얹는다(인수인계서 5.2절 3번) */}
      {t < endAt ? (
        <div style={{ position: "absolute", left: 0, top: 0, width: W, height: BANNER, overflow: "hidden" }}>
          {SEGS.map((g) => {
            const from = Math.round(sceneStart[g.scenes[0]] * fps);
            const dur = Math.round(g.scenes.reduce((a, s) => a + T.find((x) => x.id === s)!.dur, 0) * fps) + 1;
            return <Sequence key={g.clip} from={from} durationInFrames={dur} layout="none"><Clip clip={g.clip} /></Sequence>;
          })}
          <Sequence from={0} durationInFrames={Math.round(INTRO * fps)} layout="none"><Clip clip="landing-top" /></Sequence>
        </div>
      ) : null}

      {/* 음성 */}
      {T.flatMap((s) => s.lines.map((l) => (
        <Sequence key={l.file} from={Math.round((sceneStart[s.id] + l.start) * fps)} durationInFrames={Math.ceil(l.dur * fps) + 2} layout="none">
          <Audio src={staticFile(l.file)} />
        </Sequence>
      )))}

      {t < endAt ? (
        <>
          {/* 보조 자막(출처·단서): 배너 아래 오른쪽 */}
          {meta.captions.length ? (
            <div style={{ position: "absolute", top: BANNER + 18, right: 28, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10,
              opacity: interpolate(local, [0.2, 0.6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
              {meta.captions.map((c) => (
                <div key={c} style={{ background: "rgba(255,255,255,0.96)", border: `2px solid ${C.brand}`, color: C.strong, borderRadius: 14, padding: "8px 18px", fontSize: 27, fontWeight: 700, maxWidth: 1500, wordBreak: "keep-all", boxShadow: "0 6px 18px rgba(20,42,69,0.18)" }}>{c}</div>
              ))}
            </div>
          ) : null}

          {/* 장 표시 */}
          {meta.chapter ? (
            <div style={{ position: "absolute", left: 40, bottom: 196, background: C.brand, color: "white", borderRadius: 999, padding: "8px 22px", fontSize: 28, fontWeight: 800,
              opacity: interpolate(local, [0, 0.35, 3.5, 4], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>{meta.chapter}</div>
          ) : null}

          {/* 내레이션 자막 */}
          {showLine ? (
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 44, display: "flex", justifyContent: "center" }}>
              <div style={{ maxWidth: 1640, background: "rgba(16,24,34,0.86)", color: "white", borderRadius: 16, padding: "14px 30px", fontSize: 44, fontWeight: 700, lineHeight: 1.38, textAlign: "center", wordBreak: "keep-all" }}>
                {sub}
              </div>
            </div>
          ) : null}

          {/* 큰 통계 카드(레퍼런스 적용 3번): 훅 셋째 문장 */}
          {inLine("hook", 2, 0, 0.6) ? (
            <div style={{ position: "absolute", left: 60, top: 470, background: "white", border: `4px solid ${C.gap}`, borderRadius: 24, padding: "26px 40px", boxShadow: "0 16px 40px rgba(20,42,69,0.25)", opacity: fadeIn("hook", 2) }}>
              <div style={{ fontSize: 34, fontWeight: 700, color: C.ink }}>아파트 정전</div>
              <div style={{ fontSize: 92, fontWeight: 800, color: C.gap, lineHeight: 1.1 }}>7건 중 1건</div>
              <div style={{ fontSize: 44, fontWeight: 800, color: C.ink }}>12시간을 넘김</div>
              <div style={{ marginTop: 10, fontSize: 24, color: "#4a5868" }}>기후에너지환경부 집계 · 최근 3년 382건 중 55건</div>
            </div>
          ) : null}

          {/* 제품명(레퍼런스 적용 5번)과 역할 3칸(6번): 해법 장면 */}
          {inLine("solution", 0, 0, 0.3) ? (
            <div style={{ position: "absolute", left: 60, top: 120, background: C.strong, color: "white", borderRadius: 22, padding: "22px 40px", opacity: fadeIn("solution", 0) }}>
              <div style={{ fontSize: 76, fontWeight: 800 }}>전력안심망 AI</div>
              <div style={{ fontSize: 32, fontWeight: 700, color: C.soft }}>배터리가 버티는 시간을 계산하고, 담당자가 결정합니다</div>
            </div>
          ) : null}
          {inLine("solution", 1, 0, 0.6) ? (
            <div style={{ position: "absolute", left: 0, right: 0, top: 150, display: "flex", justifyContent: "center", gap: 28, opacity: fadeIn("solution", 1) }}>
              {[["AI", "읽고 쓴다", "라벨 글자 옮기기 · 보호자 알림 문장"], ["코드", "계산한다", "배터리 하한 · 처리 순서 · 검증 가능한 규칙"], ["사람", "결정한다", "기종 확인 · 모든 배정 승인"]].map(([who, verb, what]) => (
                <div key={who} style={{ width: 500, background: "white", border: `3px solid ${C.brand}`, borderRadius: 24, padding: "26px 30px", boxShadow: "0 16px 40px rgba(20,42,69,0.22)" }}>
                  <div style={{ fontSize: 60, fontWeight: 800, color: C.strong }}>{who}<span style={{ color: C.brand, fontSize: 46 }}> {verb}</span></div>
                  <div style={{ marginTop: 8, fontSize: 30, fontWeight: 700, color: "#3b4a5a", wordBreak: "keep-all" }}>{what}</div>
                </div>
              ))}
            </div>
          ) : null}

          {/* 사람 행동 바(레퍼런스 적용 9번): 담당자가 승인을 누르는 순간 */}
          {t >= sceneStart.ops + T.find((x) => x.id === "ops")!.lines[1].start + 2.2 && t <= sceneStart.ops + T.find((x) => x.id === "ops")!.lines[2].start + 3 ? (
            <div style={{ position: "absolute", left: 40, top: BANNER + 18, background: C.batt, color: "white", borderRadius: 14, padding: "10px 24px", fontSize: 34, fontWeight: 800, boxShadow: "0 8px 24px rgba(20,42,69,0.25)", opacity: fadeIn("ops", 1, 2.2) }}>
              담당자 행동: 합성 가구 H-030 「119 연계」 승인
            </div>
          ) : null}
        </>
      ) : <EndCard local={t - endAt} />}
    </AbsoluteFill>
  );
};

const EndCard: React.FC<{ local: number }> = ({ local }) => {
  const o = interpolate(local, [0, 0.5], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ background: C.strong, color: "white", alignItems: "center", justifyContent: "center", opacity: o }}>
      <Img src={staticFile("banner-strip.png")} style={{ position: "absolute", top: 0, left: 0, width: W, height: BANNER }} />
      <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: -1 }}>전력안심망 AI</div>
      <div style={{ marginTop: 22, fontSize: 44, fontWeight: 700, color: C.soft }}>AI는 읽고 쓰고, 코드는 계산하고, 결정은 사람이 합니다</div>
      <div style={{ marginTop: 26, fontSize: 30, fontWeight: 700, color: "#f3c1bb" }}>의료 판단 도구가 아닙니다 · 모든 배정은 담당자가 승인합니다 · 시연용 합성 데이터</div>
      <div style={{ marginTop: 40, fontSize: 52, fontWeight: 800, background: "white", color: C.strong, borderRadius: 18, padding: "12px 36px" }}>power-safety-net-ai.vercel.app</div>
      <div style={{ position: "absolute", bottom: 48, left: 80, right: 80, textAlign: "center", fontSize: 26, fontWeight: 500, color: "#c3d1e0", lineHeight: 1.5 }}>{scenes.credits}</div>
    </AbsoluteFill>
  );
};
