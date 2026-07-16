import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildBoundaryMetadata, validateBoundaryCollection } from "./lib/boundary-core.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const METADATA_PATH = path.join(PROJECT_ROOT, "public", "data", "boundary-metadata.json");

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label}이(가) 유효한 JSON이 아닙니다.`, { cause: error });
  }
}

function assertSameCodes(actual, expected) {
  if (
    !Array.isArray(actual) ||
    actual.length !== expected.length ||
    actual.some((code, index) => code !== expected[index])
  ) {
    throw new Error("경계 메타데이터의 행정동 코드 목록이 실제 공개 경계와 일치하지 않습니다.");
  }
}

async function main() {
  const metadataBytes = await readFile(METADATA_PATH);
  const metadata = parseJson(metadataBytes, "경계 메타데이터");
  if (!metadata || typeof metadata !== "object" || !/^\d{8}$/.test(metadata.version)) {
    throw new Error("경계 메타데이터 버전은 YYYYMMDD 형식이어야 합니다.");
  }

  const boundaryPath = path.join(
    PROJECT_ROOT,
    "public",
    "data",
    `busan-administrative-dong-${metadata.version}.geojson`,
  );
  const boundaryBytes = await readFile(boundaryPath);
  const boundaryCollection = parseJson(boundaryBytes, "부산 공개 경계");
  const summary = validateBoundaryCollection(boundaryCollection);
  const expectedMetadata = buildBoundaryMetadata(boundaryBytes, {
    version: metadata.version,
    sourceUrl: metadata.sourceUrl,
    downloadedAt: metadata.downloadedAt,
    administrativeDongCodes: summary.administrativeDongCodes,
  });

  if (metadata.sha256 !== expectedMetadata.sha256) {
    throw new Error(
      `경계 SHA-256 불일치: metadata=${metadata.sha256}, actual=${expectedMetadata.sha256}`,
    );
  }
  if (metadata.featureCount !== summary.featureCount) {
    throw new Error(
      `경계 Feature 수 불일치: metadata=${metadata.featureCount}, actual=${summary.featureCount}`,
    );
  }
  assertSameCodes(metadata.administrativeDongCodes, summary.administrativeDongCodes);

  console.log(
    `부산 행정동 경계 캐시 검증 완료: ver${metadata.version}, ${summary.featureCount}개, SHA-256 ${expectedMetadata.sha256}`,
  );
}

main().catch((error) => {
  console.error(`부산 행정동 경계 캐시 검증 실패: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
