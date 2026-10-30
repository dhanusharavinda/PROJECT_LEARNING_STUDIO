/** Windows release gate tests using offline release and updater fixtures. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { runInNewContext } from "node:vm";
import { createHash } from "node:crypto";

import {
	checkVersion, expectedAssets, feedExpectations, isPlainAssetName, normalizeReleasePages,
	parseReleases, selectDraft, verifyAssets, verifyConfigAssumptions, verifyMetadataFiles,
	type ReleaseAsset, type ReleaseRecord,
} from "../scripts/verify-release.ts";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const script = path.join(repoRoot, "scripts", "verify-release.ts");
const releaseYaml = require("js-yaml");
function studioConfig() {
	return {
		appId: "com.synapse.learningstudio", productName: "Learning Studio",
		win: { artifactName: "Learning-Studio-${version}-${arch}-setup.${ext}", target: [{ target: "nsis", arch: ["x64"] }] },
		publish: [{ provider: "github", owner: "dhanusharavinda", repo: "PROJECT_LEARNING_STUDIO", releaseType: "draft", channel: "latest" }],
	};
}
function studioPackage(version: string) { return { name: "learning-studio", version }; }
const VERSION = "0.2.0";
const TAG = `v${VERSION}`;

/** A base64-looking sha512 (the gate checks shape, not the actual digest). */
const sha512 = (seed: string) => Buffer.from(seed.padEnd(64, "0")).toString("base64");

function asset(id: number, name: string, overrides: Partial<ReleaseAsset> = {}): ReleaseAsset {
	return { id, name, size: 5000, state: "uploaded", ...overrides };
}

/** The complete, healthy 4-asset draft for a version. */
function healthyRelease(version: string, tagForm: "v" | "bare" = "v"): ReleaseRecord {
	const e = expectedAssets(version);
	return {
		id: 42,
		tag_name: tagForm === "v" ? `v${version}` : version,
		draft: true,
		assets: e.files.map((name, index) => asset(1000 + index, name)),
	};
}

/** The Windows update feed exactly as app-builder-lib writes them. */
function healthyFeeds(version: string, release: ReleaseRecord): Record<string, string> {
	const byName = new Map(release.assets.map((entry) => [entry.name, entry]));
	const feeds: Record<string, string> = {};
	for (const expectation of feedExpectations(expectedAssets(version))) {
		const files = expectation.urls.map((url) => {
			const found = byName.get(url);
			assert.ok(found, `fixture needs ${url}`);
			return `  - url: ${url}\n    sha512: ${sha512(url)}\n    size: ${found.size}\n`;
		});
		const first = expectation.urls[0]!;
		feeds[expectation.file] =
			`version: ${version}\nfiles:\n${files.join("")}` +
			`path: ${first}\nsha512: ${sha512(first)}\nreleaseDate: '2026-10-13T09:37:13.265Z'\n`;
	}
	return feeds;
}

describe("release gate , expected asset inventory", () => {
	it("is exactly the four required release outputs for the version", () => {
        assert.deepEqual(expectedAssets(VERSION).files, [
			"Learning-Studio-0.2.0-x64-setup.exe",
			"Learning-Studio-0.2.0-x64-setup.exe.blockmap",
			"latest.yml",
			"Learning-Studio-0.2.0-source.zip",
		]);
	});

	it("accepts plain semver versions and nothing else", () => {
		assert.ok(checkVersion("1.2.3").ok);
		assert.ok(checkVersion("1.2.3-beta.1").ok);
		assert.ok(!checkVersion("1.2").ok);
		assert.ok(!checkVersion("0.2.0 ; rm -rf").ok);
		assert.ok(!checkVersion(undefined).ok);
	});
});

