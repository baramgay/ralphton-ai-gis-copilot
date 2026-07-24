import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildBoundaryMetadata,
  discoverLatestVersion,
  extractGyeongnam,
  validateBoundaryCollection,
} from "./lib/boundary-core.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const GITHUB_CONTENTS_API = "https://api.github.com/repos/vuski/admdongkor/contents";
const GITHUB_ACCEPT = "application/vnd.github+json";
const USER_AGENT = "ralphton-ai-gis-copilot/0.1.0";
const REQUEST_TIMEOUT_MS = 20_000;

async function readResponseWithTimeout(url, accept, readResponse) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: accept,
        "User-Agent": USER_AGENT,
        ...(accept === GITHUB_ACCEPT
          ? { "X-GitHub-Api-Version": "2022-11-28" }
          : {}),
      },
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`GitHub 요청 실패: HTTP ${response.status} ${response.statusText} (${url})`);
    }

    return await readResponse(response);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`GitHub 요청이 20초 안에 완료되지 않았습니다: ${url}`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url) {
  return readResponseWithTimeout(url, GITHUB_ACCEPT, (response) => response.json());
}

async function fetchBytes(url) {
  const arrayBuffer = await readResponseWithTimeout(url, "application/geo+json", (response) =>
    response.arrayBuffer(),
  );
  return new Uint8Array(arrayBuffer);
}

function assertVersionDirectoryEntry(entry, version) {
  if (
    !entry ||
    entry.type !== "dir" ||
    entry.name !== `ver${version}` ||
    typeof entry.url !== "string" ||
    !entry.url.startsWith(
      `https://api.github.com/repos/vuski/admdongkor/contents/ver${version}`,
    )
  ) {
    throw new Error(`GitHub API에서 ver${version} 디렉터리 URL을 확인할 수 없습니다.`);
  }
}

function findSourceEntry(entries, version) {
  const expectedName = `HangJeongDong_ver${version}.geojson`;
  if (!Array.isArray(entries)) {
    throw new Error(`ver${version} GitHub API 응답이 파일 목록이 아닙니다.`);
  }

  const entry = entries.find(
    (candidate) =>
      candidate?.type === "file" &&
      candidate.name === expectedName &&
      typeof candidate.download_url === "string",
  );

  if (!entry) {
    throw new Error(`GitHub API에서 ${expectedName} 원본 파일을 찾을 수 없습니다.`);
  }
  return entry;
}

function parseGeoJson(bytes, label) {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error(`${label}이(가) 유효한 UTF-8 GeoJSON이 아닙니다.`, { cause: error });
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

async function main() {
  const rootEntries = await fetchJson(GITHUB_CONTENTS_API);
  const version = discoverLatestVersion(rootEntries);
  const versionDirectory = rootEntries.find(
    (entry) => entry?.type === "dir" && entry.name === `ver${version}`,
  );
  assertVersionDirectoryEntry(versionDirectory, version);

  const versionEntries = await fetchJson(versionDirectory.url);
  const sourceEntry = findSourceEntry(versionEntries, version);
  const sourceBytes = await fetchBytes(sourceEntry.download_url);
  const sourceCollection = parseGeoJson(sourceBytes, sourceEntry.name);
  const regionCollection = extractGyeongnam(sourceCollection);
  const summary = validateBoundaryCollection(regionCollection);

  // A newline-free JSON byte stream is stable across Git checkouts on every OS.
  const publicBytes = new TextEncoder().encode(JSON.stringify(regionCollection));
  const metadata = buildBoundaryMetadata(publicBytes, {
    version,
    sourceUrl: sourceEntry.download_url,
    downloadedAt: new Date().toISOString(),
    administrativeDongCodes: summary.administrativeDongCodes,
    scope: ["경상남도"],
  });
  const metadataBytes = new TextEncoder().encode(`${JSON.stringify(metadata, null, 2)}\n`);

  const sourcePath = path.join(
    PROJECT_ROOT,
    "data",
    "source",
    `HangJeongDong_ver${version}.geojson`,
  );
  const publicPath = path.join(
    PROJECT_ROOT,
    "public",
    "data",
    `administrative-dong-${version}.geojson`,
  );
  const metadataPath = path.join(PROJECT_ROOT, "public", "data", "boundary-metadata.json");

  await atomicWrite(sourcePath, sourceBytes);
  await atomicWrite(publicPath, publicBytes);
  await atomicWrite(metadataPath, metadataBytes);

  console.log(
    `경남 행정동 경계 갱신 완료: ver${version}, ${summary.featureCount}개, SHA-256 ${metadata.sha256}`,
  );
}

main().catch((error) => {
  console.error(`경남 행정동 경계 갱신 실패: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
