import React from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { newUserMessage, type LhMessage } from "../src/core/native-messages.ts";
import { isLessonAnimationRequest, visualTeachingRequest } from "../src/core/lesson-animation.ts";
import { queueLessonAnimation, queueRequestedVisual } from "../src/server/lesson-animation.ts";
import { createJobRunner } from "../src/agent/subagents/runner.ts";
import { LessonAnimationAction } from "../components/artifacts/lesson-animation.tsx";
import { JobsContext } from "../components/jobs-context.ts";
import type { ChatStore, JobStore } from "../src/core/ports.ts";
import type { ChatRecord, JobRecord } from "../src/core/contracts.ts";
import type { BlackboardArtifact, BlackboardPlan } from "../src/core/blackboard.ts";
import { validateAnimationInput } from "../src/agent/tools/animation.ts";

const text = "RAG retrieves relevant evidence before generating an answer. First split source documents into chunks and embed them into an index. At query time, embed the question, retrieve passages, and give the passages with the question to the language model.";
const plan: BlackboardPlan = { title: "RAG stages", beats: [{ kind:"flow", title:"Index documents", caption:"Chunk and embed source documents before questions arrive.", duration:5, nodes:[{id:"docs",label:"Documents"},{id:"index",label:"Vector index"}],edges:[{from:"docs",to:"index",label:"chunk and embed"}] },{kind:"flow",title:"Answer with evidence",caption:"Retrieve passages and give them to the model with the question.",duration:5,nodes:[{id:"query",label:"Question"},{id:"evidence",label:"Retrieved passages"},{id:"answer",label:"Grounded answer"}],edges:[{from:"query",to:"evidence"},{from:"evidence",to:"answer"}]}] };
const hash="b".repeat(64);
const artifact: BlackboardArtifact={id:hash,title:plan.title,url:`/api/blackboard/media/${hash}/video`,posterUrl:`/api/blackboard/media/${hash}/poster`,durationSeconds:10,sections:[],cacheHit:false,engine:"manimgx"};
test("a node explicitly named in another chapter can be reused without inventing labels",()=>{
	const crossBeat={...plan,beats:[plan.beats[0],{...plan.beats[1],edges:[{from:"index",to:"answer"}]}]};
	const normalized=validateAnimationInput(crossBeat);assert(normalized.beats[1]!.nodes!.some(n=>n.id==="index"&&n.label==="Vector index"));
	assert.equal(crossBeat.beats[1]!.nodes!.length,3);
	assert.throws(()=>validateAnimationInput({...plan,beats:[{...plan.beats[0],edges:[{from:"invented",to:"index"}]}]}),/invented/);
});
function fixture(request="Teach RAG visually") {
	const user=newUserMessage(request);
	const answer={...fauxAssistantMessage(text),id:"explanation"} as LhMessage;
	const chat={id:"lesson",title:"RAG",messages:[user,answer]} as ChatRecord;
	const rows:JobRecord[]=[];let spawned=0;
	const chatStore={getChat:(id:string)=>id===chat.id?chat:null} as ChatStore;
	const jobStore={listJobs:()=>rows,createJob:(init:object)=>{const j={...init,id:`job_${rows.length}`,status:"running",activity:"Starting",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()} as JobRecord;rows.push(j);return j;},getJob:(id:string)=>rows.find(j=>j.id===id)??null,updateJob:(id:string,patch:object)=>{const j=rows.find(j=>j.id===id);if(!j)return null;Object.assign(j,patch);return j;}} as unknown as JobStore;
	return {chat,user,answer,rows,chatStore,jobStore,spawn:()=>{spawned++;},spawns:()=>spawned};
}
test("visual teaching intent honors natural requests and explicit opt-out",()=>{
	for(const text of ["Teach me visually","Explain RAG visually","Generate an animation for this","Make animation for RAG","Show an animated board","Animate attention","render animation on architecture of neural network using Manimgx"]) assert(visualTeachingRequest([newUserMessage(text)]),text);
	for(const text of ["Explain RAG","What is the price of animation?","Do not generate an animation","Explain without visuals"]) assert.equal(visualTeachingRequest([newUserMessage(text)]),undefined,text);
	assert.equal(visualTeachingRequest([newUserMessage("Teach visually"),newUserMessage("No animation please")]),undefined);
});
test("queue uses saved explanation and goal, excludes reasoning and deduplicates repeated clicks",()=>{
	const f=fixture(); (f.answer.content as unknown[]).push({type:"thinking",thinking:"PRIVATE_REASONING"});
	const job=queueLessonAnimation(f,"lesson","explanation");assert(isLessonAnimationRequest(job.input));
	assert.match(job.input.context,/Teach RAG visually/);assert.match(job.input.context,/RAG retrieves/);assert.doesNotMatch(job.input.context,/PRIVATE_REASONING/);
	assert.equal(queueLessonAnimation(f,"lesson","explanation").id,job.id);assert.equal(f.spawns(),1);
	assert.throws(()=>queueLessonAnimation(f,"lesson",f.user.id),/saved explanation/);
	assert.throws(()=>queueLessonAnimation(f,"other","explanation"),/could not be found/);
});
test("automatic visual fallback runs once even with a pending question",()=>{
	const f=fixture(); f.chat.messages.push({...fauxAssistantMessage([fauxToolCall("quiz",{question:"What is retrieval?"},{id:"pending"})]),id:"quiz"} as LhMessage);
	const job=queueRequestedVisual(f,"lesson",new Set([f.answer.id,"quiz"]));assert(job);assert(isLessonAnimationRequest(job.input));assert.equal(job.input.intentMessageId,f.user.id);
	assert.equal(queueRequestedVisual(f,"lesson",new Set([f.answer.id])),undefined);assert.equal(f.spawns(),1);
});
test("native animation tool satisfies a visual request without a duplicate paid plan",()=>{
	const f=fixture();f.chat.messages.push({...fauxAssistantMessage([fauxToolCall("animation",plan,{id:"native"})]),id:"native"} as LhMessage);
	f.jobStore.createJob({kind:"animation",chatId:"lesson",toolCallId:"native",input:plan});
	assert.equal(queueRequestedVisual(f,"lesson",new Set([f.answer.id])),undefined);assert.equal(f.spawns(),0);
});
test("Practice also honors an explicit animation request instead of blocking on a problem",()=>{
	const f=fixture("render animation on architecture of neural network using Manimgx");f.chat.kind="practice";
	const job=queueRequestedVisual(f,"lesson",new Set([f.answer.id]));assert(job);assert(isLessonAnimationRequest(job.input));assert.equal(job.input.sourceMessageId,f.answer.id);
});
test("a question-only response still starts the requested board from the learner's goal",()=>{
	const f=fixture("Explain RAG visually");f.chat.messages=f.chat.messages.filter(m=>m.id!==f.answer.id);
	const question={...fauxAssistantMessage([fauxToolCall("quiz",{question:"What is retrieval?"},{id:"pending"})]),id:"quiz"} as LhMessage;f.chat.messages.push(question);
	const job=queueRequestedVisual(f,"lesson",new Set([question.id]));assert(job);assert(isLessonAnimationRequest(job.input));assert.equal(job.input.sourceMessageId,f.user.id);
});
test("an on-demand plan renders immediately, records usage and does not wake or wait for a quiz",async()=>{
	const f=fixture();const job=queueLessonAnimation(f,"lesson","explanation");
	const faux=createFauxCore({});faux.setResponses([fauxAssistantMessage([fauxToolCall("submit_animation",plan,{id:"submit"})],{stopReason:"toolUse"})]);
	let rendered=0,deliveries=0;
	const runner=createJobRunner({...f,animationEngineFor:()=>({model:faux.getModel(),streamFn:faux.streamSimple}),renderBlackboard:async received=>{assert.deepEqual(received,plan);rendered++;return artifact;},deliver:async()=>{deliveries++;}});
	await runner.runJob(job.id);assert.equal(job.status,"done");assert.equal(rendered,1);assert.equal(deliveries,0);assert.equal(job.delivery,undefined);assert.equal(job.usage?.steps,1);
	assert(isLessonAnimationRequest(job.input));assert.deepEqual(job.input.plan,plan);
});
test("recovery reuses the saved validated plan without another model request",async()=>{
	const f=fixture();const job=queueLessonAnimation(f,"lesson","explanation");assert(isLessonAnimationRequest(job.input));job.input.plan=plan;
	await createJobRunner({...f,animationEngineFor:()=>{throw Error("Must not spend again");},renderBlackboard:async()=>artifact,deliver:async()=>{throw Error("Must not wake");}}).runJob(job.id);
	assert.equal(job.status,"done");assert.equal(job.usage,undefined);
});
test("a missing provider fails visibly, and a retry creates one new job",async()=>{
	const f=fixture();const job=queueLessonAnimation(f,"lesson","explanation");
	await createJobRunner({...f,renderBlackboard:async()=>artifact,deliver:async()=>{throw Error("Must not wake");}}).runJob(job.id);
	assert.equal(job.status,"error");assert.match(job.error!,/teaching model/);
	const retry=queueLessonAnimation(f,"lesson","explanation",{retry:true});assert.notEqual(retry.id,job.id);assert.equal(queueLessonAnimation(f,"lesson","explanation",{retry:true}).id,retry.id);
});
test("chat offers a visual action and displays the finished local video inline",()=>{
	let html=renderToStaticMarkup(<LessonAnimationAction chatId="lesson" sourceMessageId="explanation"/>);assert.match(html,/Generate visual/);assert.doesNotMatch(html,/<video/);
	const f=fixture();const job=queueLessonAnimation(f,"lesson","explanation");job.status="done";job.result=artifact;
	html=renderToStaticMarkup(<JobsContext.Provider value={[job]}><LessonAnimationAction chatId="lesson" sourceMessageId="explanation"/></JobsContext.Provider>);
	assert.match(html,/<video/);assert.doesNotMatch(html,/Generate animation/);
});
