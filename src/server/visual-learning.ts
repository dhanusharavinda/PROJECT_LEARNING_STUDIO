import { readSettings, writeSettings } from "../store/settings.ts";
import { visualLearningEnabled } from "../core/visual-learning.ts";
import { trustedOllamaRequest } from "./ollama.ts";
export function visualLearningGet() { return Response.json({ enabled: visualLearningEnabled(readSettings()) }, { headers: { "cache-control": "no-store" } }); }
export async function visualLearningPost(request: Request) {
	if (!trustedOllamaRequest(request)) return Response.json({ error: "Change this setting from the application." }, { status: 403 });
	if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: "JSON is required." }, { status: 415 });
	try {
		const raw = await request.text(); if (raw.length > 256) return Response.json({ error: "Settings request is too large." }, { status: 413 });
		const input = JSON.parse(raw); if (typeof input?.enabled !== "boolean") return Response.json({ error: "Choose whether animations are enabled." }, { status: 400 });
		const latest = readSettings() || { version: 1 };
		writeSettings({ ...latest, visualLearning: { enabled: input.enabled } });
		return visualLearningGet();
	} catch { return Response.json({ error: "Could not save the animation setting. Try again." }, { status: 400 }); }
}
