/**
 * Kimi 외부 검증 — 항목 3: 지점 반경 분석의 기하 계산
 *
 * 실행: npx vitest run scripts/kimi-review/3-geometry.test.ts
 *
 * 측정:
 *  3-4  등거리 원통 근사(110.574 / 111.32·cos) vs 하버사인(R=6371.0088) 오차 실측
 *  3-3  bbox 거리의 하한 성질 — 내부 투영 내 성립 여부 + 남북으로 긴 상자의 역례 탐색
 *  3-1  305개 실제 경계 위 격자 표본 포함 판정 — turf와 교차 대조
 *  3-2  실제 geojson의 링(구멍) 전수 조사 + 인공 도넛에서 turf와 비교
 *  성능 probeRadius 1회 실행 시간 · bbox 필터 잔여 수
 */
import { readFileSync } from "node:fs";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point as turfPoint } from "@turf/helpers";
import { describe, it } from "vitest";

import { distanceInKilometers } from "@/lib/gis/metrics";
import { probeRadius, pointInFeature } from "@/lib/gis/point-probe";

/* point-probe.ts의 비공개 함수와 같은 식 — 근사 오차 측정 전용 복제본 */
function localScale(lat: number) {
  return { latScale: 110.574, lngScale: 111.32 * Math.cos((lat * Math.PI) / 180) };
}
function approxDistanceKm(p: { lat: number; lng: number }, q: { lat: number; lng: number }) {
  const { latScale, lngScale } = localScale(p.lat);
  return Math.hypot((q.lng - p.lng) * lngScale, (q.lat - p.lat) * latScale);
}

const boundary = JSON.parse(
  readFileSync("public/data/administrative-dong-20260701.geojson", "utf8"),
);