describe("release gate , release-list parsing", () => {
	it("flattens gh --paginate --slurp pages and accepts a plain array", () => {
		const release = healthyRelease(VERSION);
		const paged = normalizeReleasePages([[release], [], [release]]);
		assert.ok(paged.ok);
		assert.deepEqual(paged.releases, [release, release]);
		const plain = normalizeReleasePages([release]);
		assert.ok(plain.ok);
		assert.deepEqual(plain.releases, [release]);
	});

	it("fails closed on a non-array document", () => {
		assert.ok(!normalizeReleasePages({ message: "Bad credentials" }).ok);
	});

	it("rejects malformed release entries and assets", () => {
		const bad = [{ id: 1, tag_name: "v0.2.0", draft: "yes", assets: [] }];
		assert.ok(!parseReleases(bad).ok);
		const badAssets = [{ id: 1, tag_name: "v0.2.0", draft: true, assets: [{ id: 1, name: "x", size: 1, state: "" }] }];
		assert.ok(!parseReleases(badAssets).ok);
		assert.ok(parseReleases([healthyRelease(VERSION)]).ok);
	});
});

describe("release gate , draft selection (fail-closed, existing tag matching)", () => {
	it("selects the single draft carrying the v-tag", () => {
		const selection = selectDraft([healthyRelease(VERSION)], TAG, VERSION);
		assert.ok(selection.ok && selection.release.id === 42 && selection.warnings.length === 0);
	});

	it("still matches the legacy unprefixed tag form but reports the hazard", () => {
		const selection = selectDraft([healthyRelease(VERSION, "bare")], TAG, VERSION);
		assert.ok(selection.ok);
		assert.equal(selection.warnings.length, 1);
		assert.match(selection.warnings[0]!, /unprefixed tag "0.2.0"/);
		assert.match(selection.warnings[0]!, /SECOND draft/);
	});

	it("fails when nothing matches", () => {
		const selection = selectDraft([healthyRelease("0.1.0")], TAG, VERSION);
		assert.ok(!selection.ok);
		assert.match(selection.errors.join("\n"), /no release matches/);
	});

	it("fails when the match is already published , never modifies it", () => {
		const published = { ...healthyRelease(VERSION), draft: false };
		const selection = selectDraft([published], TAG, VERSION);
		assert.ok(!selection.ok);
		assert.match(selection.errors.join("\n"), /already published/);
	});

	it("fails on ambiguous v-tag + bare-version drafts", () => {
		const selection = selectDraft([healthyRelease(VERSION), healthyRelease(VERSION, "bare")], TAG, VERSION);
		assert.ok(!selection.ok);
		assert.match(selection.errors.join("\n"), /2 releases match/);
	});
});

describe("release gate, packaging configuration", () => {
	it("accepts the Windows fork configuration", () => {
		assert.ok(verifyConfigAssumptions(studioConfig(), studioPackage(VERSION)).ok);
	});
	const drifts: Array<[string, (config: ReturnType<typeof studioConfig>) => void]> = [
		["artifact name", c => { c.win.artifactName = "upstream-${version}.exe"; }],
		["target", c => { c.win.target = [{ target: "appx", arch: ["x64"] }]; }],
		["product name", c => { c.productName = "LearnHarness"; }],
		["application identity", c => { c.appId = "upstream.app"; }],
		["owner", c => { c.publish[0]!.owner = "amosblomqvist"; }],
		["repository", c => { c.publish[0]!.repo = "learnharness"; }],
		["published release", c => { c.publish[0]!.releaseType = "release"; }],
		["channel", c => { c.publish[0]!.channel = "beta"; }],
	];
	for (const [name, mutate] of drifts) it(`rejects drift in ${name}`, () => {
		const config = studioConfig(); mutate(config);
		assert.ok(!verifyConfigAssumptions(config, studioPackage(VERSION)).ok);
	});
	it("rejects a missing source archive", () => {
		const release = healthyRelease(VERSION);
		release.assets = release.assets.filter(a => a.name !== expectedAssets(VERSION).source);
		const verdict = verifyAssets(release, expectedAssets(VERSION));
		assert.ok(!verdict.ok);
		assert.match(verdict.errors.join("\n"), /source.zip: missing/);
	});
});

