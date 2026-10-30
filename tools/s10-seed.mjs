// S10(E7) 봉인 실행 시드 계산 (prereg/predictions_e7.md 0절, 봉인 전 레드팀 경미 8). 실행: node tools/s10-seed.mjs
// 규칙(봉인 대상, 결과를 보기 전에 고정):
//   B  = seal/S10.txt.ots의 비트코인 블록 증명 중 가장 낮은 높이의 블록(`ots info` 출력의 BitcoinBlockHeaderAttestation)
//   t  = max(B의 블록 헤더 시각 nTime, S10 태그 커밋 시각)  (초, UTC)
//   R  = t보다 엄격히 뒤의 첫 drand quicknet 라운드. 라운드 r의 시각 = 1692803367 + (r − 1) × 3 → R = floor((t − 1692803367) / 3) + 2
//   seedLo = 8,000,001 + (R 난수 앞 8자리 16진수 정수 mod 900,000)
// nTime은 blockstream.info와 mempool.space 두 곳, drand 난수는 api.drand.sh와 drand.cloudflare.com 두 곳에서 받아 같아야 한다.
// 라운드가 아직 안 나왔거나 블록 증명이 없으면 멈춘다(비트코인 확정 전 봉인 실행 금지). 결과는 seal/S10_beacon.json.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const QUICKNET = "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";
const GENESIS = 1692803367, PERIOD = 3;

const info = execFileSync("ots", ["info", path.join(repo, "seal", "S10.txt.ots")], { encoding: "utf-8" });
const heights = [...info.matchAll(/BitcoinBlockHeaderAttestation\((\d+)\)/g)].map((m) => Number(m[1]));
if (!heights.length) { console.error("비트코인 블록 증명 없음 — `ots upgrade seal/S10.txt.ots` 뒤 다시 실행(확정 전 봉인 실행 금지)"); process.exit(2); }
const height = Math.min(...heights);

const getJson = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u} ${r.status}`); return r.json(); };
const getText = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u} ${r.status}`); return (await r.text()).trim(); };
const nTimes = [];
for (const base of ["https://blockstream.info/api", "https://mempool.space/api"]) {
  const hash = await getText(`${base}/block-height/${height}`);
  const b = await getJson(`${base}/block/${hash}`);
  nTimes.push({ base, hash, timestamp: b.timestamp });
}
if (nTimes[0].hash !== nTimes[1].hash || nTimes[0].timestamp !== nTimes[1].timestamp) throw new Error(`블록 정보 불일치 ${JSON.stringify(nTimes)}`);
const nTime = nTimes[0].timestamp;
const commitT = Number(execFileSync("git", ["-C", repo, "log", "-1", "--format=%ct", "S10"], { encoding: "utf-8" }).trim());
const t = Math.max(nTime, commitT);
const R = Math.floor((t - GENESIS) / PERIOD) + 2;
const roundT = GENESIS + (R - 1) * PERIOD;
if (roundT <= t) throw new Error("라운드 산식 오류");
if (roundT > Date.now() / 1000) { console.error(`라운드 ${R}(시각 ${new Date(roundT * 1000).toISOString()})가 아직 안 나왔다. 그 뒤 다시 실행`); process.exit(3); }

const beacons = [];
for (const base of ["https://api.drand.sh", "https://drand.cloudflare.com"]) beacons.push({ base, ...(await getJson(`${base}/${QUICKNET}/public/${R}`)) });
if (beacons[0].randomness !== beacons[1].randomness || beacons[0].round !== R) throw new Error(`drand 불일치 ${JSON.stringify(beacons)}`);
const seedLo = 8_000_001 + (parseInt(beacons[0].randomness.slice(0, 8), 16) % 900_000);
const out = {
  rule: "tools/s10-seed.mjs 머리말", block: { height, hash: nTimes[0].hash, nTime, sources: nTimes.map((x) => x.base) }, commitT, t,
  drand: { chain: QUICKNET, round: R, roundTime: roundT, randomness: beacons[0].randomness, signature: beacons[0].signature, sources: beacons.map((x) => x.base) },
  seedLo, seedHi: seedLo + 1999,
};
writeFileSync(path.join(repo, "seal", "S10_beacon.json"), JSON.stringify(out, null, 1) + "\n", "utf-8");
console.log(JSON.stringify(out, null, 1));
