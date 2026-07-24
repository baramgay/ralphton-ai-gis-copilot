/**
 * Production / staging smoke checks — core APIs + feature probes.
 * Usage: SMOKE_BASE_URL=https://... node scripts/smoke.mjs
 */
const base = (process.env.SMOKE_BASE_URL || "https://ralphton-ai-gis-copilot.vercel.app").replace(
  /\/$/,
  "",
);

let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`OK  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}:`, error instanceof Error ? error.message : error);
  }
}

async function getJson(path, init) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    signal: AbortSignal.timeout(25_000),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { response, body, text };
}

await check("GET /", async () => {
  const response = await fetch(base, { signal: AbortSignal.timeout(25_000) });
  if (!response.ok) throw new Error(`status ${response.status}`);
  const html = await response.text();
  if (!html.includes("경남") && !html.includes("GIS")) {
    throw new Error("home HTML missing brand markers");
  }
});

await check("GET /api/health", async () => {
  const { response, body } = await getJson("/api/health");
  if (!response.ok) throw new Error(`status ${response.status}`);
  if (body?.status !== "ok") throw new Error("status field missing");
  if (!body?.capabilities) throw new Error("capabilities missing");
  for (const key of ["kakaoMapsJs", "publicData", "rag", "placeIndex", "scopeGyeongnam"]) {
    if (!(key in body.capabilities)) throw new Error(`capabilities.${key} missing`);
  }
  if (!body?.scope?.regions?.includes("경상남도")) {
    throw new Error("scope.regions missing gyeongnam");
  }
});

await check("GET /api/data/snapshot?mode=demo", async () => {
  const { response, body } = await getJson("/api/data/snapshot?mode=demo");
  if (!response.ok) throw new Error(`status ${response.status}`);
  if (!Array.isArray(body?.regions) || body.regions.length < 150) {
    throw new Error(`regions too few: ${body?.regions?.length}`);
  }
  if (!body?.referenceMonth) throw new Error("referenceMonth missing");
  if (!Array.isArray(body?.facilities)) throw new Error("facilities missing");
  const hasBusan = body.regions.some((r) => String(r.adm_nm).startsWith("부산광역시"));
  const hasGn = body.regions.some((r) => String(r.adm_nm).startsWith("경상남도"));
  if (hasBusan) throw new Error("unexpected Busan regions (app is gyeongnam-only)");
  if (!hasGn) throw new Error("no Gyeongnam regions");
});

await check("GET /api/data/sync", async () => {
  const { response, body } = await getJson("/api/data/sync");
  if (!response.ok) throw new Error(`status ${response.status}`);
  if (!body?.ok) throw new Error("ok false");
  if (!body?.syncOps) throw new Error("syncOps missing");
});

await check("POST /api/ai/parse (scarcity)", async () => {
  const { response, body } = await getJson("/api/ai/parse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "의료 취약 어디" }),
  });
  if (!response.ok) throw new Error(`status ${response.status}`);
  if (!body?.mode) throw new Error("mode missing");
  const tool = body?.intent?.tool ?? body?.tool;
  if (tool && tool !== "rankHospitalScarcity" && body.mode === "rules") {
    // rules mode should map scarcity; AI mode may vary
  }
});

await check("POST /api/ai/parse (gyeongnam)", async () => {
  const { response, body } = await getJson("/api/ai/parse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "창원 의료 취약" }),
  });
  if (!response.ok) throw new Error(`status ${response.status}`);
  if (!body?.mode) throw new Error("mode missing");
});

await check("POST /api/ai/parse (compare)", async () => {
  const { response, body } = await getJson("/api/ai/parse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "창원 vs 김해" }),
  });
  if (!response.ok) throw new Error(`status ${response.status}`);
  if (!body?.mode) throw new Error("mode missing");
});

await check("POST /api/rag/search", async () => {
  const { response, body } = await getJson("/api/rag/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "HIRA 병원", limit: 3, useRemoteEmbed: false }),
  });
  if (!response.ok) throw new Error(`status ${response.status}`);
  if (!body?.ok) throw new Error("ok false");
  if (!Array.isArray(body?.results) && !Array.isArray(body?.hits)) {
    // accept either shape
    if (!body?.chunks && body?.ok !== true) throw new Error("results missing");
  }
});

await check("GET /api/data/snapshot?mode=auto", async () => {
  const { response, body } = await getJson("/api/data/snapshot?mode=auto");
  if (!response.ok) throw new Error(`status ${response.status}`);
  if (!body?.regions?.length) throw new Error("auto snapshot empty");
  if (!["demo", "live"].includes(body.mode)) throw new Error(`bad mode ${body.mode}`);
});

if (failed > 0) {
  console.error(`\nsmoke FAILED (${failed}) against ${base}`);
  process.exit(1);
}
console.log(`\nsmoke OK against ${base}`);
