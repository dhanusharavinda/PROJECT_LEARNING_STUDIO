import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createFauxCore, fauxAssistantMessage, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai";
import type { LabCatalog, LabItem, LabSession, LabStreamEvent } from "../src/core/lab.ts";

const directory = mkdtempSync(path.join(tmpdir(), "studio-lab-test-"));
const oldData = process.env.LH_DATA_DIR;
process.env.LH_DATA_DIR = directory;
const { createLabStore, LabError } = await import("../src/store/lab.ts");
const { createLabHandlers, hasActiveLabWork, labOutputsEqual, labPricing } = await import("../src/server/lab.ts");
const { prepareDesktopUpdate, releaseDesktopUpdate } = await import("../src/server/update-admission.ts");
const { labStageBlocker } = await import("../src/core/lab.ts");

after(() => {
	assert(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep));
	rmSync(directory, { recursive: true, force: true });
	if (oldData === undefined) delete process.env.LH_DATA_DIR; else process.env.LH_DATA_DIR = oldData;
	releaseDesktopUpdate();
});

const item: LabItem = {
	id: "test-sum", trackId: "dsa", kind: "coding", title: "Add values", summary: "Fixture only",
	difficulty: "Foundation", minutes: 5, order: 0, tags: ["arithmetic"], prerequisites: [], objectives: ["Explain addition"],
	content: "Return the sum of two numbers.", hints: ["Consider the operation."],
	questions: [{ id: "q1", prompt: "Explain your approach", options: ["Add", "Subtract"], answer: 0, explanation: "The sum adds both values." }],
	resources: [{ id: "r1", title: "Python", url: "https://docs.python.org/3/", kind: "docs" }],
	coding: { language: "python", entrypoint: "solve", starterCode: "def solve(a, b):\n    pass", solution: "def solve(a, b):\n    return a+b", complexity: "O(1)", tests: [{ id: "t1", name: "Positive", args: [1, 2], expected: 3 }, { id: "t2", name: "Negative", args: [-1, 1], expected: 0 }] },
};
const lesson: LabItem = { ...item, id: "test-lesson", kind: "lesson", coding: undefined };
const catalog: LabCatalog = { version: 1, tracks: [{ id: "dsa", title: "DSA", description: "Fixture" }], items: [item, lesson] };
let sequence = 0;
function fixture(steps?: FauxResponseStep[]) {
	const store = createLabStore(path.join(directory, String(sequence++)));
	const faux = createFauxCore({}); faux.setResponses(steps ?? [fauxAssistantMessage("Consider how the inputs relate.")]);
	const handlers = createLabHandlers({ store, catalog, engine: async () => ({ model: faux.getModel(), streamFn: faux.streamSimple }) });
	return { store, handlers, session: store.create(item) };
}
function req(data: unknown, method = "POST", origin = "http://localhost:3000") {
	return new Request("http://localhost:3000/api/lab", { method, headers: { origin, "content-type": "application/json", "sec-fetch-site": origin.includes("localhost") ? "same-origin" : "cross-site" }, ...(method === "DELETE" ? {} : { body: JSON.stringify(data) }) });
}
const hash = (code: string) => createHash("sha256").update(code).digest("hex");
async function events(response: Response): Promise<LabStreamEvent[]> { return (await response.text()).trim().split("\n").filter(Boolean).map(line => JSON.parse(line)); }

test("drafts persist atomically and stale revisions cannot overwrite another window", () => {
	const { store, session } = fixture();
	const saved = store.mutate(session.id, draft => { draft.reasoning = "First window's answer"; }, 0);
	assert.equal(saved.revision, 1);
	assert.throws(() => store.mutate(session.id, draft => { draft.reasoning = "Stale overwrite"; }, 0), (error: unknown) => error instanceof LabError && error.status === 409);
	assert.equal(store.requireSession(session.id).reasoning, "First window's answer");
	const reopened = createLabStore(path.join(directory, String(sequence - 1)));
	assert.equal(reopened.requireSession(session.id).reasoning, saved.reasoning);
});

test("invalid IDs and unreadable data are refused without overwriting files", () => {
	const { store, session } = fixture();
	assert.throws(() => store.get("../../settings"), /Invalid/);
	const file = path.join(directory, String(sequence - 1), "sessions", `${session.id}.json`);
	writeFileSync(file, "broken fixture");
	assert.throws(() => store.mutate(session.id, draft => { draft.reasoning = "overwrite"; }), /preserved/);
	assert.equal(readFileSync(file, "utf8"), "broken fixture");
});

