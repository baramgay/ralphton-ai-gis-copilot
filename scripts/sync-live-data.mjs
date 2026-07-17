/**
 * CLI wrapper for live snapshot sync.
 * Safe without keys: prints demo-only status and exits 0.
 * Secrets are never printed.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  // Prefer compiled TS path via Next/tsx is not assumed; call through dynamic import of built modules fails.
  // Use a thin Node reimplementation for CLI that shells to the TypeScript entry via npx tsx if available.
  const useTsx = process.env.RALPHTON_USE_TSX !== "0";

  if (useTsx) {
    try {
      const { register } = await import("node:module");
      void register;
    } catch {
      // ignore
    }
  }

  // Fallback pure-JS path: invoke Next route is overkill; load demo metadata only.
  const demoPath = path.join(root, "public", "data", "demo-snapshot.json");
  const demo = require(demoPath);
  const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY?.trim();

  if (!serviceKey) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          status: "demo-only",
          mode: demo.mode,
          facilityCount: demo.facilities?.length ?? 0,
          notes: ["공공데이터 키가 없어 데모 스냅샷을 유지했습니다. POST /api/data/sync 로 서버 동기화를 사용하세요."],
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        status: "use-api",
        notes: [
          "CLI는 키 유무만 확인합니다. 실제 동기화는 서버에서 실행하세요:",
          "POST /api/data/sync  (header: x-sync-secret)",
          "또는 npm run dev 후 curl로 호출",
        ],
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: "sync CLI failed" }));
  process.exitCode = 1;
  void error;
});
