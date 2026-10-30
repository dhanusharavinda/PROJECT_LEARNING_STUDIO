import assert from "node:assert/strict";
import { test } from "node:test";
import { rehearsalConfig, assertRehearsalDefines, REHEARSAL_GUID, FEED } from "../scripts/build-update-rehearsal.mjs";

test("rehearsal config keeps server payload but separates registry, process, profile and feed identity", () => {
	const base = { appId: "com.synapse.learningstudio", productName: "Learning Studio", files: ["electron/**/*"], extraResources: [{ from: ".next", to: "server" }], nsis: { oneClick: false }, win: { verifyUpdateCodeSignature: false } };
	const old = rehearsalConfig(base, "0.5.0", "proof/old");
	const next = rehearsalConfig(base, "0.5.1", "proof/new");
	assert.equal(base.appId, "com.synapse.learningstudio");
	assert.equal(old.extraResources[0].to, base.extraResources[0]!.to);
	assert.ok(old.extraResources[0].from.endsWith("payload"));
	assert.deepEqual(old.files, base.files);
	assert.equal(old.appId, "com.synapse.learningstudio.updatetest");
	assert.equal(old.productName, "Learning Studio Update Test");
	assert.equal(old.executableName, old.productName);
	assert.equal(old.extraMetadata.name, "learning-studio-update-test");
	assert.equal(old.extraMetadata.appId, old.appId);
	assert.equal(old.nsis.guid, next.nsis.guid);
	assert.equal(next.extraMetadata.version, "0.5.1");
	assert.equal(old.nsis.runAfterFinish, true);
	assert.equal(old.nsis.allowElevation, false);
	assert.equal(old.nsis.createDesktopShortcut, false);
	assert.deepEqual(old.publish, [{ provider: "generic", url: FEED, channel: "latest" }]);
	assert.throws(() => rehearsalConfig(base, "0.6.0", "proof/other"));
});

test("actual NSIS verifier fails closed if any production identifier or unsafe installer mode returns", () => {
	const safe = { APP_ID: "com.synapse.learningstudio.updatetest", APP_GUID: REHEARSAL_GUID, UNINSTALL_APP_KEY: REHEARSAL_GUID, PRODUCT_NAME: "Learning Studio Update Test", PRODUCT_FILENAME: "Learning Studio Update Test", APP_FILENAME: "Learning Studio Update Test", APP_PACKAGE_NAME: "learning-studio-update-test", APP_INSTALLER_STORE_FILE: "learning-studio-update-test-updater\\installer.exe", DO_NOT_CREATE_DESKTOP_SHORTCUT: null, DO_NOT_CREATE_START_MENU_SHORTCUT: null };
	assert.doesNotThrow(() => assertRehearsalDefines(safe));
	for (const key of ["APP_ID", "APP_GUID", "UNINSTALL_APP_KEY", "PRODUCT_NAME", "PRODUCT_FILENAME", "APP_FILENAME", "APP_PACKAGE_NAME", "APP_INSTALLER_STORE_FILE"]) assert.throws(() => assertRehearsalDefines({ ...safe, [key]: "production" }), key);
	assert.throws(() => assertRehearsalDefines({ ...safe, INSTALL_MODE_PER_ALL_USERS: null }));
	assert.throws(() => assertRehearsalDefines({ ...safe, UNINSTALL_REGISTRY_KEY_2: "other" }));
	const missing = { ...safe }; delete (missing as Partial<typeof safe>).DO_NOT_CREATE_DESKTOP_SHORTCUT;
	assert.throws(() => assertRehearsalDefines(missing));
});
