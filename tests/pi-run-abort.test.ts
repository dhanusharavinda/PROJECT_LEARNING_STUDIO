import assert from "node:assert/strict";
import { test } from "node:test";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import type { PiEngine } from "../src/agent/models.ts";
import { runSubagent } from "../src/agent/subagents/pi-run.ts";

function fixture() {
	const faux = createFauxCore({});
	faux.setResponses([fauxAssistantMessage("This synthetic provider response must never be requested.")]);
	let requests = 0;
	const engine: PiEngine = { model: faux.getModel(), streamFn: (model, context, options) => {
		requests++;
		return faux.streamSimple(model, context, options);
	} };
	return { engine, requests: () => requests };
}

for (const continuation of [false, true]) test(`a pre-aborted ${continuation ? "continuation" : "prompt"} cannot start inference`, async () => {
	const f = fixture();
	const controller = new AbortController(); controller.abort();
	let usage = 0;
	await assert.rejects(runSubagent([], { role: "visualMaker", engine: f.engine, systemPrompt: "Synthetic cancellation test.", maxTurns: 1, abortSignal: controller.signal, onUsage: () => { usage++; }, ...(continuation ? { messages: [] } : { prompt: "Do not dispatch." }) }), { name: "AbortError" });
	assert.equal(f.requests(), 0);
	assert.equal(usage, 0);
});

test("pre-aborted work refuses before resolving an absent provider", async () => {
	const controller = new AbortController(); controller.abort();
	await assert.rejects(runSubagent([], { role: "visualMaker", systemPrompt: "Synthetic cancellation test.", prompt: "Do not resolve a provider.", maxTurns: 1, abortSignal: controller.signal }), { name: "AbortError" });
});

test("cancellation during agent setup cannot miss the abort listener", async () => {
	const f = fixture();
	const controller = new AbortController();
	const engine: PiEngine = { get model() { controller.abort(); return f.engine.model; }, streamFn: f.engine.streamFn };
	await assert.rejects(runSubagent([], { role: "visualMaker", engine, systemPrompt: "Synthetic cancellation test.", prompt: "Do not dispatch after setup cancellation.", maxTurns: 1, abortSignal: controller.signal }), { name: "AbortError" });
	assert.equal(f.requests(), 0);
});
