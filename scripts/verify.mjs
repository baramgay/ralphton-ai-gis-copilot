import { spawn } from "node:child_process";
import process from "node:process";

const steps = [
  { name: "test", command: "npm", args: ["run", "test"] },
  { name: "typecheck", command: "npm", args: ["run", "typecheck"] },
  { name: "lint", command: "npm", args: ["run", "lint"] },
  { name: "build", command: "npm", args: ["run", "build"] },
];

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`));
    });
  });
}

async function main() {
  for (const step of steps) {
    console.log(`\n==> verify: ${step.name}`);
    await run(step.command, step.args);
  }

  if (process.env.VERIFY_E2E === "1") {
    console.log("\n==> verify: e2e");
    await run("npm", ["run", "test:e2e"]);
  } else {
    console.log("\n==> verify: e2e skipped (set VERIFY_E2E=1 to enable)");
  }

  console.log("\nverify OK");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "verify failed");
  process.exit(1);
});