describe("release gate , asset inventory", () => {
	it("passes a complete draft and names every deviation", () => {
		assert.ok(verifyAssets(healthyRelease(VERSION), expectedAssets(VERSION)).ok);
		const release = healthyRelease(VERSION);
		release.assets = release.assets.filter((entry) => entry.name !== "Learning-Studio-0.2.0-x64-setup.exe.blockmap");
		release.assets.push(asset(9999, "Learning-Studio-0.2.0-x64.AppImage"));
		release.assets.push(asset(9998, "Learning-Studio-0.1.0-x64-setup.exe"));
		release.assets.push(asset(9997, "Learning-Studio-0.2.0-arm64.dmg", { size: 0 }));
		release.assets.push(asset(9996, "Learning-Studio-0.2.0-arm64.dmg", { state: "starter" }));
		const verdict = verifyAssets(release, expectedAssets(VERSION));
		assert.ok(!verdict.ok);
		const joined = verdict.errors.join("\n");
		assert.match(joined, /x64-setup\.exe\.blockmap: missing/);
		assert.match(joined, /x64\.AppImage: unexpected/);
		assert.match(joined, /0\.1\.0-x64-setup\.exe: unexpected/);
		assert.match(joined, /duplicate asset name/);
		assert.match(joined, /zero-size/);
		assert.match(joined, /state is "starter"/);
	});
});

describe("release gate , updater reference hygiene", () => {
	it("accepts bare asset names only", () => {
		assert.ok(isPlainAssetName("Learning-Studio-0.2.0-arm64.dmg"));
		for (const bad of ["", ".", "..", "../Learning-Studio.zip", "dist/Learning-Studio.zip", "https://evil.example/app.zip",
			"http://evil.example/app.zip", "file:///etc/passwd", "C:\\app.zip", "~x/app.zip", "app.zip?q=1", "app.zip#x"]) {
			assert.equal(isPlainAssetName(bad), false, bad);
		}
	});
});

describe("release gate , update feeds", () => {
	it("accepts the healthy feeds for the complete draft", () => {
		const release = healthyRelease(VERSION);
		const verdict = verifyMetadataFiles(healthyFeeds(VERSION, release), release, expectedAssets(VERSION));
		assert.ok(verdict.ok, JSON.stringify(verdict, null, 2));
	});

	type Mutation = (feeds: Record<string, string>, release: ReleaseRecord) => void;
	const mutations: Array<[string, Mutation, RegExp]> = [
		["wrong version in latest.yml", (feeds) => { feeds["latest.yml"] = feeds["latest.yml"]!.replace(`version: ${VERSION}`, "version: 0.3.0"); }, /latest\.yml: version is "0\.3\.0"/],
		["path traversal in a reference", (feeds, release) => {
			const e = expectedAssets(VERSION);
			feeds["latest.yml"] = feeds["latest.yml"]!.replace(`url: ${e.win.exe}`, "url: ../../dist/app.exe");
			void release;
		}, /latest\.yml: files\[0\]\.url is not a bare asset name/],
		["absolute-URL reference", (feeds) => {
			const e = expectedAssets(VERSION);
			feeds["latest.yml"] = feeds["latest.yml"]!.replace(`url: ${e.win.exe}`, "url: https://evil.example/app.exe");
		}, /is not a bare asset name/],
		["reference to an asset the release does not hold", (feeds) => {
			const e = expectedAssets(VERSION);
			feeds["latest.yml"] = feeds["latest.yml"]!.replace(`url: ${e.win.exe}`, "url: Learning-Studio-0.1.0-x64-setup.exe");
		}, /references "Learning-Studio-0\.1\.0-x64-setup\.exe" which is not an asset/],
		["size disagreeing with the uploaded asset", (feeds) => {
			const e = expectedAssets(VERSION);
			feeds["latest.yml"] = feeds["latest.yml"]!.replace("size: 5000", "size: 4999");
			void e;
		}, /size 4999 ≠ release asset size 5000/],
		["legacy path pointing away from files[0]", feeds => {
			feeds["latest.yml"] = feeds["latest.yml"]!.replace(`path: ${expectedAssets(VERSION).win.exe}`, "path: other.exe");
		}, /top-level path is/],
		["legacy sha512 not matching files[0]", feeds => {
			feeds["latest.yml"] = feeds["latest.yml"]!.replace(`sha512: ${sha512(expectedAssets(VERSION).win.exe)}\nreleaseDate`, `sha512: ${sha512("tampered")}\nreleaseDate`);
		}, /top-level sha512 does not match/],
		["extra entry in latest.yml", (feeds) => {
			const e = expectedAssets(VERSION);
			feeds["latest.yml"] = feeds["latest.yml"]!.replace("path:", `  - url: ${e.source}\n    sha512: ${sha512(e.source)}\n    size: 5000\npath:`);
		}, /must reference exactly/],
		["garbage sha512", (feeds) => {
			const e = expectedAssets(VERSION);
			feeds["latest.yml"] = feeds["latest.yml"]!.replace(`sha512: ${sha512(e.win.exe)}`, "sha512: deadbeef");
		}, /sha512 is not a base64 digest/],
		["unparseable feed", (feeds) => { feeds["latest.yml"] = "\tversion: [unclosed"; }, /does not parse as YAML/],
		["non-mapping feed", (feeds) => { feeds["latest.yml"] = "- just\n- a\n- list\n"; }, /top level is not a mapping/],
		["feed not downloaded", (feeds) => { delete feeds["latest.yml"]; }, /not downloaded/],
	];
	for (const [label, mutate, pattern] of mutations) {
		it(`fails on ${label}`, () => {
			const release = healthyRelease(VERSION);
			const feeds = healthyFeeds(VERSION, release);
			mutate(feeds, release);
			const verdict = verifyMetadataFiles(feeds, release, expectedAssets(VERSION));
			assert.ok(!verdict.ok, `expected failure for: ${label}`);
			assert.match(verdict.errors.join("\n"), pattern);
		});
	}
});