test("mutations enforce same-origin, JSON type, body limits, and known exercises", async () => {
	const { handlers } = fixture();
	assert.equal((await handlers.create(req({ itemId: item.id }, "POST", "https://evil.example"))).status, 403);
	assert.equal((await handlers.create(new Request("http://localhost:3000/api/lab", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "text/plain" }, body: "{}" }))).status, 415);
	assert.equal((await handlers.create(req({ itemId: "x", extra: "x".repeat(270000) }))).status, 413);
	assert.equal((await handlers.create(req({ itemId: "missing" }))).status, 404);
	assert.equal((await handlers.create(req({ itemId: item.id, timerMinutes: 181 }))).status, 400);
});

test("stage gates require saved reasoning, own attempts, and test evidence", async () => {
	const { store, session, handlers } = fixture();
	assert.equal((await handlers.patch(req({ revision: 0, stage: "reflect" }, "PATCH"), session.id)).status, 422);
	assert.equal((await handlers.patch(req({ revision: 0, stage: "plan" }, "PATCH"), session.id)).status, 422);
	let saved = store.mutate(session.id, draft => { draft.reasoning = "I need to combine both inputs using addition and return their sum."; });
	assert.equal(labStageBlocker(saved, item, "plan"), null);
	saved = store.mutate(session.id, draft => { draft.stage = "attempt"; });
	assert.match(labStageBlocker(saved, item, "test")!, /own attempt/);
	assert.equal((await handlers.patch(req({ revision: saved.revision, stage: "test", code: item.coding!.solution }, "PATCH"), session.id)).status, 200);
	saved = store.requireSession(session.id);
	assert.match(labStageBlocker(saved, item, "reflect")!, /Run your code/);
});

test("bookmarks and read progress persist but cannot manufacture verified progress", async () => {
	const { handlers, store } = fixture();
	assert.equal((await handlers.library(req({ bookmarkId: "r1", bookmarked: true }))).status, 200);
	assert.equal((await handlers.library(req({ itemId: item.id, state: "read" }))).status, 200);
	assert.equal((await handlers.library(req({ itemId: item.id, state: "proven" }))).status, 422);
	assert.deepEqual(store.library().bookmarks, ["r1"]);
	assert.equal(store.library().progress[item.id]!.state, "read");
});

test("run reservations block updates and reject fake passed flags", async () => {
	const { handlers, store, session } = fixture();
	const saved = store.mutate(session.id, draft => { draft.code = item.coding!.solution; });
	const lease = await (await handlers.startRun(req({ revision: saved.revision, codeHash: hash(saved.code) }), saved.id)).json();
	assert.equal(hasActiveLabWork(), true);
	assert.deepEqual(prepareDesktopUpdate(), { ready: false, reason: "busy" });
	assert.equal((await handlers.remove(req({}, "DELETE"), saved.id)).status, 409);
	const response = await handlers.run(req({ runId: lease.runId, revision: saved.revision, codeHash: hash(saved.code), results: [{ testId: "t1", actual: 999, passed: true }, { testId: "t2", actual: 0, passed: true }], durationMs: 4, stdout: "" }), saved.id);
	assert.equal(response.status, 200);
	const result = await response.json();
	assert.equal(result.run.passed, 1);
	assert.equal(result.run.results[0].passed, false);
	assert.equal(store.library().progress[item.id]!.state, "practiced");
	assert.equal(hasActiveLabWork(), false);
});

test("current code and a reflection are required for verified completion", async () => {
	const { handlers, store, session } = fixture();
	let saved = store.mutate(session.id, draft => { draft.code = item.coding!.solution; draft.stage = "test"; draft.reasoning = "I add both values. This works for negative values and zero too."; });
	const lease = await (await handlers.startRun(req({ revision: saved.revision, codeHash: hash(saved.code) }), saved.id)).json();
	await handlers.run(req({ runId: lease.runId, revision: saved.revision, codeHash: hash(saved.code), results: [{ testId: "t1", actual: 3 }, { testId: "t2", actual: 0 }], durationMs: 2 }), saved.id);
	saved = store.requireSession(saved.id);
	assert.equal(store.library().progress[item.id]!.state, "practiced");
	assert.equal((await handlers.patch(req({ revision: saved.revision, stage: "reflect", complete: true }, "PATCH"), saved.id)).status, 422);
	const done = await handlers.patch(req({ revision: saved.revision, stage: "reflect", reflection: "I tested positive and negative numbers and learned addition is constant time.", complete: true }, "PATCH"), saved.id);
	assert.equal(done.status, 200);
	assert.equal(store.library().progress[item.id]!.state, "proven");
});

