import { writeFileSync } from "node:fs";
import path from "node:path";

import { runLiveSync } from "../src/lib/data/live-sync";

async function main() {
  const r = await runLiveSync({ publish: true, timeoutMs: 240_000 });
  const summary = {
    ok: r.status !== "failed",
    status: r.status,
    facilityCount: r.facilityCount,
    published: r.published,
    mode: r.snapshot.mode,
    referenceMonth: r.snapshot.referenceMonth,
    notes: r.notes,
  };
  const out = path.join(process.cwd(), ".data", "last-publish-result.json");
  try {
    writeFileSync(out, JSON.stringify(summary, null, 2), "utf8");
  } catch {
    // ignore
  }
  console.log(JSON.stringify(summary, null, 2));
  process.exit(r.status === "failed" || !r.published ? 1 : 0);
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : "unknown",
    }),
  );
  process.exit(1);
});
