import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSggCollection, validateSggCollection } from "./lib/sgg-boundary.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new Error(`${label}이(가) 유효한 JSON이 아닙니다.`, { cause: error });
  }
}

async function atomicWrite(targetPath, bytes) {
  const directory = path.dirname(targetPath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  await mkdir(directory, { recursive: true });

  let handle;
  try {
    handle = await open(temporaryPath, "wx");
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, targetPath);
  } finally {
    await handle?.close();
    await rm(temporaryPath, { force: true });
  }
}

/**
 * 커밋된 행정동 공개 파일에서 시군구 dissolve 산출물을 만든다.
 *
 * fetch-boundaries(원본 갱신)와 분리한 이유: 판번호가 바뀌지 않는 한 dissolve를
 * 다시 돌릴 일이 없고, 네트워크 없이 산출물만 재생성할 수 있어야 한다.
 * fetch-boundaries는 `writeSggArtifact`를 import해 원본 갱신 시 함께 만든다.
 */
export async function writeSggArtifact(dongCollection, version) {
  if (!/^\d{8}$/.test(version ?? "")) {
    throw new Error("시군구 경계 버전은 YYYYMMDD 형식이어야 합니다.");
  }
  const expectedPrefixes = [
    ...new Set(dongCollection.features.map((feature) => feature?.properties?.adm_cd2?.slice(0, 5))),
  ];
  const sggCollection = buildSggCollection(dongCollection);
  const summary = validateSggCollection(sggCollection, expectedPrefixes);

  const sggBytes = new TextEncoder().encode(JSON.stringify(sggCollection));
  const sggPath = path.join(PROJECT_ROOT, "public", "data", `administrative-sgg-${version}.geojson`);
  await atomicWrite(sggPath, sggBytes);

  const sha256 = createHash("sha256").update(sggBytes).digest("hex");

  const metadataPath = path.join(PROJECT_ROOT, "public", "data", "boundary-metadata.json");
  const metadata = parseJson(await readFile(metadataPath), "경계 메타데이터");
  metadata.sgg = { featureCount: summary.featureCount, sha256 };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

  return { version, sggPath, featureCount: summary.featureCount, sha256 };
}

export async function buildSggArtifact(version) {
  const dongPath = path.join(PROJECT_ROOT, "public", "data", `administrative-dong-${version}.geojson`);
  const dongCollection = parseJson(await readFile(dongPath), "경남 공개 경계(행정동)");
  return writeSggArtifact(dongCollection, version);
}

const invokedDirectly =
  process.argv[1] != null && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  const metadataPath = path.join(PROJECT_ROOT, "public", "data", "boundary-metadata.json");
  readFile(metadataPath)
    .then((bytes) => parseJson(bytes, "경계 메타데이터").version)
    .then(buildSggArtifact)
    .then(({ version, featureCount, sha256 }) => {
      console.log(`경남 시군구 경계 생성 완료: ver${version}, ${featureCount}개, SHA-256 ${sha256}`);
    })
    .catch((error) => {
      console.error(`경남 시군구 경계 생성 실패: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    });
}
