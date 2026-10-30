import assert from"node:assert/strict";import{test}from"node:test";
import{createFauxCore,fauxAssistantMessage,fauxToolCall,type FauxResponseStep,type TranscriptContext}from"@earendil-works/pi-ai";
import{reviewInteractiveDemo}from"../src/agent/subagents/demo-reviewer.ts";
import{runDemoBuilder}from"../src/agent/subagents/demo-builder.ts";
import type{HeadlessApi}from"../src/agent/subagents/headless.ts";

const clean={ok:true,pageErrors:[],consoleErrors:[],failedRequests:[]};
const verdict=(approved:boolean,issues:string[])=>fauxAssistantMessage([fauxToolCall("submit_demo_review",{approved,issues},{id:crypto.randomUUID()})],{stopReason:"toolUse"});

test("a provider interruption reports a useful retry action without fabricated HTML",async()=>{
	const faux=createFauxCore({});faux.setResponses([()=>{throw new Error("terminated");}]);
	const headless={available:()=>true,unavailableReason:()=>null} as unknown as HeadlessApi;
	const result=await runDemoBuilder({title:"Gradient",brief:"Teach descent."},{engine:{model:faux.getModel(),streamFn:faux.streamSimple},headless});
	assert.equal(result.html,"");assert.match(result.notes!,/provider interrupted generation/);assert.match(result.notes!,/Retry/);
});
function engine(responses:FauxResponseStep[]){const faux=createFauxCore({});faux.setResponses(responses);return{model:faux.getModel(),streamFn:faux.streamSimple};}
function instructions(context:TranscriptContext){return context.messages.flatMap(message=>message.role==="system"?[typeof message.content==="string"?message.content:message.content.map(part=>part.text).join("\n")]:[]).join("\n");}

test("the author and independent critic receive a visual-first compact instrument contract",async()=>{
	let authorPrompt="",reviewPrompt="";
	const html='<!doctype html><canvas aria-label="Loss surface"></canvas><label>Learning rate<input type="range"></label><details><summary>Derivation</summary>Full mathematics</details>';
	const author=engine([context=>{authorPrompt=instructions(context);return fauxAssistantMessage([fauxToolCall("write_demo",{html},{id:crypto.randomUUID()})],{stopReason:"toolUse"});},fauxAssistantMessage("Explore the learning rate.")]);
	const reviewer=engine([context=>{reviewPrompt=instructions(context);return verdict(true,[]);}]);
	const headless={available:()=>true,unavailableReason:()=>null,runDemo:async()=>clean} as unknown as HeadlessApi;
	const result=await runDemoBuilder({title:"Gradient descent",brief:"Explore the learning rate on a loss surface."},{engine:author,reviewEngine:reviewer,headless,maxSteps:3});
	assert.equal(result.html,html);
	assert.match(authorPrompt,/main working visualization first/);assert.match(authorPrompt,/primary controls directly beside or immediately below/);
	assert.match(authorPrompt,/720 px embed width/);assert.match(authorPrompt,/first 640 px/);assert.match(authorPrompt,/default-collapsed <details>/);assert.match(authorPrompt,/Preserve the full mathematics/);
	assert.match(reviewPrompt,/Reject a plot buried below an equation wall/);assert.match(reviewPrompt,/even when the mathematics is correct/);
	assert.match(reviewPrompt,/actual readable working visualization is visible in the initial viewport/);assert.match(reviewPrompt,/default-collapsed <details>/);
	assert.match(reviewPrompt,/Without usable pixels.*never claim visual confirmation/);
});
test("independent reviewer reports code-only scope when it did not receive usable pixels",async()=>{
	const e=engine([verdict(true,[])]);let calls=0;
	const review=await reviewInteractiveDemo({title:"Vector",brief:"Scale a vector",html:"<html></html>"},{engine:e,onUsage:()=>calls++});
	assert.equal(review.approved,true);assert.equal(review.scope,"code-only");assert.equal(calls,1);
});
test("inconsistent approval with unresolved issues is rejected",async()=>{
	const review=await reviewInteractiveDemo({title:"Vector",brief:"Scale a vector",html:"<html></html>"},{engine:engine([verdict(true,["The x component ignores the scale control."])])});assert.equal(review.approved,false);
});
test("a rejected demo is repaired, runtime-tested and independently reviewed again",async()=>{
	const draft='<!doctype html><p>Incorrect derivative</p>',fixed='<!doctype html><p>Correct derivative</p>';
	const write=(html:string)=>fauxAssistantMessage([fauxToolCall("write_demo",{html},{id:crypto.randomUUID()})],{stopReason:"toolUse"});
	const author=engine([write(draft),fauxAssistantMessage("Initial instrument."),write(fixed),fauxAssistantMessage("Repaired instrument.")]);
	const reviewer=engine([verdict(false,["Use derivative 2x for x squared."]),verdict(true,[])]);
	const runs:string[]=[];const headless={available:()=>true,unavailableReason:()=>null,runDemo:async(html:string)=>{runs.push(html);return clean;}} as unknown as HeadlessApi;
	const result=await runDemoBuilder({title:"Derivative",brief:"Teach x squared derivative."},{engine:author,reviewEngine:reviewer,headless,maxSteps:4});
	assert.equal(result.html,fixed);assert.deepEqual(runs,[draft,fixed]);assert.match(result.notes!,/Independent source review passed/);assert.match(result.notes!,/No visual review was possible/);
});
test("a persistent independent rejection never publishes the unapproved HTML",async()=>{
	const draft='<!doctype html><p>Wrong formula</p>';
	const write=()=>fauxAssistantMessage([fauxToolCall("write_demo",{html:draft},{id:crypto.randomUUID()})],{stopReason:"toolUse"});
	const author=engine([write(),fauxAssistantMessage("Done."),write(),fauxAssistantMessage("Done."),write(),fauxAssistantMessage("Done.")]);
	const reviewer=engine([verdict(false,["Wrong gradient."]),verdict(false,["Wrong gradient."]),verdict(false,["Wrong gradient."])]);
	const headless={available:()=>true,unavailableReason:()=>null,runDemo:async()=>clean} as unknown as HeadlessApi;
	const result=await runDemoBuilder({title:"Gradient",brief:"Teach descent."},{engine:author,reviewEngine:reviewer,headless,maxSteps:3});assert.equal(result.html,"");assert.match(result.notes!,/independent quality review: Wrong gradient/);
});

test("required visual review fails closed when browser pixels are unavailable", async () => {
	const html = "<!doctype html><p>Instrument</p>";
	const author = engine([fauxAssistantMessage([fauxToolCall("write_demo", { html }, { id: crypto.randomUUID() })], { stopReason: "toolUse" }), fauxAssistantMessage("Done.")]);
	const base = engine([verdict(true, [])]);
	const reviewer = { ...base, model: { ...base.model, input: ["text", "image"] as ("text" | "image")[] } };
	const headless = { available: () => true, unavailableReason: () => null, runDemo: async () => ({ ...clean, screenshotError: "Capture timed out" }) } as unknown as HeadlessApi;
	const result = await runDemoBuilder({ title: "Instrument", brief: "Explore a real numerical parameter." }, { engine: author, reviewEngine: reviewer, requireRenderReview: true, headless, maxSteps: 3 });
	assert.equal(result.html, ""); assert.match(result.notes!, /could not capture/); assert.match(result.notes!, /Capture timed out/);
});
