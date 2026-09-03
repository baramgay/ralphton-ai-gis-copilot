/**
 * KOSIS e-지방지표 → 경남 시군구 레이어 큐브.
 *
 * 실행: `node scripts/adapters/kosis-indicators.mjs`
 * 키:   C:/업무/_secrets/부동산월보-kosis-api-key.txt (환경변수 KOSIS_API_KEY 우선)
 *
 * 여기 실리는 지표는 **전부 율·지수**다. 이유는 `_kosis-core.mjs` 머리말에 있다 —
 * 창원시가 KOSIS에서 한 행이라 건수를 5개 구에 나눠 주면 없는 값을 지어내게 된다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  expandToDongCells,
  fetchKosisTable,
  readKey,
  toSggYearMap,
  yearsToMonths,
} from "./_kosis-core.mjs";

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SECRET_PATH = "C:/업무/_secrets/부동산월보-kosis-api-key.txt";

/**
 * 레이어 정의. `itmId`는 표에서 **율 항목**의 id다 — 대부분 T10(A÷B×N)이고,
 * 분자·분모 항목(T001·T002)을 잘못 집으면 건수가 실린다.
 */
export const KOSIS_LAYER_SPECS = [
  {
    id: "kosis-safety",
    label: "안전",
    metrics: [
      { key: "fire_rate", tblId: "DT_1YL21081", itmId: "T10", label: "주민 만명당 화재", unit: "건/만명" },
      { key: "accident_rate", tblId: "DT_1YL21051", itmId: "T10", label: "자동차 천대당 교통사고", unit: "건/천대" },
      { key: "hitrun_rate", tblId: "DT_1YL13901", itmId: "T10", label: "뺑소니 교통사고율", unit: "%" },
      { key: "drunk_rate", tblId: "DT_1YL14001", itmId: "T10", label: "음주운전 교통사고 비율", unit: "%" },
    ],
  },
  {
    id: "kosis-welfare",
    label: "복지",
    metrics: [
      { key: "welfare_facility", tblId: "DT_1YL20941", itmId: "T10", label: "인구 십만명당 사회복지시설", unit: "개/십만명" },
      { key: "senior_leisure", tblId: "DT_1YL20961", itmId: "T10", label: "노인 천명당 노인여가복지시설", unit: "개/천명" },
      { key: "childcare", tblId: "DT_1YL20951", itmId: "T10", label: "유아 천명당 보육시설", unit: "개/천명" },
      { key: "solo_elderly", tblId: "DT_1YL12701", itmId: "T10", label: "독거노인가구 비율", unit: "%" },
      { key: "foreign_rate", tblId: "DT_1YL21271", itmId: "T10", label: "인구 천명당 등록외국인", unit: "명/천명" },
    ],
  },
  {
    id: "kosis-health",
    label: "보건의료",
    metrics: [
      { key: "doctors", tblId: "DT_1YL20981", itmId: "T10", label: "인구 천명당 의사", unit: "명/천명" },
      { key: "beds", tblId: "DT_1YL20971", itmId: "T10", label: "인구 천명당 병상", unit: "개/천명" },
    ],
  },
  {
    id: "kosis-housing",
    label: "주거",
    metrics: [
      { key: "old_housing", tblId: "DT_1YL202004", itmId: "T10", label: "노후주택 비율", unit: "%" },
      { key: "vacant", tblId: "DT_1YL202005", itmId: "T10", label: "빈집 비율", unit: "%" },
      { key: "ownership", tblId: "DT_1YL202111", itmId: "T0021", label: "주택소유가구 비율", unit: "%" },
    ],
  },
  {
    /*
     * 사업체·종사자 지표는 뺐다. 최신 표(등록기반)가 경남 22개 시군구 중 12개만 주는데,
     * 그대로 실으면 순위가 절반만 보고 「경남 1위」라고 말하게 된다.
     */
    id: "kosis-finance",
    label: "지방재정",
    metrics: [
      { key: "fiscal_independence", tblId: "DT_1YL20921", itmId: "T20", label: "재정자립도", unit: "%" },
      { key: "fiscal_autonomy", tblId: "DT_1YL20891", itmId: "T20", label: "재정자주도", unit: "%" },
      { key: "welfare_budget", tblId: "DT_1YL20912", itmId: "T10", label: "사회복지 결산비중", unit: "%" },
      { key: "admin_budget", tblId: "DT_1YL20902", itmId: "T10", label: "일반공공행정 결산비중", unit: "%" },
    ],
  },
  {
    id: "kosis-transport",
    label: "교통",
    metrics: [
      { key: "car_per_person", tblId: "DT_1YL20731", itmId: "T10", label: "1인당 자동차 등록", unit: "대" },
      { key: "road_paved", tblId: "DT_1YL20721", itmId: "T10", label: "도로포장률", unit: "%" },
    ],
  },
  {
    id: "kosis-environment",
    label: "환경",
    metrics: [
      { key: "recycle", tblId: "DT_1YL21311", itmId: "T10", label: "생활폐기물 재활용률", unit: "%" },
      { key: "waste_per_person", tblId: "DT_1YL21321", itmId: "T10", label: "1인당 생활폐기물 배출", unit: "kg/일" },
      { key: "waterworks", tblId: "DT_1YL20741", itmId: "T10", label: "상수도 보급률", unit: "%" },
    ],
  },
  {
    id: "kosis-education",
    label: "교육·문화",
    metrics: [
      { key: "academy", tblId: "DT_1YL21191", itmId: "T10", label: "인구 천명당 사설학원", unit: "개/천명" },
      { key: "class_size", tblId: "DT_1YL15001", itmId: "T001", label: "학급당 학생수", unit: "명" },
      { key: "culture", tblId: "DT_1YL20931", itmId: "T10", label: "인구 십만명당 문화기반시설", unit: "개/십만명" },
    ],
  },
];

