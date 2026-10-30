/** Actual shell functions with fake Electron/updater/filesystem. No app,
 * profile, network, timer or updater download/install operation is run. */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createContext, runInContext } from "node:vm";
import { describe, it } from "node:test";

const mainFile = fileURLToPath(new URL("../electron/main.cjs", import.meta.url));
const mainSource = readFileSync(mainFile, "utf8");
const mainRequire = createRequire(mainFile);

function fixture({ packaged = true, updaterMissing = false, feed = "", dev = false, testProfile = false, testBuild = false, cacheFailure = false } = {}) {
	let settings: string | Error = JSON.stringify({ version: 1, general: { autoUpdate: true } });
	const settingsReads: string[] = [];
	const order: string[] = [];
	const intervals: { callback: () => void; delay: number }[] = [];
	const handles = new Map<string, (event: unknown) => unknown>();
	const windows: FakeWindow[] = [];
	let enumerationFails = false;
	let userData = "/fixture/custom-user-data";
	let menu: { submenu?: { label?: string; click?: () => void }[] }[] = [];
	let readiness: { ready: boolean; reason?: string } | Error = { ready: true };
	const readinessRequests: { url: string; init: RequestInit }[] = [];
	class FakeUpdater extends EventEmitter {
		feed: unknown = null;
		setFeedURL(value: unknown) { this.feed = JSON.parse(JSON.stringify(value)); }
		checks = 0;
		downloads = 0;
		autoDownload = false;
		autoInstallOnAppQuit = false;
		result: object | null = { updateInfo: { version: "0.3.7" } };
		failure: Error | null = null;
		downloadFailure: Error | null = null;
		async downloadUpdate() {
			this.downloads++;
			if (this.downloadFailure) throw this.downloadFailure;
			this.emit("update-downloaded", { version: "0.5.1" });
			return [];
		}
		checkForUpdates() {
			this.checks++;
			this.emit("checking-for-update");
			if (this.failure) return Promise.reject(this.failure);
			if (this.result) this.emit("update-not-available", { version: "0.3.7" });
			return Promise.resolve(this.result);
		}
		quitAndInstall() { order.push("install"); }
	}
	const updater = new FakeUpdater();
	class FakeWebContents extends EventEmitter {
		mainFrame = { url: "http://127.0.0.1:9000/" };
		messages: { channel: string; value: unknown }[] = [];
		loading = false;
		fails = false;
		send(channel: string, value: unknown) {
			if (this.fails) throw new Error("window destroyed");
			this.messages.push({ channel, value: JSON.parse(JSON.stringify(value)) });
		}
		isLoadingMainFrame() { return this.loading; }
		setWindowOpenHandler() {}
		getZoomFactor() { return 1; }
	}
	class FakeWindow extends EventEmitter {
		webContents = new FakeWebContents();
		minimized = false;
		focused = false;
		constructor() { super(); windows.push(this); }
		loadURL() { this.webContents.loading = true; }
		isMinimized() { return this.minimized; }
		restore() { this.minimized = false; }
		focus() { this.focused = true; }
		show() {}
		static getAllWindows() {
			if (enumerationFails) throw new Error("window enumeration failed");
			return windows;
		}
		static fromWebContents(contents: FakeWebContents) { return windows.find(win => win.webContents === contents); }
	}
	const app = Object.assign(new EventEmitter(), {
		isPackaged: packaged,
		name: "LearnHarness",
		setName() {},
		getPath: () => userData,
		setPath: (_: string, value: string) => { userData = value; },
		requestSingleInstanceLock: () => false,
		quit() {},
		whenReady: async () => {},
	});
	const electron = {
		app, BrowserWindow: FakeWindow,
		Menu: { buildFromTemplate: (value: typeof menu) => value, setApplicationMenu: (value: typeof menu) => { menu = value; } },
		ipcMain: { on() {}, handle: (channel: string, fn: (event: unknown) => unknown) => handles.set(channel, fn) },
		session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onBeforeSendHeaders() {} } } },
	};
	const context = createContext({
		require: (id: string) => {
			if (id === "electron") return electron;
			if (id === "./update-test-mode.cjs") return {
				...mainRequire(id),
				isUpdateTestBuild: () => testBuild,
				resolveUpdateTestProfile: () => testProfile ? { profile: "/fixture/isolated", cacheName: "fixture-isolated" } : null,
				prepareUpdateTestCache: () => { if (cacheFailure) throw new Error("fixture cache failure"); return "/fixture/isolated/update-test-config.yml"; },
			};
			if (id === "./chatgpt.cjs") return { createChatGPT: () => ({ close() {}, pause() {}, resume() {} }), fileStore: () => ({}) };
			if (id === "./subscriptions.cjs") return { createSubscriptions: () => ({ ready: Promise.resolve(), close() {}, pause() {}, resume() {} }), loadSubscriptionSDK: () => ({}) };
			if (id === "electron-updater") {
				if (updaterMissing) throw new Error("missing updater");
				return { autoUpdater: updater };
			}
			if (id === "node:fs") return {
				readFileSync: (file: string) => {
					settingsReads.push(file);
					if (settings instanceof Error) throw settings;
					return settings;
				}, mkdirSync() {}, appendFileSync() {}, existsSync() { return false; },
			};
			return mainRequire(id);
		},
		process: { argv: [], env: { ...(dev ? { LH_DEV_URL: "http://127.0.0.1:9000" } : {}), ...(testProfile ? { LH_UPGRADE_TEST_MODE: "check-download-only" } : {}), LH_UPDATE_FEED: feed }, platform: "darwin", resourcesPath: "/fixture/resources", on() {} },
		__dirname: path.dirname(mainFile), URL, AbortSignal,
		fetch: async (url: string, init: RequestInit) => {
			readinessRequests.push({ url, init });
			order.push(JSON.parse(String(init.body)).op);
			if (readiness instanceof Error) throw readiness;
			return { ok: true, json: async () => readiness };
		},
		setInterval: (callback: () => void, delay: number) => intervals.push({ callback, delay }),
		setTimeout() {},
		fixtureChild: { kill: (signal: string) => order.push(signal) },
	});
	runInContext(mainSource, context, { filename: mainFile });
	const run = (code: string) => runInContext(code, context);
	run('freePort = async () => 9000; startServer = async () => { serverProcess = fixtureChild; }; waitUntilUp = async () => {};');
	return {
		run, updater, windows, intervals, handles, settingsReads, order, app, readinessRequests,
		setReadiness: (value: typeof readiness) => { readiness = value; },
		setSettings: (value: unknown) => { settings = JSON.stringify(value); },
		setSettingsFailure: (value: string | Error) => { settings = value; },
		setEnumerationFailure: (value: boolean) => { enumerationFails = value; },
		window: () => new FakeWindow(),
		state: () => JSON.parse(JSON.stringify(run("updateState"))),
		check: async (manual = false) => { run(`checkForUpdates({ manual: ${manual} })`); await Promise.resolve(); await Promise.resolve(); },
		menuCheck: () => menu[0]!.submenu!.find(item => item.label === "Check for Updates…")!.click!(),
	};
}

