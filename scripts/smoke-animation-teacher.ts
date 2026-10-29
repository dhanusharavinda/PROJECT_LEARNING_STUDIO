import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { PATHS } from "../config.ts";
import { createTeacherAgent } from "../src/agent/teacher-agent.ts";
import { createTeacherTools } from "../src/agent/tools.ts";
import { createJobRunner } from "../src/agent/subagents/runner.ts";
import { handleChatRequest, handleChatInput } from "../src/server/chat-handler.ts";
import { deliverJobResult, setTurnRunner } from "../src/server/jobs.ts";
import { runningTurn } from "../src/server/turn-runs.ts";
import { renderBlackboard, blackboardMediaResponse } from "../src/server/blackboard.ts";
import { chatStore } from "../src/store/chats.ts";
import { jobStore } from "../src/store/jobs.ts";
import type { AnimationResult } from "../src/core/contracts.ts";
import type { AgentBuildOptions } from "../src/agent/teacher-agent.ts";

if (!process.env.LH_DATA_DIR || !path.resolve(process.env.LH_DATA_DIR).startsWith(path.resolve("work") + path.sep)) throw Error("Set LH_DATA_DIR to an isolated project work directory.");
process.env.OPENROUTER_API_KEY = "synthetic-key-presence-only-no-network";
const plan = { title: "RAG: prepare, retrieve, answer", beats: [
	{ title: "Prepare sources", caption: "Indexing happens before answering: split source documents into chunks and create searchable embeddings.", kind: "flow", duration: 4, nodes: [{ id: "source", label: "Source documents" }, { id: "chunks", label: "Chunks" }, { id: "index", label: "Embedding index" }], edges: [{ from: "source", to: "chunks" }, { from: "chunks", to: "index" }] },
	{ title: "Retrieve and answer", caption: "At question time, retrieve relevant passages. Give the question and those passages to the language model, then cite the evidence.", kind: "flow", duration: 4, nodes: [{ id: "query", label: "Question" }, { id: "retrieve", label: "Retrieve passages" }, { id: "answer", label: "Answer with citations" }], edges: [{ from: "query", to: "retrieve" }, { from: "retrieve", to: "answer" }] },
] };
const faux = createFauxCore({ tokenSize: { min: 64, max: 64 } });
faux.setResponses([
	fauxAssistantMessage([fauxToolCall("animation", plan, { id: "rag_animation" })], { stopReason: "toolUse" }),
	fauxAssistantMessage("RAG retrieves relevant evidence and gives it to the model alongside your question. The indexing and answering stages are separate. We will use the two board chapters to check that distinction."),
	fauxAssistantMessage("Replay Retrieve and answer. What can go wrong if retrieval returns the wrong passage, even when the language model follows its instructions?"),
]);
const engine = { model: faux.getModel(), streamFn: faux.streamSimple };
const chat = chatStore.createChat("RAG integration verification (scripted provider)");
chatStore.saveSettings(chat.id, { model: { provider: "openrouter", id: "z-ai/glm-5.3-flash" } });
const runner = createJobRunner({ chatStore, jobStore, renderBlackboard, deliver: deliverJobResult });
const factory = (options: AgentBuildOptions) => createTeacherAgent(undefined, { engine, messages: options.messages, tools: createTeacherTools({ chatId: chat.id, chatStore, jobStore, spawn: (job, input) => void runner.runJob(job.id, input) }) });
setTurnRunner(async (id, input) => {
	const response = await handleChatInput(id, input, factory);
	return response.status;
});
const accepted = await handleChatRequest(new Request("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId: chat.id, input: { type: "text", text: "Explain RAG and show indexing separately from answering." } }) }), factory);
assert.equal(accepted.status, 200, await accepted.text());
const turn = runningTurn(chat.id);
if (turn) await new Response(turn.subscribe()).text();
const started = Date.now();
let done = jobStore.findJobByToolCallId(chat.id, "rag_animation");
while (Date.now() - started < 180000) {
	done = jobStore.findJobByToolCallId(chat.id, "rag_animation");
	if (done?.status === "error") throw Error(done.error || "Animation job failed");
	if (done?.status === "done" && done.delivery?.status === "delivered") break;
	await new Promise(r => setTimeout(r, 100));
}
assert.equal(done?.status, "done");
assert.equal(done.delivery?.status, "delivered", "The production delivery registry must acknowledge a persisted marker.");
const reloaded = chatStore.getChat(chat.id)!;
assert.equal(reloaded.messages.filter(message => (message as { customType?: string }).customType === "subagent-steer").length, 1);
const result = done.result as AnimationResult;
assert.equal(result.engine, "manimgx"); assert.equal(result.sections.length, 2);
const media = await blackboardMediaResponse(new Request("http://localhost" + result.url, { headers: { range: "bytes=0-99" } }), result.id, "video");
assert.equal(media.status, 206); assert.equal((await media.arrayBuffer()).byteLength, 100);
const poster = await blackboardMediaResponse(new Request("http://localhost" + result.posterUrl), result.id, "poster");
assert.equal(poster.status, 200);
const receipt = { checkedAt: new Date().toISOString(), chatId: chat.id, jobId: done.id, provider: "scripted local test provider, no DeepSeek API call", renderer: "actual ManimGX native runtime", dataRoot: PATHS.data, checks: ["Teacher tool call through HTTP turn handler", "Persisted job and context-specific plan", "Native rendered video", "Production result-delivery registry", "Persisted steer survives fresh disk read", "Two chapter positions", "Byte range playback and poster"], result };
await fs.mkdir("work", { recursive: true });
await fs.writeFile("work/native-animation-teacher.json", JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
