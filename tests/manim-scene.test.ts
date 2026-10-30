import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { after, test } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { runManimSceneBuilder } from "../src/agent/subagents/manim-scene-builder.ts";
import type { ManimSceneArtifact } from "../src/core/manim-scene.ts";
import type { PiEngine } from "../src/agent/models.ts";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "learning-manim-source-"));
const previousData = process.env.LH_DATA_DIR;
const previousPython = process.env.LH_MANIMGX_PYTHON;
async function resolveTestPython() {
	const portable = path.resolve(".runtime/manimgx-portable", process.platform === "win32" ? "python.exe" : "bin/python3");
	const candidates = previousPython ? [previousPython] : [portable, process.platform === "win32" ? "python" : "python3"];
	for (const candidate of candidates) {
		try {
			const { stdout } = await promisify(execFile)(candidate, ["-I", "-c", "import sys; print(sys.executable)"], { windowsHide: true, timeout: 10_000 });
			return stdout.trim();
		} catch (error) {
			if (previousPython) throw error;
		}
	}
	throw new Error("Manim scene tests require Python with runtime/manimgx-requirements.txt installed. Set LH_MANIMGX_PYTHON to its executable.");
}
const testPython = await resolveTestPython();
process.env.LH_DATA_DIR = directory;
process.env.LH_MANIMGX_PYTHON = testPython;
const { validateManimSource, manimReviewPlan } = await import("../src/server/manim-scene.ts");
after(async () => {
	await fs.rm(directory, { recursive: true, force: true });
	if (previousData === undefined) delete process.env.LH_DATA_DIR; else process.env.LH_DATA_DIR = previousData;
	if (previousPython === undefined) delete process.env.LH_MANIMGX_PYTHON; else process.env.LH_MANIMGX_PYTHON = previousPython;
});
const source = `import manimgx as m
import numpy as np
class LearningScene(m.ThreeDScene):
    def construct(self):
        result=np.dot([2,3],[4,5])
        assert result==23
        axes=m.ThreeDAxes()
        surface=m.Surface(lambda u,v:axes.c2p(u,v,u*u+v*v),u_range=(-2,2),v_range=(-2,2),resolution=(20,20))
        self.set_camera_orientation(phi=60*m.DEGREES,theta=-45*m.DEGREES)
        self.add(axes)
        self.play(m.Create(surface),run_time=2)
`;
test("restricted scene language accepts computed 3D surfaces and assertions", async () => {
	await validateManimSource(source);
});
test("review samples cover every chapter and the end without growing with play count", () => {
	const sections = Array.from({ length: 9 }, (_,i) => ({ title: `Chapter ${i+1}`, start: i*5, end: (i+1)*5 }));
	const plan = manimReviewPlan(45, sections);
	assert.equal(plan.samples.length, 12);
	assert.equal(plan.sectionCount, 9); assert.equal(plan.coveredSections, 9);
	assert.equal(plan.samples.at(-1)?.moment, "end");
	assert.ok(plan.samples.some(s => s.seconds > 40), "the final chapter must be visible");
	assert.ok(plan.samples.every((sample,i) => i===0 || sample.seconds > plan.samples[i-1]!.seconds));
	const crowded = manimReviewPlan(60, Array.from({ length: 30 }, (_,i) => ({ title: `Chapter ${i+1}`, start: i*2, end: (i+1)*2 })));
	assert.equal(crowded.samples.length, 12); assert.equal(crowded.coveredSections, 12);
	assert.equal(manimReviewPlan(.0005).samples.length, 1);
});
test("Windows native process limit remains enforced with practical rendering headroom", async () => {
	if (process.platform !== "win32") return;
	const probe = `import runpy,sys
worker=runpy.run_path(sys.argv[1])
worker['limits']()
limits=worker['resource_measurement']()
assert limits['memoryLimitBytes']==4*1024*1024*1024
assert limits['cpuSecondsLimit']==120
assert limits['peakProcessBytes']>0
`;
	await promisify(execFile)(testPython, ["-I", "-c", probe, path.resolve("src/server/manim-scene-worker.py")], { windowsHide: true });
});
test("restricted scene language rejects filesystem, imports, reflection, typesetter file options and unbounded loops", async () => {
	const prohibited = [
		source.replace("import numpy as np", "import os"),
		source.replace("result=np.dot([2,3],[4,5])", "result=open('secret.txt').read()"),
		source.replace("result=np.dot([2,3],[4,5])", "result=m.Text.__init__.__globals__"),
		source.replace("result=np.dot([2,3],[4,5])", "result='{0.construct.__globals__}'.format(self)"),
		source.replace("result=np.dot([2,3],[4,5])", "result='{value.__class__}'.format_map({'value':self})"),
		source.replace("axes=m.ThreeDAxes()", "axes=m.ImageMobject('secret.png')"),
		source.replace("axes=m.ThreeDAxes()", "axes=m.Text('x',font_paths=['C:/secret'])"),
		source.replace("axes=m.ThreeDAxes()", "axes=m.Text('x',typst_preamble='arbitrary markup')"),
		source.replace("axes=m.ThreeDAxes()", "axes=m.Text('x',package_path='C:/secret')"),
		source.replace("axes=m.ThreeDAxes()", "while True: pass"),
		source.replace("axes=m.ThreeDAxes()", "axes=m.Speech('Use a paid voice')"),
		source.replace("axes=m.ThreeDAxes()", "axes=m.Typst('#read(\"secret.txt\")')"),
		source.replace("def construct(self):", "def render(self):"),
		source.replace("assert result==23", "assert True"),
		source.replace("assert result==23", "result=result+1"),
		source.replace("axes=m.ThreeDAxes()", "import math"),
	];
	for (const code of prohibited) await assert.rejects(validateManimSource(code));
});
test("runtime gates evaluated typesetter strings and nested constructor options", async () => {
	const probe = `import runpy,sys
worker=runpy.run_path(sys.argv[1])
rejected=worker['SceneRejected']
checked=worker['checked_label']
constructor=worker['guard_label_constructor']
capability=worker['guarded_capability']
def must_reject(function):
    try: function()
    except rejected: return
    raise AssertionError('The capability boundary accepted a prohibited value')
for text in ['#re'+'ad("secret.txt")', '#im'+'port "secret.typ": *', chr(92)+'in'+'put{secret.txt}', chr(92)+'cs'+'name input'+chr(92)+'endcsname']:
    must_reject(lambda: checked(text,latex=True))
def original(instance,*args,**kwargs): return args
must_reject(lambda: constructor(original,latex=True)(None,chr(92)+'in'+'put{secret.txt}'))
key='typst_'+'preamble'
must_reject(lambda: capability(lambda **kwargs: kwargs)(element_to_mobject_config={key:'#read("secret.txt")'}))
must_reject(lambda: capability(lambda **kwargs: kwargs)(alignment='left); #let f=re'+'ad; #f("secret"); #set align(left'))
assert checked(chr(92)+'frac{1}{2}'+chr(92)+'sum_{i=0}^{n} x_i',latex=True)
assert constructor(original,latex=True)(None,chr(92)+'begin{pmatrix}1 & 2 '+chr(92)+chr(92)+' 3 & 4'+chr(92)+'end{pmatrix}')
`;
	await promisify(execFile)(testPython, ["-I", "-c", probe, path.resolve("src/server/manim-scene-worker.py")], { windowsHide: true });
});
test("separate scene stages reset numeric sampling before evaluating the source", async () => {
	const sampleSource = `import manimgx as m
import numpy as np
sample=np.random.uniform()
class LearningScene(m.Scene):
    def construct(self):
        assert abs(sample-0.5488135039273248)<1e-12
`;
	const sourceFile = path.join(directory, "seed-source.json");
	await fs.writeFile(sourceFile, JSON.stringify({ sourceCode: sampleSource }));
	const probe = `import runpy,sys,types,numpy as np
np.random.seed(int(sys.argv[3]))
worker=runpy.run_path(sys.argv[1])
scene=worker['load_scene'](sys.argv[2],'learning_seed_probe')
# Exercise the generated computation without constructing a renderer or GPU scene.
scene.construct(types.SimpleNamespace(time=0))
`;
	for (const [stage, priorSeed] of [["inspect", "17"], ["poster", "23"], ["render", "31"]]) {
		const folder = path.join(directory, stage!); await fs.mkdir(folder);
		await promisify(execFile)(testPython, ["-I", "-c", probe, path.resolve("src/server/manim-scene-worker.py"), sourceFile, priorSeed!], { windowsHide: true, cwd: folder });
	}
});
const hash="c".repeat(64);
const artifact: ManimSceneArtifact = { id:hash,title:"3D surface",url:`/api/blackboard/media/${hash}/video`,posterUrl:`/api/blackboard/media/${hash}/poster`,durationSeconds:2,sections:[],cacheHit:false,engine:"manimgx",sourceCode:source,verification:{boundary:"restricted-scene-interpreter",mathAssertions:1,layoutChecked:false,threeD:true,visualReviewed:false} };
const png=await fs.readFile("public/studio/rag-preview.png");
function fixture(responses: ReturnType<typeof fauxAssistantMessage>[]) {
	const faux=createFauxCore({});faux.setResponses(responses);
	return { model:{...faux.getModel(),input:["text","image"] as ("text"|"image")[]},streamFn:faux.streamSimple };
}
const write=()=>fauxAssistantMessage([fauxToolCall("write_scene",{sourceCode:source},{id:"write"})],{stopReason:"toolUse"});
const inspect=()=>fauxAssistantMessage([fauxToolCall("inspect_scene",{},{id:"inspect"})],{stopReason:"toolUse"});
const approve=()=>fauxAssistantMessage([fauxToolCall("approve_scene",{explanation:"The generated surface shows the actual quadratic function and a readable mathematical label.",checks:["The independently known dot product is 23."]},{id:"approve"})],{stopReason:"toolUse"});
test("scene builder delivers only after native render and a subsequent visual review",async()=>{
	let renderCalls=0;
	const result=await runManimSceneBuilder({title:"3D surface",brief:"Teach a quadratic loss surface."},{engine:fixture([write(),inspect(),approve()]),validateSource:async()=>{},renderScene:async()=>{renderCalls++;return artifact;},storyboard:async()=>png});
	assert.equal(renderCalls,1);assert.equal(result.verification.visualReviewed,true);assert.match(result.reviewNotes!,/dot product/);
});
test("native authoring keeps real playback controls outside the rendered video",async()=>{
	const scripted=fixture([write(),inspect(),approve()]);let prompt="";
	const engine:PiEngine={...scripted,streamFn:(model,context,options)=>{prompt=JSON.stringify(context);return scripted.streamFn(model,context,options);}};
	await runManimSceneBuilder({title:"A parameter comparison",brief:"Compare learning rates in a directed video."},{engine,validateSource:async()=>{},renderScene:async()=>artifact,storyboard:async()=>png});
	assert.match(prompt,/video with no live controls/);
	assert.match(prompt,/Never draw pretend interactive buttons, sliders/);
	assert.match(prompt,/application supplies the real video playback UI/);
	assert.match(prompt,/interaction is central.*interactive HTML/s);
});
test("a premature approval cannot skip seeing the actual render",async()=>{
	const sameStep=fauxAssistantMessage([fauxToolCall("inspect_scene",{},{id:"inspect"}),fauxToolCall("approve_scene",{explanation:"I am approving before looking at any native image.",checks:["The dot product equals 23."]},{id:"premature"})],{stopReason:"toolUse"});
	const result=await runManimSceneBuilder({title:"3D surface",brief:"Teach a quadratic."},{engine:fixture([write(),sameStep,approve()]),validateSource:async()=>{},renderScene:async()=>artifact,storyboard:async()=>png});
	assert.equal(result.verification.visualReviewed,true);
});
test("a failed native render never becomes a delivered scene",async()=>{
	await assert.rejects(runManimSceneBuilder({title:"3D surface",brief:"Teach a quadratic."},{engine:fixture([write(),inspect(),approve()]),maxSteps:3,validateSource:async()=>{},renderScene:async()=>{throw Error("bad geometry");},storyboard:async()=>png}),/Last diagnostic:.*bad geometry/s);
});
test("independent reviewer rejection gates delivery even when the author can see images",async()=>{
	const reviewer=fixture([fauxAssistantMessage([fauxToolCall("submit_scene_review",{accept:false,issues:["The key moving point is hidden behind the surface."],explanation:"The opaque surface obscures the gradient descent marker."},{id:"review"})],{stopReason:"toolUse"})]);
	await assert.rejects(runManimSceneBuilder({title:"3D surface",brief:"Teach a quadratic."},{engine:fixture([write(),inspect(),approve()]),visionEngine:reviewer,maxSteps:3,validateSource:async()=>{},renderScene:async()=>artifact,storyboard:async()=>png}),/moving point is hidden/);
});
test("independent review usage and provenance use the actual reviewer model",async()=>{
	const reviewer=fixture([fauxAssistantMessage([fauxToolCall("submit_scene_review",{accept:true,issues:[],explanation:"The labels, visible geometry and the computed example are consistent."},{id:"review"})],{stopReason:"toolUse"})]);
	reviewer.model={...reviewer.model,id:"independent-vision-reviewer"};
	const usageModels:string[]=[];
	const result=await runManimSceneBuilder({title:"3D surface",brief:"Teach a quadratic."},{engine:fixture([write(),inspect(),approve()]),visionEngine:reviewer,validateSource:async()=>{},renderScene:async()=>artifact,storyboard:async()=>png,onReviewUsage:(_usage,modelId)=>{usageModels.push(modelId);}});
	assert.match(result.verification.reviewModel!,/:independent-vision-reviewer$/);
	assert.ok(usageModels.length>0);
	assert.ok(usageModels.every(id=>id.endsWith(":independent-vision-reviewer")));
});
test("abort is honored without delivering or inventing media",async()=>{
	const controller=new AbortController();controller.abort();
	await assert.rejects(runManimSceneBuilder({title:"3D surface",brief:"Teach a quadratic."},{engine:fixture([write(),inspect(),approve()]),abortSignal:controller.signal,validateSource:async()=>{},renderScene:async()=>artifact,storyboard:async()=>png}),/abort/i);
});

test("an approval with unresolved independent review issues remains rejected", async () => {
	const reviewer = fixture([fauxAssistantMessage([fauxToolCall("submit_scene_review", {
		accept: true,
		issues: ["The computed gradient arrow points uphill instead of downhill."],
		explanation: "The scene renders, but the update direction misrepresents gradient descent.",
	}, { id: "inconsistent-review" })], { stopReason: "toolUse" })]);
	await assert.rejects(runManimSceneBuilder({ title: "3D surface", brief: "Teach gradient descent." }, {
		engine: fixture([write(), inspect(), approve()]), visionEngine: reviewer, maxSteps: 3,
		validateSource: async () => {}, renderScene: async () => artifact, storyboard: async () => png,
	}), (error: unknown) => {
		assert(error instanceof Error);
		assert.match(error.message, /Independent visual review: needs correction/);
		assert.match(error.message, /gradient arrow points uphill/);
		return true;
	});
});
