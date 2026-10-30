/** Package a lower-version production identity for real GitHub check/download.
 * The mandatory marked profile and main-process guard forbid installation. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const yaml = require("js-yaml");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "work", "updater-proof", "production-check");
const config = yaml.load(fs.readFileSync(path.join(root, "electron-builder.yml"), "utf8"));
assert.equal(config.appId, "com.synapse.learningstudio"); assert.equal(config.productName, "Learning Studio");
const productionUpdateConfig = path.join(root, "dist/win-unpacked/resources/app-update.yml");
assert.ok(fs.existsSync(productionUpdateConfig), "Build the production NSIS package first, so its exact update/signing settings can be reused.");
const shippedConfig = fs.readFileSync(productionUpdateConfig, "utf8");
const shippedFeed = yaml.load(shippedConfig);
assert.equal(shippedFeed.provider, "github"); assert.equal(shippedFeed.owner, "dhanusharavinda"); assert.equal(shippedFeed.repo, "PROJECT_LEARNING_STUDIO");
config.extends = null;
config.extraMetadata = { ...config.extraMetadata, version: "0.4.0", upgradeCheckOnly: true };
config.directories = { ...config.directories, output };
config.extraResources = config.extraResources.map(resource => resource.from === ".next" ? { ...resource, from: path.join(root, "work", "updater-proof", "payload") } : resource);
fs.mkdirSync(output, { recursive: true });
const configPath = path.join(output, "builder.json"); fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
const { build, Platform, Arch } = require("electron-builder");
await build({ projectDir: root, config: configPath, targets: Platform.WINDOWS.createTarget(["dir"], Arch.x64), publish: "never" });
const { extractFile } = require("@electron/asar");
const asar = path.join(output, "win-unpacked", "resources", "app.asar");
const metadata = JSON.parse(extractFile(asar, "package.json").toString());
assert.equal(metadata.version, "0.4.0"); assert.equal(metadata.upgradeCheckOnly, true); assert.equal(metadata.name, "learning-studio");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(hash(extractFile(asar, "electron/main.cjs")), hash(fs.readFileSync(path.join(root, "electron/main.cjs"))));
// A dir-only build has no installer target, so builder omits this file.
// Reuse the production package's exact policy instead of inventing one.
fs.writeFileSync(path.join(output, "win-unpacked", "resources", "app-update.yml"), shippedConfig);
const feed = yaml.load(fs.readFileSync(path.join(output, "win-unpacked", "resources", "app-update.yml"), "utf8"));
assert.equal(feed.owner, "dhanusharavinda"); assert.equal(feed.repo, "PROJECT_LEARNING_STUDIO");
fs.writeFileSync(path.join(output, "verified.json"), JSON.stringify({ version: metadata.version, installerAllowed: false, executable: path.join(output, "win-unpacked", "Learning Studio.exe"), sourceSha256: hash(extractFile(asar, "electron/main.cjs")), feed }, null, 2));
console.log("Packaged check-only production identity. No installer built or launched.");