async function main() {
  const apiKey = process.env.KOSIS_API_KEY?.trim() || readKey(readFileSync, SECRET_PATH);
  if (!apiKey) throw new Error("KOSIS API 키를 찾지 못했습니다.");

  const snapshot = JSON.parse(
    readFileSync(path.join(PROJECT_ROOT, "public", "data", "demo-snapshot.json"), "utf8"),
  );
  const regions = snapshot.regions;

  for (const spec of KOSIS_LAYER_SPECS) {
    /*
     * 지표마다 표가 다르므로 연도 축도 다르다. 한 큐브의 월 축은 하나뿐이니, 지표들의
     * **공통 연도**만 싣는다. 없는 해를 null로 채워 축을 늘리면 추세 그래프가 빈 구간을
     * 실제 결측처럼 그리는데, 여기서는 애초에 그 해 자료를 받지 않은 것이라 뜻이 다르다.
     */
    const fetched = [];
    for (const metric of spec.metrics) {
      const rows = await fetchKosisTable({ apiKey, orgId: "101", tblId: metric.tblId, years: 5 });
      const { bySgg, years } = toSggYearMap(rows, { itmId: metric.itmId });
      if (years.length === 0) throw new Error(`${spec.id}/${metric.key}: 값이 하나도 없습니다.`);
      fetched.push({ metric, bySgg, years });
      console.log(`  ${spec.id}/${metric.key} — ${years.length}개년(${years[0]}~${years.at(-1)}) 시군구 ${Object.keys(bySgg).length}`);
    }

    const common = fetched
      .map((f) => new Set(f.years))
      .reduce((a, b) => new Set([...a].filter((y) => b.has(y))));
    const years = [...common].sort();
    if (years.length === 0) {
      throw new Error(`${spec.id}: 지표들이 공유하는 연도가 없습니다 — 레이어를 쪼개야 합니다.`);
    }

    const months = yearsToMonths(years);
    const cells = expandToDongCells(regions, {}, years, "__seed");
    for (const cell of cells) delete cell.series.__seed;
    for (const { metric, bySgg } of fetched) {
      const filled = expandToDongCells(regions, bySgg, years, metric.key);
      for (const [i, cell] of cells.entries()) {
        cell.series[metric.key] = filled[i].series[metric.key];
      }
    }

    const cube = {
      layerId: spec.id,
      adminLevel: "dong",
      referenceMonth: months.at(-1),
      months,
      cells,
    };
    const out = path.join(PROJECT_ROOT, "public", "data", "layers", `${spec.id}.json`);
    writeFileSync(out, JSON.stringify(cube));
    console.log(`${spec.id}: ${cells.length}칸 · ${months.length}개년 · ${spec.metrics.length}지표 → ${path.basename(out)}`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch((error) => {
    console.error(`KOSIS 지표 갱신 실패: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
