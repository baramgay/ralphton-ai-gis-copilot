/**
 * One-shot: runLiveSync({ publish: true }) via tsx.
 * Secrets never printed.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runner = `
import { runLiveSync } from "./src/lib/data/live-sync.ts";
const r = await runLiveSync({ publish: true, timeoutMs: 240_000 });
console.log(JSON.stringify({
  ok: r.status !== "failed",
  status: r.status,
  facilityCount: r.facilityCount,
  published: r.published,
  mode: r.snapshot.mode,
  referenceMonth: r.snapshot.referenceMonth,
  notes: r.notes,
}, null, 2));
`;

const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["tsx", "--eval", runner],
  {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    shell: true,
  },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
