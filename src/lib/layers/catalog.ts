import type { LayerDescriptor } from "@/lib/layers/types";

export const POPULATION_LAYER: Omit<LayerDescriptor, "months"> = {
  id: "population",
  label: "인구",
  provider: "공공",
  kind: "choropleth",
  coverage: "gyeongnam",
  adminLevels: ["dong", "sgg"],
  sourceNotes: ["주민등록 인구·세대 (시연 스냅샷은 합성)"],
  metrics: [
    { key: "pop_total", label: "총인구", unit: "명", aggregation: "sum", formula: "월별 주민등록 인구", limitation: "외국인 제외", triggers: ["인구", "총인구", "인구수"] },
    { key: "households", label: "세대수", unit: "세대", aggregation: "sum", formula: "월별 세대 수", limitation: "", triggers: ["세대", "가구"] },
    { key: "density", label: "인구밀도", unit: "명/㎢", aggregation: "weightedAvg", weightKey: "pop_total", formula: "인구/면적", limitation: "", triggers: ["밀도", "인구밀도"] },
    { key: "elderly_ratio", label: "고령비율", unit: "%", aggregation: "weightedAvg", weightKey: "pop_total", formula: "고령인구/총인구×100", limitation: "", triggers: ["고령", "고령비율", "노인"] },
    { key: "natural_change", label: "자연증가", unit: "명", aggregation: "sum", formula: "출생−사망", limitation: "전입·전출 미포함", triggers: ["자연증가", "출생", "사망"] },
  ],
};

export const MEDICAL_LAYER: Omit<LayerDescriptor, "months"> = {
  id: "medical",
  label: "의료",
  provider: "공공",
  kind: "point",
  coverage: "gyeongnam",
  adminLevels: ["dong", "sgg"],
  sourceNotes: ["HIRA 병원정보서비스 (경남 sido 380000)"],
  metrics: [
    { key: "vulnerability", label: "의료취약지수", unit: "점", aggregation: "weightedAvg", weightKey: "pop_total", formula: "공급35%+고령수요25%+최근접25%+2km무시설15%", limitation: "병원급 중심", triggers: ["의료취약", "취약지", "병원부족"] },
  ],
};
