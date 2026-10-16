// 봉인 대상 시나리오 정의: 표준 50건(spec.md 5.6절, S2b)과 프리셋 3개(5.7절, S2b). 비AI.
// 정의(시드·구성·θ)만 여기 두고, 실제 시나리오는 materialize로 펼친다. spec/standard50.json에는 정의와 materialize sha256을,
// spec/presets/*.json에는 materialize 전체를 싣는다(scripts/build-standard50.ts, scripts/build-presets.ts).
// 시드는 배정기 결과를 보기 전에 정했다(프리셋 1001~1003은 개발 시드 범위 1~10,000 안, 5.4절).
import { CAUSES, type Cause } from "../domain/types";
import { GEN_CLASSES, type GenClass } from "./labels";
import { standardTheta } from "./lhs";
import { SIM_PARAMS } from "./generator";
import { canonicalJson, materialize, sha256Hex, type MaterializedScenario, type ScenarioDef } from "./materialize";

/** 5.6절: 시드 = 20261017 + idx */
export const STD50_SEED_BASE = 20261017;
/** 5.6절: N = 30, 초점 등급 12가구(40%) + 혼합 18가구 */
export const STD50_N = 30;
export const STD50_FOCUS = 12;
/** 5.6절: 가구/자원 비 1.5/3/6 순환(17/16/16) */
export const STD50_RATIOS = [1.5, 3, 6] as const;
/** 5.6절: ROTATING 1건은 60가구(전 주택 1순위 = 모든 가구가 단전 대상), 혼합 구성 */
export const STD50_ROTATING_N = 60;
/** ROTATING 건의 가구/자원 비(명세에 없음 → 표준 θ의 3, DEVLOG TASK C 결정) */
export const STD50_ROTATING_RATIO = 3;

export const CAUSES7: readonly Cause[] = CAUSES.filter((c) => c !== "ROTATING");

const pad2 = (n: number) => String(n).padStart(2, "0");

export interface Std50Case {
  idx: number;
  def: ScenarioDef;
}

export function standard50Defs(): Std50Case[] {
  const base = standardTheta();
  const out: Std50Case[] = [];
  let idx = 0;
  for (const cls of GEN_CLASSES) {
    for (const cause of CAUSES7) {
      const ratio = STD50_RATIOS[idx % STD50_RATIOS.length];
      out.push({
        idx,
        def: {
          scenarioId: `STD50-${pad2(idx)}`, seed: String(STD50_SEED_BASE + idx), cause,
          theta: { ...base, hhPerResource: ratio },
          nRegistered: STD50_N, nResources: Math.round(STD50_N / ratio),
          focusClass: cls as GenClass, nFocus: STD50_FOCUS, table: "gamma",
        },
      });
      idx++;
    }
  }
  out.push({
    idx,
    def: {
      scenarioId: `STD50-${pad2(idx)}`, seed: String(STD50_SEED_BASE + idx), cause: "ROTATING",
      theta: { ...base, hhPerResource: STD50_ROTATING_RATIO },
      nRegistered: STD50_ROTATING_N, nResources: Math.round(STD50_ROTATING_N / STD50_ROTATING_RATIO),
      focusClass: null, nFocus: 0, table: "gamma",
    },
  });
  return out;
}

export interface PresetDef {
  file: string;
  name: string;
  description: string;
  def: ScenarioDef;
}

/** 5.7절: 30가구, 자원 10개, 시드 고정, 표준 θ */
export function presetDefs(): PresetDef[] {
  const th = { ...standardTheta(), hhPerResource: 3 };
  const mk = (scenarioId: string, seed: string, cause: Cause): ScenarioDef => ({
    scenarioId, seed, cause, theta: th, nRegistered: 30, nResources: 10, focusClass: null, nFocus: 0, table: "gamma",
  });
  return [
    {
      file: "suwon.json", name: "수원형 야간 변압기",
      description: "아파트 단지 야간 변압기 고장(APT_NIGHT_XFMR). 랜딩 CTA 시나리오(1.3절)",
      def: mk("PRESET-SUWON", "1001", "APT_NIGHT_XFMR"),
    },
    {
      file: "seosan.json", name: "서산형 부품 조달",
      description: "아파트 부품 조달 지연(APT_PARTS, 서산 13~14h 사건)",
      def: mk("PRESET-SEOSAN", "1002", "APT_PARTS"),
    },
    {
      file: "rotating.json", name: "순환단전",
      description: "예비력 부족 순환단전 1h 블록(ROTATING, NEAR_CERTAIN)",
      def: mk("PRESET-ROTATING", "1003", "ROTATING"),
    },
  ];
}

