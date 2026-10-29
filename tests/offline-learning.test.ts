import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, afterEach, test } from "node:test";
import { configureOfflinePolicy, localOllamaUrl, offlineProviderAllowed, offlineSettings, offlineUrlAllowed, OLLAMA_PROVIDER } from "../src/core/offline.ts";
import { resolveConversationSpec, resolveRoleSpec, resolveSettings } from "../src/core/settings-resolution.ts";
import type { UserSettings } from "../src/core/settings.ts";
import { createModels } from "@earendil-works/pi-ai";

const parent = path.resolve("work/testdata"); fs.mkdirSync(parent,{recursive:true});
const root = fs.mkdtempSync(path.join(parent,"offline-"));
process.env.LH_DATA_DIR = path.join(root,"data"); process.env.LH_AUTH_FILE = path.join(root,"auth.json");
fs.writeFileSync(process.env.LH_AUTH_FILE,"{}");
const { readSettings, writeSettings } = await import("../src/store/settings.ts");
const { localModels, ollamaPost } = await import("../src/server/ollama.ts");
const { piEngineForSpec } = await import("../src/agent/models.ts");
const { buildOpenAiCompatibleProvider } = await import("../src/server/custom-provider.ts");
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; writeSettings({version:1}); configureOfflinePolicy(() => offlineSettings(readSettings())); });
after(() => { assert.equal(path.dirname(root),parent); fs.rmSync(root,{recursive:true,force:true}); });

const source: UserSettings = { version:1, models:{strong:{model:{provider:"deepseek",id:"deepseek-v4-pro"}},cheap:{model:{provider:"deepseek",id:"deepseek-flash"}}}, agent:{models:{researcher:{model:{provider:"openai",id:"saved-model"}}}}, offline:{enabled:true,baseUrl:"http://127.0.0.1:11434",model:"chosen-at-runtime:9b",models:[{id:"chosen-at-runtime:9b",image:true}]} };
test("offline routing overrides conversation and role pins without overwriting cloud choices", () => {
	const before = JSON.stringify(source), effective = resolveSettings(source);
	assert.equal(resolveRoleSpec("researcher",source)?.provider,OLLAMA_PROVIDER);
	assert.equal(effective.models.vision?.id,"chosen-at-runtime:9b");
	assert.equal(resolveConversationSpec({model:{provider:"openai",id:"saved-chat"}},effective.models.strong,true)?.provider,OLLAMA_PROVIDER);
	assert.equal(effective.agent.tools.research,false);
	assert.equal(JSON.stringify(source),before);
	const online = {...source,offline:{...source.offline as object,enabled:false}};
	assert.equal(resolveRoleSpec("researcher",online)?.provider,"openai");
	assert.equal(resolveSettings(online).models.strong?.id,"deepseek-v4-pro");
	assert.equal(resolveConversationSpec({model:{provider:OLLAMA_PROVIDER,id:"saved-local"}},resolveSettings(online).models.strong)?.provider,"deepseek");
});
test("only local server addresses are accepted, without credentials or redirects", () => {
	assert.equal(localOllamaUrl("http://localhost:11434/"),"http://localhost:11434");
	for(const url of ["https://ollama.com","http://localhost.evil.test","http://user@localhost:11434","http://127.0.0.1:11434/v1","file:///tmp"] ) assert.equal(localOllamaUrl(url),"");
});
test("offline policy blocks cloud engines and URLs but permits local media and inference", () => {
	configureOfflinePolicy(() => offlineSettings(source));
	assert.equal(offlineProviderAllowed("deepseek"),false);
	assert.equal(offlineUrlAllowed("https://api.deepseek.com/chat/completions"),false);
	assert.equal(offlineUrlAllowed("http://127.0.0.1:11434/v1/chat/completions"),true);
	assert.equal(offlineUrlAllowed("data:image/png;base64,AA"),true);
	assert.throws(()=>piEngineForSpec({provider:"deepseek",id:"deepseek-flash"}),/Offline learning/);
});
test("local models use Ollama-compatible system messages, token limits, and explicit thinking control", () => {
	const registry=createModels();
	registry.setProvider(buildOpenAiCompatibleProvider({providerId:OLLAMA_PROVIDER,baseUrl:"http://127.0.0.1:11434/v1",models:[{id:"runtime-choice",image:true,reasoning:true}]}));
	const model=registry.getModel(OLLAMA_PROVIDER,"runtime-choice")!;
	const compat=model.compat as {supportsDeveloperRole?:boolean;supportsStore?:boolean;maxTokensField?:string};
	assert.equal(compat.supportsDeveloperRole,false);
	assert.equal(compat.supportsStore,false);
	assert.equal(compat.maxTokensField,"max_tokens");
	assert.equal(model.thinkingLevelMap?.off,"none");
	assert(model.input.includes("image"));
});
test("the installed server fetch guard rejects remote calls before transmission", async () => {
	writeSettings(source);
	await assert.rejects(originalFetch("https://example.invalid/offline-check"),/Offline learning/);
});
function request(body: object, trusted=true) { return new Request("http://localhost/api/ollama",{method:"POST",headers:{"content-type":"application/json",...(trusted?{origin:"http://localhost"}:{})},body:JSON.stringify(body)}); }
function stubOllama() {
	const calls: {url:string; body:unknown}[]=[];
	globalThis.fetch = (async (input,init) => {
		const url=String(input), body=init?.body?JSON.parse(String(init.body)):undefined; calls.push({url,body});
		if(url.endsWith("/api/tags")) return Response.json({models:[{name:"chosen-at-runtime:9b",size:6000000000},{name:"remote:cloud",size:400},{name:"disguised-remote",size:6000000000}]});
		if(url.endsWith("/api/show")) return Response.json(body.model==="disguised-remote"?{remote_host:"https://ollama.com",capabilities:["completion"]}:{capabilities:["completion","vision"]});
		if(url.endsWith("/api/create")) return Response.json({status:"success"});
		assert.fail(`Unexpected endpoint ${url}`);
	}) as typeof fetch;
	return calls;
}
test("discovery excludes cloud and renamed remote models", async () => {
	stubOllama(); const models=await localModels("http://127.0.0.1:11434");
	assert.deepEqual(models.map(m=>m.id),["chosen-at-runtime:9b"]); assert.equal(models[0]?.image,true);
});
test("enabling and disabling offline learning preserves cloud configuration and requires a local selected model", async () => {
	const {offline:_offline,...cloud}=source; writeSettings(cloud); const calls=stubOllama();
	assert.equal((await ollamaPost(request({enabled:true,model:"chosen-at-runtime:9b"},false))).status,403);
	assert.equal((await ollamaPost(request({enabled:true,model:"remote:cloud"}))).status,400);
	assert.deepEqual(readSettings(),cloud);
	assert.equal((await ollamaPost(request({enabled:true,model:"chosen-at-runtime:9b"}))).status,200);
	assert.deepEqual(readSettings()?.models,cloud.models);
	assert.equal(offlineSettings(readSettings())?.model,"chosen-at-runtime:9b");
	assert.match(offlineSettings(readSettings())?.runtimeModel||"",/^learning-studio-/);
	assert(calls.some(c=>c.url.endsWith("/api/create")));
	globalThis.fetch=(async()=>{throw Error("Ollama is stopped");}) as typeof fetch;
	assert.equal((await ollamaPost(request({enabled:false}))).status,200);
	assert.equal(offlineSettings(readSettings())?.enabled,false);
	assert.deepEqual(readSettings()?.models,cloud.models);
});
