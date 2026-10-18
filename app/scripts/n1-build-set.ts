// N1 보호자 알림 측정셋 (비AI, 결정적). /ops 화면과 같은 경로로 알림 입력을 만든다:
//   시뮬레이션 시나리오(계획자 화면만) → ops 세션 시작 → RULE 추천 행 → outageInput / 가구 → prepInput.
//   수동검토 가구는 화면의 「수정」처럼 119(시각 없음)·쉼터로 바꾼 입력도 만든다(배터리 '담당자 확인 중' 상태 확보).
// 층(kind:배터리 상태:수단)별 라운드로빈으로 고르고, 같은 사실 묶음(=같은 프롬프트)은 한 번만 넣는다.
// 시험셋은 dev와 같은 사실 묶음을 빼고(누수 방지), 시나리오 시드를 봉인(S9) 뒤 공개된 drand 난수로 정한다(prereg/n1.json 규칙).
// 실행: (app/에서) npx tsx scripts/n1-build-set.ts                       → datasets/notice/dev.json
//       npx tsx scripts/n1-build-set.ts --round <R> --salt <randomness>  → datasets/notice/test.json(봉인 뒤에만)
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Cause } from "../src/lib/domain/types";
import { qT, sToH } from "../src/lib/engine/quantize";
import { buildFacts, factsKey, NOTICE_LANES, outageInput, prepInput, type NoticeInputT } from "../src/lib/notice/facts";
import { DB, newSession, recompute, start, type UiPreset } from "../src/lib/ops/session";
import { e5Thetas } from "../src/lib/sim/e5";
import { canonicalJson, materialize, sha256Hex } from "../src/lib/sim/materialize";
import { e3Def } from "../src/lib/sim/sweep";

const repo = path.resolve(__dirname, "..", "..");
const CAUSES: readonly Cause[] = ["APT_EMP", "KEPCO_DIST", "APT_SHORT", "APT_NIGHT_XFMR", "APT_FIRE", "TYPHOON_WEAK", "TYPHOON_STRONG"];
const BASES = ["2026-08-14T22:00:00+09:00", "2026-07-03T14:00:00+09:00", "2026-09-11T03:00:00+09:00", "2026-08-27T18:00:00+09:00"];
const SPLITS = {
  dev: { seedLo: 9_700, scenarios: 12, master: "N1-dev", n: 40 },
  test: { seedLo: 7_000_000, scenarios: 24, master: "N1", n: 60 },
} as const;
/** 시험셋 시드 하한 = 7,000,000 + (drand 난수 앞 8자리 16진수 mod 900,000). 봉인 전에는 알 수 없다 */
export function testSeedLo(salt: string): number {
  if (!/^[0-9a-f]{64}$/.test(salt)) throw new Error("salt는 drand randomness(64자리 16진수)");
  return 7_000_000 + (parseInt(salt.slice(0, 8), 16) % 900_000);
}

export interface N1Item { id: string; stratum: string; audience: "보호자" | "본인"; input: NoticeInputT; source: { scenarioId: string; seed: string; scenarioSha256: string; householdId: string; nowH: number } }

