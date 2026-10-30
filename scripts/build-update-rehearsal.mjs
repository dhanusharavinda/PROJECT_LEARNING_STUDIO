/** Build-only updater rehearsal. Never launches an app or an installer. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { TEST_IDENTITY } = require("../electron/update-test-mode.cjs");
const yaml = require("js-yaml");
export const REHEARSAL_GUID = "35901a9c-9833-4d47-8f6a-1039b00f13d9";
export const FEED = "http://127.0.0.1:18767/";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "work", "updater-proof");
const hash = (data) => createHash("sha256").update(data).digest("hex");

export function rehearsalConfig(base, version, output) {
	assert.match(version, /^0\.5\.[01]$/);
	const config = structuredClone(base);
	const resources = config.extraResources.map(resource => resource.from === ".next" ? { ...resource, from: path.join(OUTPUT, "payload") } : resource);
	return {
		...config, extends: null,
		extraResources: resources,
		appId: TEST_IDENTITY.appId, productName: TEST_IDENTITY.productName,
		executableName: TEST_IDENTITY.productName,
		extraMetadata: { ...config.extraMetadata, ...TEST_IDENTITY, version },
		directories: { ...config.directories, output },
		win: { ...config.win, artifactName: "Learning-Studio-Update-Test-${version}-${arch}-setup.${ext}", target: [{ target: "nsis", arch: ["x64"] }] },
		nsis: { ...config.nsis, guid: REHEARSAL_GUID, oneClick: false, perMachine: false, selectPerMachineByDefault: false, allowElevation: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: false, createStartMenuShortcut: false, runAfterFinish: true },
		publish: [{ provider: "generic", url: FEED, channel: "latest" }],
	};
}

/** Check actual defines immediately before electron-builder invokes makensis.
 * The production registry and executable name must never enter this installer. */
export function assertRehearsalDefines(defines) {
	for (const [key, expected] of Object.entries({
		APP_ID: TEST_IDENTITY.appId, APP_GUID: REHEARSAL_GUID, UNINSTALL_APP_KEY: REHEARSAL_GUID,
		PRODUCT_NAME: TEST_IDENTITY.productName, PRODUCT_FILENAME: TEST_IDENTITY.productName,
		APP_FILENAME: TEST_IDENTITY.productName, APP_PACKAGE_NAME: TEST_IDENTITY.name,
	})) assert.equal(defines[key], expected, `Unsafe NSIS ${key}`);
	assert.equal(defines.UNINSTALL_REGISTRY_KEY_2, undefined);
	for (const key of ["APP_INSTALLER_STORE_FILE", "APP_PACKAGE_STORE_FILE"]) {
		if (defines[key]) assert.ok(defines[key].startsWith(`${TEST_IDENTITY.name}-updater\\`), `Unsafe ${key}`);
	}
	assert.ok(Object.hasOwn(defines, "DO_NOT_CREATE_DESKTOP_SHORTCUT"));
	assert.ok(Object.hasOwn(defines, "DO_NOT_CREATE_START_MENU_SHORTCUT"));
	assert.ok(!Object.hasOwn(defines, "INSTALL_MODE_PER_ALL_USERS"));
	assert.ok(!Object.hasOwn(defines, "INSTALL_MODE_PER_ALL_USERS_DEFAULT"));
	assert.ok(!Object.hasOwn(defines, "MULTIUSER_INSTALLMODE_ALLOW_ELEVATION"));
}

function assertTemplates() {
	const templateRoot = path.dirname(require.resolve("app-builder-lib/templates/nsis/installer.nsi"));
	const files = ["common.nsh", "multiUser.nsh", "include/allowOnlyOneInstallerInstance.nsh", "include/installUtil.nsh"];
	const text = Object.fromEntries(files.map(file => [file, fs.readFileSync(path.join(templateRoot, file), "utf8")]));
	assert.ok(text["common.nsh"].includes('!define APP_EXECUTABLE_FILENAME "${PRODUCT_FILENAME}.exe"'));
	assert.ok(text["multiUser.nsh"].includes('!define /ifndef INSTALL_REGISTRY_KEY "Software\\${APP_GUID}"'));
	assert.ok(text["multiUser.nsh"].includes('!define /ifndef UNINSTALL_REGISTRY_KEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${UNINSTALL_APP_KEY}"'));
	assert.ok(text["include/allowOnlyOneInstallerInstance.nsh"].includes("${APP_EXECUTABLE_FILENAME}"));
	return Object.fromEntries(files.map(file => [file, hash(text[file])]));
}

