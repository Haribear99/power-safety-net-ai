// scripts/sweep.ts의 작업자(worker_threads). 작업 묶음을 받아 sweep.ts 함수를 돌리고 결과 행을 돌려준다.
import { parentPort } from "node:worker_threads";
import { e2Cells, runE1, runE2 } from "../src/lib/sim/sweep";
import type { Theta } from "../src/lib/sim/lhs";
import type { Cause } from "../src/lib/domain/types";
import type { QuantileFamily } from "../src/lib/engine/restoration";

export type Job =
  | { exp: "E2"; nCells: 9 | 27; cellIdx: number; k: number; seedLo: number }
  | { exp: "E1"; d: number; cause: Cause; theta: Theta; seedLo: number; table: QuantileFamily; group: string };

parentPort!.on("message", (jobs: Job[]) => {
  const out = jobs.map((j) => {
    if (j.exp === "E2") return runE2(e2Cells(j.nCells)[j.cellIdx], j.k, j.seedLo);
    return { group: j.group, row: runE1(j.d, j.cause, j.theta, j.seedLo, j.table) };
  });
  parentPort!.postMessage(out);
});
