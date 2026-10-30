/** Drive only the isolated test app's explicitly opened renderer debugger. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../work/updater-proof");
const initial = JSON.parse(fs.readFileSync(path.join(root, "initial-install.json"), "utf8").replace(/^\uFEFF/, ""));
assert.ok(initial.target.endsWith("Learning Studio Update Test"));
const phase = process.argv[2]; assert.ok(["download", "restart", "verify"].includes(phase));
const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:18768", defaultViewport: null });
try {
	const pages = await browser.pages(); const page = pages.find(page => /^http:\/\/127\.0\.0\.1:\d+\//.test(page.url()));
	assert.ok(page, "Isolated desktop renderer not ready");
	const data = await page.evaluate(async () => ({ settings: await (await fetch("/api/settings")).json(), chats: await (await fetch("/api/chats")).json() }));
	assert.equal(data.settings.settings.models.strong.model.provider, "openai");
	assert.equal(data.settings.settings.models.strong.model.id, "gpt-5");
	assert.ok(data.chats.chats.some(chat => chat.id === "chat_upgrade_proof"));
	const settings = await page.$("[data-testid='settings-entry']");
	if (settings) await settings.click();
	const general = await page.$("[data-testid='settings-nav-general']"); if (general) await general.click();
	if (phase === "download") {
		await page.waitForSelector("[data-testid='update-check']", { timeout: 30000 });
		await page.click("[data-testid='update-check']");
		await page.waitForSelector("[data-testid='update-download']", { timeout: 30000 });
		const before = await page.evaluate(() => window.lh.getUpdateState()); assert.equal(before.status, "available"); assert.equal(before.version, "0.5.1");
		await page.screenshot({ path: path.join(root, "01-update-available.png") });
		await page.click("[data-testid='update-download']");
		await page.waitForSelector("[data-testid='update-restart']", { timeout: 180000 });
		const after = await page.evaluate(() => window.lh.getUpdateState()); assert.equal(after.status, "downloaded");
		await page.screenshot({ path: path.join(root, "02-update-downloaded.png") });
		fs.writeFileSync(path.join(root, "download-receipt.json"), JSON.stringify({ before, after, savedDataReadThroughServer: true, at: new Date().toISOString() }, null, 2));
	} else if (phase === "restart") {
		await page.waitForSelector("[data-testid='update-restart']", { timeout: 30000 });
		assert.equal((await page.evaluate(() => window.lh.getUpdateState())).status, "downloaded");
		fs.writeFileSync(path.join(root, "restart-request.json"), JSON.stringify({ at: new Date().toISOString(), method: "clicked actual Settings Restart and install button" }, null, 2));
		await page.click("[data-testid='update-restart']").catch(error => { if (!/closed|detached/i.test(String(error))) throw error; });
	} else {
		const { extractFile } = require("@electron/asar");
		const metadata = JSON.parse(extractFile(path.join(initial.target, "resources/app.asar"), "package.json").toString());
		assert.equal(metadata.version, "0.5.1"); assert.equal(metadata.name, "learning-studio-update-test");
		for (const entry of initial.syntheticFiles) assert.equal(createHash("sha256").update(fs.readFileSync(path.join(initial.profile, entry.relativePath))).digest("hex").toUpperCase(), entry.sha256);
		await page.screenshot({ path: path.join(root, "03-updated-preserved-settings.png") });
		fs.writeFileSync(path.join(root, "upgrade-receipt.json"), JSON.stringify({ at: new Date().toISOString(), installedShellVersion: metadata.version, savedDataReadThroughServer: true, syntheticFilesByteIdentical: true, rendererBuildVersion: "0.5.0", caveat: "Same updater source and NSIS mechanism under isolated product identity. This is not installation into the production identity.", profile: initial.profile }, null, 2));
	}
} finally { await browser.disconnect(); }