test("stale, missing, duplicate, and abandoned code runs do not leak reservations", async () => {
	const { handlers, store, session } = fixture();
	let saved = store.mutate(session.id, draft => { draft.code = item.coding!.solution; });
	let lease = await (await handlers.startRun(req({ revision: saved.revision, codeHash: hash(saved.code) }), saved.id)).json();
	store.mutate(saved.id, draft => { draft.code += "\n# new draft"; });
	assert.equal((await handlers.run(req({ runId: lease.runId, revision: saved.revision, codeHash: hash(saved.code), results: [], durationMs: 1 }), saved.id)).status, 409);
	assert.equal(hasActiveLabWork(), false);
	saved = store.requireSession(saved.id);
	lease = await (await handlers.startRun(req({ revision: saved.revision, codeHash: hash(saved.code) }), saved.id)).json();
	assert.equal((await handlers.run(req({ runId: lease.runId, revision: saved.revision, codeHash: hash(saved.code), results: [{ testId: "t1", actual: 3 }, { testId: "t1", actual: 3 }], durationMs: 1 }), saved.id)).status, 400);
	assert.equal(hasActiveLabWork(), false);
	lease = await (await handlers.startRun(req({ revision: saved.revision, codeHash: hash(saved.code) }), saved.id)).json();
	assert.equal((await handlers.cancelRun(req({}, "DELETE"), saved.id, lease.runId)).status, 200);
	assert.equal(hasActiveLabWork(), false);
});

test("prepared updates refuse new sessions and code runs without changing saved work", async () => {
	const { handlers, session, store } = fixture();
	assert.deepEqual(prepareDesktopUpdate(), { ready: true });
	try {
		assert.equal((await handlers.create(req({ itemId: item.id }))).status, 409);
		assert.equal((await handlers.startRun(req({ revision: session.revision, codeHash: hash(session.code) }), session.id)).status, 409);
		assert.equal(store.list().length, 1);
	} finally { releaseDesktopUpdate(); }
});

test("coaching streams through the shared runner, saves usage, and preserves concurrent drafts", async () => {
	let unblock!: () => void;
	const waiting = new Promise<void>(resolve => { unblock = resolve; });
	const { handlers, session, store } = fixture([async () => { await waiting; return fauxAssistantMessage("Try a small example first."); }]);
	const response = await handlers.coach(req({ action: "ask", message: "How do I start?" }), session.id);
	assert.equal(response.status, 200);
	assert.equal(hasActiveLabWork(), true);
	assert.deepEqual(prepareDesktopUpdate(), { ready: false, reason: "busy" });
	assert.equal((await handlers.coach(req({ action: "hint" }), session.id)).status, 409);
	store.mutate(session.id, draft => { draft.reasoning = "I can start by combining the inputs using addition."; });
	unblock();
	const output = await events(response);
	assert(output.some(event => event.type === "text"));
	assert(output.some(event => event.type === "done"));
	const saved = store.requireSession(session.id);
	assert.match(saved.reasoning, /combining/);
	assert.equal(saved.messages.length, 2);
	assert(saved.usage[0]!.calls[0]!.inputTokens! > 0);
	assert.equal(hasActiveLabWork(), false);
	assert.equal(store.library().progress[item.id], undefined, "AI answers do not establish practice evidence");
});

test("cancelled coaches release reservations and never save a completed AI answer", async () => {
	let unblock!: () => void;
	const waiting = new Promise<void>(resolve => { unblock = resolve; });
	const { handlers, session, store } = fixture([async () => { await waiting; return fauxAssistantMessage("Late answer"); }]);
	const response = await handlers.coach(req({ action: "hint" }), session.id);
	assert.equal(handlers.cancel(req({}, "DELETE"), session.id).status, 200);
	unblock();
	const output = await events(response);
	assert(output.some(event => event.type === "error" && event.error.includes("stopped")));
	assert.equal(store.requireSession(session.id).messages.filter(message => message.role === "assistant").length, 0);
	assert.equal(hasActiveLabWork(), false);
});

