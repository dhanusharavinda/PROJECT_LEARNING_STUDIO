import React from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { renderToStaticMarkup } from "react-dom/server";
import { VisualLearningContext, VisualLearningToggle } from "../components/visual-learning-toggle.tsx";
import { LessonAnimationAction, VISUAL_FORMATS, selectLessonVisualJob } from "../components/artifacts/lesson-animation.tsx";
import { AnimationCard, AnimationOutputCard } from "../components/artifacts/animation-card.tsx";
import { DemoCard, buildDemoSrcDoc, demoMotionScript } from "../components/artifacts/demo-card.tsx";
import { VisualCard } from "../components/artifacts/visual-card.tsx";
import { JobsContext } from "../components/jobs-context.ts";
import type { JobRecord } from "../src/core/contracts.ts";

const state=(enabled:boolean)=>({enabled,loaded:true,busy:false,error:"",setEnabled:async()=>{}});
const id="c".repeat(64);
const video={id,title:"A 3D quadratic",url:`/api/blackboard/media/${id}/video`,posterUrl:`/api/blackboard/media/${id}/poster`,durationSeconds:8,sections:[],cacheHit:false,engine:"manimgx",sourceCode:'class Lesson(m.ThreeDScene):\n    pass',verification:{threeD:true,layoutChecked:true,mathAssertions:2,visualReviewed:true,boundary:"restricted-scene-interpreter"}};
function job(kind:JobRecord["kind"],result:unknown,createdAt="2026-10-29T20:00:00Z"):JobRecord{return{id:"job_"+createdAt,kind,status:"done",chatId:"lesson",toolCallId:"direct",activity:"finished",createdAt,updatedAt:createdAt,input:{mode:"lesson-animation",sourceMessageId:"explanation",automatic:false,context:"A quadratic surface"},result};}

test("the header has one accessible animation switch with a visible state",()=>{
	const html=renderToStaticMarkup(<VisualLearningContext.Provider value={state(false)}><VisualLearningToggle/></VisualLearningContext.Provider>);
	assert.match(html,/role="switch"/);assert.match(html,/aria-label="Animations"/);assert.match(html,/aria-checked="false"/);assert.match(html,/>Off</);
});
test("motion off keeps static generation available and formats remain explicit",()=>{
	const html=renderToStaticMarkup(<VisualLearningContext.Provider value={state(false)}><LessonAnimationAction chatId="lesson" sourceMessageId="explanation"/></VisualLearningContext.Provider>);
	assert.match(html,/Generate diagram/);assert.match(html,/Choose visual format/);
	assert.deepEqual(VISUAL_FORMATS.map(f=>f.id),["auto","interactive","video","diagram"]);
});
test("a finished interactive job displays a sandboxed live document in the chat",()=>{
	const html=renderToStaticMarkup(<JobsContext.Provider value={[job("demo",{title:"Change the learning rate",html:'<html><body><label>Learning rate<input type="range"/></label></body></html>',tested:true})]}><LessonAnimationAction chatId="lesson" sourceMessageId="explanation"/></JobsContext.Provider>);
	assert.match(html,/<iframe/);assert.match(html,/sandbox="allow-scripts"/);assert.doesNotMatch(html,/allow-same-origin/);assert.match(html,/View code/);assert.match(html,/Copy code/);
});
test("newest completed visuals win over an older failed request in newest-first feeds",()=>{
	const newer=job("animation",video,"2026-10-29T21:00:00Z"),older={...job("animation",undefined),status:"error" as const,error:"Old render error"};
	const html=renderToStaticMarkup(<JobsContext.Provider value={[newer,older]}><LessonAnimationAction chatId="lesson" sourceMessageId="explanation"/></JobsContext.Provider>);
	assert.match(html,/<video/);assert.doesNotMatch(html,/Old render error/);
});
test("local request state cannot pin an older result or leak into a different explanation",()=>{
	const older=job("animation",video),newer=job("demo",{title:"An interactive view",html:"<p>Ready</p>",tested:true},"2026-10-29T22:00:00Z");
	assert.equal(selectLessonVisualJob([newer,older],"explanation",older)?.id,newer.id);
	assert.equal(selectLessonVisualJob([],"different-explanation",older),null);
	assert.equal(selectLessonVisualJob([newer,older],"explanation",newer,{sourceMessageId:"explanation",jobId:older.id})?.id,older.id,"an intentional saved-format selection can reopen an older result");
	assert.equal(selectLessonVisualJob([newer,older],"explanation",older,{sourceMessageId:"different-explanation",jobId:older.id})?.id,newer.id,"a choice on another explanation does not pin this one");
	const pending={...newer,status:"running" as const};
	assert.equal(selectLessonVisualJob([older],"explanation",pending)?.id,pending.id,"a new local request remains visible before its feed update");
});
test("advanced scene source is collapsed and verification scope is explicit",()=>{
	const html=renderToStaticMarkup(<VisualLearningContext.Provider value={state(false)}><AnimationOutputCard output={video}/></VisualLearningContext.Provider>);
	assert.match(html,/Animations paused/);assert.match(html,/<details/);assert.doesNotMatch(html,/<details[^>]* open/);assert.match(html,/2 numeric checks executed/);assert.match(html,/do not prove every mathematical claim/);
});
test("native teacher visuals are usable while delivery waits behind a quiz, then yield to the saved steer",()=>{
	const demo=job("demo",{title:"Signals in a network",html:"<html><body><canvas></canvas></body></html>",tested:true});demo.delivery={kind:"result",status:"pending"};
	const animation: JobRecord={...job("animation",video),delivery:{kind:"result",status:"pending"}};
	const diagram: JobRecord={...job("visual",{title:"A dependency",svg:'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text x="4" y="20">A to B</text></svg>'}),delivery:{kind:"result",status:"pending"}};
	const part={toolCallId:"direct",state:"output-available",type:"tool-demo"} as never;
	const render=(record:JobRecord,kind:"demo"|"animation"|"visual")=>renderToStaticMarkup(<VisualLearningContext.Provider value={state(false)}><JobsContext.Provider value={[record]}>{kind==="demo"?<DemoCard part={part}/>:kind==="visual"?<VisualCard part={part}/>:<AnimationCard part={part}/>}</JobsContext.Provider></VisualLearningContext.Provider>);
	assert.match(render(demo,"demo"),/<iframe/);assert.match(render(animation,"animation"),/<video/);assert.match(render(diagram,"visual"),/data-testid="visual-card"/);
	demo.delivery.status="delivered";animation.delivery!.status="delivered";diagram.delivery!.status="delivered";
	assert.doesNotMatch(render(demo,"demo"),/<iframe/);assert.doesNotMatch(render(animation,"animation"),/<video/);assert.doesNotMatch(render(diagram,"visual"),/data-testid="visual-card"/);
	delete demo.delivery;assert.doesNotMatch(render(demo,"demo"),/<iframe/,"legacy delivered artifacts must not be replayed");
});
test("motion policy precedes authored code and preserves an earlier document CSP",()=>{
	const document='<meta http-equiv="Content-Security-Policy" content="connect-src none"><html><head></head><body><script>window.authored=true;</script></body></html>';
	const html=buildDemoSrcDoc(document,false);
	assert(html.indexOf('Content-Security-Policy')<html.indexOf('nextFrame=1'));
	assert(html.indexOf('learning-motion-change')<html.indexOf('window.authored=true'));
	assert.match(html,/demo-resize/);
});

