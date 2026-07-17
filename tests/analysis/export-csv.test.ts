import { describe, expect, test } from "vitest";

import { facilitiesToCsv, rankedToCsv, toCsv } from "@/lib/analysis/export-csv";

describe("export-csv", () => {
  test("escapes commas and quotes", () => {
    const csv = toCsv(["a", "b"], [['hello, world', 'say "hi"']]);
    expect(csv).toContain('"hello, world"');
    expect(csv).toContain('"say ""hi"""');
  });

  test("ranked csv includes provenance meta and sido", () => {
    const csv = rankedToCsv("의료 취약", "2026-06", "demo", "demo", [
      {
        rank: 1,
        code: "2611051000",
        name: "중구 중앙동",
        valueLabel: "85점",
        note: "취약",
        sido: "부산",
      },
    ]);
    expect(csv).toContain("기준월");
    expect(csv).toContain("2026-06");
    expect(csv).toContain("2611051000");
    expect(csv).toContain("시도시");
    expect(csv).toContain("부산");
  });

  test("facility csv lists rows with sido", () => {
    const csv = facilitiesToCsv("시설", "2026-06", "demo", "demo", [
      {
        id: "f1",
        name: "중앙의원",
        type: "의원",
        region: "중구",
        address: "부산",
        sido: "부산",
      },
    ]);
    expect(csv).toContain("중앙의원");
    expect(csv).toContain("의원");
    expect(csv).toContain("시도시");
    expect(csv).toContain("부산");
  });
});