function candidates(split: keyof typeof SPLITS, seedLo: number): N1Item[] {
  const cfg = SPLITS[split];
  const thetas = e5Thetas(cfg.scenarios, cfg.master);
  const out: N1Item[] = [];
  for (let d = 0; d < cfg.scenarios; d++) {
    const cause = CAUSES[d % CAUSES.length];
    const mat = materialize(e3Def(d + 1, cause, thetas[d], seedLo, "N1"));
    const m = mat.scenario;
    const baseIso = BASES[d % BASES.length];
    const preset: UiPreset = {
      format: "pl26-ui-preset/1",
      meta: { scenarioId: m.scenarioId, name: m.scenarioId, description: "", seed: m.seed, scenarioSha256: mat.sha256, baseIso },
      allocOpts: { travel: m.sim.travel, stress119: m.sim.stress119 },
      planner: m.planner as UiPreset["planner"],
    };
    const s0 = start(newSession(preset));
    const src = (householdId: string, nowS: number) => ({ scenarioId: m.scenarioId, seed: m.seed, scenarioSha256: mat.sha256, householdId, nowH: sToH(nowS) });
    // 평시 대비: 가구마다 1건
    for (const hh of s0.households) out.push({ id: "", stratum: "", audience: hh.caregiver ? "보호자" : "본인", input: prepInput(hh, DB), source: src(hh.id, 0) });
    // 정전 중: 시작 시각과 2시간 뒤
    for (const dt of [0, 2 * 3600]) {
      const s = dt === 0 ? s0 : recompute(s0, s0.nowS + dt);
      for (const row of s.result?.rows ?? []) {
        const hh = s.households.find((h) => h.id === row.rec.householdId)!;
        const res = s.preset.planner.resources.find((r) => r.id === row.rec.resourceId);
        const lanes = (NOTICE_LANES as readonly string[]).includes(row.rec.lane) ? [row.rec.lane]
          : row.rec.lane === "MANUAL_REVIEW" ? ["FALLBACK_119", "FALLBACK_SHELTER"] : [];
        for (const lane of lanes) {
          const same = lane === row.rec.lane;
          const input = outageInput({
            hh, baseIso, nowS: s.nowS, lane: lane as never, resourceKind: same ? res?.kind ?? null : null,
            etaS: same && row.rec.etaH != null ? qT(row.rec.etaH) : null, late119: same ? row.late119 ?? false : false, db: DB,
          });
          if (input) out.push({ id: "", stratum: "", audience: hh.caregiver ? "보호자" : "본인", input, source: src(hh.id, s.nowS) });
        }
      }
    }
  }
  return out;
}

export function buildSet(split: keyof typeof SPLITS, seedLo: number = SPLITS[split].seedLo, exclude: readonly N1Item[] = []): N1Item[] {
  const seen = new Set<string>(exclude.map((x) => canonicalJson(buildFacts(x.input))));
  const strata = new Map<string, N1Item[]>();
  for (const c of candidates(split, seedLo)) {
    const f = buildFacts(c.input);
    const k = canonicalJson(f);
    if (seen.has(k)) continue;
    seen.add(k);
    const st = `${factsKey(f)}:${f.audience}`;
    (strata.get(st) ?? strata.set(st, []).get(st)!).push({ ...c, stratum: st });
  }
  // 층 안 순서: 결정적 해시
  const h = (x: N1Item) => sha256Hex(`${split}|${canonicalJson(x.input)}`);
  for (const xs of strata.values()) xs.sort((a, b) => (h(a) < h(b) ? -1 : 1));
  const keys = [...strata.keys()].sort();
  const pick: N1Item[] = [];
  for (let round = 0; pick.length < SPLITS[split].n; round++) {
    let added = 0;
    for (const k of keys) {
      const xs = strata.get(k)!;
      if (round < xs.length && pick.length < SPLITS[split].n) { pick.push(xs[round]); added++; }
    }
    if (!added) break;
  }
  return pick.map((x, i) => ({ ...x, id: `${split}-${String(i).padStart(3, "0")}` }));
}

if (process.argv[1]?.endsWith("n1-build-set.ts")) {
  const dir = path.join(repo, "datasets", "notice");
  mkdirSync(dir, { recursive: true });
  const argv = process.argv.slice(2);
  const salt = argv.includes("--salt") ? argv[argv.indexOf("--salt") + 1] : null;
  const round = argv.includes("--round") ? Number(argv[argv.indexOf("--round") + 1]) : null;
  const dev = buildSet("dev");
  for (const split of salt ? (["dev", "test"] as const) : (["dev"] as const)) {
    const seedLo = split === "test" ? testSeedLo(salt!) : SPLITS.dev.seedLo;
    const items = split === "test" ? buildSet("test", seedLo, dev) : dev;
    const json = canonicalJson({ format: "pl26-n1-set/2", split, n: items.length, seedLo, ...(split === "test" ? { beacon: { chain: "drand quicknet", round, randomness: salt } } : {}), items });
    writeFileSync(path.join(dir, `${split}.json`), json + "\n", "utf-8");
    const by: Record<string, number> = {};
    for (const x of items) by[x.stratum] = (by[x.stratum] ?? 0) + 1;
    console.log(`${split}: ${items.length}건 sha256 ${sha256Hex(json)}`);
    console.log(Object.entries(by).map(([k, v]) => `  ${k} ${v}`).join("\n"));
  }
}
