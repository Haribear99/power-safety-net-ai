// E7(S10) 결과를 evidence.json 모양으로 옮긴다. sync-evidence.ts가 부른다. 봉인 해시 대상(prereg/e7.json) — 공용 sync 파일 대신 이 모듈만 고정한다(레드팀 2라운드 경미 6).
type Cmp5 = { rel: number | null; lo: number | null; hi: number | null };
type HhRate = { k: number; n: number; rate: number };
export interface E7Out {
  source: { n: number };
  gapHPerRun: Record<string, number>;
  usedMean: Record<string, [number, number]>;
  cylShare: { strat: Cmp5; unstrat: Cmp5 };
  compares: Record<string, Cmp5>;
  hhRates: Record<string, Record<string, HhRate>>;
  prereg: { hit: number; total: number; items: { id: string; text: string; hit: boolean | null; value: string; structural?: boolean }[] };
}

export function e7Evidence(e7: E7Out | null) {
  if (!e7) return null;
  const c = (x: Cmp5) => ({ rel: x.rel, lo: x.lo, hi: x.hi });
  const bat = "RULE+P7P", match = "RULE+CYL10S+P7E";
  return {
    n: e7.source.n,
    compares: Object.fromEntries(Object.entries(e7.compares).map(([k, x]) => [k, c(x)])),
    cylShare: { strat: c(e7.cylShare.strat), unstrat: c(e7.cylShare.unstrat) },
    hhGap: Object.fromEntries(Object.entries(e7.hhRates).map(([cls, r]) => [cls, { none: r.RULE?.rate ?? null, battery: r[bat]?.rate ?? null, matched: r[match]?.rate ?? null }])),
    // E7(10.x)은 다른 봉인과 합산하지 않고 따로 센다. 문턱은 예비 실행을 보고 정했고, 구조상 보장 항목(10.S*)은 집계 밖(레드팀 경미 6)
    prereg: {
      hit: e7.prereg.hit, total: e7.prereg.total, afterPilot: true,
      missed: e7.prereg.items.filter((x) => x.hit === false && !x.structural).map((x) => ({ id: x.id, text: x.text, value: x.value })),
    },
    usedMean: e7.usedMean,
  };
}
