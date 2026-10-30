import assert from "node:assert/strict";
import { test,after } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { LhMessage } from "../src/core/native-messages.ts";
import { createFauxCore,fauxAssistantMessage,fauxToolCall } from "@earendil-works/pi-ai";
import type { HeadlessApi } from "../src/agent/subagents/headless.ts";
import type { ChatRecord,JobRecord } from "../src/core/contracts.ts";
import type { ChatStore,JobStore } from "../src/core/ports.ts";
const dir=await fs.mkdtemp(path.join(os.tmpdir(),"studio-visual-learning-"));process.env.LH_DATA_DIR=dir;process.env.LH_IGNORE_ENV_KEYS="1";
// Set the filesystem seam before loading any transitive config dependency.
const {visualLearningEnabled}=await import("../src/core/visual-learning.ts");
const {resolveSettings}=await import("../src/core/settings-resolution.ts");
const {accumulateJobUsage}=await import("../src/core/contracts/jobs.ts");
const {jobCost}=await import("../src/core/prices.ts");
const {jobTools}=await import("../src/agent/tools/jobs.ts");
const {newUserMessage}=await import("../src/core/native-messages.ts");
const {createJobRunner}=await import("../src/agent/subagents/runner.ts");
const {headlessOverride}=await import("../src/agent/subagents/headless.ts");
const {queueLessonAnimation,queueRequestedVisual}=await import("../src/server/lesson-animation.ts");
const {visualLearningPost,visualLearningGet}=await import("../src/server/visual-learning.ts");
const {writeSettings,readSettings}=await import("../src/store/settings.ts");
after(async()=>{delete headlessOverride.current;await fs.rm(dir,{recursive:true,force:true});});
function request(body:unknown,origin="http://localhost"){return new Request("http://localhost/api/visual-learning",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(body)});}
test("animation switch preserves model preferences and blocks untrusted changes",async()=>{
	writeSettings({version:1,models:{strong:{model:{provider:"test",id:"quality"}}},graph:{enabled:true}});const before=readSettings();
	assert.equal((await visualLearningPost(request({enabled:false},"https://evil.example"))).status,403);
	assert.equal((await visualLearningPost(request({enabled:false}))).status,200);assert.equal((await visualLearningGet().json()).enabled,false);assert.deepEqual(readSettings()?.models,before?.models);assert.deepEqual(readSettings()?.graph,before?.graph);
	assert.equal((await visualLearningPost(request({enabled:"yes"}))).status,400);assert.equal((await visualLearningPost(request({enabled:true}))).status,200);assert(visualLearningEnabled(readSettings()));
});
test("off disables new motion tools while retaining static diagrams and saved choices",()=>{
	const s={version:1,agent:{tools:{research:false}},visualLearning:{enabled:false}};
	const effective=resolveSettings(s);assert.equal(effective.agent.tools.animation,false);assert.equal(effective.agent.tools.demo,false);assert.notEqual(effective.agent.tools.visual,false);assert.equal(effective.agent.tools.research,false);assert.deepEqual(s.agent.tools,{research:false});
});
test("mixed author and review calls retain actual model prices",()=>{
	const author=accumulateJobUsage(undefined,"author:pro",{inputTokens:10,outputTokens:5});
	const reviewed=accumulateJobUsage(author,"review:vision",{inputTokens:4,outputTokens:3});
	assert.equal(reviewed.model,"author:pro");assert.equal(reviewed.calls?.[1]?.model,"review:vision");assert.equal(jobCost({usage:reviewed},(_u,m)=>m==="author:pro"?2:7),9);
	const subscription=accumulateJobUsage(undefined,"chatgpt:test",{inputTokens:10});const plusApi=accumulateJobUsage(subscription,"review:vision",{inputTokens:3});assert.equal(jobCost({usage:plusApi},()=>7),7);
});
function fixture(){
	const chat={id:"lesson",title:"Gradient descent",messages:[newUserMessage("Help me understand learning rate in gradient descent."),{...fauxAssistantMessage("For f(x)=x squared, the gradient is 2x. Updating x by subtracting the learning rate times 2x contracts toward zero when the rate is between zero and one. The learner should change that rate and observe convergence or divergence."),id:"explanation"}]} as ChatRecord;
	const rows:JobRecord[]=[];const chatStore={getChat:()=>chat} as unknown as ChatStore;
	const jobStore={listJobs:()=>rows,createJob:(init:object)=>{const row={...init,id:"job_"+rows.length,status:"running",activity:"starting",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}as JobRecord;rows.push(row);return row;},getJob:(id:string)=>rows.find(j=>j.id===id)??null,updateJob:(id:string,patch:object)=>{const row=rows.find(j=>j.id===id);if(!row)return null;Object.assign(row,patch);return row;},findJobByToolCallId:(_c:string,id:string)=>rows.find(j=>j.toolCallId===id)??null} as unknown as JobStore;
	return{chatStore,jobStore,rows,chat,spawn:()=>{}};
}
test("the native animation tool accepts an unrestricted-template conceptual scene brief",async()=>{
	const f=fixture();const tools=jobTools({chatId:"lesson",...f});
	await tools.animation!.execute!("call",{title:"A 3D loss surface",brief:"Show a 3D quadratic loss surface, derive its gradient and animate a computed descent trajectory. Check an independent gradient example."},undefined,undefined);
	assert.equal((f.rows[0]?.input as {mode:string}).mode,"manim-scene");
});

