import { describe, expect, it } from "vitest";

import {
  isGyeongnam,
  sggCodeOf,
  sggNameOf,
  stripSido,
} from "@/lib/analysis/scope";

describe("analysis scope", () => {
  it("strips the gyeongnam sido prefix", () => {
    expect(stripSido("경상남도 진주시 중앙동")).toBe("진주시 중앙동");
    expect(stripSido("경상남도 양산시")).toBe("양산시");
  });
});

describe("gyeongnam scope helpers", () => {
  it("derives 5-digit sgg code from 10-digit dong code", () => {
    expect(sggCodeOf("4812051000")).toBe("48120");
  });
  it("extracts sgg name, keeping 시+구 for 창원, else single 시/군", () => {
    expect(sggNameOf("경상남도 창원시 의창구 동읍")).toBe("창원시 의창구");
    expect(sggNameOf("경상남도 진주시 천전동")).toBe("진주시");
    expect(sggNameOf("경상남도 남해군 남해읍")).toBe("남해군");
  });
  it("flags gyeongnam membership by adm code", () => {
    expect(isGyeongnam("4817051000")).toBe(true);
    expect(isGyeongnam("2611051000")).toBe(false);
  });
});
