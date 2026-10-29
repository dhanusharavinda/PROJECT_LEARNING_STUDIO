import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, afterEach, test } from "node:test";
import { blackboardPlanSchema } from "../src/core/blackboard.ts";
import type { JobRecord } from "../src/core/contracts.ts";

const testRoot = path.resolve("work/testdata");
fs.mkdirSync(testRoot, { recursive: true });
const directory = fs.mkdtempSync(path.join(testRoot, "blackboard-delete-"));
process.env.LH_DATA_DIR = path.join(directory, "data");
process.env.LH_AUTH_FILE = path.join(directory, "auth.json");
process.env.LH_MANIMGX_PYTHON = path.join(directory, "missing-python.exe");
fs.writeFileSync(process.env.LH_AUTH_FILE, "{}");
const { stores } = await import("../src/server/stores.ts");
const { deleteChatSession } = await import("../src/server/chats.ts");
const { renderBlackboard, blackboardMediaResponse } = await import("../src/server/blackboard.ts");
const cacheRoot = path.join(process.env.LH_DATA_DIR, "blackboard");
const chats: string[] = [];

function chat() {
	const record = stores.chatStore.createChat("Synthetic deletion fixture");
	chats.push(record.id);
	return record;
}
function job(chatId: string, input?: unknown, result?: unknown, status: JobRecord["status"] = "done") {
	const record = stores.jobStore.createJob({ kind: "animation", chatId, toolCallId: crypto.randomUUID(), input });
	return stores.jobStore.updateJob(record.id, { result, status })!;
}
async function partial(title: string) {
	const input = blackboardPlanSchema.parse({ title, beats: [{ title: "Synthetic board", caption: "A local fixture with no paid inference", kind: "text", duration: 2 }] });
	const before = new Set(fs.existsSync(cacheRoot) ? fs.readdirSync(cacheRoot) : []);
	await assert.rejects(renderBlackboard(input), /runtime is missing/);
	const id = fs.readdirSync(cacheRoot).find(name => /^[a-f0-9]{64}$/.test(name) && !before.has(name))!;
	assert(id, "the failed render created a traceable hash directory");
	return { input, id, folder: path.join(cacheRoot, id) };
}
function complete(folder: string) {
	fs.writeFileSync(path.join(folder, "receipt.json"), "{}");
	fs.writeFileSync(path.join(folder, "BlackboardLesson.mp4"), "synthetic-video");
	fs.writeFileSync(path.join(folder, "poster.png"), "synthetic-poster");
}
function media(id: string) {
	return blackboardMediaResponse(new Request("http://localhost/api"), id, "video");
}
afterEach(() => {
	for (const id of chats.splice(0)) { stores.jobStore.deleteJobsForChat(id); stores.chatStore.deleteChat(id); }
});
after(() => {
	assert.equal(path.dirname(directory), testRoot);
	fs.rmSync(directory, { recursive: true, force: true });
});

test("deleting a lesson removes its source, plan and media, while unrelated cache survives", async () => {
	const owner = chat(), artifact = await partial("Completed board");
	complete(artifact.folder);
	const unrelated = path.join(cacheRoot, "f".repeat(64));
	fs.mkdirSync(unrelated); fs.writeFileSync(path.join(unrelated, "sentinel"), "keep");
	const record = job(owner.id, artifact.input, { id: artifact.id });
	assert.equal((await media(artifact.id)).status, 200);
	assert.equal((await deleteChatSession(owner.id, "preserve-graph")).ok, true);
	assert.equal(fs.existsSync(artifact.folder), false);
	assert.equal(stores.jobStore.getJob(record.id), null);
	assert.equal(stores.chatStore.getChat(owner.id), null);
	assert.equal((await media(artifact.id)).status, 404);
	assert.equal(fs.readFileSync(path.join(unrelated, "sentinel"), "utf8"), "keep");
});

test("a shared completed animation is retained until its final lesson is deleted", async () => {
	const first = chat(), second = chat(), artifact = await partial("Shared board");
	complete(artifact.folder);
	job(first.id, artifact.input, { id: artifact.id });
	job(second.id, undefined, { id: artifact.id });
	assert.equal((await deleteChatSession(first.id, "preserve-graph")).ok, true);
	assert.equal((await media(artifact.id)).status, 200);
	assert.equal((await deleteChatSession(second.id, "preserve-graph")).ok, true);
	assert.equal(fs.existsSync(artifact.folder), false);
});

