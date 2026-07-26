/**
 * KCB 100m 격자를 그대로 쓰기엔 셀이 너무 많다. 500m·1km로 묶으면 몇 개가 되는지,
 * 그때 값이 얼마나 남는지 먼저 재 본다. 어댑터를 쓰기 전에 규모부터 확인하는 절차다.
 */
import { createReadStream } from "node:fs";
import readline from "node:readline";

const KCB = "C:/업무/민간데이터/KCB 데이터/(KCB)경남도청_데이터_20251222/KCB_STAT_00.txt";
const CENTROIDS = "C:/업무/민간데이터/격자변환/grid_100m_centroids_wgs84.csv";

async function collectGrids() {
  const rl = readline.createInterface({
    input: createReadStream(KCB, "utf8"),
    crlfDelay: Infinity,
  });
  const grids = new Set();
  let rows = 0;
  let header = null;
  for await (const line of rl) {
    if (header === null) {
      header = line.split("|");
      continue;
    }
    const id = line.split("|", 2)[1];
    if (id) grids.add(id);
    rows += 1;
  }
  return { grids, rows, header };
}

async function main() {
  const t0 = Date.now();
  const { grids, rows, header } = await collectGrids();
  console.log(`KCB 격자 파일: ${rows.toLocaleString()}행 · 고유 격자 ${grids.size.toLocaleString()}개 (${Math.round((Date.now() - t0) / 1000)}초)`);
  console.log(`컬럼 ${header.length}개`);

  // 중심점 매핑에서 경남 격자만 추린다.
  const rl = readline.createInterface({
    input: createReadStream(CENTROIDS, "utf8"),
    crlfDelay: Infinity,
  });
  let head = null;
  let matched = 0;
  let scanned = 0;
  const bins = { 500: new Set(), 1000: new Set() };
  let bbox = null;
  for await (const line of rl) {
    if (head === null) {
      head = line.split(",").map((c) => c.trim());
      console.log("중심점 컬럼:", head.join(", "));
      continue;
    }
    scanned += 1;
    const f = line.split(",");
    const gid = f[head.indexOf("gid")];
    if (!grids.has(gid)) continue;
    matched += 1;
    const x = Number(f[head.indexOf("center_x_5179")]);
    const y = Number(f[head.indexOf("center_y_5179")]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    bins[500].add(`${Math.floor(x / 500)}_${Math.floor(y / 500)}`);
    bins[1000].add(`${Math.floor(x / 1000)}_${Math.floor(y / 1000)}`);
    const lon = Number(f[head.indexOf("longitude")]);
    const lat = Number(f[head.indexOf("latitude")]);
    bbox = bbox
      ? [Math.min(bbox[0], lon), Math.min(bbox[1], lat), Math.max(bbox[2], lon), Math.max(bbox[3], lat)]
      : [lon, lat, lon, lat];
  }

  console.log(`\n중심점 파일 ${scanned.toLocaleString()}행 중 경남 격자 ${matched.toLocaleString()}개 매칭`);
  console.log(`  100m 그대로 : ${grids.size.toLocaleString()}셀`);
  console.log(`  500m 로 묶음: ${bins[500].size.toLocaleString()}셀`);
  console.log(`  1km 로 묶음 : ${bins[1000].size.toLocaleString()}셀`);
  if (bbox) console.log(`  경계: 경도 ${bbox[0].toFixed(3)}~${bbox[2].toFixed(3)} · 위도 ${bbox[1].toFixed(3)}~${bbox[3].toFixed(3)}`);
  console.log(`\n총 ${Math.round((Date.now() - t0) / 1000)}초`);
}

main();
