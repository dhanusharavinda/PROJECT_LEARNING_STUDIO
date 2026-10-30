import React from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { jobTools } from "../src/agent/tools/jobs.ts";
import { validateAnimationInput } from "../src/agent/tools/animation.ts";
import { createTeacherTools, createProberTools } from "../src/agent/tools.ts";
import { composeInstructions } from "../src/agent/teacher-agent.ts";
import { createJobRunner } from "../src/agent/subagents/runner.ts";
import { buildSubagentSteer, isSubagentFailure, type JobRecord, type SteerMessage } from "../src/core/contracts.ts";
import type { ChatStore, JobStore, CreateJobInit, JobPatch } from "../src/core/ports.ts";
import type { BlackboardPlan, BlackboardArtifact } from "../src/core/blackboard.ts";
import { AnimationOutputCard } from "../components/artifacts/animation-card.tsx";
import { fireJobAbort } from "../src/agent/subagents/aborts.ts";

const plan: BlackboardPlan = { title: "RAG: indexing and answering", beats: [
	{ title: "Prepare documents", caption: "Chunk source text and index its embeddings before the question arrives.", kind: "flow", duration: 3, nodes: [{ id: "documents", label: "Documents" }, { id: "index", label: "Search index" }], edges: [{ from: "documents", to: "index", label: "chunk and embed" }] },
	{ title: "Answer with evidence", caption: "Retrieve relevant passages, then give those passages and the question to the model.", kind: "text", duration: 3 },
] };
const hash = "a".repeat(64);
const artifact: BlackboardArtifact = { id: hash, title: plan.title, url: `/api/blackboard/media/${hash}/video`, posterUrl: `/api/blackboard/media/${hash}/poster`, durationSeconds: 6, sections: [{ title: "Prepare documents", start: 0, end: 3 }, { title: "Answer with evidence", start: 3, end: 6 }], cacheHit: false, engine: "manimgx" };

function fixtures() {
	const rows = new Map<string, JobRecord>();
	const jobStore = {
		createJob(init: CreateJobInit) { const job: JobRecord = { ...init, id: `job_${rows.size}`, status: "running", activity: "starting", createdAt: "2026-10-29T00:00:00Z", updatedAt: "2026-10-29T00:00:00Z" }; rows.set(job.id, job); return job; },
		getJob(id: string) { return rows.get(id) ?? null; },
		updateJob(id: string, patch: JobPatch) { const old = rows.get(id); if (!old) return null; const next = { ...old, ...patch }; rows.set(id, next); return next; },
		findJobByToolCallId(chatId: string, callId: string) { return [...rows.values()].find(j => j.chatId === chatId && j.toolCallId === callId) ?? null; },
		listJobs() { return [...rows.values()]; },
	} as unknown as JobStore;
	const chatStore = { getChat: () => ({ id: "lesson", messages: [] }) } as unknown as ChatStore;
	return { rows, jobStore, chatStore };
}

