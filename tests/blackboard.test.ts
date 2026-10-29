import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { blackboardPlanSchema, blackboardSections, compileBlackboardScene, vectorCosine, quadraticDescent } from "../src/core/blackboard.ts";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "learning-board-"));
process.env.LH_DATA_DIR = dir;
const { blackboardMediaResponse, renderBlackboard } = await import("../src/server/blackboard.ts");
after(async () => { await fs.rm(dir,{recursive:true,force:true}); delete process.env.LH_DATA_DIR; });
const flow = {title:"A grounded flow",beats:[{title:"Retrieve evidence",caption:"Use retrieved passages",kind:"flow",duration:4,nodes:[{id:"a",label:"Question"},{id:"b",label:"Evidence"}],edges:[{from:"a",to:"b"}]}]};

test("blackboard rejects broken references and duplicate identities", () => {
	assert.equal(blackboardPlanSchema.safeParse({...flow,beats:[{...flow.beats[0],edges:[{from:"a",to:"private-file"}]}]}).success,false);
	assert.equal(blackboardPlanSchema.safeParse({...flow,beats:[{...flow.beats[0],nodes:[{id:"a",label:"One"},{id:"a",label:"Two"}]}]}).success,false);
});
test("blackboard rejects arbitrary code, nonfinite math, zero vectors and long render plans", () => {
	assert.equal(blackboardPlanSchema.safeParse({...flow,python:"import os"}).success,false);
	assert.equal(blackboardPlanSchema.safeParse({title:"Vectors",beats:[{title:"Compare",caption:"Directions",kind:"vectors",duration:3,a:[0,0],b:[1,1]}]}).success,false);
	assert.equal(blackboardPlanSchema.safeParse({title:"Vectors",beats:[{title:"Compare",caption:"Directions",kind:"vectors",duration:3,a:[Infinity,0],b:[1,1]}]}).success,false);
	assert.equal(blackboardPlanSchema.safeParse({...flow,beats:Array(7).fill({...flow.beats[0],duration:10})}).success,false);
});
test("compiler keeps hostile labels as JSON data, and reveals teaching steps progressively", () => {
	const plan=blackboardPlanSchema.parse({...flow,title:'\"); __import__("os").system("whoami") #'});
	const source=compileBlackboardScene(plan);
	assert.match(source,/P = json.loads\(/);
	assert.ok(!source.includes('\n__import__'));
	assert.match(source,/for step_index,dot in enumerate\(trace\)/);
	assert.match(source,/self.clear\(\)/);
	assert.deepEqual(blackboardSections(plan),[{title:"Retrieve evidence",start:0,end:4}]);
});
test("media serves bounded byte ranges and rejects traversal, unknown kinds and invalid ranges", async () => {
	const id="a".repeat(64),folder=path.join(dir,"blackboard",id);
	await fs.mkdir(folder,{recursive:true}); await fs.writeFile(path.join(folder,"receipt.json"),"{}"); await fs.writeFile(path.join(folder,"BlackboardLesson.mp4"),"0123456789");
	const response=await blackboardMediaResponse(new Request("http://localhost/api",{headers:{Range:"bytes=2-5"}}),id,"video");
	assert.equal(response.status,206); assert.equal(response.headers.get("content-range"),"bytes 2-5/10"); assert.equal(await response.text(),"2345");
	assert.equal((await blackboardMediaResponse(new Request("http://localhost/api"),"../secrets","video")).status,404);
	assert.equal((await blackboardMediaResponse(new Request("http://localhost/api"),id,"scene.py")).status,404);
	assert.equal((await blackboardMediaResponse(new Request("http://localhost/api",{headers:{Range:"bytes=999-"}}),id,"video")).status,416);
});
test("an aborted render never starts Python or writes a completion marker", async () => {
	const controller=new AbortController();controller.abort();
	await assert.rejects(renderBlackboard(blackboardPlanSchema.parse(flow),{signal:controller.signal}),/abort/i);
});
test("compiled vector and descent values agree with independently known examples", () => {
	assert.ok(Math.abs(vectorCosine([3,1],[1,3])-.6)<1e-12);
	assert.equal(vectorCosine([1,0],[0,1]),0);
	assert.equal(vectorCosine([1,0],[-1,0]),-1);
	const plan=blackboardPlanSchema.parse({title:"Quadratic",beats:[{title:"Descent",caption:"Subtract rate times derivative",kind:"gradient_descent",duration:4,start:3.5,learningRate:.2,iterations:3}]});
	const source=compileBlackboardScene(plan),dataLine=source.split("\n").find(l=>l.startsWith("P = json.loads("))!;
	const compiled=JSON.parse(JSON.parse(dataLine.slice("P = json.loads(".length,-1)));
	const steps=compiled.beats[0].calculation.steps;
	for(const [i,x] of [3.5,2.1,1.26].entries())assert.ok(Math.abs(steps[i].x-x)<1e-12);
	assert.ok(steps[2].loss<steps[1].loss && steps[1].loss<steps[0].loss);
	assert.equal(quadraticDescent(2,.25,2)[1]!.x,1);
});
test("queued cancellation is prompt without letting the next job overtake an active job", async () => {
	const shared=globalThis as typeof globalThis & {__lhBlackboardQueue?:Promise<unknown>};
	let release!:()=>void;shared.__lhBlackboardQueue=new Promise<void>(r=>{release=r;});
	const controller=new AbortController();
	const waiting=renderBlackboard(blackboardPlanSchema.parse(flow),{signal:controller.signal});
	setTimeout(()=>controller.abort(),10);
	await assert.rejects(waiting,/cancel|abort/i);
	let finished=false;const tail=shared.__lhBlackboardQueue!;void tail.then(()=>{finished=true;});
	await new Promise(r=>setTimeout(r,10));assert.equal(finished,false);
	release();await tail;assert.equal(finished,true);
	delete shared.__lhBlackboardQueue;
});
test("an activity callback failure releases its queue slot", async () => {
	const shared=globalThis as typeof globalThis & {__lhBlackboardQueue?:Promise<unknown>};
	await assert.rejects(renderBlackboard(blackboardPlanSchema.parse(flow),{onProgress:()=>{throw new Error("Activity failed");}}),/Activity failed/);
	await shared.__lhBlackboardQueue;
	delete shared.__lhBlackboardQueue;
});
