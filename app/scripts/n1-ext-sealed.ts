// 사후 집계(통합 레드팀 9라운드): 봉인 시험셋(S9)에서 배터리 시각·시간에 확인 외장 배터리가 합쳐져 있었는데 나간 글이 '외장'을 말하지 않은 항목을 센다.
// 봉인 시험셋의 출처(시나리오·가구·시각)로 세션을 다시 만들고, 현행 outageInput/prepInput의 외장 몫(batteryExtS)을 계산한다. API 호출 없음.
// 레드팀 재현 스크립트(9라운드)를 옮겨 적은 것이다. 산소통이 있는 집은 지금 규칙이 외장 몫을 빼므로, 산소통을 뺀 가구로 외장 몫을 센다.
//   npx tsx scripts/n1-ext-sealed.ts   → seal/outputs/posthoc/n1_ext_sealed.json
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { qT } from "../src/lib/engine/quantize";
import { outageInput, prepInput, type NoticeInputT } from "../src/lib/notice/facts";
import { DB, newSession, recompute, start } from "../src/lib/ops/session";
import { e5Thetas } from "../src/lib/sim/e5";
import { materialize } from "../src/lib/sim/materialize";
import { e3Def } from "../src/lib/sim/sweep";
import type { Cause } from "../src/lib/domain/types";

const repo = path.join(__dirname, "..", "..");
// n1-build-set.ts와 같은 원인·기준 시각 순서
const CAUSES = ["APT_EMP", "KEPCO_DIST", "APT_SHORT", "APT_NIGHT_XFMR", "APT_FIRE", "TYPHOON_WEAK", "TYPHOON_STRONG"] as Cause[];
const BASES = ["2026-08-14T22:00:00+09:00", "2026-07-03T14:00:00+09:00", "2026-09-11T03:00:00+09:00", "2026-08-27T18:00:00+09:00"];
type Item = { id: string; input: NoticeInputT; source: { scenarioId: string; householdId: string; nowH: number } };
const set = JSON.parse(readFileSync(path.join(repo, "datasets", "notice", "test.json"), "utf-8")) as { items: Item[] };
const SEED_LO = 7412507;
const thetas = e5Thetas(24, "N1");
const sess: Record<string, { s0: ReturnType<typeof start>; baseIso: string }> = {};
for (let d = 0; d < 24; d++) {
  const mat = materialize(e3Def(d + 1, CAUSES[d % CAUSES.length], thetas[d], SEED_LO, "N1"));
  const m = mat.scenario;
  const baseIso = BASES[d % BASES.length];
  const preset = { format: "pl26-ui-preset/1", meta: { scenarioId: m.scenarioId, name: m.scenarioId, description: "", seed: m.seed, scenarioSha256: mat.sha256, baseIso }, allocOpts: { travel: m.sim.travel, stress119: m.sim.stress119 }, planner: m.planner };
  sess[m.scenarioId] = { s0: start(newSession(preset as Parameters<typeof newSession>[0])), baseIso };
}
const sealedDir = path.join(repo, "out", "sealed", "n1");
const sealed = new Map(readdirSync(sealedDir).filter((f) => /^test-\d+\.json$/.test(f)).map((f) => {
  const r = JSON.parse(readFileSync(path.join(sealedDir, f), "utf-8")) as { id: string; facts: { battery: { text?: string } }; composed: { source: string; sentences: string[] } };
  return [r.id, r] as const;
}));
const rows: { id: string; kind: string; deviceCls: string; extS: number; batteryS: number | null; source: string; saidExt: boolean }[] = [];
let mismatch = 0;
for (const it of set.items) {
  const S = sess[it.source.scenarioId];
  if (!S) throw new Error(`시나리오 없음 ${it.source.scenarioId}`);
  const nowS = qT(it.source.nowH);
  const s = nowS === S.s0.nowS || it.input.kind === "PREP" ? S.s0 : recompute(S.s0, nowS);
  const hh = s.households.find((h) => h.id === it.source.householdId);
  if (!hh) throw new Error(`가구 없음 ${it.source.householdId}`);
  let ext = 0;
  if (it.input.kind === "PREP") ext = (prepInput(hh, DB) as { batteryExtS?: number }).batteryExtS ?? 0;
  else {
    const x = outageInput({ hh: { ...hh, cylinder: undefined }, baseIso: S.baseIso, nowS: s.nowS, lane: it.input.lane, resourceKind: it.input.resourceKind, etaS: it.input.etaS, late119: it.input.late119, db: DB });
    ext = (x as { batteryExtS?: number } | null)?.batteryExtS ?? 0;
    if (!hh.cylinder && x && x.kind === "OUTAGE" && (x.batteryLs !== it.input.batteryLs || x.batteryEndS !== it.input.batteryEndS)) mismatch++;
  }
  if (ext <= 0) continue;
  const r = sealed.get(it.id)!;
  rows.push({ id: it.id, kind: it.input.kind, deviceCls: it.input.deviceCls, extS: ext, batteryS: it.input.kind === "PREP" ? it.input.batteryS : it.input.batteryLs, source: r.composed.source, // 배터리 시각·시간이 든 그 문장에 '외장'이 있어야 합산을 말한 것이다
    saidExt: r.composed.sentences.some((x) => r.facts.battery.text != null && x.includes(r.facts.battery.text) && x.includes("외장")) });
}
const undisclosed = rows.filter((r) => !r.saidExt);
const out = { format: "pl26-n1-ext-sealed/1", note: "사후 집계(통합 레드팀 9라운드). 봉인 시험셋 60건 중 배터리 시간에 확인 외장 몫이 있는 항목과, 나간 글이 외장 합산을 말하지 않은 항목", n: set.items.length, mismatch, withExt: rows.length, undisclosed: { k: undisclosed.length, ai: undisclosed.filter((r) => r.source === "ai").length, ids: undisclosed.map((r) => r.id) }, rows };
writeFileSync(path.join(repo, "seal", "outputs", "posthoc", "n1_ext_sealed.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ n: out.n, mismatch, withExt: rows.length, undisclosed: out.undisclosed }));
