import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { contextualizeRegionQuery, detectRegionFilters } from "@/lib/analysis/query-regions";
import { extractQuerySignals } from "@/lib/analysis/query-signals";
import { NH_CONSUMPTION_LAYER, SKT_LIVING_LAYER } from "@/lib/layers/catalog";
import { resolveLayerQuery } from "@/lib/layers/resolve-layer-query";
import { layerCubeToAnalysisView } from "@/lib/layers/to-analysis-view";
import type { LayerCube } from "@/lib/layers/types";
import { getAllPlaces } from "@/lib/geo/place-index";

const MASAN = ["창원시 마산합포구", "창원시 마산회원구"];

describe("historical region context across public and private analysis", () => {
  test.each(["마산", "마산시", "창원 마산"])("%s includes both current districts", (name) => {
    const query = `${name} 카드매출 높은 지역`;
    expect(detectRegionFilters(query)).toEqual(MASAN);
    expect(extractQuerySignals(query).districts).toEqual(MASAN);
    expect(resolveLayerQuery(query, [NH_CONSUMPTION_LAYER])).toMatchObject({
      regionFilters: MASAN, metricKey: "card_sales", direction: "desc", adminLevel: "dong",
    });
  });

  test.each(MASAN)("explicit %s does not expand to its sibling", (district) => {
    expect(detectRegionFilters(`${district} 카드매출`)).toEqual([district]);
    expect(detectRegionFilters(`${district.replace("창원시 ", "")} 카드매출`)).toEqual([district]);
  });

  test("separate mentions preserve order and deduplicate group members", () => {
    expect(detectRegionFilters("김해와 마산 카드매출")).toEqual(["김해시", ...MASAN]);
    expect(detectRegionFilters("마산과 마산회원구 카드매출")).toEqual(MASAN);
    expect(detectRegionFilters("진해 카드매출")).toEqual(["창원시 진해구"]);
    expect(detectRegionFilters("창원 카드매출")).toEqual(["창원시"]);
  });

  test("actual card sales ranking and district aggregation stay inside both Masan districts", () => {
    const cube = JSON.parse(readFileSync("public/data/layers/nh-consumption.json", "utf8")) as LayerCube;
    const match = resolveLayerQuery("마산 카드매출 높은 지역", [NH_CONSUMPTION_LAYER])!;
    const metric = NH_CONSUMPTION_LAYER.metrics.find((m) => m.key === match.metricKey)!;
    const { analysis } = layerCubeToAnalysisView(cube, metric, NH_CONSUMPTION_LAYER.metrics, "dong", match.direction, match.regionFilters);
    expect(analysis.ranked.length).toBeGreaterThan(2);
    expect(new Set(analysis.ranked.map((row) => row.code.slice(0, 5)))).toEqual(new Set(["48125", "48127"]));
    expect(analysis.ranked.every((row) => /마산합포구|마산회원구/.test(row.name))).toBe(true);
    const { analysis: districts } = layerCubeToAnalysisView(cube, metric, NH_CONSUMPTION_LAYER.metrics, "sgg", match.direction, match.regionFilters);
    expect(districts.ranked).toHaveLength(2);
    expect(new Set(districts.ranked.map((row) => row.code))).toEqual(new Set(["48125", "48127"]));
  });

  test("scope followups preserve both districts while fresh and explicit queries reset scope", () => {
    const query = contextualizeRegionQuery("그중 생활인구 높은 곳", MASAN);
    expect(resolveLayerQuery(query, [SKT_LIVING_LAYER])?.regionFilters).toEqual(MASAN);
    expect(contextualizeRegionQuery("진주 생활인구 높은 곳", MASAN)).toBe("진주 생활인구 높은 곳");
    expect(contextualizeRegionQuery("그중 진주 생활인구 높은 곳", MASAN)).toBe("그중 진주 생활인구 높은 곳");
    expect(contextualizeRegionQuery("카드매출 높은 지역", MASAN)).toBe("카드매출 높은 지역");
    expect(contextualizeRegionQuery("그중 물금읍 생활인구", MASAN, ["물금읍"])).toBe("그중 물금읍 생활인구");
  });

  test("a public administrative code also carries its named dong into private followups", () => {
    const place = getAllPlaces().find((item) => item.shortName === "물금읍")!;
    const query = contextualizeRegionQuery("그중 카드매출 높은 곳", [place.adm_cd2], ["물금읍"]);
    expect(resolveLayerQuery(query, [NH_CONSUMPTION_LAYER], { dongNames: ["물금읍"] })?.regionFilters)
      .toEqual(["양산시 물금읍"]);
  });
});
