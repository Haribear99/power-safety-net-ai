// 리허설 랩 스윕 실행기 (spec.md 5.4절 E1·E2, 라운드 5). 비AI, 결정적. worker_threads로 나눠 돌리고 순서대로 합친다.
// 실행 (app/에서):
//   npx tsx scripts/sweep.ts E2 --tag dev --seedLo 6001 [--cells 27]
//   npx tsx scripts/sweep.ts E1 --tag dev --seedLo 7001 --draws 400 --master E1-dev [--falsify 100] [--lognormal]
//   npx tsx scripts/sweep.ts E3 --tag dev --seedLo 8001 --draws 200 --master E3-dev
//   npx tsx scripts/sweep.ts E4 --tag dev --seedLo 9001 --draws 200 --master E4-dev   (실측 분포 APT_EMP, S6)
//   npx tsx scripts/sweep.ts E5 --tag dev --seedLo 9501 --draws 200 --master E5-dev   (AI 판독 기여·표적 사전 배치, S7)
//   npx tsx scripts/sweep.ts E6 --tag dev --seedLo 9801 --draws 200 --master E6-dev   (평시 정보 표적 사전 배치, S8)
//   npx tsx scripts/sweep.ts E7 --tag dev --seedLo 9600001 --draws 200 --master E7-dev   (평시 산소통 보급, S10)
// 봉인 실행(S4 뒤)은 --tag sealed와 prereg/sweep.json의 시드 범위·추첨 수를 쓴다. 출력: out/sweeps/<exp>_<tag>.json
// 출력 행마다 seed 키가 있다(scripts/check-seal-order.mjs가 S4 이전 출력에서 E1·E2 전용 시드를 찾는다).
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { CAUSES } from "../src/lib/domain/types";
import { canonicalJson, sha256Hex } from "../src/lib/sim/materialize";
import { e1Thetas, E1_FALSIFY_DRAWS, e2Cells, E2_SEEDS_PER_CELL, E3_VARIANTS, E4_CAUSE, e4Thetas, falsifyVariants, withAxis, type E1Row, type E2Row, type E3Row } from "../src/lib/sim/sweep";
import type { Job } from "./sweep-worker";
import { E5_ARMS, E5_CAUSE, e5Thetas, E5_VARIANTS } from "../src/lib/sim/e5";
import { e6Thetas, E6_VARIANTS } from "../src/lib/sim/e6";
import { E7_ARMS, E7_CYL_H, e7Thetas, E7_VARIANTS } from "../src/lib/sim/e7";