test("valid input preserves another queued render and removes partial error output on its final deletion", async () => {
	const first = chat(), second = chat(), artifact = await partial("Partial shared board");
	job(first.id, artifact.input, undefined, "error");
	const pending = job(second.id, artifact.input, undefined, "running");
	assert.equal((await deleteChatSession(first.id, "preserve-graph")).ok, true);
	assert.equal(fs.existsSync(path.join(artifact.folder, "scene.py")), true);
	stores.jobStore.updateJob(pending.id, { status: "error" });
	assert.equal((await deleteChatSession(second.id, "preserve-graph")).ok, true);
	assert.equal(fs.existsSync(artifact.folder), false);
});

test("orphan job records still protect a shared animation", async () => {
	const owner = chat(), artifact = await partial("Orphan reference board");
	job(owner.id, artifact.input);
	const orphan = job("chat_orphan_fixture", artifact.input);
	try {
		assert.equal((await deleteChatSession(owner.id, "preserve-graph")).ok, true);
		assert.equal(fs.existsSync(artifact.folder), true);
	} finally { stores.jobStore.deleteJobsForChat(orphan.chatId); }
});

test("a copied animation in another lesson is retained without a job reference", async () => {
	const owner = chat(), copy = chat(), artifact = await partial("Copied lesson board");
	job(owner.id, artifact.input);
	const copyFile = path.join(process.env.LH_DATA_DIR!, "chats", `${copy.id}.json`);
	const record = JSON.parse(fs.readFileSync(copyFile, "utf8"));
	record.fixture = { url: `/api/blackboard/media/${artifact.id}/video` };
	fs.writeFileSync(copyFile, JSON.stringify(record));
	assert.equal((await deleteChatSession(owner.id, "preserve-graph")).ok, true);
	assert.equal(fs.existsSync(artifact.folder), true);
	assert.equal((await deleteChatSession(copy.id, "preserve-graph")).ok, true);
	assert.equal(fs.existsSync(artifact.folder), false);
});

test("an older completed result and a newer partial render are both cleaned", async () => {
	const owner = chat(), artifact = await partial("New partial board"), oldId = "e".repeat(64);
	const oldFolder = path.join(cacheRoot, oldId); fs.mkdirSync(oldFolder); complete(oldFolder);
	job(owner.id, artifact.input, { id: oldId });
	assert.equal((await deleteChatSession(owner.id, "preserve-graph")).ok, true);
	assert.equal(fs.existsSync(oldFolder), false);
	assert.equal(fs.existsSync(artifact.folder), false);
});

test("invalid artifact IDs cannot target a file outside the hash cache", async () => {
	const owner = chat(), outside = path.join(directory, "outside.txt");
	fs.writeFileSync(outside, "preserve");
	job(owner.id, { invalid: true }, { id: "../../outside.txt" });
	assert.equal((await deleteChatSession(owner.id, "preserve-graph")).ok, true);
	assert.equal(fs.readFileSync(outside, "utf8"), "preserve");
});

test("unverifiable references return a retryable error without losing the lesson or jobs", async () => {
	const owner = chat(), artifact = await partial("Retry deletion board");
	const record = job(owner.id, artifact.input);
	const corrupt = path.join(process.env.LH_DATA_DIR!, "jobs", "job_corrupt_fixture.json");
	fs.writeFileSync(corrupt, "not json");
	try {
		const outcome = await deleteChatSession(owner.id, "preserve-graph");
		assert(!outcome.ok && outcome.status === 503 && outcome.code === "artifact_cleanup_failed");
		assert(stores.chatStore.getChat(owner.id));
		assert(stores.jobStore.getJob(record.id));
		assert.equal(fs.existsSync(artifact.folder), true);
	} finally { fs.unlinkSync(corrupt); }
	assert.equal((await deleteChatSession(owner.id, "preserve-graph")).ok, true);
	assert.equal(fs.existsSync(artifact.folder), false);
});

test("a hash directory junction cannot make deletion escape the cache", async () => {
	const owner = chat(), artifact = await partial("Junction deletion board");
	job(owner.id, artifact.input);
	const outside = path.join(directory, "junction-target");
	fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, "sentinel"), "preserve");
	assert.equal(path.dirname(artifact.folder), cacheRoot);
	fs.rmSync(artifact.folder, { recursive: true });
	fs.symlinkSync(outside, artifact.folder, process.platform === "win32" ? "junction" : "dir");
	try {
		const outcome = await deleteChatSession(owner.id, "preserve-graph");
		assert(!outcome.ok && outcome.code === "artifact_cleanup_failed");
		assert(stores.chatStore.getChat(owner.id));
		assert.equal(fs.readFileSync(path.join(outside, "sentinel"), "utf8"), "preserve");
	} finally {
		assert.equal(path.dirname(artifact.folder), cacheRoot);
		fs.rmSync(artifact.folder, { recursive: true, force: true });
	}
	assert.equal((await deleteChatSession(owner.id, "preserve-graph")).ok, true);
	assert.equal(fs.readFileSync(path.join(outside, "sentinel"), "utf8"), "preserve");
});
