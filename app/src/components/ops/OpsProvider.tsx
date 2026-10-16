"use client";
// /ops·/ops/119가 함께 쓰는 탭 세션 상태(spec.md 1.4절 '상태 보관'). 서버 DB 없음, 새로고침하면 초기화.
// ops/layout.tsx 안에 두므로 /ops ↔ /ops/119 클라이언트 이동에는 상태가 유지된다.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import suwon from "@/data/presets/suwon.json";
import seosan from "@/data/presets/seosan.json";
import rotating from "@/data/presets/rotating.json";
import { newSession, recompute, start, type Session, type UiPreset } from "@/lib/ops/session";

export const PRESETS: UiPreset[] = [suwon, seosan, rotating] as unknown as UiPreset[];
export const SPEEDS = [0, 1, 60, 600] as const;
export type Speed = (typeof SPEEDS)[number];
/** 재계산 주기: 모의시간 5분(1.4절 '재계산', 제안값) */
const RECOMPUTE_EVERY_S = 300;
const TICK_MS = 500;

interface OpsCtx {
  session: Session | null;
  presetId: string | null;
  speed: Speed;
  latencyMs: number | null;
  load: (scenarioId: string) => void;
  startOutage: () => void;
  setSpeed: (s: Speed) => void;
  update: (fn: (s: Session) => Session) => void;
}

const Ctx = createContext<OpsCtx | null>(null);

export function OpsProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [speed, setSpeed] = useState<Speed>(0);
  const [latencyMs, setLatency] = useState<number | null>(null);
  const t0 = useRef<number | null>(null);

  const load = useCallback((id: string) => {
    const p = PRESETS.find((x) => x.meta.scenarioId === id) ?? PRESETS[0];
    setPresetId(p.meta.scenarioId);
    setSession(newSession(p));
    setSpeed(0);
    setLatency(null);
  }, []);

  const startOutage = useCallback(() => {
    t0.current = performance.now();
    setSession((s) => (s ? start(s) : s));
  }, []);

  // 정전 → 순위 표시 지연: 클릭부터 결과가 그려진 다음 프레임까지(실측)
  useEffect(() => {
    if (t0.current != null && session?.result) {
      const begin = t0.current;
      t0.current = null;
      requestAnimationFrame(() => setLatency(Math.round(performance.now() - begin)));
    }
  }, [session?.result]);

  useEffect(() => {
    if (!session?.started || speed === 0) return;
    const id = setInterval(() => {
      setSession((s) => {
        if (!s) return s;
        const n = s.nowS + Math.round((speed * TICK_MS) / 1000);
        const crossed = Math.floor(n / RECOMPUTE_EVERY_S) !== Math.floor(s.nowS / RECOMPUTE_EVERY_S);
        return crossed ? recompute(s, n) : { ...s, nowS: n };
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [session?.started, speed]);

  const update = useCallback((fn: (s: Session) => Session) => setSession((s) => (s ? fn(s) : s)), []);
  const value = useMemo(() => ({ session, presetId, speed, latencyMs, load, startOutage, setSpeed, update }),
    [session, presetId, speed, latencyMs, load, startOutage, update]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOps(): OpsCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("OpsProvider 밖");
  return c;
}