test("a provider-consent refusal terminates a native demo instead of leaving it running",async()=>{
	const f=fixture();const job=f.jobStore.createJob({kind:"demo",chatId:"lesson",toolCallId:"demo",input:{title:"Descent",brief:"Change the rate."}});
	const runner=createJobRunner({...f,animationEngineFor:()=>{throw Error("Background provider use needs consent");},deliver:async()=>{}});
	await runner.runJob(job.id);assert.equal(job.status,"error");assert.match(job.error!,/consent/);
});

test("the animation switch also blocks previously queued structured animations",async()=>{
	const f=fixture();const job=f.jobStore.createJob({kind:"animation",chatId:"lesson",toolCallId:"old",input:{title:"Saved plan",beats:[]}});let rendered=false;
	await createJobRunner({...f,visualAnimationsEnabled:()=>false,renderBlackboard:async()=>{rendered=true;throw Error("Must not render");},deliver:async()=>{}}).runJob(job.id);
	assert.equal(rendered,false);assert.equal(job.status,"error");assert.match(job.error!,/Animations are off/);
});

test("an explicitly stopped native visual is not replaced by the automatic fallback",()=>{
	const f=fixture();const intent=f.chat.messages[0]!;intent.content=[{type:"text",text:"Explain gradient descent visually with an interactive simulation."}];
	f.chat.messages.push({...fauxAssistantMessage([fauxToolCall("demo",{title:"Descent",brief:"Calculate a trajectory."},{id:"stopped-visual"})]),id:"dispatch"}as LhMessage);
	const job=f.jobStore.createJob({kind:"demo",chatId:"lesson",toolCallId:"stopped-visual",input:{title:"Descent",brief:"Calculate a trajectory."}});
	f.jobStore.updateJob(job.id,{status:"error",error:"Aborted by learner"});let spawns=0;
	queueRequestedVisual({...f,spawn:()=>{spawns++;}},"lesson",new Set(["dispatch"]));assert.equal(spawns,0);assert.equal(f.rows.length,1);
});
test("a contextual auto request selects and immediately delivers a tested interactive instrument",async()=>{
	const f=fixture();const job=queueLessonAnimation(f,"lesson","explanation");job.usage=accumulateJobUsage(undefined,"earlier:paid",{inputTokens:9,outputTokens:3});const faux=createFauxCore({});
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("choose_visual",{format:"interactive",title:"Learning rate and convergence",brief:"Build an interactive f(x)=x squared gradient descent instrument. The learning rate changes the actual update x = x - rate * 2x. Show values, a plot, pause/step/reset controls and verify derivative and convergence examples."},{id:"direction"})],{stopReason:"toolUse"}),
		fauxAssistantMessage([fauxToolCall("write_demo",{html:"<!doctype html><html><body><canvas></canvas><input type='range'></body></html>"},{id:"write"})],{stopReason:"toolUse"}),
		fauxAssistantMessage([fauxToolCall("run_demo",{},{id:"run"})],{stopReason:"toolUse"}),fauxAssistantMessage("The verified controls change the numerical model."),
		fauxAssistantMessage([fauxToolCall("submit_demo_review",{approved:true,issues:[]},{id:"review"})],{stopReason:"toolUse"})]);
	headlessOverride.current={unavailableReason:()=>null,available:()=>true,runDemo:async()=>({ok:true,consoleErrors:[],pageErrors:[],failedRequests:[],probeResult:{quality:{ok:true,checks:Array.from({length:8},(_,i)=>({label:"check"+i,passed:true}))}}})} as unknown as HeadlessApi;
	let deliveries=0;const runner=createJobRunner({...f,animationEngineFor:()=>({model:faux.getModel(),streamFn:faux.streamSimple}),manimSceneRuntime:{validateSource:async()=>{},renderScene:async()=>{throw Error("Interactive must not render a video");},storyboard:async()=>Buffer.from("")},deliver:async()=>{deliveries++;}});
	await runner.runJob(job.id);assert.equal(job.status,"done",JSON.stringify(job));assert.equal(job.kind,"demo");assert.match((job.result as {html:string}).html,/Content-Security-Policy/);assert.equal(deliveries,0);assert.equal(job.delivery,undefined);assert.equal(job.usage?.steps,6);assert.equal(job.usage?.calls?.[0]?.inputTokens,9);delete headlessOverride.current;
});