describe("Animated teacher board", () => {
	it("validates context-specific plans before creating jobs", () => {
		assert.deepEqual(validateAnimationInput(plan), plan);
		assert.throws(() => validateAnimationInput({ ...plan, beats: [{ ...plan.beats[0], edges: [{ from: "unknown", to: "index" }] }] }));
		assert.throws(() => validateAnimationInput({ ...plan, code: "import os" }));
	});
	it("dispatches once per tool call and persists the complete teaching plan", async () => {
		const f = fixtures(); let spawns = 0;
		const tools = jobTools({ chatId: "lesson", jobStore: f.jobStore, spawn: () => { spawns++; } });
		await tools.animation!.execute!("call_animation", plan, undefined, undefined);
		await tools.animation!.execute!("call_animation", plan, undefined, undefined);
		assert.equal(spawns, 1); assert.equal(f.rows.size, 1);
		assert.deepEqual([...f.rows.values()][0]?.input, plan);
	});
	it("renders and delivers through the job pipeline without another model call", async () => {
		const f = fixtures(); const delivered: SteerMessage[] = [];
		const job = f.jobStore.createJob({ kind: "animation", chatId: "lesson", toolCallId: "animate", input: plan });
		const runner = createJobRunner({ ...f, engineFor: () => { throw Error("A second model should not be needed"); }, renderBlackboard: async (received, options) => { assert.deepEqual(received, plan); options.onProgress("Rendering chapter 2"); return artifact; }, deliver: async steer => { delivered.push(steer); } });
		await runner.runJob(job.id);
		assert.equal(f.jobStore.getJob(job.id)?.status, "done");
		assert.deepEqual(f.jobStore.getJob(job.id)?.result, artifact);
		assert.equal(delivered.length, 1);
		assert.match(delivered[0]!.content as string, /ask a prediction or application question/);
	});
	it("reports rendering failure rather than fabricating a ready video", async () => {
		const f = fixtures(); const delivered: SteerMessage[] = [];
		const job = f.jobStore.createJob({ kind: "animation", chatId: "lesson", toolCallId: "bad", input: plan });
		const runner = createJobRunner({ ...f, renderBlackboard: async () => { throw Error("Render timed out"); }, deliver: async steer => { delivered.push(steer); } });
		await runner.runJob(job.id);
		assert.equal(f.jobStore.getJob(job.id)?.status, "error");
		assert.match(delivered[0]!.content as string, /Render timed out/);
		assert.match(delivered[0]!.content as string, /Continue teaching in prose/);
	});
	it("provides chapters and native playback while rejecting external video URLs", () => {
		const html = renderToStaticMarkup(<AnimationOutputCard output={artifact} />);
		assert.match(html, /<video/); assert.match(html, /controls/); assert.match(html, /Animation chapters/); assert.match(html, /Answer with evidence/);
		const unsafe = renderToStaticMarkup(<AnimationOutputCard output={{ ...artifact, url: "https://example.com/track.mp4" }} />);
		assert.doesNotMatch(unsafe, /<video/);
	});
	it("cancellation cannot resurrect a job or deliver a stale artifact", async () => {
		const f = fixtures(); let deliveries = 0;
		const job = f.jobStore.createJob({ kind: "animation", chatId: "lesson", toolCallId: "cancel", input: plan });
		let entered!: () => void;
		const started = new Promise<void>(resolve => { entered = resolve; });
		const runner = createJobRunner({ ...f, deliver: async () => { deliveries++; }, renderBlackboard: async (_plan, options) => {
			entered(); await new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(Error("Canceled")), { once: true })); return artifact;
		} });
		const running = runner.runJob(job.id); await started;
		f.jobStore.updateJob(job.id, { status: "error", error: "Aborted by learner" }); fireJobAbort(job.id); await running;
		assert.equal(f.jobStore.getJob(job.id)?.error, "Aborted by learner");
		assert.equal(deliveries, 0); assert.equal(f.jobStore.getJob(job.id)?.result, undefined);
	});
	it("grounds the tool in lesson context and checks learning after playback", () => {
		const prompt = composeInstructions("teacher");
		assert.match(prompt, /prediction/);
		assert.match(prompt, /formulas, assumptions/);
		assert.match(prompt, /title.*brief/);
	});
	it("defines completion as an artifact, not proof of learning", () => {
		assert.equal(isSubagentFailure("animation", artifact), false);
		const steer = buildSubagentSteer({ id: "a", kind: "animation", toolCallId: "call" }, artifact);
		assert.match(steer.content as string, /Watching does not establish understanding/);
	});
	it("is teacher-only, and can be switched off without removing questions", () => {
		const f = fixtures(); const ctx = { chatId: "lesson", ...f, spawn: () => {} };
		assert.ok(createTeacherTools(ctx).animation);
		assert.equal(createTeacherTools(ctx, { animation: false }).animation, undefined);
		assert.ok(createTeacherTools(ctx, { animation: false }).quiz);
		assert.equal(createProberTools({ ...ctx, deliver: async () => {} }).animation, undefined);
	});
});
