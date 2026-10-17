// scripts/sweep.ts의 작업자(worker_threads). 작업 묶음을 받아 sweep.ts 함수를 돌리고 결과 행을 돌려준다.
import { parentPort } from "node:worker_threads";
import { e2Cells, runE1, runE2, runE3, runE4 } from "../src/lib/sim/sweep";
import { runE5 } from "../src/lib/sim/e5";
import { runE6 } from "../src/lib/sim/e6";
import type { Theta } from "../src/lib/sim/lhs";
import type { Cause } from "../src/lib/domain/types";
import type { QuantileFamily } from "../src/lib/engine/restoration";

export type Job =
  | { exp: "E2"; nCells: 9 | 27; cellIdx: number; k: number; seedLo: number }
  | { exp: "E1"; d: number; cause: Cause; theta: Theta; seedLo: number; table: QuantileFamily; group: string }
  | { exp: "E3"; d: number; cause: Cause; theta: Theta; seedLo: number }
  | { exp: "E4"; d: number; theta: Theta; seedLo: number }
  | { exp: "E5"; d: number; theta: Theta; seedLo: number }
  | { exp: "E6"; d: number; theta: Theta; seedLo: number };

parentPort!.on("message", (jobs: Job[]) => {
  const out = jobs.map((j) => {
    if (j.exp === "E2") return runE2(e2Cells(j.nCells)[j.cellIdx], j.k, j.seedLo);
    if (j.exp === "E3") return runE3(j.d, j.cause, j.theta, j.seedLo);
    if (j.exp === "E4") return runE4(j.d, j.theta, j.seedLo);
    if (j.exp === "E5") return runE5(j.d, j.theta, j.seedLo);
    if (j.exp === "E6") return runE6(j.d, j.theta, j.seedLo);
    return { group: j.group, row: runE1(j.d, j.cause, j.theta, j.seedLo, j.table) };
  });
  parentPort!.postMessage(out);
});
