/**
 * 격자 데이터가 읍면동 데이터와 맞는지 100m 단위에서 대조한다.
 *
 * 1km로 묶은 뒤 칸 중심으로 읍면동을 붙여 비교하면, 칸이 경계를 걸칠 때 인구가 통째로
 * 옆 동으로 넘어가 실제보다 훨씬 어긋나 보인다. 그래서 묶기 전에, 100m 중심점 각각을
 * 읍면동에 넣고 합해서 본다. 이러면 "데이터가 맞는가"와 "묶는 방식이 맞는가"가 갈린다.
 */
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";

const KCB_FILE =
  "C:\\업무\\민간데이터\\KCB 데이터\\(KCB)경남도청_데이터_20251222\\KCB_STAT_00.txt";
const CENTROIDS = "C:\\업무\\민간데이터\\격자변환\\grid_100m_centroids_wgs84.csv";

const decoder = new TextDecoder("euc-kr");
const decode = (v) => decoder.decode(Buffer.from(v, "latin1"));

async function main() {
  const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
  const boundary = JSON.parse(
    await readFile(path.join(projectRoot, "public", "data", "administrative-dong-20260701.geojson"), "utf8"),
  );
  const dongCube = JSON.parse(
    await readFile(path.join(projectRoot, "public", "data", "layers", "kcb-credit.json"), "utf8"),
  );

  const feats = boundary.features.map((f) => {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    const walk = (co) => {
      if (typeof co[0] === "number") {
        a = Math.min(a, co[0]); c = Math.max(c, co[0]);
        b = Math.min(b, co[1]); d = Math.max(d, co[1]);
        return;
      }
      for (const p of co) walk(p);
    };
    walk(f.geometry.coordinates);
    return { f, bbox: [a, b, c, d], name: f.properties.adm_nm.replace(/^경상남도\s*/, "") };
  });
  const dongOf = (lon, lat) => {
    for (const { f, bbox, name } of feats) {
      if (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
      if (booleanPointInPolygon([lon, lat], f)) return name;
    }
    return null;
  };

  // 좌표 매핑
  const coords = new Map();
  {
    const rl = readline.createInterface({ input: createReadStream(CENTROIDS, "utf8"), crlfDelay: Infinity });
    let head = null;
    for await (const line of rl) {
      if (head === null) { head = line.split(",").map((c) => c.replace(/^\uFEFF/, "").trim()); continue; }
      const f = line.split(",");
      const lon = Number(f[head.indexOf("longitude")]);
      const lat = Number(f[head.indexOf("latitude")]);
      if (Number.isFinite(lon)) coords.set(f[0], { lon, lat });
    }
  }
  console.log(`좌표 매핑 ${coords.size.toLocaleString()}개`);

  // 100m 격자별 인구 합
  const popByGrid = new Map();
  let unmatchedRows = 0;
  {
    const rl = readline.createInterface({ input: createReadStream(KCB_FILE, "latin1"), crlfDelay: Infinity });
    let idx = null;
    for await (const raw of rl) {
      const f = raw.split("|");
      if (idx === null) { idx = { g: f.indexOf("GRID_100M_ID"), p: f.indexOf("MP00001") }; continue; }
      const gid = decode(f[idx.g] ?? "");
      if (!coords.has(gid)) { unmatchedRows += 1; continue; }
      popByGrid.set(gid, (popByGrid.get(gid) ?? 0) + (Number(f[idx.p]) || 0));
    }
  }
  console.log(`경남 격자 ${popByGrid.size.toLocaleString()}개 · 매핑 밖 행 ${unmatchedRows.toLocaleString()}`);

  // 100m 중심점을 읍면동에 넣어 합산
  const byDong = new Map();
  let outside = 0;
  let outsidePop = 0;
  for (const [gid, pop] of popByGrid) {
    const at = coords.get(gid);
    const name = dongOf(at.lon, at.lat);
    if (!name) { outside += 1; outsidePop += pop; continue; }
    byDong.set(name, (byDong.get(name) ?? 0) + pop);
  }
  console.log(`읍면동 밖 격자 ${outside.toLocaleString()}개 (인구 ${outsidePop.toLocaleString()})`);

  const di = dongCube.months.indexOf(dongCube.referenceMonth);
  const dongPop = new Map(
    dongCube.cells.map((c) => [c.name.replace(/^경상남도\s*/, ""), c.series.pop_total?.[di]]),
  );

  let n = 0, close = 0;
  const worst = [];
  for (const [name, g] of byDong) {
    const d = dongPop.get(name);
    if (d == null || d === 0) continue;
    n += 1;
    const ratio = g / d;
    if (ratio > 0.9 && ratio < 1.1) close += 1;
    else worst.push({ name, g, d, ratio });
  }
  worst.sort((a, b) => Math.abs(1 - a.ratio) - Math.abs(1 - b.ratio)).reverse();
  console.log(`\n100m 기준 대조: ${n}개 읍면동 · ±10% 이내 ${close} (${((close / n) * 100).toFixed(0)}%)`);
  for (const w of worst.slice(0, 8)) {
    console.log(`  ${w.name}: 격자 ${w.g.toLocaleString()} vs 동 ${w.d.toLocaleString()} (${(w.ratio * 100).toFixed(0)}%)`);
  }
  const gTot = [...byDong.values()].reduce((a, b) => a + b, 0);
  const dTot = [...dongPop.values()].filter((v) => v != null).reduce((a, b) => a + b, 0);
  console.log(`\n합계: 격자 ${gTot.toLocaleString()} · 동 ${dTot.toLocaleString()} (${((gTot / dTot) * 100).toFixed(1)}%)`);
}

main();
