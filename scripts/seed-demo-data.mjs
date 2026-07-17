import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildDemoMetadata, seedSnapshot } from "./lib/seed-core.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const PUBLIC_DATA_DIR = path.join(PROJECT_ROOT, "public", "data");
const METADATA_PATH = path.join(PUBLIC_DATA_DIR, "boundary-metadata.json");
const SNAPSHOT_PATH = path.join(PUBLIC_DATA_DIR, "demo-snapshot.json");
const DEMO_METADATA_PATH = path.join(PUBLIC_DATA_DIR, "demo-metadata.json");

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label}이(가) 유효한 JSON이 아닙니다.`, { cause: error });
  }
}

async function main() {
  const metadata = parseJson(await readFile(METADATA_PATH), "경계 메타데이터");
  const version = metadata.version;
  if (!/^\d{8}$/.test(String(version))) {
    throw new Error("경계 메타데이터에 유효한 버전이 없습니다.");
  }

  const boundaryPath = path.join(PUBLIC_DATA_DIR, `busan-administrative-dong-${version}.geojson`);
  const boundary = parseJson(await readFile(boundaryPath), "부산 공개 경계");

  const versionSeed = Number(version);
  const snapshot = seedSnapshot(boundary, versionSeed);
  const snapshotBytes = new TextEncoder().encode(JSON.stringify(snapshot));

  const demoMetadata = buildDemoMetadata(snapshot, {
    versionSeed,
    generatedAt: new Date().toISOString(),
  });
  const metadataBytes = new TextEncoder().encode(`${JSON.stringify(demoMetadata, null, 2)}\n`);

  await writeFile(SNAPSHOT_PATH, snapshotBytes);
  await writeFile(DEMO_METADATA_PATH, metadataBytes);

  console.log(
    `부산 데모 스냅샷 생성 완료: ${snapshot.regions.length}개 행정동, ${snapshot.facilities.length}개 시설, SHA-256 ${demoMetadata.sha256}`,
  );
}

main().catch((error) => {
  console.error(`부산 데모 스냅샷 생성 실패: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