describe("automatic-update preference gate", () => {
	it("a fork without a test override uses only its own explicit GitHub repository", async () => {
		const f = fixture({ feed: "" });
		f.run("setupAutoUpdater()");
		await f.check(true);
		assert.equal(f.updater.checks, 1);
		assert.deepEqual(f.updater.feed, { provider: "github", owner: "dhanusharavinda", repo: "PROJECT_LEARNING_STUDIO", channel: "latest" });
	});
	it("explicit OFF skips automatic checks, but manual checks still run without reading the preference", async () => {
		const f = fixture();
		f.setSettings({ general: { autoUpdate: false } });
		f.run("setupAutoUpdater()");
		await f.check();
		assert.equal(f.updater.checks, 0);
		assert.deepEqual(f.settingsReads, [path.join("/fixture/custom-user-data", "data", "settings.json")]);
		await f.check(true);
		assert.equal(f.updater.checks, 1);
		assert.equal(f.settingsReads.length, 1);
		assert.equal(f.updater.autoDownload, false);
		assert.equal(f.updater.autoInstallOnAppQuit, false);
	});

	for (const [label, setting] of [
		["ON", { general: { autoUpdate: true } }], ["absent field", { general: {} }],
		["absent section", { version: 1 }], ["null", null], ["non-boolean", { general: { autoUpdate: "false" } }],
	] as const) {
		it(`${label} keeps automatic checks enabled`, async () => {
			const f = fixture(); f.setSettings(setting); f.run("setupAutoUpdater()"); await f.check();
			assert.equal(f.updater.checks, 1);
		});
	}
	for (const [label, failure] of [["missing", new Error("ENOENT")], ["unreadable", new Error("EACCES")], ["corrupt", "{nope"]] as const) {
		it(`${label} settings keep automatic checks enabled`, async () => {
			const f = fixture(); f.setSettingsFailure(failure); f.run("setupAutoUpdater()"); await f.check();
			assert.equal(f.updater.checks, 1);
		});
	}

	it("re-reads the setting on each check, without triggering a check merely when saved", async () => {
		const f = fixture(); f.run("setupAutoUpdater()");
		f.setSettings({ general: { autoUpdate: false } }); await f.check();
		f.setSettings({ general: { autoUpdate: true } });
		assert.equal(f.updater.checks, 0);
		await f.check();
		f.setSettings({ general: { autoUpdate: false } }); await f.check();
		assert.equal(f.updater.checks, 1);
		assert.equal(f.settingsReads.length, 3);
	});

	for (const label of ["unpackaged", "missing updater"] as const) {
		it(`${label} stays unavailable, not a saved OFF preference`, async () => {
			const f = fixture({ packaged: label !== "unpackaged", updaterMissing: label === "missing updater" });
			f.run("setupAutoUpdater()"); await f.check(true); await f.check();
			assert.equal(f.updater.checks, 0);
			assert.equal(f.settingsReads.length, 0);
			assert.equal(f.state().status, "disabled");
		});
	}
});