describe("release gate , workflow wiring", () => {
	const yaml = require("js-yaml") as { load(source: string): any };
	const workflow = yaml.load(fs.readFileSync(path.join(repoRoot, ".github", "workflows", "release.yml"), "utf8"));
	const verify = workflow.jobs.verify;

	it("builds the portable Windows payload before any release upload", () => {
		const job = workflow.jobs.package;
		assert.equal(job["runs-on"], "windows-2025");
		assert.equal(job.strategy, undefined);
		const prepare = job.steps.findIndex((step: any) => step.run?.includes("setup-manimgx.ps1"));
		const build = job.steps.findIndex((step: any) => step.run?.includes("electron-builder"));
		const upload = job.steps.findIndex((step: any) => step.run?.includes("gh release upload"));
		assert.ok(prepare >= 0 && build > prepare && upload > build);
		assert.match(job.steps[build].run, /--win --x64 --publish never/);
		assert.equal(job.steps[upload].if, "github.event_name == 'push'");
		assert.match(job.steps[upload].run, /isDraft/);
		for (const step of job.steps.slice(0, upload)) assert.equal(step.env?.GH_TOKEN, undefined);
		assert.ok(job.steps.some((step: any) => step.uses === "actions/setup-python@v6" && step.with["python-version"] === "3.14"));
		assert.ok(job.steps.some((step: any) => step.run?.includes("git archive --format=zip") && step.run.includes("LICENSE") && step.run.includes("manimgx-requirements.txt")));
	});

	it("the actual workflow digest gate accepts matching bytes and rejects altered installer bytes", () => {
		const step = workflow.jobs.package.steps.find((item: any) => item.name === "Verify installer manifest against actual bytes");
		assert.ok(step);
		const code = step.run.split("<<'NODE'\n")[1].replace(/\nNODE\s*$/, "").replace(/^import .+;\n/gm, "");
		const name = `Learning-Studio-${VERSION}-x64-setup.exe`;
		const original = Buffer.from("original installer payload");
		const digest = createHash("sha512").update(original).digest("base64");
		const info = { version: VERSION, files: [{ url: name, size: original.length, sha512: digest }], path: name, sha512: digest };
		const run = (installer: Buffer) => runInNewContext(code, {
			fs: {
				readFileSync: (file: string) => file === "package.json" ? JSON.stringify({ version: VERSION }) : file === "dist/latest.yml" ? releaseYaml.dump(info) : installer,
				statSync: () => ({ size: 100 }),
			}, crypto: { createHash }, yaml: releaseYaml,
		});
		assert.doesNotThrow(() => run(original));
		assert.throws(() => run(Buffer.from("tampered installer payload")), /metadata does not match/);
	});

	it("can see drafts after ALL packaging jobs, only on real tag pushes", () => {
		assert.ok(verify);
		assert.equal(verify.needs, "package");
		assert.equal(verify.if, "github.event_name == 'push'");
		// GitHub's release-list API hides drafts from read-only tokens.
		assert.deepEqual(verify.permissions, { contents: "write" });
		assert.equal(verify.env?.GH_TOKEN, undefined);
	});

	it("exposes the elevated token only to the two API-reading steps", () => {
		const readers = ["List every release, drafts included", "Download the Windows update feed"];
		for (const step of verify.steps) {
			if (readers.includes(step.name)) assert.equal(step.env?.GH_TOKEN, "${{ github.token }}");
			else assert.equal(step.env?.GH_TOKEN, undefined, String(step.name ?? step.uses));
		}
		assert.equal(verify.steps.filter((step: any) => step.env?.GH_TOKEN).length, 2);
	});

	it("uses only implicit GET requests, never release-mutating commands", () => {
		const calls: string[] = verify.steps.flatMap((step: any) =>
			(step.run ?? "").split("\n").filter((line: string) => /^\s*gh\s/.test(line)),
		);
		assert.equal(calls.length, 2);
		for (const call of calls) {
			assert.match(call, /^\s*gh api /);
			assert.doesNotMatch(call, /(?:\s|^)(?:--(?:method|input|field|raw-field)(?:[=\s]|$)|-[XfF])/);
		}
	});

	it("checks out the tagged revision and runs select + verify", () => {
		const checkout = verify.steps.find((step: any) => step.uses?.startsWith("actions/checkout"));
		assert.deepEqual(checkout.with, { ref: "${{ github.sha }}", "persist-credentials": false });
		const select = verify.steps.find((step: any) => step.run?.includes("verify-release.ts select"));
		const final = verify.steps.find((step: any) => step.run?.includes("verify-release.ts verify"));
		assert.ok(select && final);
		assert.match(final.run, /--tag "\$GITHUB_REF_NAME"/);
		// The gate's own job: nothing here may create, edit, publish, or delete.
		for (const step of verify.steps) {
			assert.equal(step.run?.includes("create") ?? false, false, String(step.name));
		}
	});

	it("download step fetches exactly the Windows update feed from the selected draft", () => {
		const download = verify.steps.find((step: any) => step.name === "Download the Windows update feed");
		assert.ok(download);
		assert.ok(download.run.includes("latest.yml"));
		assert.ok(!download.run.includes("latest-mac.yml"));
		assert.match(download.run, /releases\/assets\/\$id/);
	});
});