test("pausing freezes frame and timer work, preserves state, and resumes without a clock jump",()=>{
	let now=0,next=1;const frameQueue=new Map<number,(time:number)=>void>(),timerQueue=new Map<number,()=>void>(),intervalQueue=new Map<number,()=>void>(),listeners=new Map<string,(event:any)=>void>();
	class ElementStub { animate(){return{pause(){},play(){}};} }
	const context:any={performance:{now:()=>now},Map,Array,CustomEvent:class {detail:unknown;constructor(public type:string,options:{detail:unknown}){this.detail=options.detail;}},Element:ElementStub,parent:{},document:{createElement:()=>({textContent:""}),head:{appendChild(){}},documentElement:{dataset:{}},addEventListener(){},querySelectorAll:()=>[],getAnimations:()=>[],dispatchEvent(){}},requestAnimationFrame:(fn:(time:number)=>void)=>{const id=next++;frameQueue.set(id,fn);return id;},cancelAnimationFrame:(id:number)=>{frameQueue.delete(id);},setTimeout:(fn:()=>void)=>{const id=next++;timerQueue.set(id,fn);return id;},clearTimeout:(id:number)=>timerQueue.delete(id),setInterval:(fn:()=>void)=>{const id=next++;intervalQueue.set(id,fn);return id;},addEventListener:(type:string,fn:(event:any)=>void)=>listeners.set(type,fn)};
	context.window=context;context.dispatchEvent=(event:{type:string})=>listeners.get(event.type)?.(event);
	vm.runInNewContext(demoMotionScript(true).replace(/^<script>|<\/script>$/g,""),context);
	const frame=(time:number)=>{const pending=[...frameQueue.values()];frameQueue.clear();pending.forEach(fn=>fn(time));};
	const send=(enabled:boolean,source=context.parent)=>listeners.get("message")!({source,data:{type:"learning-motion",enabled}});
	const observed:number[]=[];let intervals=0,timeouts=0;const model={rate:.3,x:4};
	let modelMotionAllowed=true;context.addEventListener("learning-motion-change",(event:{detail:{enabled:boolean}})=>{modelMotionAllowed=event.detail.enabled;});
	context.requestAnimationFrame((time:number)=>observed.push(time));frame(10);now=10;send(false);
	assert.equal(modelMotionAllowed,false,"authored window listeners receive the pause event");
	context.requestAnimationFrame((time:number)=>observed.push(time));context.setInterval(()=>intervals++,10);context.setTimeout(()=>timeouts++,5);
	[...intervalQueue.values()].forEach(fn=>fn());const due=[...timerQueue.values()];timerQueue.clear();due.forEach(fn=>fn());frame(100);
	assert.equal(intervals,0);assert.equal(timeouts,0);assert.deepEqual(observed,[10]);assert.deepEqual(model,{rate:.3,x:4});
	now=100;assert.equal(context.performance.now(),10,"model clocks stay frozen while animation is paused");
	send(true,{});assert.equal(context.__learningMotionEnabled,false);
	now=110;send(true);frame(120);[...timerQueue.values()].forEach(fn=>fn());[...intervalQueue.values()].forEach(fn=>fn());
	assert.equal(modelMotionAllowed,true,"authored window listeners receive the resume event");
	assert.deepEqual(observed,[10,20]);assert.equal(timeouts,1);assert.equal(intervals,1);assert.deepEqual(model,{rate:.3,x:4});
});
