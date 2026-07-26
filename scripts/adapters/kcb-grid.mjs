import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";

/**
 * KCB 100m 격자(KCB_STAT_00.txt) → N미터 격자 큐브.
 *
 * 원천은 **부울경**이다(명세서 시트명 "(부울경)"). 경남만 남긴다 — 격자 좌표 매핑
 * 파일이 경남 격자만 담고 있어, 매핑에 없는 격자를 버리는 것이 곧 경남 필터가 된다.
 * 부산·울산 격자가 34.7%를 차지하므로 이 필터가 없으면 다른 시도 값이 섞인다.
 *
 * 원자료 인코딩은 **CP949**다(좌표 매핑 CSV만 UTF-8). latin1로 읽어 바이트를 보존한 뒤
 * euc-kr로 되돌린다. 이걸 놓치면 격자 ID가 깨져 매핑이 0건이 된다(실제로 겪었다).
 *
 * 행 = (기준연월 × 100m격자 × 5세 연령구간). AP00002가 연령구간이라 격자당 5.4행이며,
 * MP00001을 합하면 그 격자의 성인(만18~104세) 인구가 된다. 중복이 아니다.
 *
 * 해상도와 기간은 인자로 받는다. 1km로 시작하되 500m도 바로 시도할 수 있어야 한다.
 *   node scripts/adapters/kcb-grid.mjs --resolution=1000
 *   node scripts/adapters/kcb-grid.mjs --resolution=500 --months=1
 */

const DEFAULT_KCB_DIR = "C:\\업무\\민간데이터\\KCB 데이터";
const KCB_DIR = process.env.KCB_DIR ?? DEFAULT_KCB_DIR;
const CENTROIDS =
  process.env.GRID_CENTROIDS ??
  "C:\\업무\\민간데이터\\격자변환\\grid_100m_centroids_wgs84.csv";
const STAT_FILE = "KCB_STAT_00.txt";

// --- pure helpers (테스트 대상) ---

const NEEDED = [
  "CRTR_YM", "GRID_100M_ID", "MP00001", "MP00003", "MA00001",
  "MS00002", "MC00006", "ML00001", "MD00001", "MD00003", "ECON_CNT",
];

export function parseHeader(headerLine) {
  const cols = headerLine.split("|");
  const idx = {};
  for (const name of NEEDED) {
    const at = cols.indexOf(name);
    if (at < 0) throw new Error(`KCB 격자 헤더에 ${name} 컬럼이 없습니다.`);
    idx[name] = at;
  }
  return idx;
}

/** EPSG:5179 미터 좌표를 해상도로 내림해 격자 키를 만든다. */
export function binKey(x, y, resolution) {
  return `${Math.floor(x / resolution)}_${Math.floor(y / resolution)}`;
}

/** 격자 키 → 그 칸의 중심 좌표(EPSG:5179). */
export function binCenter(key, resolution) {
  const [gx, gy] = key.split("_").map(Number);
  return { x: (gx + 0.5) * resolution, y: (gy + 0.5) * resolution };
}

function num(fields, index) {
  const value = Number(fields[index]);
  return Number.isFinite(value) ? value : null;
}

export function emptyEntry() {
  return {
    pop: 0,
    incomeW: 0,
    scoreW: 0,
    spendSum: 0,
    econ: 0,
    loanHolders: 0,
    delinquent: 0,
    highend: 0,
  };
}

/**
 * 한 행(연령구간 하나)을 격자 집계에 더한다.
 *
 * 소득·신용평점은 명세대로 1인 평균이라 인구로 가중한다. MC00006(카드 이용금액)은
 * 명세에 "평균"이라 적혀 있지만 실제로는 그 집단의 합계다 — 행정동 어댑터에서 이미
 * 겪었다(1인 소비가 5.3억으로 나왔다). 합계로 취급해 소비활동 대상자수로 나눈다.
 */
export function accumulate(entry, fields, idx) {
  const pop = num(fields, idx.MP00001) ?? 0;
  entry.pop += pop;

  const income = num(fields, idx.MA00001);
  if (income !== null) entry.incomeW += income * pop;
  const score = num(fields, idx.MS00002);
  if (score !== null) entry.scoreW += score * pop;

  const spend = num(fields, idx.MC00006);
  const econ = num(fields, idx.ECON_CNT) ?? pop;
  if (spend !== null) {
    entry.spendSum += spend;
    entry.econ += econ;
  }

  entry.loanHolders += num(fields, idx.ML00001) ?? 0;
  entry.delinquent += (num(fields, idx.MD00001) ?? 0) + (num(fields, idx.MD00003) ?? 0);
  entry.highend += num(fields, idx.MP00003) ?? 0;
  return entry;
}