describe("release gate , CLI (offline, repo config)", () => {
	// CLI fixtures follow the real package version; pure-core fixtures above
	// intentionally stay at 0.2.0. A release version bump must not break tests.
	const VERSION = (JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { version: string }).version;
	const TAG = `v${VERSION}`;
	const tsxImport = import.meta.resolve("tsx");
	function run(args: string[], cwd = path.dirname(args[1]!)) {
		return spawnSync(process.execPath, ["--import", tsxImport, script, ...args], {
			cwd, encoding: "utf8", timeout: 60_000,
		});
	}

	function workspace(tagForm: "v" | "bare" = "v", version = VERSION) {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-release-gate-"));
		const release = healthyRelease(version, tagForm);
		fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(studioPackage(version)));
		fs.writeFileSync(path.join(root, "electron-builder.yml"), releaseYaml.dump(studioConfig()));
		fs.writeFileSync(path.join(root, "releases.json"), JSON.stringify([release]));
		fs.mkdirSync(path.join(root, "metadata"));
		for (const [name, content] of Object.entries(healthyFeeds(version, release))) {
			fs.writeFileSync(path.join(root, "metadata", name), content);
		}
		return { root, release };
	}

	it("select emits machine JSON for the workflow's download step", () => {
		const { root, release } = workspace();
		try {
			const result = run(["select", path.join(root, "releases.json"), "--tag", TAG]);
			assert.equal(result.status, 0, String(result.stderr));
			const report = JSON.parse(result.stdout) as {
				releaseId: number; tag: string; matchedTagName: string; warnings: string[];
				assets: Array<{ id: number; name: string; size: number; state: string }>;
			};
			assert.equal(report.releaseId, release.id);
			assert.equal(report.matchedTagName, TAG);
			assert.deepEqual(report.warnings, []);
			assert.deepEqual(report.assets.map((entry) => entry.name), expectedAssets(VERSION).files);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("verify passes the complete draft and exits 0", () => {
		const { root } = workspace();
		try {
			const result = run(["verify", path.join(root, "releases.json"), path.join(root, "metadata"), "--tag", TAG]);
			assert.equal(result.status, 0, String(result.stderr));
			assert.match(result.stdout, /4\/4 expected files present/);
			assert.ok(result.stdout.includes(`OK: draft for ${TAG} is complete`));
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("verify fails a draft with a missing blockmap and a stale asset", () => {
		const { root } = workspace();
		try {
			const release = healthyRelease(VERSION);
			release.assets = release.assets.filter((entry) => entry.name !== `Learning-Studio-${VERSION}-x64-setup.exe.blockmap`);
			release.assets.push(asset(9999, "Learning-Studio-0.1.0-x64-setup.exe"));
			fs.writeFileSync(path.join(root, "releases.json"), JSON.stringify([release]));
			const result = run(["verify", path.join(root, "releases.json"), path.join(root, "metadata"), "--tag", TAG]);
			assert.equal(result.status, 1);
			assert.match(result.stderr, /x64-setup\.exe\.blockmap: missing from the release/);
			assert.match(result.stderr, /0\.1\.0-x64-setup\.exe: unexpected asset/);
			assert.match(result.stderr, /do not publish/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("verify fails closed when the tag disagrees with package.json", () => {
		const { root } = workspace();
		try {
			const wrongTag = TAG === "v0.3.0" ? "v0.2.0" : "v0.3.0";
			const result = run(["verify", path.join(root, "releases.json"), path.join(root, "metadata"), "--tag", wrongTag]);
			assert.equal(result.status, 1);
			assert.match(result.stderr, /does not equal "v" \+ package\.json version/);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("verify works after a package version bump without changing the tests", () => {
		const futureVersion = "12.3.4";
		const { root } = workspace("v", futureVersion);
		try {
			const pkg = studioPackage(futureVersion);
			fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ ...pkg, version: futureVersion }));
			fs.writeFileSync(path.join(root, "electron-builder.yml"), releaseYaml.dump(studioConfig()));
			const result = run(["verify", path.join(root, "releases.json"), path.join(root, "metadata"), "--tag", `v${futureVersion}`], root);
			assert.equal(result.status, 0, String(result.stderr));
			assert.ok(result.stdout.includes(`OK: draft for v${futureVersion} is complete`));
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("select warns loudly for the legacy unprefixed draft tag", () => {
		const { root } = workspace("bare");
		try {
			const result = run(["select", path.join(root, "releases.json"), "--tag", TAG]);
			assert.equal(result.status, 0, String(result.stdout));
			assert.ok(result.stderr.includes("WARNING:"));
			assert.ok(result.stderr.includes(`unprefixed tag "${VERSION}"`));
			const report = JSON.parse(result.stdout) as { warnings: string[] };
			assert.equal(report.warnings.length, 1);
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});
});
