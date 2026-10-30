import React, { act } from "react";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { labCodeHash, formatLabTime, LabRequestError, labRequest, mergeLabDraft, readLabEvents } from "../components/lab/lab-client.ts";
import { useLabSession } from "../components/lab/use-lab-session.ts";
import { beforeRestart, isUpdatePreparing } from "../components/update-readiness.ts";
import type { LabSession, LabStreamEvent } from "../src/core/lab.ts";

(globalThis as Record<string, unknown>).React = React;
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, CustomEvent: dom.window.CustomEvent });
const originalFetch = globalThis.fetch;
const roots: Root[] = [];
const initial = (): LabSession => ({ id: "local-test", itemId: "two-sum", title: "Pair search", kind: "coding", trackId: "dsa", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), revision: 1, status: "active", stage: "understand", reasoning: "", code: "pass", reflection: "", messages: [], runs: [], feedback: [], usage: [], questionIndex: 0, answers: {}, quizAnswers: {}, hintsUsed: 0, elapsedSeconds: 0, linkedChatIds: [] });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };

afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); globalThis.fetch = originalFetch; });

describe("Lab transport", () => {
	it("preserves events split inside Unicode and the final line without a newline", async () => {
		const events: LabStreamEvent[] = [{ type: "text", text: "A café explains λ" }, { type: "done", session: initial() }];
		const bytes = new TextEncoder().encode(events.map(event => JSON.stringify(event)).join("\n"));
		const stream = new ReadableStream<Uint8Array>({ start(controller) { for (let index = 0; index < bytes.length; index += 3) controller.enqueue(bytes.slice(index, index + 3)); controller.close(); } });
		const received: LabStreamEvent[] = [];
		await readLabEvents(new Response(stream), event => received.push(event));
		assert.deepEqual(received, events);
	});
	it("does not call an interrupted coach response complete", async () => {
		await assert.rejects(readLabEvents(new Response('{"type":"text","text":"partial"}\n'), () => {}), /interrupted/);
	});
	it("surfaces server conflicts and validation errors", async () => {
		globalThis.fetch = async () => new Response(JSON.stringify({ error: "Another window changed this attempt." }), { status: 409 });
		await assert.rejects(labRequest("/api/lab"), error => error instanceof LabRequestError && error.status === 409 && /Another window/.test(error.message));
	});
	it("preserves edits over a newer server revision", () => {
		const saved = { ...initial(), revision: 4, code: "old server code" };
		assert.deepEqual(mergeLabDraft(saved, { code: "new typed code" }), { ...saved, code: "new typed code" });
	});
	it("hashes the exact UTF8 code submitted for a run", async () => {
		assert.equal(await labCodeHash("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
		assert.notEqual(await labCodeHash("print('λ')"), await labCodeHash("print('λ')\n"));
	});
	it("keeps timers bounded and readable after an hour", () => { assert.equal(formatLabTime(-8), "00:00"); assert.equal(formatLabTime(3661.9), "61:01"); });
});

describe("Lab draft autosave", () => {
	async function mount() {
		let hook!: ReturnType<typeof useLabSession>;
		function Harness() { hook = useLabSession(initial()); return <span>{hook.session.code}</span>; }
		const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); roots.push(root);
		await act(async () => root.render(<Harness />));
		return { get hook() { return hook; }, host };
	}
	it("serializes a new edit made while an earlier save is in flight", async () => {
		const first = deferred<Response>();
		const requests: Record<string, unknown>[] = [];
		globalThis.fetch = async (_url, options) => {
			const patch = JSON.parse(options?.body as string); requests.push(patch);
			if (requests.length === 1) return first.promise;
			return new Response(JSON.stringify({ session: { ...initial(), revision: 3, code: patch.code } }));
		};
		const view = await mount();
		await act(async () => view.hook.edit({ code: "first edit" }));
		let saving!: Promise<LabSession>;
		await act(async () => { saving = view.hook.flush(); });
		await act(async () => view.hook.edit({ code: "second edit" }));
		await act(async () => { first.resolve(new Response(JSON.stringify({ session: { ...initial(), revision: 2, code: "first edit" } }))); await saving; });
		assert.deepEqual(requests.map(value => [value.revision, value.code]), [[1, "first edit"], [2, "second edit"]]);
		assert.equal(view.hook.session.code, "second edit"); assert.equal(view.hook.session.revision, 3); assert.equal(view.hook.saveState, "saved");
	});
	it("retains a conflicting local draft without silently overwriting it", async () => {
		globalThis.fetch = async () => new Response(JSON.stringify({ error: "Reload before saving." }), { status: 409 });
		const view = await mount();
		await act(async () => view.hook.edit({ code: "my unsaved work" }));
		await act(async () => { await assert.rejects(view.hook.flush(), /Reload/); });
		assert.equal(view.hook.conflict, true); assert.equal(view.hook.saveState, "error"); assert.equal(view.hook.session.code, "my unsaved work");
	});
	it("uses the coach's latest revision for subsequent autosaves", async () => {
		const requests: Record<string, unknown>[] = [];
		globalThis.fetch = async (_url, options) => {
			const patch = JSON.parse(options?.body as string); requests.push(patch);
			return new Response(JSON.stringify({ session: { ...initial(), ...patch, revision: patch.revision + 1, code: patch.code, messages: [{ id: "review", role: "assistant", content: "Try an empty input.", createdAt: new Date().toISOString() }] } }));
		};
		const view = await mount();
		await act(async () => view.hook.edit({ code: "first attempt" }));
		await act(async () => { await view.hook.flush(); });
		await act(async () => view.hook.replace({ ...view.hook.session, revision: 7, messages: [{ id: "review", role: "assistant", content: "Try an empty input.", createdAt: new Date().toISOString() }] }));
		await act(async () => view.hook.edit({ code: "revised after coaching" }));
		await act(async () => { await view.hook.flush(); });
		assert.equal(requests[1]?.revision, 7); assert.equal(view.hook.session.code, "revised after coaching"); assert.equal(view.hook.session.messages.length, 1);
	});
	it("adopts coach messages without replacing text typed during a reconnect", async () => {
		const view = await mount();
		await act(async () => view.hook.edit({ reasoning: "My new reasoning stays visible while a saved coach result arrives." }));
		await act(async () => view.hook.replace({ ...initial(), revision: 5, messages: [{ id: "new", role: "assistant", content: "Check the invariant.", createdAt: new Date().toISOString() }] }));
		assert.equal(view.hook.session.revision, 5); assert.equal(view.hook.session.messages.length, 1); assert.match(view.hook.session.reasoning, /new reasoning stays/);
	});
	it("flushes a fresh draft before update restart and freezes new edits until released", async () => {
		const response = deferred<Response>();
		const requests: Record<string, unknown>[] = [];
		globalThis.fetch = async (_url, options) => { requests.push(JSON.parse(options?.body as string)); return response.promise; };
		const view = await mount();
		await act(async () => view.hook.edit({ code: "saved immediately before restart" }));
		let ready!: Promise<() => void>;
		await act(async () => { ready = beforeRestart(); });
		assert.equal(isUpdatePreparing(), true); assert.equal(document.body.inert, true);
		assert.equal(requests[0]?.code, "saved immediately before restart");
		await act(async () => view.hook.edit({ code: "must not race the restart" }));
		let release!: () => void;
		await act(async () => { response.resolve(new Response(JSON.stringify({ session: { ...initial(), revision: 2, code: requests[0]?.code } }))); release = await ready; });
		assert.equal(view.hook.session.code, "saved immediately before restart"); assert.equal(view.hook.saveState, "saved");
		release(); assert.equal(isUpdatePreparing(), false); assert.equal(document.body.inert, false);
	});
	it("blocks update restart after a save conflict and preserves the draft", async () => {
		globalThis.fetch = async () => new Response(JSON.stringify({ error: "Reload before saving." }), { status: 409 });
		const view = await mount();
		await act(async () => view.hook.edit({ code: "keep this unsaved draft" }));
		await act(async () => { await assert.rejects(beforeRestart(), /Reload/); });
		assert.equal(isUpdatePreparing(), false); assert.equal(document.body.inert, false);
		assert.equal(view.hook.session.code, "keep this unsaved draft"); assert.equal(view.hook.conflict, true);
		await act(async () => { await assert.rejects(beforeRestart(), /conflict/); });
	});
});
