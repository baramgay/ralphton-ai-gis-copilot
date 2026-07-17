/**
 * Production / staging smoke checks.
 * Usage: SMOKE_BASE_URL=https://... node scripts/smoke.mjs
 */
const base = (process.env.SMOKE_BASE_URL || "https://ralphton-ai-gis-copilot.vercel.app").replace(
  /\/$/,
  "",
);

async function check(name, fn) {
  try {
    await fn();
    console.log(`OK  ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}:`, error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

async function getJson(path, init) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { response, body };
}

await check("GET /api/health", async () => {
  const { response, body } = await getJson("/api/health");
  if (!response.ok) throw new Error(`status ${response.status}`);
  if (body?.status !== "ok") throw new Error("status field missing");
  if (!body?.capabilities) throw new Error("capabilities missing");
});

await check("GET /api/data/snapshot?mode=demo", async () => {
  const { response, body } = await getJson("/api/data/snapshot?mode=demo");
  if (!response.ok) throw new Error(`status ${response.status}`);
  if (!body?.regions?.length) throw new Error("regions empty");
  if (!body?.referenceMonth) throw new Error("referenceMonth missing");
});

await check("GET /api/data/sync", async () => {
  const { response, body } = await getJson("/api/data/sync");
  if (!response.ok) throw new Error(`status ${response.status}`);
  if (!body?.ok) throw new Error("ok false");
  if (!body?.syncOps) throw new Error("syncOps missing");
});

await check("POST /api/ai/parse", async () => {
  const { response, body } = await getJson("/api/ai/parse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "의료 취약 어디" }),
  });
  if (!response.ok) throw new Error(`status ${response.status}`);
  if (!body?.mode) throw new Error("mode missing");
});

await check("POST /api/rag/search", async () => {
  const { response, body } = await getJson("/api/rag/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: "의료 취약", limit: 2, useRemoteEmbed: false }),
  });
  if (!response.ok) throw new Error(`status ${response.status}`);
  if (!body?.ok) throw new Error("ok false");
});

if (process.exitCode) {
  console.error(`\nsmoke FAILED against ${base}`);
  process.exit(1);
}
console.log(`\nsmoke OK against ${base}`);