const repo = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const exp = argv[0];
const arg = (k: string, d?: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const flag = (k: string) => argv.includes(`--${k}`);
const tag = arg("tag", "dev")!;
const seedLo = Number(arg("seedLo"));
if (!Number.isInteger(seedLo)) throw new Error("--seedLo 필요");

async function runPool<R>(jobs: Job[], chunk = 40): Promise<R[]> {
  const nW = Math.max(1, Math.min(os.cpus().length - 2, 14));
  const chunks: Job[][] = [];
  for (let i = 0; i < jobs.length; i += chunk) chunks.push(jobs.slice(i, i + chunk));
  const results: R[][] = new Array(chunks.length);
  let next = 0, done = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: nW }, () => new Promise<void>((resolve, reject) => {
    const w = new Worker(path.join(__dirname, "sweep-worker.ts"), { execArgv: ["--import", "tsx"] });
    let cur = -1;
    const feed = () => {
      if (next >= chunks.length) { void w.terminate(); resolve(); return; }
      cur = next++;
      w.postMessage(chunks[cur]);
    };
    w.on("message", (out: R[]) => {
      results[cur] = out;
      done++;
      if (done % 50 === 0 || done === chunks.length) process.stderr.write(`  ${done}/${chunks.length} 묶음 · ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
      feed();
    });
    w.on("error", reject);
    feed();
  })));
  return results.flat();
}

function write(name: string, doc: unknown): void {
  const dir = path.join(repo, "out", "sweeps");
  mkdirSync(dir, { recursive: true });
  const json = canonicalJson(doc);
  writeFileSync(path.join(dir, name), json + "\n", "utf-8");
  console.log(`→ out/sweeps/${name} (${(json.length / 1e6).toFixed(1)}MB, sha256 ${sha256Hex(json).slice(0, 16)}…)`);
}

async function main() {
  if (exp === "E2") {
    const nCells = Number(arg("cells", "27")) as 9 | 27;
    const per = Number(arg("perCell", String(E2_SEEDS_PER_CELL)));
    const cells = e2Cells(nCells);
    const jobs: Job[] = [];
    for (const c of cells) for (let k = 0; k < per; k++) jobs.push({ exp: "E2", nCells, cellIdx: c.idx, k, seedLo });
    const rows = await runPool<E2Row>(jobs, 20);
    write(`E2_${tag}.json`, { format: "pl26-sweep-e2/1", tag, seedLo, nCells, perCell: per, cells, rows });
    return;
  }
  if (exp === "E1") {
    const draws = Number(arg("draws"));
    const master = arg("master")!;
    const fN = Number(arg("falsify", String(E1_FALSIFY_DRAWS)));
    if (!(draws > 0) || !master) throw new Error("--draws, --master 필요");
    const thetas = e1Thetas(draws, master);
    const jobs: Job[] = [];
    for (let d = 0; d < draws; d++) for (const cause of CAUSES) jobs.push({ exp: "E1", d, cause, theta: thetas[d], seedLo, table: "gamma", group: "main" });
    if (fN > 0) {
      for (const v of falsifyVariants()) for (let d = 0; d < Math.min(fN, draws); d++) for (const cause of CAUSES) {
        jobs.push({ exp: "E1", d, cause, theta: withAxis(thetas[d], v), seedLo, table: "gamma", group: `${v.axis}:${v.end}` });
      }
    }
    if (flag("lognormal")) for (let d = 0; d < draws; d++) for (const cause of CAUSES) jobs.push({ exp: "E1", d, cause, theta: thetas[d], seedLo, table: "lognormal", group: "lognormal" });
    console.log(`E1 작업 ${jobs.length}건`);
    const res = await runPool<{ group: string; row: E1Row }>(jobs, 40);
    const groups: Record<string, E1Row[]> = {};
    for (const r of res) (groups[r.group] ??= []).push(r.row);
    write(`E1_${tag}.json`, {
      format: "pl26-sweep-e1/1", tag, seedLo, draws, master, falsifyDraws: fN, variants: fN > 0 ? falsifyVariants() : [], groups,
    });
    return;
  }
  if (exp === "E3") {
    const draws = Number(arg("draws"));
    const master = arg("master")!;
    if (!(draws > 0) || !master) throw new Error("--draws, --master 필요");
    const thetas = e1Thetas(draws, master);
    const jobs: Job[] = [];
    for (let d = 0; d < draws; d++) for (const cause of CAUSES) jobs.push({ exp: "E3", d, cause, theta: thetas[d], seedLo });
    console.log(`E3 작업 ${jobs.length}건`);
    const rows = await runPool<E3Row>(jobs, 20);
    write(`E3_${tag}.json`, { format: "pl26-sweep-e3/1", tag, seedLo, draws, master, variants: E3_VARIANTS, rows });
    return;
  }
  if (exp === "E4") {
    const draws = Number(arg("draws"));
    const master = arg("master")!;
    if (!(draws > 0) || !master) throw new Error("--draws, --master 필요");
    const thetas = e4Thetas(draws, master);
    const jobs: Job[] = [];
    for (let d = 0; d < draws; d++) jobs.push({ exp: "E4", d, theta: thetas[d], seedLo });
    console.log(`E4 작업 ${jobs.length}건`);
    const rows = await runPool<E3Row>(jobs, 20);
    write(`E4_${tag}.json`, { format: "pl26-sweep-e4/1", tag, seedLo, draws, master, cause: E4_CAUSE, variants: E3_VARIANTS, rows });
    return;
  }
  if (exp === "E5") {
    const draws = Number(arg("draws"));
    const master = arg("master")!;
    if (!(draws > 0) || !master) throw new Error("--draws, --master 필요");
    const thetas = e5Thetas(draws, master);
    const jobs: Job[] = [];
    for (let d = 0; d < draws; d++) jobs.push({ exp: "E5", d, theta: thetas[d], seedLo });
    console.log(`E5 작업 ${jobs.length}건`);
    const rows = await runPool<E3Row>(jobs, 20);
    write(`E5_${tag}.json`, { format: "pl26-sweep-e5/1", tag, seedLo, draws, master, cause: E5_CAUSE, arms: E5_ARMS, variants: E5_VARIANTS, rows });
    return;
  }
  if (exp === "E6") {
    const draws = Number(arg("draws"));
    const master = arg("master")!;
    if (!(draws > 0) || !master) throw new Error("--draws, --master 필요");
    const thetas = e6Thetas(draws, master);
    const jobs: Job[] = [];
    for (let d = 0; d < draws; d++) jobs.push({ exp: "E6", d, theta: thetas[d], seedLo });
    console.log(`E6 작업 ${jobs.length}건`);
    const rows = await runPool<E3Row>(jobs, 20);
    write(`E6_${tag}.json`, { format: "pl26-sweep-e6/1", tag, seedLo, draws, master, cause: E5_CAUSE, arms: { AI: E5_ARMS.AI }, variants: E6_VARIANTS, rows });
    return;
  }
  if (exp === "E7") {
    const draws = Number(arg("draws"));
    const master = arg("master")!;
    if (!(draws > 0) || !master) throw new Error("--draws, --master 필요");
    const thetas = e7Thetas(draws, master);
    const jobs: Job[] = [];
    for (let d = 0; d < draws; d++) jobs.push({ exp: "E7", d, theta: thetas[d], seedLo });
    console.log(`E7 작업 ${jobs.length}건`);
    const rows = await runPool<E3Row>(jobs, 20);
    write(`E7_${tag}.json`, { format: "pl26-sweep-e7/1", tag, seedLo, draws, master, cause: E5_CAUSE, arms: E7_ARMS, cylH: E7_CYL_H, variants: E7_VARIANTS, rows });
    return;
  }
  throw new Error("실험은 E1, E2, E3, E4, E5, E6, E7");
}

main().catch((e) => { console.error(e); process.exit(1); });