describe("status observation never controls the updater", () => {
	it("reports events, but a staged update stays visible without suppressing future checks", async () => {
		const f = fixture(); const win = f.window(); f.run("setupAutoUpdater()");
		f.updater.emit("checking-for-update"); assert.equal(f.state().status, "checking");
		f.updater.emit("update-available", { version: "0.3.8" });
		assert.equal(f.state().status, "available"); assert.equal(f.state().version, "0.3.8");
		f.updater.emit("update-downloaded", { version: "0.3.8" });
		const ready = f.state();
		await f.check();
		f.updater.emit("error", new Error("failure with sensitive diagnostic details"));
		assert.equal(f.updater.checks, 1);
		assert.deepEqual(f.state(), ready);
		f.updater.emit("update-downloaded", { version: "0.3.9" });
		assert.equal(f.state().version, "0.3.9");
		assert.ok(f.state().revision > ready.revision);
		assert.equal(win.webContents.messages.at(-1)!.channel, "lh:update-status");
	});

	for (const status of ["checking", "downloading", "error", "disabled", "downloaded"]) {
		it(`a ${status} display state does not block a future automatic check`, async () => {
			const f = fixture(); f.run(`setupAutoUpdater(); reportUpdateStatus("${status}")`); await f.check();
			assert.equal(f.updater.checks, 1);
		});
	}

	it("check failures settle to a generic error and later checks still run", async () => {
		const f = fixture(); f.run("setupAutoUpdater()");
		f.updater.failure = new Error("private endpoint/diagnostic detail"); await f.check();
		assert.equal(f.state().status, "error");
		assert.ok(!JSON.stringify(f.state()).includes("private"));
		f.updater.failure = null; await f.check();
		assert.equal(f.updater.checks, 2); assert.equal(f.state().status, "up-to-date");
	});

	it("a declined check makes no up-to-date claim", async () => {
		const f = fixture(); f.updater.result = null; f.run("setupAutoUpdater()"); await f.check(true);
		assert.equal(f.state().status, "idle");
	});

	it("window enumeration/send failures do not break checks or the next window's notification", async () => {
		const f = fixture(); const bad = f.window(); bad.webContents.fails = true; const good = f.window();
		f.run("setupAutoUpdater()"); await f.check();
		assert.equal(good.webContents.messages.at(-1)!.channel, "lh:update-status");
		f.setEnumerationFailure(true); await f.check();
		f.setEnumerationFailure(false); await f.check();
		assert.equal(f.updater.checks, 3);
	});

	it("OFF does not erase a staged update; Restart checks readiness and kills server before installing", async () => {
		const f = fixture(); await f.run("main()");
		f.updater.emit("update-available", { version: "0.3.8" });
		f.setSettings({ general: { autoUpdate: false } });
		f.updater.emit("update-downloaded", { version: "0.3.8" }); await f.check();
		assert.equal(f.state().status, "downloaded"); assert.equal(f.updater.checks, 1);
		assert.equal(f.updater.autoDownload, false); assert.equal(f.updater.autoInstallOnAppQuit, false);
		await f.run("installUpdateNow()");
		assert.deepEqual(f.order, ["prepare", "SIGTERM", "install"]);
	});
});