/**
 * 평균·비율을 낼 최소 인구(성인 기준).
 *
 * 1km 칸의 성인 인구 중앙값이 23명이다. 그 정도 표본에서 평균소득·신용평점을 내면
 * 한두 사람이 값을 좌우하고, 소득처럼 민감한 값은 재식별 위험도 생긴다. 명세서에
 * 최소 집계 기준이 없어 직접 정했다 — 30명이면 칸의 42.6%만 남지만 **인구의 98.3%**를
 * 덮는다. 인구수 자체는 통계로 공표되는 값이라 그대로 둔다.
 */
export const MIN_POP_FOR_AVERAGES = 30;

/** 집계자 → 최종 지표(명·만원·점·%). 표본이 모자라면 평균·비율은 내지 않는다. */
export function finalize(entry) {
  const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
  const pop = entry.pop;
  const enough = pop >= MIN_POP_FOR_AVERAGES;
  return {
    pop_total: pop > 0 ? pop : null,
    avg_income: enough && entry.incomeW > 0 ? round1(entry.incomeW / pop / 10) : null,
    credit_score: enough && entry.scoreW > 0 ? Math.round(entry.scoreW / pop) : null,
    card_spend: enough && entry.econ > 0 ? round1(entry.spendSum / entry.econ / 10) : null,
    loan_ratio: enough ? round1((entry.loanHolders / pop) * 100) : null,
    delinquency_ratio: enough ? round1((entry.delinquent / pop) * 100) : null,
    highend_ratio: enough ? round1((entry.highend / pop) * 100) : null,
  };
}

export const METRIC_KEYS = [
  "pop_total", "avg_income", "credit_score", "card_spend",
  "loan_ratio", "delinquency_ratio", "highend_ratio",
];

// --- streaming ---

const decoder = new TextDecoder("euc-kr");
const decodeCp949 = (value) => decoder.decode(Buffer.from(value, "latin1"));

/** 경남 격자 좌표 매핑. 이 목록에 없는 격자(부산·울산)는 버린다. */
async function loadGyeongnamGrids() {
  const rl = readline.createInterface({
    input: createReadStream(CENTROIDS, "utf8"),
    crlfDelay: Infinity,
  });
  const coords = new Map();
  let head = null;
  for await (const line of rl) {
    if (head === null) {
      head = line.split(",").map((c) => c.replace(/^\uFEFF/, "").trim());
      continue;
    }
    const f = line.split(",");
    const gid = f[0];
    const x = Number(f[head.indexOf("center_x_5179")]);
    const y = Number(f[head.indexOf("center_y_5179")]);
    const lon = Number(f[head.indexOf("longitude")]);
    const lat = Number(f[head.indexOf("latitude")]);
    if (!Number.isFinite(x) || !Number.isFinite(lon)) continue;
    coords.set(gid, { x, y, lon, lat });
  }
  return coords;
}

async function monthFolders() {
  const entries = await readdir(KCB_DIR, { withFileTypes: true });
  const folders = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(KCB_DIR, entry.name, STAT_FILE);
    try {
      await stat(file);
      folders.push(file);
    } catch {
      /* 그 달에는 격자 파일이 없다 */
    }
  }
  return folders.sort();
}

async function aggregateMonth(file, coords, resolution, collectPerGrid = false) {
  const rl = readline.createInterface({
    input: createReadStream(file, "latin1"),
    crlfDelay: Infinity,
  });
  const bins = new Map();
  const perGrid = collectPerGrid ? new Map() : null;
  let idx = null;
  let crtrYm = null;
  let dropped = 0;
  let kept = 0;
  for await (const raw of rl) {
    if (idx === null) {
      idx = parseHeader(raw);
      continue;
    }
    const fields = raw.split("|");
    const gid = decodeCp949(fields[idx.GRID_100M_ID] ?? "");
    const at = coords.get(gid);
    if (!at) {
      dropped += 1; // 부산·울산 격자
      continue;
    }
    kept += 1;
    crtrYm ??= fields[idx.CRTR_YM];
    const key = binKey(at.x, at.y, resolution);
    const entry = bins.get(key) ?? emptyEntry();
    accumulate(entry, fields, idx);
    bins.set(key, entry);
    if (perGrid) perGrid.set(gid, (perGrid.get(gid) ?? 0) + (Number(fields[idx.MP00001]) || 0));
  }
  return { bins, crtrYm, dropped, kept, perGrid };
}

