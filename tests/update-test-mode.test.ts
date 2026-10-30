import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
const require = createRequire(import.meta.url);
const { TEST_IDENTITY, PROFILE_MODE, PROFILE_MARKER, isUpdateTestBuild, resolveUpdateTestProfile, prepareUpdateTestCache } = require("../electron/update-test-mode.cjs");

test("isolated installer identity requires all markers, never a partial production identity", () => {
	assert.equal(isUpdateTestBuild({ name: "learning-studio" }), false);
	assert.equal(isUpdateTestBuild(TEST_IDENTITY), true);
	for (const key of Object.keys(TEST_IDENTITY)) assert.throws(() => isUpdateTestBuild({ [key]: TEST_IDENTITY[key] }), /Incomplete/);
});

test("production check profile requires explicit mode, dedicated directory and marker", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "update-profile-tests-"));
	try {
		const profile = path.join(root, "learning-studio-upgrade-test-12345678"); mkdirSync(profile);
		const normal = path.join(root, "ordinary"); mkdirSync(normal);
		const env = { LH_UPGRADE_TEST_PROFILE: profile, LH_UPGRADE_TEST_MODE: PROFILE_MODE };
		assert.equal(resolveUpdateTestProfile({}, normal), null);
		assert.throws(() => resolveUpdateTestProfile({ LH_UPGRADE_TEST_PROFILE: profile }, normal), /explicit/);
		assert.throws(() => resolveUpdateTestProfile({ ...env, LH_UPGRADE_TEST_MODE: "install" }, normal), /explicit/);
		assert.throws(() => resolveUpdateTestProfile({ ...env, LH_UPGRADE_TEST_PROFILE: "relative" }, normal), /absolute/);
		assert.throws(() => resolveUpdateTestProfile(env, normal));
		writeFileSync(path.join(profile, PROFILE_MARKER), JSON.stringify({ version: 1, purpose: "learning-studio-production-update-check", mode: PROFILE_MODE }));
		assert.equal(resolveUpdateTestProfile(env, normal).profile, profile);
		for (const overlapping of [profile, root, path.join(profile, "data")]) assert.throws(() => resolveUpdateTestProfile(env, overlapping), /separate/);
		writeFileSync(path.join(profile, PROFILE_MARKER), JSON.stringify({ version: 1, purpose: "wrong", mode: PROFILE_MODE }));
		assert.throws(() => resolveUpdateTestProfile(env, normal), /marker/);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("test cache changes only cache name and preserves signing/feed policy", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "update-cache-tests-"));
	try {
		const source = "provider: github\nowner: example\nrepo: original\npublisherName:\n  - Example Publisher\nupdaterCacheDirName: original-updater\n";
		const original = path.join(root, "app-update.yml"); writeFileSync(original, source);
		const target = prepareUpdateTestCache({ profile: root, cacheName: "isolated-updater" }, original);
		assert.equal(readFileSync(target, "utf8"), source.replace("original-updater", "isolated-updater"));
		assert.equal(readFileSync(original, "utf8"), source);
	} finally { rmSync(root, { recursive: true, force: true }); }
});