// ---------- 봉인 파일 문서 ----------
export const STD50_FORMAT = "pl26-standard50/1" as const;
export const PRESET_FORMAT = "pl26-preset/1" as const;

/** 보조 장부(sim_params.json) 정본 sha256 — 생성 규칙이 바뀌면 봉인 파일이 달라진다 */
export function simParamsSha256(): string {
  return sha256Hex(canonicalJson(Object.fromEntries(SIM_PARAMS)));
}

export interface Std50Doc {
  format: typeof STD50_FORMAT;
  meta: Record<string, unknown>;
  cases: {
    idx: number; scenarioId: string; seed: string; cause: Cause; focusClass: GenClass | null; nFocus: number;
    nRegistered: number; nResources: number; hhPerResource: number; table: string; sha256: string;
  }[];
}

export function standard50Doc(shaOf: (def: ScenarioDef) => string): Std50Doc {
  return {
    format: STD50_FORMAT,
    meta: {
      title: "표준 50건 (spec.md 5.6절, 봉인 S2b)",
      composition: "등급 7(INTERMITTENT 제외) × 원인 7(ROTATING 제외) = 49건 + ROTATING 1건(60가구, 혼합). 각 건 N=30 = 초점 등급 12 + 혼합 18, 가구/자원 비 1.5/3/6 순환(17/16/16), 시드 20261017+idx",
      prov: { type: "policy", sourceIds: [], note: "구성 규칙은 이 명세(spec.md 5.6절). 분포 값은 spec/params.json과 app/src/lib/sim/sim_params.json(행마다 출처·유형)" },
      thetaBase: standardTheta(),
      thetaNote: "모든 건은 params standardTheta에 hhPerResource만 바꾼다",
      generator: "app/src/lib/sim/{generator,materialize,scenarios}.ts",
      simParamsSha256: simParamsSha256(),
      sha256Rule: "sha256 = materialize 정본 JSON(키 정렬, 1e-6 반올림, UTF-8)의 sha256. scripts/export-scenarios.ts가 같은 바이트를 out/oracle_input/에 쓴다",
      rotatingCase: "ROTATING 건의 가구/자원 비는 명세에 없어 3(표준 θ)으로 두었다(DEVLOG TASK C)",
    },
    cases: standard50Defs().map(({ idx, def }) => ({
      idx, scenarioId: def.scenarioId, seed: def.seed, cause: def.cause, focusClass: def.focusClass ?? null, nFocus: def.nFocus ?? 0,
      nRegistered: def.nRegistered, nResources: def.nResources, hhPerResource: def.theta.hhPerResource, table: def.table ?? "gamma",
      sha256: shaOf(def),
    })),
  };
}

export interface PresetDoc {
  format: typeof PRESET_FORMAT;
  meta: {
    file: string; name: string; description: string; scenarioId: string; seed: string; cause: Cause;
    prov: { type: string; sourceIds: string[]; note: string };
    simParamsSha256: string; scenarioSha256: string;
  };
  scenario: MaterializedScenario;
}

export function presetDoc(p: PresetDef): PresetDoc {
  const m = materialize(p.def);
  return {
    format: PRESET_FORMAT,
    meta: {
      file: p.file, name: p.name, description: p.description, scenarioId: p.def.scenarioId, seed: p.def.seed, cause: p.def.cause,
      prov: {
        type: "assumed", sourceIds: [],
        note: "합성 시나리오(모두 mock). 원인별 복구 분포의 출처는 params restoration.<원인> 행, 생성 분포는 params gen.*·sim_params.json. 시드는 배정기 결과를 보기 전에 정했다(5.7절)",
      },
      simParamsSha256: simParamsSha256(), scenarioSha256: m.sha256,
    },
    scenario: m.scenario,
  };
}
