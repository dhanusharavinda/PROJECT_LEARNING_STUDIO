import { readSettings, writeSettings } from "../store/settings.ts";
import { createHash } from "node:crypto";
import { configureOfflinePolicy, localOllamaUrl, offlineSettings, offlineUrlAllowed, type OfflineSettings } from "../core/offline.ts";
import { desktopAPIAuthorized } from "./desktop-access.ts";
import { subscriptionRequestOrigin } from "./web-subscription-http.ts";
import type { CustomModel } from "../core/settings.ts";

const DEFAULT_URL = "http://127.0.0.1:11434";
configureOfflinePolicy(() => offlineSettings(readSettings()));
const state = globalThis as typeof globalThis & { __studioLocalFetch?: boolean };
if (!state.__studioLocalFetch) {
	const upstream = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		if (!offlineUrlAllowed(url)) throw new Error("Offline learning is on. Online services are paused; turn it off in Providers to use this service.");
		return upstream(input, offlineSettings(readSettings())?.enabled ? { ...init, redirect: "error" } : init);
	};
	state.__studioLocalFetch = true;
}

export function trustedOllamaRequest(req: Request): boolean {
	if (process.env.LH_DESKTOP_SERVER === "1" || process.env.LH_DESKTOP_API_SECRET) return desktopAPIAuthorized(req.headers);
	try { return req.headers.get("origin") === subscriptionRequestOrigin(req) && (!req.headers.has("sec-fetch-site") || req.headers.get("sec-fetch-site") === "same-origin"); }
	catch { return false; }
}
async function localJson(url: string, body?: object) {
	const res = await fetch(url, { method: body ? "POST" : "GET", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000), redirect: "error" });
	if (!res.ok) throw new Error("Ollama did not respond. Start Ollama and refresh the model list.");
	return res.json();
}
export async function localModels(baseUrl: string): Promise<CustomModel[]> {
	const base = localOllamaUrl(baseUrl);
	if (!base) throw new Error("Use a local Ollama address, such as http://127.0.0.1:11434.");
	const tags = await localJson(`${base}/api/tags`);
	const candidates = (Array.isArray(tags.models) ? tags.models : []).filter((m: { name?: string; size?: number }) => typeof m.name === "string" && !/cloud/i.test(m.name) && !m.name.startsWith("learning-studio-") && Number(m.size) > 1000000);
	const models = await Promise.all(candidates.map(async (m: { name: string }) => {
		const info = await localJson(`${base}/api/show`, { model: m.name });
		if (info.remote_host || info.remote_model || !info.capabilities?.includes("completion")) return null;
		return { id: m.name, image: info.capabilities.includes("vision"), reasoning: info.capabilities.includes("thinking"), context: 32768, maxTokens: 4096 } satisfies CustomModel;
	}));
	return models.filter((m): m is NonNullable<typeof m> => m !== null).sort((a,b) => a.id.localeCompare(b.id));
}
export async function ollamaGet(req: Request) {
	const saved = offlineSettings(readSettings());
	const baseUrl = new URL(req.url).searchParams.get("baseUrl") || saved?.baseUrl || DEFAULT_URL;
	try { return Response.json({ enabled: saved?.enabled === true, model: saved?.model || "", baseUrl, models: await localModels(baseUrl) }, { headers: { "cache-control": "no-store" } }); }
	catch (error) { return Response.json({ enabled: saved?.enabled === true, model: saved?.model || "", baseUrl, models: [], error: error instanceof Error ? error.message : "Start Ollama and refresh." }, { headers: { "cache-control": "no-store" } }); }
}
export async function ollamaPost(req: Request) {
	if (!trustedOllamaRequest(req)) return Response.json({ error: "A trusted local application request is required." }, { status: 403 });
	if (!req.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "JSON is required." }, { status: 415 });
	try {
		const raw = await req.text();
		if (raw.length > 4096) return Response.json({ error: "Settings request is too large." }, { status: 413 });
		const input = JSON.parse(raw);
		if (typeof input.enabled !== "boolean") throw new Error("Choose whether offline learning is on or off.");
		const record = readSettings() || { version: 1 };
		const saved = offlineSettings(record);
		if (!input.enabled) { writeSettings({ ...record, offline: { ...saved, enabled: false } }); return Response.json({ ok: true, enabled: false }); }
		const baseUrl = localOllamaUrl(typeof input.baseUrl === "string" ? input.baseUrl : saved?.baseUrl || DEFAULT_URL);
		const models = await localModels(baseUrl);
		const model = models.find(m => m.id === input.model);
		if (!model) throw new Error("Choose a downloaded local model. Cloud models cannot be used offline.");
		const runtimeModel = `learning-studio-${createHash("sha256").update(model.id + ":32768").digest("hex").slice(0,12)}`;
		const created = await fetch(`${baseUrl}/api/create`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: runtimeModel, from: model.id, parameters: { num_ctx: model.context, num_predict: model.maxTokens }, stream: false }), signal: AbortSignal.timeout(60000), redirect: "error" });
		if (!created.ok) throw new Error("Could not prepare the model context. Update Ollama and retry.");
		const creation = await created.json();
		if (creation.status !== "success") throw new Error(creation.error || "Ollama could not prepare this model.");
		const offline: OfflineSettings = { enabled: true, baseUrl, model: model.id, models, runtimeModel };
		const latest = readSettings() || { version: 1 };
		if (JSON.stringify(offlineSettings(latest)) !== JSON.stringify(saved)) return Response.json({ error: "Offline settings changed while connecting. Refresh and retry." }, { status: 409 });
		writeSettings({ ...latest, offline });
		return Response.json({ ok: true, ...offline });
	} catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not save offline learning." }, { status: 400 }); }
}
