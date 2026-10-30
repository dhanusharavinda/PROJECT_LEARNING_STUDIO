/** Prepare only. Launch a production binary with these explicit environment
 * values to test its real GitHub feed while installation stays hard-disabled. */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { PROFILE_MODE, PROFILE_MARKER } = require("../electron/update-test-mode.cjs");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = path.join(root, "work", "updater-proof", `learning-studio-upgrade-test-${randomUUID()}`);
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(path.join(profile, PROFILE_MARKER), JSON.stringify({ version: 1, purpose: "learning-studio-production-update-check", mode: PROFILE_MODE }, null, 2));
const env = { LH_UPGRADE_TEST_MODE: PROFILE_MODE, LH_UPGRADE_TEST_PROFILE: profile, LH_IGNORE_ENV_KEYS: "1" };
fs.writeFileSync(path.join(profile, "launch-env.json"), JSON.stringify(env, null, 2));
console.log(JSON.stringify({ profile, env, clearInheritedVariables: ["LH_DEV_URL", "LH_UPDATE_FEED", "ELECTRON_RUN_AS_NODE"], installerAllowed: false }, null, 2));