describe("startup, timer, trusted IPC and menu wiring", () => {
	it("starts and retains the 24h timer without any Settings subscription, checking current preference each time", async () => {
		const f = fixture(); f.setSettings({ general: { autoUpdate: false } });
		await f.run("main()");
		assert.equal(f.updater.checks, 0);
		assert.equal(f.intervals.length, 1); assert.equal(f.intervals[0]!.delay, 24 * 60 * 60 * 1000);
		f.setSettings({ general: { autoUpdate: true } }); f.intervals[0]!.callback(); await Promise.resolve();
		assert.equal(f.updater.checks, 1);
		f.windows.length = 0; f.intervals[0]!.callback(); await Promise.resolve();
		assert.equal(f.updater.checks, 2, "checks also work with every window closed");
	});

	it("ON/default boot checks immediately and status never disables the scheduled check", async () => {
		const f = fixture(); f.setSettings({ version: 1 }); await f.run("main()");
		assert.equal(f.updater.checks, 1);
		f.run('reportUpdateStatus("downloading", "0.3.8")'); f.intervals[0]!.callback(); await Promise.resolve();
		assert.equal(f.updater.checks, 2);
	});

	it("snapshot/manual IPC accepts only an owned main frame and snapshot reads never check", async () => {
		const f = fixture(); f.setSettings({ general: { autoUpdate: false } }); await f.run("main()");
		const sender = f.windows[0]!.webContents;
		const event = { sender, senderFrame: sender.mainFrame };
		const get = f.handles.get("lh:update:get")!; const check = f.handles.get("lh:update:check")!;
		assert.equal((get(event) as { status: string }).status, "idle"); assert.equal(f.updater.checks, 0);
		check(event); assert.equal(f.updater.checks, 1);
		for (const bad of [
			{ sender: {}, senderFrame: sender.mainFrame },
			{ sender, senderFrame: { url: sender.mainFrame.url } },
		]) {
			assert.throws(() => get(bad), /Untrusted/); assert.throws(() => check(bad), /Untrusted/);
		}
		sender.mainFrame.url = "https://untrusted.invalid/";
		assert.throws(() => check(event), /Untrusted/);
		assert.equal(f.updater.checks, 1);
	});

	it("menu restores/focuses a minimized window, opens General, and manually checks while OFF", async () => {
		const f = fixture(); f.setSettings({ general: { autoUpdate: false } }); await f.run("main()");
		const win = f.windows[0]!; win.webContents.loading = false; win.minimized = true;
		f.menuCheck();
		assert.equal(win.minimized, false); assert.equal(win.focused, true);
		assert.ok(win.webContents.messages.some(message => message.channel === "lh:open-settings" && message.value === "general"));
		assert.equal(f.updater.checks, 1);
	});

	it("menu reopens a window and delivers General after load; loading existing windows are covered too", async () => {
		const f = fixture(); f.setSettings({ general: { autoUpdate: false } }); await f.run("main()");
		f.windows.length = 0; f.menuCheck();
		assert.equal(f.windows.length, 1); assert.equal(f.updater.checks, 1);
		const win = f.windows[0]!;
		assert.ok(!win.webContents.messages.some(message => message.channel === "lh:open-settings"));
		win.webContents.emit("did-finish-load");
		assert.ok(win.webContents.messages.some(message => message.channel === "lh:open-settings"));
		f.menuCheck(); win.webContents.emit("did-finish-load");
		assert.equal(win.webContents.messages.filter(message => message.channel === "lh:open-settings").length, 2);
	});

	it("menu navigation failure does not prevent its manual check", async () => {
		const f = fixture(); f.setSettings({ general: { autoUpdate: false } }); await f.run("main()");
		f.windows[0]!.webContents.fails = true; f.windows[0]!.webContents.loading = false;
		f.menuCheck(); assert.equal(f.updater.checks, 1);
	});
});

