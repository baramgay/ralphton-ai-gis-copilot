import { describe, expect, it } from "vitest";

// @ts-expect-error Native ESM scripts intentionally have no TypeScript declaration file.
import { filterGyeongnam, listSggFromDong } from "../../scripts/lib/gyeongnam-core.mjs";

const features = [
  { properties: { adm_nm: "서울특별시 중구 중앙동", adm_cd2: "1111051000", sgg: "11110", sggnm: "중구" } },
  { properties: { adm_nm: "경상남도 창원시 의창구 동읍", adm_cd2: "4812051000", sgg: "48120", sggnm: "창원시 의창구" } },
  { properties: { adm_nm: "경상남도 진주시 천전동", adm_cd2: "4817051000", sgg: "48170", sggnm: "진주시" } },
];

describe("gyeongnam-core", () => {
  it("keeps only 경상남도 (adm_cd2 starts 48)", () => {
    const kept = filterGyeongnam(features);
    expect(kept).toHaveLength(2);
    expect(
      kept.every((f: { properties: { adm_cd2: string } }) => f.properties.adm_cd2.startsWith("48")),
    ).toBe(true);
  });

  it("lists distinct sgg codes with names", () => {
    const sgg = listSggFromDong(filterGyeongnam(features));
    expect(sgg).toEqual([
      { code: "48120", name: "창원시 의창구" },
      { code: "48170", name: "진주시" },
    ]);
  });
});
