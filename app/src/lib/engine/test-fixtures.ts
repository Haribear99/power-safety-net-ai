// 시험 전용 가구 생성기. 엔진·시뮬레이션 본 코드는 쓰지 않는다.
import type { HouseholdView } from "../domain/types";

export function makeHH(over: Partial<Omit<HouseholdView, "device">> & { device?: Partial<HouseholdView["device"]> } = {}): HouseholdView {
  const { device, ...rest } = over;
  return {
    id: "H-001", pseudonym: "H-001", cell: { x: 0, y: 0 }, floor: 1, mobilityNeed: false, caregiver: true,
    tReport: 0, lEndPrev: null, ext: [],
    ...rest,
    device: {
      specId: "TRILOGY100", specBy: "db_exact", batteryAgeY: null,
      charge: { value: null, source: "unknown" },
      ...device,
    },
  };
}