function verifyArtifacts(output, version, compilerChecks) {
	assert.ok(compilerChecks >= 2, "Missing actual installer/uninstaller NSIS verification");
	const { extractFile } = require("@electron/asar");
	const resources = path.join(output, "win-unpacked", "resources");
	const archive = path.join(resources, "app.asar");
	const metadata = JSON.parse(extractFile(archive, "package.json").toString());
	for (const [key, value] of Object.entries({ ...TEST_IDENTITY, version })) assert.equal(metadata[key], value);
	const main = extractFile(archive, "electron/main.cjs");
	assert.equal(hash(main), hash(fs.readFileSync(path.join(ROOT, "electron/main.cjs"))), "Rehearsal must run the unchanged production updater source");
	assert.ok(fs.existsSync(path.join(output, "win-unpacked", `${TEST_IDENTITY.productName}.exe`)));
	assert.ok(!fs.existsSync(path.join(output, "win-unpacked", "Learning Studio.exe")));
	const updateConfig = yaml.load(fs.readFileSync(path.join(resources, "app-update.yml"), "utf8"));
	assert.equal(updateConfig.provider, "generic"); assert.equal(updateConfig.url, FEED);
	assert.equal(updateConfig.updaterCacheDirName, `${TEST_IDENTITY.name}-updater`);
	const manifest = yaml.load(fs.readFileSync(path.join(output, "latest.yml"), "utf8"));
	assert.equal(manifest.version, version);
	const installerName = `Learning-Studio-Update-Test-${version}-x64-setup.exe`;
	const asset = manifest.files.find(file => file.url === installerName);
	assert.ok(asset); const installer = fs.readFileSync(path.join(output, installerName));
	assert.equal(asset.size, installer.length);
	assert.equal(asset.sha512, createHash("sha512").update(installer).digest("base64"));
	assert.ok(fs.existsSync(path.join(output, `${installerName}.blockmap`)));
	return { version, identity: TEST_IDENTITY, guid: REHEARSAL_GUID, compilerChecks, installer: path.join(output, installerName), installerSha256: hash(installer), updaterSourceSha256: hash(main), rendererBuildVersion: "0.5.0", feed: FEED };
}

async function main() {
	if (process.platform !== "win32") throw new Error("The isolated NSIS rehearsal requires Windows.");
	const args = process.argv.slice(2);
	assert.ok(args.length === 0 || (args.length === 1 && ["--build", "--freeze"].includes(args[0])), "Use no arguments to prepare, --freeze after the production standalone build, then --build.");
	const base = yaml.load(fs.readFileSync(path.join(ROOT, "electron-builder.yml"), "utf8"));
	assert.equal(base.appId, "com.synapse.learningstudio");
	assert.equal(base.productName, "Learning Studio");
	fs.mkdirSync(OUTPUT, { recursive: true });
	if (args[0] === "--freeze") {
		const frozen = path.join(OUTPUT, "payload", "standalone");
		assert.ok(!fs.existsSync(frozen), "Frozen payload already exists. Preserve it for this proof.");
		fs.cpSync(path.join(ROOT, ".next", "standalone"), frozen, { recursive: true, errorOnExist: true, force: false });
		const files = fs.readdirSync(frozen, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => {
			const filename = path.join(entry.parentPath, entry.name);
			return { path: path.relative(frozen, filename).replaceAll("\\", "/"), sha256: hash(fs.readFileSync(filename)) };
		}).sort((a, b) => a.path.localeCompare(b.path));
		fs.writeFileSync(path.join(OUTPUT, "frozen-payload.json"), JSON.stringify({ capturedAt: new Date().toISOString(), fileCount: files.length, manifestSha256: hash(JSON.stringify(files)), files }, null, 2));
		console.log(`Frozen ${files.length} standalone files. The root production build may now proceed.`); return;
	}
	const templates = assertTemplates();
	const configs = ["0.5.0", "0.5.1"].map((version, index) => {
		const output = path.join(OUTPUT, index === 0 ? "old" : "new");
		const config = rehearsalConfig(base, version, output);
		fs.writeFileSync(path.join(OUTPUT, `builder-${version}.json`), JSON.stringify(config, null, 2));
		return { version, output, config };
	});
	fs.writeFileSync(path.join(OUTPUT, "prepared.json"), JSON.stringify({ identity: TEST_IDENTITY, guid: REHEARSAL_GUID, feed: FEED, templates, installerExecuted: false }, null, 2));
	if (args.length === 0) { console.log(`Prepared isolated configs in ${OUTPUT}. No build or installer executed.`); return; }
	assert.ok(fs.existsSync(path.join(OUTPUT, "payload/standalone/server.js")), "Freeze the production standalone server first");
	assert.ok(fs.existsSync(path.join(ROOT, ".runtime/manimgx-portable/python.exe")), "Prepare the portable runtime first");
	const { build, Platform, Arch } = require("electron-builder");
	const { NsisTarget } = require("app-builder-lib/out/targets/nsis/NsisTarget.js");
	const original = NsisTarget.prototype.executeMakensis;
	const receipts = [];
	try {
		for (const item of configs) {
			fs.mkdirSync(item.output, { recursive: true }); let checks = 0;
			NsisTarget.prototype.executeMakensis = async function(defines, commands, script, options) {
				assertRehearsalDefines(defines); checks++;
				fs.writeFileSync(path.join(item.output, `nsis-verified-${checks}.json`), JSON.stringify({ defines, scriptSha256: hash(script), templates }, null, 2));
				return original.call(this, defines, commands, script, options);
			};
			await build({ projectDir: ROOT, config: path.join(OUTPUT, `builder-${item.version}.json`), targets: Platform.WINDOWS.createTarget(["nsis"], Arch.x64), publish: "never" });
			const receipt = verifyArtifacts(item.output, item.version, checks);
			fs.writeFileSync(path.join(item.output, "verified.json"), JSON.stringify(receipt, null, 2)); receipts.push(receipt);
		}
	} finally { NsisTarget.prototype.executeMakensis = original; }
	assert.equal(receipts[0].updaterSourceSha256, receipts[1].updaterSourceSha256);
	fs.writeFileSync(path.join(OUTPUT, "build-proof.json"), JSON.stringify({ receipts, installerExecuted: false, productionInstallUntouched: true }, null, 2));
	console.log("Both isolated installers passed identity, NSIS, source and asset checks. No installer executed.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
