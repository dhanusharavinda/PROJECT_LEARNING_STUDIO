import assert from "node:assert/strict";
import { test } from "node:test";
import { Type } from "typebox";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { runSubmitAgent } from "../src/agent/subagents/submit-agent.ts";
import { OLLAMA_PROVIDER } from "../src/core/offline.ts";

function fixture(local: boolean, maxTurns = 4) {
	const faux=createFauxCore({});
	faux.setResponses([fauxAssistantMessage("I have inspected the context."),fauxAssistantMessage([fauxToolCall("submit_review",{value:7},{id:"submit"})],{stopReason:"toolUse"})]);
	const steps:number[]=[];
	return { steps, options:{role:"auditor" as const,toolName:"submit_review",toolDescription:"Submit the reviewed value.",parameters:Type.Object({value:Type.Number()}),fill:(v:{value:number})=>v,systemPrompt:"Review the input and submit the result.",prompt:"Review seven.",engine:{model:{...faux.getModel(),...(local?{provider:OLLAMA_PROVIDER}:{})},streamFn:faux.streamSimple},signal:undefined,onStep:(_u:unknown,_m:string,step:number)=>{steps.push(step);},neverSubmitted:"No review submitted",maxTurns} };
}
test("a local model receives one reminder and can submit without exceeding its original budget",async()=>{
	const f=fixture(true); const result=await runSubmitAgent(f.options);
	assert.equal(result.value,7); assert.deepEqual(f.steps,[1,2]);
});
test("cloud providers do not receive an additional paid retry",async()=>{
	const f=fixture(false); await assert.rejects(runSubmitAgent(f.options),/No review submitted/);
	assert.deepEqual(f.steps,[1]);
});
test("an exhausted local budget still fails honestly",async()=>{
	const f=fixture(true,1); await assert.rejects(runSubmitAgent(f.options),/No review submitted/);
	assert.deepEqual(f.steps,[1]);
});
