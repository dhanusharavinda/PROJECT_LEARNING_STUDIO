import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
const requested = process.argv.slice(2);
const files = requested.length ? requested : readdirSync("tests")
  .filter(name => /\.test\.tsx?$/.test(name)).map(name => `tests/${name}`);
const child = spawn(process.execPath, ["--import", "tsx", "--test", ...files], {
  stdio: "inherit", env: { ...process.env, NODE_ENV: "test" },
});
child.on("error", error => { console.error(error); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
