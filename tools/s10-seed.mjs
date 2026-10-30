// S10(E7) 봉인 실행 시드 계산 (prereg/predictions_e7.md 0절, 봉인 전 레드팀 1·2라운드). 실행: node tools/s10-seed.mjs
// 규칙(봉인 대상, 결과를 보기 전에 고정):
//   스탬프는 alice·bob 캘린더 두 곳으로만 만든다:
//     python -I tools/ots.py stamp -c https://alice.btc.calendar.opentimestamps.org -c https://bob.btc.calendar.opentimestamps.org -m 1 seal/S10.txt
//   .ots에는 alice·bob 두 캘린더 경로만 있어야 한다(대기 증명 URI는 업그레이드 뒤에도 남으므로 지금 파일로 확인한다).
//   B  = alice 캘린더 경로의 비트코인 블록 증명(높이 하나로 정해진다 — 업그레이드 시점을 골라 B를 바꿀 수 없다).
//        S10 태그 커밋 시각 + 24시간이 지나도록 alice 증명이 없을 때만 bob의 것을 쓴다(기준 시각은 커밋이라 다시 커밋해도 밀리지 않는다).
//   증명 확인: tools/ots_check.py — S10.txt sha256 = .ots 다이제스트, 증명 메시지 = 그 블록 머클 루트(blockstream.info·mempool.space 두 곳 일치).
//   S10 태그 커밋 시각이 B의 헤더 시각 nTime보다 늦으면 멈춘다(커밋 시각을 미래로 적어 라운드를 고르는 길을 막는다).
//   멈추면 이 S10은 무효로 CHANGELOG에 공개하고, 내용을 바꾸지 않은 새 태그 S10b로 다시 커밋·스탬프한다.
//   R  = nTime보다 엄격히 뒤의 첫 drand quicknet 라운드. 라운드 r의 시각 = 1692803367 + (r − 1) × 3 → R = floor((nTime − 1692803367) / 3) + 2
//   seedLo = 8,000,001 + (R 난수 앞 8자리 16진수 정수 mod 900,000). 난수는 api.drand.sh와 drand.cloudflare.com 두 곳이 같아야 한다.
// 결과는 seal/S10_beacon.json.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const QUICKNET = "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";
const GENESIS = 1692803367, PERIOD = 3;
const ALICE = "https://alice.btc.calendar.opentimestamps.org", BOB = "https://bob.btc.calendar.opentimestamps.org";
const stop = (msg, code = 2) => { console.error(msg); process.exit(code); };

const chk = JSON.parse(execFileSync("python", ["-I", path.join(repo, "tools", "ots_check.py"), path.join(repo, "seal", "S10.txt"), path.join(repo, "seal", "S10.txt.ots")], { encoding: "utf-8" }));
if (!chk.digestMatch) stop("S10.txt sha256이 .ots 다이제스트와 다르다");
const cals = Object.keys(chk.byCalendar).sort();
if (cals.join() !== [ALICE, BOB].sort().join()) stop(`캘린더가 alice·bob 두 곳이 아니다: ${cals.join(", ")}`);
const commitT = Number(execFileSync("git", ["-C", repo, "log", "-1", "--format=%ct", "S10"], { encoding: "utf-8" }).trim());
let cal = ALICE;
if (!(chk.byCalendar[ALICE] ?? []).length) {
  if (Date.now() / 1000 < commitT + 24 * 3600) stop("alice 증명 없음 — `python -I tools/ots.py upgrade seal/S10.txt.ots` 뒤 다시(S10 커밋 뒤 24시간까지는 alice만 기다린다)");
  if (!(chk.byCalendar[BOB] ?? []).length) stop("alice·bob 모두 증명 없음");
  cal = BOB;
}
const height = Math.min(...chk.byCalendar[cal]);
const b = chk.bitcoin.find((x) => x.height === height);
if (!b?.merkleOk) stop(`블록 ${height} 머클 루트 불일치`);
const nTime = b.nTime;
if (commitT > nTime) stop(`S10 커밋 시각(${commitT})이 블록 시각(${nTime})보다 늦다 — 규칙 위반, 봉인 실행 중지`);
const R = Math.floor((nTime - GENESIS) / PERIOD) + 2;
const roundT = GENESIS + (R - 1) * PERIOD;
if (roundT <= nTime) throw new Error("라운드 산식 오류");
if (roundT > Date.now() / 1000) stop(`라운드 ${R}(시각 ${new Date(roundT * 1000).toISOString()})가 아직 안 나왔다. 그 뒤 다시`, 3);

const getJson = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u} ${r.status}`); return r.json(); };
const beacons = [];
for (const base of ["https://api.drand.sh", "https://drand.cloudflare.com"]) beacons.push({ base, ...(await getJson(`${base}/${QUICKNET}/public/${R}`)) });
if (beacons[0].randomness !== beacons[1].randomness || beacons[0].round !== R) throw new Error(`drand 불일치 ${JSON.stringify(beacons)}`);
const seedLo = 8_000_001 + (parseInt(beacons[0].randomness.slice(0, 8), 16) % 900_000);
const out = {
  rule: "tools/s10-seed.mjs 머리말", calendar: cal, block: { height, hash: b.hash, nTime, merkleOk: b.merkleOk }, commitT,
  drand: { chain: QUICKNET, round: R, roundTime: roundT, randomness: beacons[0].randomness, signature: beacons[0].signature, sources: beacons.map((x) => x.base) },
  seedLo, seedHi: seedLo + 1999,
};
writeFileSync(path.join(repo, "seal", "S10_beacon.json"), JSON.stringify(out, null, 1) + "\n", "utf-8");
console.log(JSON.stringify(out, null, 1));
