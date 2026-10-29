import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const python = path.join(root, ".runtime", "manimgx-portable", "python.exe");
if (process.platform !== "win32") throw new Error("Build the Windows payload on Windows.");
if (!fs.existsSync(python)) throw new Error("Portable ManimGX runtime is missing. See the runtime setup documentation.");
const env = { ...process.env, LH_MANIMGX_PYTHON: python };
const runtimeCheck = spawnSync(python, ["-I", "-c", "import manimgx; print('Portable ManimGX ready')"], {
  cwd: root, env, encoding: "utf8", timeout: 30_000,
});
if (runtimeCheck.error || runtimeCheck.status !== 0) throw new Error("Portable ManimGX runtime failed its import check.");
function run(file, args) {
  const result = spawnSync(process.execPath, [file, ...args], { cwd: root, env, stdio: "inherit" });
  if (result.error || result.status !== 0) throw result.error || new Error(`${file} failed (${result.status})`);
}
if (!process.argv.includes("--pack-only")) {
  run("node_modules/next/dist/bin/next", ["build"]);
  run("scripts/build-server.mjs", []);
  run("scripts/smoke-server.mjs", ["--electron"]);
}
if (!fs.existsSync(path.join(root, ".next", "standalone", "server.js"))) {
  throw new Error("Prepared standalone server is missing. Run desktop:win before pack-only.");
}
run("node_modules/electron-builder/cli.js", ["--win", "--x64", "--publish", "never", "--config.electronDist=node_modules/electron/dist"]);
