"use strict";
const fs = require("node:fs");
const path = require("node:path");

const TEST_IDENTITY = Object.freeze({
	name: "learning-studio-update-test",
	productName: "Learning Studio Update Test",
	appId: "com.synapse.learningstudio.updatetest",
});
const PROFILE_MODE = "check-download-only";
const PROFILE_MARKER = ".learning-studio-update-test.json";

/** A rehearsal build must match all three packaged identity markers. */
function isUpdateTestBuild(metadata) {
	const hasMarker = Object.entries(TEST_IDENTITY).some(([key, value]) => metadata?.[key] === value);
	if (!hasMarker) return false;
	if (!Object.entries(TEST_IDENTITY).every(([key, value]) => metadata?.[key] === value)) {
		throw new Error("Incomplete isolated updater build identity.");
	}
	return true;
}

function relatedPath(left, right) {
	const relative = path.relative(left, right);
	return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

/** Opt-in profile isolation is only for checking/downloading production bits.
 * It never makes the production NSIS identity safe to install on this host. */
function resolveUpdateTestProfile(env, defaultProfile) {
	const requested = env.LH_UPGRADE_TEST_PROFILE;
	const mode = env.LH_UPGRADE_TEST_MODE;
	if (!requested && !mode) return null;
	if (mode !== PROFILE_MODE || !requested || !path.isAbsolute(requested)) throw new Error("Update checks require an explicit absolute test profile and check-download-only mode.");
	const profile = fs.realpathSync(requested);
	if (!fs.statSync(profile).isDirectory() || !/^learning-studio-upgrade-test-[a-zA-Z0-9-]{8,64}$/.test(path.basename(profile))) throw new Error("Update test profile must be a dedicated marked directory.");
	const ordinary = fs.existsSync(defaultProfile) ? fs.realpathSync(defaultProfile) : path.resolve(defaultProfile);
	if (relatedPath(profile, ordinary) || relatedPath(ordinary, profile)) throw new Error("Update test profile must be separate from the ordinary application profile.");
	const marker = JSON.parse(fs.readFileSync(path.join(profile, PROFILE_MARKER), "utf8"));
	if (marker?.version !== 1 || marker?.purpose !== "learning-studio-production-update-check" || marker?.mode !== PROFILE_MODE) throw new Error("Update test profile marker is invalid.");
	return { profile, mode, cacheName: path.basename(profile) };
}

/** Preserve all shipped update settings, including any future signing policy,
 * while redirecting the cache away from the ordinary install's cache. */
function prepareUpdateTestCache(testProfile, originalConfigPath) {
	let source = fs.readFileSync(originalConfigPath, "utf8");
	const field = `updaterCacheDirName: ${testProfile.cacheName}`;
	source = /^updaterCacheDirName:.*$/m.test(source) ? source.replace(/^updaterCacheDirName:.*$/m, field) : `${source.trimEnd()}\n${field}\n`;
	const configPath = path.join(testProfile.profile, "update-test-config.yml");
	fs.writeFileSync(configPath, source, "utf8");
	return configPath;
}

module.exports = { TEST_IDENTITY, PROFILE_MODE, PROFILE_MARKER, isUpdateTestBuild, resolveUpdateTestProfile, prepareUpdateTestCache };