describe("explicit update actions and protected restart", () => {
	it("a production check-only profile isolates cache and cannot reach readiness, shutdown or install", async () => {
		const f = fixture({ testProfile: true }); await f.run("main()");
		assert.equal(f.app.getPath(), "/fixture/isolated");
		assert.equal(f.run("autoUpdater.updateConfigPath"), "/fixture/isolated/update-test-config.yml");
		f.updater.emit("update-available", { version: "0.5.1" });
		await f.run("downloadUpdate()");
		assert.equal(f.updater.downloads, 1);
		await f.run("installUpdateNow()");
		assert.equal(f.state().actionError, "test-profile");
		assert.deepEqual(f.order, []);
		assert.equal(f.readinessRequests.length, 0);
		assert.equal(f.updater.autoInstallOnAppQuit, false);
	});
	it("failed cache isolation disables the test-profile updater", async () => {
		const f = fixture({ testProfile: true, cacheFailure: true });
		f.run("setupAutoUpdater()"); await f.check(true);
		assert.equal(f.state().status, "disabled"); assert.equal(f.updater.checks, 0);
	});
	it("an isolated installer identity cannot fall back to the production GitHub feed", async () => {
		const f = fixture({ testBuild: true }); f.run("setupAutoUpdater()"); await f.check(true);
		assert.equal(f.state().status, "disabled"); assert.equal(f.updater.feed, null);
		const local = fixture({ testBuild: true, feed: "http://127.0.0.1:9222/" });
		local.run("setupAutoUpdater()"); await local.check(true);
		assert.equal(local.updater.checks, 1);
		assert.deepEqual(local.updater.feed, { provider: "generic", url: "http://127.0.0.1:9222/" });
	});
	it("a packaged external development shell still cannot update", async () => {
		const f = fixture({ dev: true }); f.run("setupAutoUpdater()"); await f.check(true);
		assert.equal(f.state().status, "disabled"); assert.equal(f.updater.checks, 0);
	});

	it("accepts only loopback HTTP as the release-drill override", () => {
		const local = fixture({ feed: "http://127.0.0.1:9222/updates/" }); local.run("setupAutoUpdater()");
		assert.deepEqual(local.updater.feed, { provider: "generic", url: "http://127.0.0.1:9222/updates/" });
		for (const feed of ["https://upstream.example/releases", "http://localhost@remote.example/", "http://name:secret@localhost/", "invalid"]) {
			const f = fixture({ feed }); f.run("setupAutoUpdater()");
			assert.equal(f.state().status, "disabled"); assert.equal(f.updater.feed, null);
		}
	});

	it("checking never downloads, Download requires an available result, and download failure is retryable", async () => {
		const f = fixture(); f.run("setupAutoUpdater()");
		await f.run("downloadUpdate()"); assert.equal(f.updater.downloads, 0);
		await f.check(true); assert.equal(f.updater.downloads, 0);
		f.updater.emit("update-available", { version: "0.5.1" });
		assert.equal(f.state().status, "available"); assert.equal(f.updater.downloads, 0);
		f.updater.downloadFailure = new Error("private diagnostics");
		await f.run("downloadUpdate()");
		assert.equal(f.state().status, "available"); assert.equal(f.state().actionError, "download");
		assert.ok(!JSON.stringify(f.state()).includes("private"));
		f.updater.downloadFailure = null; await f.run("downloadUpdate()");
		assert.equal(f.updater.downloads, 2); assert.equal(f.state().status, "downloaded");
		await f.run("downloadUpdate()"); assert.equal(f.updater.downloads, 2);
		assert.equal(f.updater.autoInstallOnAppQuit, false);
	});

	it("download progress is bounded and never fabricates an installed version", () => {
		const f = fixture(); f.run("setupAutoUpdater()"); f.updater.emit("update-available", { version: "0.5.1" });
		f.updater.emit("download-progress", { percent: 23.7 }); assert.equal(f.state().progress, 24);
		f.updater.emit("download-progress", { percent: 120 }); assert.equal(f.state().progress, 100);
		f.updater.emit("download-progress", { percent: NaN }); assert.equal(f.state().progress, null);
		assert.equal(f.state().status, "downloading");
	});

	it("install cannot run before a real downloaded event", async () => {
		const f = fixture(); await f.run("main()");
		await f.run('reportUpdateStatus("downloaded", "0.5.1"); installUpdateNow()');
		assert.deepEqual(f.order, []); assert.equal(f.readinessRequests.length, 0);
	});

	it("busy or unreachable server preserves the app and staged update, then permits a later idle restart", async () => {
		const f = fixture(); await f.run("main()"); f.updater.emit("update-downloaded", { version: "0.5.1" });
		f.setReadiness({ ready: false, reason: "busy" }); await f.run("installUpdateNow()");
		assert.equal(f.state().actionError, "busy"); assert.deepEqual(f.order, ["prepare"]);
		f.setReadiness(new Error("server unavailable")); await f.run("installUpdateNow()");
		assert.equal(f.state().actionError, "readiness"); assert.ok(!f.order.includes("SIGTERM"));
		f.setReadiness({ ready: true }); await f.run("installUpdateNow()");
		assert.deepEqual(f.order.slice(-3), ["prepare", "SIGTERM", "install"]);
		const request = f.readinessRequests.at(-1)!;
		assert.equal(request.url, "http://127.0.0.1:9000/api/desktop/update-readiness");
		assert.equal(request.init.redirect, "error");
		assert.ok((request.init.headers as Record<string, string>)["x-learnharness-desktop"]);
	});

	it("download and install IPC reject foreign windows, child frames and navigated frames", async () => {
		const f = fixture(); await f.run("main()"); const sender = f.windows[0]!.webContents;
		for (const channel of ["lh:update:download", "lh:update-install"]) {
			const action = f.handles.get(channel)!;
			assert.throws(() => action({ sender: {}, senderFrame: sender.mainFrame }), /Untrusted/);
			assert.throws(() => action({ sender, senderFrame: { url: sender.mainFrame.url } }), /Untrusted/);
			sender.mainFrame.url = "https://untrusted.invalid/";
			assert.throws(() => action({ sender, senderFrame: sender.mainFrame }), /Untrusted/);
			sender.mainFrame.url = "http://127.0.0.1:9000/";
		}
		assert.equal(f.updater.downloads, 0); assert.equal(f.readinessRequests.length, 0);
	});

	it("a failed owned-server shutdown releases admission and never launches the installer", async () => {
		const f = fixture(); await f.run("main()"); f.updater.emit("update-downloaded", { version: "0.5.1" });
		f.run('killServer = () => { throw new Error("shutdown failed"); }');
		await f.run("installUpdateNow()");
		assert.deepEqual(f.order, ["prepare", "release"]);
		assert.equal(f.state().status, "downloaded"); assert.equal(f.state().actionError, "readiness");
	});

	it("an installation already handed to the updater cannot be launched twice", async () => {
		const f = fixture(); await f.run("main()"); f.updater.emit("update-downloaded", { version: "0.5.1" });
		await f.run("installUpdateNow()"); await f.run("installUpdateNow()");
		assert.deepEqual(f.order, ["prepare", "SIGTERM", "install"]);
	});
});