describe("항목3: 기하 실측", () => {
  it("3-4: 평면 근사 vs 하버사인 오차(위도 34.5~35.8, 0.5~5km, 8방위)", () => {
    console.log("\n===== 3-4 근사 오차 =====");
    console.log("위도   거리km   최대오차m(방위)   평균|오차|m");
    let worst = { err: 0, lat: 0, km: 0, az: 0 };
    for (const lat of [34.5, 35.0, 35.23, 35.5, 35.8]) {
      for (const km of [0.5, 1, 3, 5]) {
        let maxErr = 0, maxAz = 0, sum = 0;
        for (let k = 0; k < 8; k++) {
          const az = (k * Math.PI) / 4;
          // 하버사인 역산: p에서 km만큼 az 방향으로 간 점 q를 구한다(구면)
          const R = 6371.0088;
          const d = km / R;
          const φ1 = (lat * Math.PI) / 180, λ1 = (128.68 * Math.PI) / 180;
          const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(az));
          const λ2 = λ1 + Math.atan2(Math.sin(az) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
          const q = { lat: (φ2 * 180) / Math.PI, lng: (λ2 * 180) / Math.PI };
          const p = { lat, lng: 128.68 };
          const approx = approxDistanceKm(p, q);
          const exact = distanceInKilometers(p, q);
          const err = (approx - exact) * 1000;
          sum += Math.abs(err);
          if (Math.abs(err) > Math.abs(maxErr)) { maxErr = err; maxAz = k * 45; }
          if (Math.abs(err) > Math.abs(worst.err)) worst = { err, lat, km, az: k * 45 };
        }
        console.log(`${lat.toFixed(2)}  ${km.toFixed(1)}     ${(maxErr).toFixed(1)}m (${maxAz}°)      ${(sum / 8).toFixed(1)}m`);
      }
    }
    console.log(`최악: 위도 ${worst.lat}, ${worst.km}km, ${worst.az}°방향 → ${worst.err.toFixed(1)}m`);
  });

  it("3-3: 남북으로 긴 상자에서 bbox 거리가 진거리보다 크게 나오는가(하한 붕괴 탐색)", () => {
    console.log("\n===== 3-3 하한 붕괴 탐색 =====");
    // 지점 남쪽, 상자는 북쪽으로 10km 이어지고 동서로 넓은 읍면을 가정
    // 진거리 = 상자 남쪽 가장자리까지의 하버사인, bbox거리 = 코드의 평면근사
    const p = { lat: 35.0, lng: 128.0 };
    let maxOver = 0, worstCfg = "";
    for (const southLat of [35.03, 35.05, 35.1]) {
      for (const widthDeg of [0.05, 0.2, 0.5]) {
        const box: [number, number, number, number] = [128.0 - widthDeg, southLat, 128.0 + widthDeg, southLat + 0.1];
        // 코드의 bboxDistanceKm 복제
        const { latScale, lngScale } = localScale(p.lat);
        const dLng = Math.max(box[0] - p.lng, 0, p.lng - box[2]) * lngScale;
        const dLat = Math.max(box[1] - p.lat, 0, p.lat - box[3]) * latScale;
        const approx = Math.hypot(dLng, dLat);
        // 진짜 최단거리: 상자 안에서 가장 가까운 점(같은 경도, 남쪽 가장자리)
        const exact = distanceInKilometers(p, { lat: southLat, lng: 128.0 });
        const over = (approx - exact) * 1000;
        if (over > maxOver) { maxOver = over; worstCfg = `남쪽가장자리 ${southLat}, 반폭 ${widthDeg}°`; }
        console.log(`남단 ${southLat} 반폭 ${widthDeg}°: 근사 ${approx.toFixed(4)}km vs 하버사인 ${exact.toFixed(4)}km → 근사가 ${over.toFixed(1)}m ${over >= 0 ? "큼(보수적)" : "작음(빠뜨릴 수 있음!)"}`);
      }
    }
    console.log(`최대 초과: +${maxOver.toFixed(1)}m (${worstCfg})`);
  });

  it("3-1/3-2: 실제 경계 305개 — 링·꼭짓점 전수, 격자 표본으로 turf와 교차 대조", () => {
    const features = boundary.features;
    let vertices = 0, holes = 0, multi = 0;
    for (const f of features) {
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      if (polys.length > 1) multi += 1;
      for (const rings of polys) {
        if (rings.length > 1) holes += rings.length - 1;
        for (const ring of rings) vertices += ring.length;
      }
    }
    console.log(`\n===== 경계 전수 =====`);
    console.log(`features=${features.length} vertices=${vertices} 구멍보유 폴리곤=${holes} MultiPolygon=${multi}`);

    // 격자 표본: 경남 bbox 위 0.01° 격자, 각 점에서 (내부구현 vs turf) 비교 + 포함 feature 수
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const f of features) {
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const rings of polys) for (const ring of rings) for (const [x, y] of ring) {
        if (x < minLng) minLng = x; if (x > maxLng) maxLng = x;
        if (y < minLat) minLat = y; if (y > maxLat) maxLat = y;
      }
    }
    let n = 0, disagree = 0, zero = 0, one = 0, twoPlus = 0;
    const disagreeSamples: string[] = [];
    for (let lat = minLat; lat <= maxLat; lat += 0.01) {
      for (let lng = minLng; lng <= maxLng; lng += 0.01) {
        const pt = { lat, lng };
        let hits = 0;
        for (const f of features) {
          const mine = pointInFeature(pt, f);
          const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
          const turf = polys.some((rings: never) =>
            booleanPointInPolygon(turfPoint([lng, lat]), { type: "Polygon", coordinates: rings }),
          );
          if (mine !== turf) {
            disagree += 1;
            if (disagreeSamples.length < 5) disagreeSamples.push(`${lat.toFixed(3)},${lng.toFixed(3)} ${f.properties.adm_nm} mine=${mine} turf=${turf}`);
          }
          if (mine) hits += 1;
        }
        n += 1;
        if (hits === 0) zero += 1; else if (hits === 1) one += 1; else twoPlus += 1;
      }
    }
    console.log(`격자 ${n}점: 포함0=${zero} 포함1=${one} 포함2+=${twoPlus}`);
    console.log(`turf와 불일치: ${disagree}건 ${disagreeSamples.join(" | ") || "(없음)"}`);

    // 인공 도넛 — turf와 같은 판정인지
    const donut = {
      type: "Feature",
      properties: { adm_cd2: "X", adm_nm: "도넛" },
      geometry: { type: "Polygon", coordinates: [
        [[127, 34], [129, 34], [129, 36], [127, 36], [127, 34]],
        [[127.4, 34.4], [128.6, 34.4], [128.6, 35.6], [127.4, 35.6], [127.4, 34.4]],
      ] },
    };
    for (const [label, pt] of [["구멍 안", { lat: 35, lng: 128 }], ["도넛 살", { lat: 34.2, lng: 128 }], ["바깥", { lat: 33, lng: 128 }]] as const) {
      const mine = pointInFeature(pt, donut as never);
      const turf = booleanPointInPolygon(turfPoint([pt.lng, pt.lat]), donut.geometry as never);
      console.log(`도넛 ${label}: mine=${mine} turf=${turf} ${mine === turf ? "일치" : "불일치!"}`);
    }
  });

  it("성능: probeRadius 1회 — 305개 경계 + 시설 4,272개", () => {
    // 창원 시내 한 점, 반경 3km. 시설은 경남 bbox 안 난수 4,272개(의료취약 순위의 실제 규모).
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const f of boundary.features) {
      const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const rings of polys) for (const ring of rings) for (const [x, y] of ring) {
        if (x < minLng) minLng = x; if (x > maxLng) maxLng = x;
        if (y < minLat) minLat = y; if (y > maxLat) maxLat = y;
      }
    }
    let seed = 42;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const facilities = Array.from({ length: 4272 }, (_, i) => ({
      id: `f${i}`, name: `시설${i}`, type: `종류${i % 7}`,
      lat: minLat + rand() * (maxLat - minLat), lng: minLng + rand() * (maxLng - minLng),
    }));

    const t0 = performance.now();
    const result = probeRadius({ point: { lat: 35.227, lng: 128.681 }, radiusKm: 3, boundary, facilities });
    const t1 = performance.now();
    console.log(`\n===== 성능 =====`);
    console.log(`probeRadius 1회(창원 시내, 반경 3km, 시설 4272): ${(t1 - t0).toFixed(1)}ms`);
    console.log(`걸치는 행정동: ${result.regions.length}개 · 반경 내 시설: ${result.facilities.length}개 · 속한 동: ${result.containing?.name}`);
    // 재실행(캐시 상태)
    const t2 = performance.now();
    probeRadius({ point: { lat: 35.15, lng: 129.0 }, radiusKm: 5, boundary, facilities });
    const t3 = performance.now();
    console.log(`2회차(울산 근처 바다, 반경 5km): ${(t3 - t2).toFixed(1)}ms`);
  });
});