/** 격자 중심이 어느 읍면동에 드는지. 표에 코드만 뜨지 않게 이름을 붙인다. */
function dongNamer(boundary) {
  const features = boundary.features.map((feature) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const walk = (coords) => {
      if (typeof coords[0] === "number") {
        minX = Math.min(minX, coords[0]); maxX = Math.max(maxX, coords[0]);
        minY = Math.min(minY, coords[1]); maxY = Math.max(maxY, coords[1]);
        return;
      }
      for (const part of coords) walk(part);
    };
    walk(feature.geometry.coordinates);
    return { feature, bbox: [minX, minY, maxX, maxY] };
  });

  return (lon, lat) => {
    for (const { feature, bbox } of features) {
      if (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
      if (booleanPointInPolygon([lon, lat], feature)) return feature.properties.adm_nm;
    }
    return null;
  };
}

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v ?? "1"];
    }),
  );
  const resolution = Number(args.resolution ?? 1000);
  const monthLimit = args.months ? Number(args.months) : null;
  if (!Number.isFinite(resolution) || resolution < 100) {
    throw new Error("--resolution 은 100 이상의 미터 값이어야 합니다.");
  }

  const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
  const boundaryPath = path.join(projectRoot, "public", "data", "administrative-dong-20260701.geojson");
  const label = resolution >= 1000 ? `${resolution / 1000}km` : `${resolution}m`;
  const outputPath = path.join(projectRoot, "public", "data", "layers", `kcb-grid-${label}.json`);

  console.log(`해상도 ${label} · 좌표 매핑 로드 중…`);
  const coords = await loadGyeongnamGrids();
  console.log(`  경남 100m 격자 ${coords.size.toLocaleString()}개`);

  const boundary = JSON.parse(await readFile(boundaryPath, "utf8"));
  const nameAt = dongNamer(boundary);

  let files = await monthFolders();
  if (monthLimit) files = files.slice(-monthLimit);
  console.log(`대상 월 ${files.length}개`);

  const months = [];
  const perMonth = [];
  let referenceGridPop = null;
  for (const file of files) {
    const isLast = file === files[files.length - 1];
    const { bins, crtrYm, dropped, kept, perGrid } = await aggregateMonth(file, coords, resolution, isLast);
    if (perGrid) referenceGridPop = perGrid;
    const month = `${crtrYm.slice(0, 4)}-${crtrYm.slice(4, 6)}`;
    months.push(month);
    perMonth.push(bins);
    console.log(
      `  ${month}: ${label} 격자 ${bins.size.toLocaleString()}칸 · 경남 행 ${kept.toLocaleString()} · 부울 제외 ${dropped.toLocaleString()}`,
    );
  }

  // 모든 달에 등장한 칸의 합집합으로 셀을 만든다.
  const keys = [...new Set(perMonth.flatMap((bins) => [...bins.keys()]))].sort();

  /*
   * EPSG:5179 미터 → 위경도 변환.
   *
   * 투영 라이브러리를 새로 들이지 않고, 이미 가진 100m 중심점 100만 개로 아핀 변환을
   * 최소제곱 적합한다(lon = a + b·x + c·y, lat = d + e·x + f·y). 5179는 람베르트
   * 원뿔도법이라 경남 폭(약 170km)에서도 거의 아핀이다 — 잔차를 아래에서 실측해 찍는다.
   *
   * 칸 중심을 **구성원 평균**으로 잡으면 격자가 어긋난다(칸마다 구성원 분포가 달라
   * 중심이 조금씩 밀린다). 격자 좌표에서 계산한 참 중심을 써야 칸들이 딱 맞물린다.
   */
  const affine = (() => {
    let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
    let sLon = 0, sxLon = 0, syLon = 0, sLat = 0, sxLat = 0, syLat = 0;
    for (const [, at] of coords) {
      n += 1; sx += at.x; sy += at.y;
      sxx += at.x * at.x; sxy += at.x * at.y; syy += at.y * at.y;
      sLon += at.lon; sxLon += at.x * at.lon; syLon += at.y * at.lon;
      sLat += at.lat; sxLat += at.x * at.lat; syLat += at.y * at.lat;
    }
    // 3x3 정규방정식을 가우스 소거로 푼다(계수는 [1, x, y] 기준).
    const solve = (rhs) => {
      const m = [
        [n, sx, sy, rhs[0]],
        [sx, sxx, sxy, rhs[1]],
        [sy, sxy, syy, rhs[2]],
      ];
      for (let i = 0; i < 3; i += 1) {
        let pivot = i;
        for (let r = i + 1; r < 3; r += 1) if (Math.abs(m[r][i]) > Math.abs(m[pivot][i])) pivot = r;
        [m[i], m[pivot]] = [m[pivot], m[i]];
        for (let r = 0; r < 3; r += 1) {
          if (r === i) continue;
          const factor = m[r][i] / m[i][i];
          for (let c = i; c < 4; c += 1) m[r][c] -= factor * m[i][c];
        }
      }
      return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
    };
    return { lon: solve([sLon, sxLon, syLon]), lat: solve([sLat, sxLat, syLat]) };
  })();
  /*
   * 전역 아핀 하나로는 부족하다 — 실측 최대 오차가 337m로 1km 칸의 34%였다.
   * 5179는 람베르트 원뿔도법이라 경남 폭(약 170km)에서 상수항이 밀린다.
   *
   * 대신 **칸마다 실제 100m 중심점 하나를 기준점으로 삼고**, 거기서의 이동만 아핀
   * 미분값(도/미터)으로 환산한다. 이동 거리가 500m를 넘지 않으므로 오차가 미터 수준으로
   * 줄어든다. 기준점은 칸 중심에 가장 가까운 구성원을 쓴다.
   */
  const dLon = { dx: affine.lon[1], dy: affine.lon[2] };
  const dLat = { dx: affine.lat[1], dy: affine.lat[2] };

  const anchors = new Map();
  for (const [, at] of coords) {
    const key = binKey(at.x, at.y, resolution);
    const center = binCenter(key, resolution);
    const d = Math.hypot(at.x - center.x, at.y - center.y);
    const prev = anchors.get(key);
    if (!prev || d < prev.d) anchors.set(key, { ...at, d });
  }

  const toLonLatNear = (anchor, x, y) => ({
    lon: anchor.lon + dLon.dx * (x - anchor.x) + dLon.dy * (y - anchor.y),
    lat: anchor.lat + dLat.dx * (x - anchor.x) + dLat.dy * (y - anchor.y),
  });

  // 기준점 방식이 실제로 얼마나 정확한지 재서 남긴다(추측하지 않는다).
  {
    let worst = 0;
    let checked = 0;
    for (const [, at] of coords) {
      if (checked++ % 97 !== 0) continue;
      const anchor = anchors.get(binKey(at.x, at.y, resolution));
      if (!anchor) continue;
      const got = toLonLatNear(anchor, at.x, at.y);
      const dx = (got.lon - at.lon) * 111320 * Math.cos((at.lat * Math.PI) / 180);
      const dy = (got.lat - at.lat) * 110570;
      worst = Math.max(worst, Math.hypot(dx, dy));
    }
    console.log(`  좌표 변환 최대 오차 ${worst.toFixed(2)}m (칸 ${resolution}m 대비 ${((worst / resolution) * 100).toFixed(3)}%)`);
  }

  const round6 = (v) => Math.round(v * 1e6) / 1e6;

  /*
   * 도시부만 남긴다.
   *
   * KCB 격자는 (격자 × 5세연령구간) 인구가 3명 미만이면 아예 행을 주지 않는다(원자료
   * 최소값이 정확히 3이다). 농촌은 인구가 얇게 퍼져 대부분의 조합이 그 밑이라 통째로
   * 빠진다 — 100m 단위로 읍면동과 대조하니 하동 청암면 21%, 산청 삼장면 29%처럼
   * 나왔다(전체 88.7%, ±10% 이내는 305개 중 91개뿐).
   *
   * 그대로 실으면 "이 면은 인구가 없다"로 읽히는데 실제로는 KCB가 안 준 것이다.
   * 격자의 값어치는 읍면동 **안**을 더 잘게 보는 것이고 그건 도시부에서 나온다.
   * 농촌은 읍면동 레이어로 충분하므로, 표본이 성긴 지역은 아예 빼서 오독을 막는다.
   */
  const MIN_DONG_COVERAGE = 0.9;
  const coveredDongs = await (async () => {
    const dongCube = JSON.parse(
      await readFile(path.join(projectRoot, "public", "data", "layers", "kcb-credit.json"), "utf8"),
    );
    const di = dongCube.months.indexOf(dongCube.referenceMonth);
    const dongPop = new Map(
      dongCube.cells.map((cell) => [cell.name.replace(/^경상남도\s*/, ""), cell.series.pop_total?.[di]]),
    );

    const gridPopByDong = new Map();
    for (const [gid, pop] of referenceGridPop ?? []) {
      const at = coords.get(gid);
      if (!at) continue;
      const name = nameAt(at.lon, at.lat);
      if (!name) continue;
      const key = name.replace(/^경상남도\s*/, "");
      gridPopByDong.set(key, (gridPopByDong.get(key) ?? 0) + pop);
    }

    const covered = new Set();
    let checked = 0;
    for (const [name, gridPop] of gridPopByDong) {
      const dong = dongPop.get(name);
      if (dong == null || dong === 0) continue;
      checked += 1;
      if (gridPop / dong >= MIN_DONG_COVERAGE) covered.add(name);
    }
    console.log(
      `  격자 표본이 읍면동 인구의 ${MIN_DONG_COVERAGE * 100}% 이상인 곳: ${covered.size}/${checked}개 읍면동`,
    );
    return covered;
  })();

  const areaKm2 = (resolution / 1000) ** 2;
  const cells = [];
  const features = [];
  let unnamed = 0;
  let droppedSparse = 0;
  for (const key of keys) {
    const center = binCenter(key, resolution);
    const anchor = anchors.get(key);
    if (!anchor) continue;
    const { lon, lat } = toLonLatNear(anchor, center.x, center.y);
    const dong = nameAt(lon, lat);
    if (!dong) {
      unnamed += 1;
      continue; // 읍면동 밖(바다·경계)이면 어느 지역 것인지 말할 수 없다.
    }
    const dongName = dong.replace(/^경상남도\s*/, "");
    if (!coveredDongs.has(dongName)) {
      droppedSparse += 1;
      continue;
    }

    const series = {};
    for (const metric of METRIC_KEYS) series[metric] = [];
    for (const bins of perMonth) {
      const values = bins.has(key) ? finalize(bins.get(key)) : null;
      for (const metric of METRIC_KEYS) series[metric].push(values ? values[metric] : null);
    }

    const name = `${dongName} ${label}격자`;
    cells.push({
      code: key,
      name,
      point: { lat: round6(lat), lng: round6(lon) },
      areaKm2,
      series,
    });

    // 지도는 읍면동 폴리곤을 칠하는 경로를 그대로 쓴다. 격자도 같은 모양의 GeoJSON으로
    // 내보내면 채색·클릭·툴팁이 전부 따라온다.
    const sw = toLonLatNear(anchor, center.x - resolution / 2, center.y - resolution / 2);
    const ne = toLonLatNear(anchor, center.x + resolution / 2, center.y + resolution / 2);
    const west = round6(sw.lon);
    const east = round6(ne.lon);
    const south = round6(sw.lat);
    const north = round6(ne.lat);
    features.push({
      type: "Feature",
      properties: { adm_cd2: key, adm_nm: name, sggnm: dongName.split(/\s+/)[0] ?? "" },
      geometry: {
        type: "Polygon",
        coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
      },
    });
  }

  const cube = {
    layerId: `kcb-grid-${label}`,
    adminLevel: "dong",
    referenceMonth: months[months.length - 1],
    months,
    cells,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(cube), "utf8");
  const geoPath = path.join(projectRoot, "public", "data", `grid-${label}.geojson`);
  await writeFile(geoPath, JSON.stringify({ type: "FeatureCollection", features }), "utf8");
  const geoWritten = await stat(geoPath);
  console.log(`  경계 ${geoPath} · ${(geoWritten.size / 1024).toFixed(0)}KB`);
  const written = await stat(outputPath);
  console.log(
    `\n${outputPath}\n  셀 ${cells.length.toLocaleString()}개 · 월 ${months.length}개 · ${(written.size / 1024).toFixed(0)}KB` +
      ` · 제외: 읍면동 밖 ${unnamed}칸, 표본 성긴 지역 ${droppedSparse}칸`,
  );
}

main();
