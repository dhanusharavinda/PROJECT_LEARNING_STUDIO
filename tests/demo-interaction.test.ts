import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import { interactionReportProblem, offlineDemoDocument, INTERACTIVE_DEMO_PROBE } from "../src/core/demo-quality.ts";
import { verifyDemo } from "../src/agent/subagents/demo-builder.ts";
import type { HeadlessApi } from "../src/agent/subagents/headless.ts";

const clean={ok:true,consoleErrors:[],pageErrors:[],failedRequests:[]};
const report={ok:true,checks:Array.from({length:8},(_,i)=>({label:`Control ${i}`,passed:true}))};
test("strict verification requires a report and turns failed controls into a failed run",async()=>{
	let options:unknown;
	const headless={runDemo:async(_html:string,opts:unknown)=>{options=opts;return{...clean,probeResult:{quality:report}};}} as unknown as HeadlessApi;
	assert.equal((await verifyDemo(headless,"<html></html>",true)).ok,true);
	assert.equal((options as {sandboxed:boolean}).sandboxed,true);assert.match((options as {probe:string}).probe,/__learningDemo/);
	const broken={...headless,runDemo:async()=>({...clean,probeResult:{quality:{ok:false,checks:[{label:"Slider updates underlying model",passed:false}]}}})};
	assert.equal((await verifyDemo(broken,"<html></html>",true)).ok,false);
	assert.equal((await verifyDemo({...headless,runDemo:async()=>clean},"<html></html>",true)).ok,false);
});
test("a false probe assertion cannot pass merely because the page did not throw",async()=>{
	const headless={runDemo:async()=>({...clean,probeResult:false})} as unknown as HeadlessApi;
	const result=await verifyDemo(headless,"<html></html>",false,"false");assert.equal(result.ok,false);assert.match(result.pageErrors[0]!,/returned false/);
});
test("saved strict documents block remote dependencies and malformed reports fail closed",()=>{
	const html=offlineDemoDocument("<!doctype html><canvas></canvas>");assert.match(html,/connect-src 'none'/);assert.match(html,/frame-src 'none'/);assert.match(html,/<canvas>/);
	assert(interactionReportProblem(undefined));assert(interactionReportProblem({ok:true,checks:[]}));assert.equal(interactionReportProblem(report),null);
});
test("reference gradient descent uses the correct derivatives and honestly detects divergence",()=>{
	const html=fs.readFileSync("public/studio/interactive/gradient-descent-3d.html","utf8");
	assert.match(html,/rate\*\.5\*y/);assert.match(html,/Diverging: reduce the learning rate/);assert.match(html,/not a literal view/);
	const advance=vm.runInNewContext("(x,y,rate)=>({x:x-rate*x,y:y-rate*.5*y})");
	const value=advance(2,3,.1);assert.equal(value.x,1.8);assert.equal(value.y,2.85);assert(Math.abs(advance(2,0,2.4).x)>2);
});
test("reference neural network derives visible values from weights and explicitly describes an untrained model",()=>{
	const html=fs.readFileSync("public/studio/interactive/neural-signal-flow.html","utf8");
	assert.match(html,/const hidden=sums\.map\(Math\.tanh\)/);assert.match(html,/contribution=matrix\[j\]\[i\]\*from\[i\]/);assert.match(html,/does not train the model/);assert.match(html,/finite differences/);
});
test("the interaction probe requires actual labeled parameter intervention and pause stability",()=>{
	assert.match(INTERACTIVE_DEMO_PROBE,/dispatchEvent\(new Event\('input'/);assert.match(INTERACTIVE_DEMO_PROBE,/Pause freezes numerical state/);assert.match(INTERACTIVE_DEMO_PROBE,/selfTest/);
});
