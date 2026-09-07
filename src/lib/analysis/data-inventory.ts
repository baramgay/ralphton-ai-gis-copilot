/**
 * 활용 데이터 목록 — 이 도구가 무엇을 싣고 있는가.
 *
 * ## 왜 손으로 적지 않는가
 *
 * 데이터 목록을 따로 적어 두면 **카탈로그와 갈라진다**. 지표를 하나 더하고 목록을 안
 * 고치면 화면에는 있는데 목록에는 없는 지표가 생기고, 지표를 빼면 목록에만 남는다.
 * 목록이 틀리면 없느니만 못하다 — 공공기관 자료로 쓰는 도구에서 「무엇을 썼는가」는
 * 결과만큼 중요하다.
 *
 * 그래서 정본(`@/lib/layers/catalog`)에서 만든다. 지표를 더하면 목록에 저절로 나온다.
 */

import { CUBE_LAYERS, MEDICAL_LAYER } from "@/lib/layers/catalog";
import type { LayerDescriptor } from "@/lib/layers/types";

export type ProviderKey = "공공" | "SKT" | "NH" | "KCB" | "KOSIS";

export type InventoryMetric = {
  label: string;
  unit: string;
  formula: string;
  limitation: string;
  /** 시군구까지만 제공되는 지표. 읍면동으로 줄을 세우면 안 된다. */
  sggOnly: boolean;
};

export type InventoryLayer = {
  id: string;
  label: string;
  provider: ProviderKey;
  /** 사람이 읽는 공간 단위. 격자는 행정 단위가 아니라 따로 적는다. */
  unitLabel: string;
  metrics: InventoryMetric[];
  sourceNotes: string[];
};

export type InventoryGroup = {
  provider: ProviderKey;
  /** 이 제공기관이 무엇인지 한 줄. 약칭만 보고는 알 수 없다. */
  note: string;
  layers: InventoryLayer[];
  metricCount: number;
};

const PROVIDER_ORDER: ProviderKey[] = ["SKT", "NH", "KCB", "공공", "KOSIS"];

const PROVIDER_NOTE: Record<ProviderKey, string> = {
  SKT: "이동통신 기반 생활인구·이동. 이 도구의 중심 자료입니다.",
  NH: "카드 결제 기반 소비·상권. NH농협카드 기준이라 전체 카드 시장의 일부입니다.",
  KCB: "신용정보 기반 소득·신용·거주이동. 개인이 아니라 지역 단위로 집계된 값입니다.",
  공공: "주민등록 인구·세대와 의료기관 목록. 행정 기준 값입니다.",
  KOSIS: "국가통계포털 e-지방지표. 시군구까지만 제공되어 시군구 단위로 계산합니다.",
};

function unitLabelOf(layer: Omit<LayerDescriptor, "months">): string {
  if (layer.geometry === "grid") return "500m 격자";
  if (layer.kind === "point") return "지점(좌표)";
  const levels = layer.adminLevels;
  if (levels.includes("dong") && levels.includes("sgg")) return "행정동 · 시군구";
  return levels.includes("dong") ? "행정동" : "시군구";
}

function toInventory(layer: Omit<LayerDescriptor, "months">): InventoryLayer {
  return {
    id: layer.id,
    label: layer.label,
    provider: layer.provider,
    unitLabel: unitLabelOf(layer),
    metrics: layer.metrics.map((metric) => ({
      label: metric.label,
      unit: metric.unit,
      formula: metric.formula,
      limitation: metric.limitation,
      sggOnly: metric.scope === "sgg",
    })),
    sourceNotes: [...layer.sourceNotes],
  };
}

/*
 * 의료기관은 큐브(월별 격자 자료)가 아니라 지점 목록이라 CUBE_LAYERS 밖에 있다.
 * 목록에서 빠뜨리면 「의료 접근성」 결과의 출처가 어디에도 안 적힌다.
 */
const ALL_LAYERS = [...CUBE_LAYERS, MEDICAL_LAYER];

export const DATA_INVENTORY: InventoryGroup[] = PROVIDER_ORDER.map((provider) => {
  const layers = ALL_LAYERS.filter((layer) => layer.provider === provider).map(toInventory);
  return {
    provider,
    note: PROVIDER_NOTE[provider],
    layers,
    metricCount: layers.reduce((sum, layer) => sum + layer.metrics.length, 0),
  };
}).filter((group) => group.layers.length > 0);

export const INVENTORY_TOTALS = {
  layers: DATA_INVENTORY.reduce((sum, group) => sum + group.layers.length, 0),
  metrics: DATA_INVENTORY.reduce((sum, group) => sum + group.metricCount, 0),
};
