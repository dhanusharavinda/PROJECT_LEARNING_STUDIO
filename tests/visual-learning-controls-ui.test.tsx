import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { VisualLearningContext, VisualLearningProvider, useVisualLearning } from "../components/visual-learning-toggle.tsx";
import { LessonAnimationAction } from "../components/artifacts/lesson-animation.tsx";
import { JobsContext } from "../components/jobs-context.ts";
import type { JobRecord } from "../src/core/contracts.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true });
const originalFetch = globalThis.fetch;
let root: Root | undefined;
let host: HTMLDivElement | undefined;
let state: ReturnType<typeof useVisualLearning>;
function Observer() { state = useVisualLearning(); return <span>{state.loaded ? "ready" : "loading"}</span>; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function mount(children: React.ReactNode = <Observer />) {
	host = document.createElement("div"); document.body.append(host); root = createRoot(host);
	await act(async () => root!.render(<VisualLearningProvider>{children}</VisualLearningProvider>));
}
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); root = undefined; host = undefined; globalThis.fetch = originalFetch; });

test("a saved off preference stays paused during load and an older refresh cannot undo a new selection", async () => {
	const first = deferred<Response>(), refresh = deferred<Response>(), post = deferred<Response>(); let reads = 0;
	globalThis.fetch = async (_url, options) => options?.method === "POST" ? post.promise : ++reads === 1 ? first.promise : refresh.promise;
	await mount(); assert.equal(state.loaded, false); assert.equal(state.enabled, false);
	await act(async () => first.resolve(Response.json({ enabled: false })));
	assert.equal(state.loaded, true); assert.equal(state.enabled, false);
	await act(async () => window.dispatchEvent(new window.Event("focus")));
	let save!: Promise<void>;
	await act(async () => { save = state.setEnabled(true); });
	await act(async () => { window.dispatchEvent(new window.Event("focus")); refresh.resolve(Response.json({ enabled: false })); });
	assert.equal(reads, 2, "focusing during a save does not race another read");
	assert.equal(state.busy, true);
	await act(async () => { post.resolve(Response.json({ enabled: true })); await save; });
	assert.equal(state.enabled, true); assert.equal(state.busy, false); assert.equal(state.error, "");
});

test("a failed settings save preserves the current preference and offers another attempt", async () => {
	globalThis.fetch = async (_url, options) => options?.method === "POST" ? Response.json({ error: "Could not save preference." }, { status: 500 }) : Response.json({ enabled: false });
	await mount(); await act(async () => state.setEnabled(true));
	assert.equal(state.enabled, false); assert.equal(state.busy, false); assert.equal(state.loaded, true); assert.equal(state.error, "Could not save preference.");
});

test("the visible generation action requests a static diagram while animations are off", async () => {
	const modes: unknown[] = [];
	globalThis.fetch = async (_url, options) => {
		if (options?.method !== "POST") return Response.json({ enabled: false });
		modes.push(JSON.parse(String(options.body)).mode);
		return Response.json({ job: { id: "pending-diagram", kind: "visual", status: "running", chatId: "lesson", toolCallId: "direct", createdAt: "2026-10-29T23:00:00Z", updatedAt: "2026-10-29T23:00:00Z", input: { mode: "lesson-animation", sourceMessageId: "explanation" } } });
	};
	await mount(<LessonAnimationAction chatId="lesson" sourceMessageId="explanation" />);
	const button = [...host!.querySelectorAll("button")].find(element => element.textContent === "Generate diagram");
	assert(button); assert.equal(button.disabled, false);
	await act(async () => button.click());
	assert.deepEqual(modes, ["diagram"]); assert.match(host!.textContent!, /Starting visual/);
});

test("saved format controls reopen an older interactive demo after a newer video without another generation", async () => {
	let generations = 0;
	globalThis.fetch = async (_url, options) => { if (options?.method === "POST") generations++; return Response.json({ enabled: true }); };
	const base = { chatId: "lesson", toolCallId: "direct", status: "done" as const, activity: "Ready", updatedAt: "2026-10-29T23:00:00Z", input: { mode: "lesson-animation", sourceMessageId: "explanation", automatic: false } };
	const interactive: JobRecord = { ...base, id: "old-interactive", kind: "demo", createdAt: "2026-10-29T21:00:00Z", result: { title: "Explore the learning rate", html: "<html><body>Interactive model</body></html>", tested: true } };
	const video: JobRecord = { ...base, id: "new-video", kind: "animation", createdAt: "2026-10-29T22:00:00Z", result: { title: "An animated explanation", url: `/api/blackboard/media/${"c".repeat(64)}/video`, durationSeconds: 8, sections: [] } };
	const view = (sourceMessageId: string) => <VisualLearningContext.Provider value={{ enabled: true, loaded: true, busy: false, error: "", setEnabled: async () => {} }}><JobsContext.Provider value={[video, interactive]}><LessonAnimationAction chatId="lesson" sourceMessageId={sourceMessageId} /></JobsContext.Provider></VisualLearningContext.Provider>;
	await mount(view("explanation"));
	assert(host!.querySelector("video")); assert.equal(host!.querySelector("iframe"), null);
	const savedDemo = host!.querySelector<HTMLButtonElement>('button[aria-label="Show saved interactive demo"]');
	assert(savedDemo);
	await act(async () => savedDemo.click());
	assert(host!.querySelector("iframe")); assert.equal(host!.querySelector("video"), null); assert.equal(savedDemo.getAttribute("aria-pressed"), "true");
	assert.equal(generations, 0, "reopening a saved format does not spend another model call");
	await act(async () => root!.render(<VisualLearningProvider>{view("other-explanation")}</VisualLearningProvider>));
	assert.equal(host!.querySelector("iframe"), null); assert.equal(host!.querySelector("video"), null);
	await act(async () => root!.render(<VisualLearningProvider>{view("explanation")}</VisualLearningProvider>));
	assert(host!.querySelector("video"), "changing the explanation clears a deliberate saved selection");
	globalThis.fetch = async (_url, options) => options?.method === "POST" ? Response.json({ job: interactive }) : Response.json({ enabled: true });
	const generate = [...host!.querySelectorAll("button")].find(button => button.textContent === "Generate visual");
	assert(generate);
	await act(async () => generate.click());
	assert(host!.querySelector("iframe"), "a cached API response can reopen the older requested format too");
	assert.equal(host!.querySelector("video"), null);
});