test("AI review is provisional and cannot mark a test as passed", async () => {
	const { handlers, session, store } = fixture([fauxAssistantMessage([fauxToolCall("submit_lab_review", { summary: "The reasoning is clear.", strengths: ["Uses examples"], improvements: ["Test edge cases"], score: 100 })], { stopReason: "toolUse" })]);
	store.mutate(session.id, draft => { draft.reasoning = "I will return the sum of both values and test negative inputs."; });
	const output = await events(await handlers.coach(req({ action: "review" }), session.id));
	assert(output.some(event => event.type === "done"));
	const saved = store.requireSession(session.id);
	assert.equal(saved.feedback[0]!.source, "ai-review");
	assert.equal(saved.runs.length, 0);
	assert.equal(store.library().progress[item.id]!.state, "collected");
	assert.match(store.library().progress[item.id]!.weakAreas[0]!, /^Coach suggestion:/);
});

test("handoffs preserve attempt context and link to the existing Teaching or Practice session", async () => {
	const store = createLabStore(path.join(directory, String(sequence++))), session = store.create(item);
	store.mutate(session.id, draft => { draft.reasoning = "I am uncertain about negative values."; });
	let prompt = "", mode = "";
	const handlers = createLabHandlers({ store, catalog, handoff: (_title, context, target) => { prompt = context; mode = target; return "chat_fixture"; } });
	const response = await handlers.handoff(req({ mode: "practice" }), session.id);
	assert.equal(response.status, 200);
	assert.equal(mode, "practice"); assert.match(prompt, /uncertain about negative/);
	assert.deepEqual(store.requireSession(session.id).linkedChatIds, ["chat_fixture"]);
});

test("default handoff creates an empty chat for the existing opening-prompt flow", async () => {
	const { store, session } = fixture();
	const handlers = createLabHandlers({ store, catalog });
	const response = await handlers.handoff(req({ mode: "teach" }), session.id);
	const value = await response.json();
	assert.equal(response.status, 200);
	assert.match(value.openingPrompt, /Teach me Add values/);
	const { stores } = await import("../src/server/stores.ts");
	assert.deepEqual(stores.chatStore.getChat(value.chatId)!.messages, []);
});

test("quiz progress needs correct deterministic answers and the learner's explanation", async () => {
	const { store, handlers } = fixture();
	const session = store.create(lesson);
	store.mutate(session.id, draft => { draft.stage = "reflect"; draft.reflection = "I learned how to combine the inputs with an addition operation."; draft.quizAnswers = { q1: 0 }; });
	let saved = store.requireSession(session.id);
	await handlers.patch(req({ revision: saved.revision, complete: true }, "PATCH"), saved.id);
	assert.equal(store.library().progress[lesson.id]!.state, "practiced");
	saved = store.requireSession(saved.id);
	await handlers.patch(req({ revision: saved.revision, answers: { q1: "Addition combines both quantities and returns their total, including negative inputs." }, complete: true }, "PATCH"), saved.id);
	assert.equal(store.library().progress[lesson.id]!.state, "proven");
});

test("output comparison rejects malformed outputs and supports numeric tolerance", () => {
	assert(labOutputsEqual({ values: [0.300001] }, { values: [0.3] }, 0.00001));
	assert(!labOutputsEqual({ values: [0.3], extra: true }, { values: [0.3] }));
	assert(!labOutputsEqual("3", 3));
	assert(!labOutputsEqual(Number.NaN, 3));
});

test("cost reporting reuses existing unknown and subscription accounting without writing estimates", () => {
	const { store, session } = fixture();
	const saved = store.mutate(session.id, draft => {
		draft.usage = ["unknown-test-provider:example", "chatgpt:gpt-5"].map(model => ({ at: new Date().toISOString(), model, calls: [{ inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }] }));
	});
	const pricing = labPricing([saved]);
	assert.equal(pricing.unpriced, 1);
	assert.equal(pricing.subscription, 1);
	assert.equal(store.requireSession(session.id).pricing, undefined);
});