test("per-tool settings reject explicit formats at the manual route", async () => {
	const { lessonAnimationPost } = await import("../src/server/chat-handler.ts");
	writeSettings({ version: 1, agent: { tools: { demo: false, animation: false, visual: false } } });
	for (const mode of ["interactive", "video", "diagram", "auto"]) {
		const response = await lessonAnimationPost(new Request("http://localhost/api/chats/missing/animation", {
			method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
			body: JSON.stringify({ sourceMessageId: "explanation", mode }),
		}), "missing");
		assert.equal(response.status, 409, mode);
		assert.match((await response.json()).error, /turned off/);
	}
});

test("queued native formats stop before model admission when their tools are disabled", async () => {
	for (const kind of ["demo", "animation", "visual"] as const) {
		const f = fixture();
		const job = f.jobStore.createJob({ kind, chatId: "lesson", toolCallId: `disabled-${kind}`, input: kind === "animation" ? { mode: "manim-scene", title: "Descent", brief: "Explain computed gradient descent." } : { title: "Descent", brief: "Explain computed gradient descent." } });
		let admitted = 0;
		await createJobRunner({ ...f, visualFormatEnabled: () => false, animationEngineFor: () => { admitted++; throw Error("Must not admit a disabled format"); }, engineFor: () => { admitted++; throw Error("Must not admit a disabled format"); }, deliver: async () => {} }).runJob(job.id);
		assert.equal(admitted, 0, kind); assert.equal(job.status, "error", kind); assert.match(job.error!, /turned off/);
	}
});

test("automatic visual fallback is restricted to the remaining static format", async () => {
	const f = fixture();
	f.chat.messages[0]!.content = [{ type: "text", text: "Explain gradient descent visually." }];
	const job = queueRequestedVisual(f, "lesson", new Set(["explanation"])); assert(job);
	const faux = createFauxCore({});
	const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160" viewBox="0 0 320 160"><text x="20" y="80">Gradient points uphill.</text></svg>';
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("choose_visual", { format: "interactive", title: "Unavailable simulation", brief: "An interactive numerical illustration of gradient descent with a learning rate control and independently checked update formula." }, { id: "disabled-direction" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("choose_visual", { format: "diagram", title: "Descent direction", brief: "Show a static quadratic curve with a point, its upward gradient and the opposite downward update direction. Label the gradient and update clearly with the actual equation." }, { id: "available-direction" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("write_svg", { svg }, { id: "svg" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("render_svg", {}, { id: "render" })], { stopReason: "toolUse" }),
		fauxAssistantMessage("The static diagram explains why updates oppose the gradient."),
	]);
	const model = { ...faux.getModel(), input: ["text", "image"] as ("text" | "image")[] };
	const png = await fs.readFile("public/studio/rag-preview.png");
	let svgRenders = 0;
	headlessOverride.current = { available: () => true, unavailableReason: () => null, renderSvg: async () => { svgRenders++; return png; }, runDemo: async () => { throw Error("A disabled interactive instrument must not run"); } } as unknown as HeadlessApi;
	try {
		await createJobRunner({ ...f, visualFormatEnabled: format => format === "diagram", animationEngineFor: () => ({ model, streamFn: faux.streamSimple }), manimSceneRuntime: { validateSource: async () => { throw Error("A disabled video must not run"); }, renderScene: async () => { throw Error("A disabled video must not render"); }, storyboard: async () => png }, deliver: async () => {} }).runJob(job.id);
		assert.equal(job.status, "done", JSON.stringify(job)); assert.equal(job.kind, "visual"); assert.equal(svgRenders, 1); assert.equal((job.result as { svg: string }).svg, svg);
		assert.equal(job.usage?.steps, 5, "The unavailable first direction must be rejected rather than dispatched");
	} finally { delete headlessOverride.current; }
});

test("the director rejects video plans above the native cap and carries the valid duration into the brief", async () => {
	const { directLessonVisual } = await import("../src/agent/subagents/visual-director.ts");
	const faux = createFauxCore({});
	const plan = { format: "video", title: "Learning rate comparison", brief: "Compare two fixed learning rates for the same quadratic descent update, label the actual step values, and show why one trajectory overshoots while the other converges." };
	faux.setResponses([
		fauxAssistantMessage([fauxToolCall("choose_visual", { ...plan, durationSeconds: 220 }, { id: "too-long" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxToolCall("choose_visual", { ...plan, durationSeconds: 35 }, { id: "bounded" })], { stopReason: "toolUse" }),
	]);
	let calls = 0, context = "";
	const direction = await directLessonVisual("Explain the effect of a learning rate using a short directed animation.", "video", { model: faux.getModel(), streamFn: (model, transcript, options) => { context = JSON.stringify(transcript); return faux.streamSimple(model, transcript, options); } }, { signal: new AbortController().signal, onUsage: () => { calls++; }, chatId: "synthetic-video-duration" });
	assert.equal(calls, 2); assert.equal(direction.durationSeconds, 35);
	assert.match(direction.brief, /total target duration of 35 seconds/); assert.match(direction.brief, /application supplies the real playback controls/);
	assert.match(context, /strict total cap of 120 seconds/); assert.match(context, /Never ask the video author to draw pretend sliders or buttons/);
});
