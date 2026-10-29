"use client";
import { useCallback, useEffect, useState } from "react";
import { Toggle } from "@/components/settings/controls";
import { notifySettingsSaved, useSettingsSaved } from "@/components/settings-signal";

interface LocalStatus { enabled: boolean; baseUrl: string; model: string; models: { id: string }[]; error?: string }
export function OfflineLearning() {
	const [status, setStatus] = useState<LocalStatus | null>(null);
	const [model, setModel] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const reload = useCallback(async () => {
		try { const res = await fetch("/api/ollama"); if (!res.ok) throw Error("Could not load Ollama settings."); const body: LocalStatus = await res.json(); const loaded = { ...body, enabled: body.enabled === true, model: typeof body.model === "string" ? body.model : "", models: Array.isArray(body.models) ? body.models : [] }; setStatus(loaded); setModel(loaded.model); setError(loaded.enabled ? loaded.error || "" : ""); }
		catch { setError("Start Ollama, then refresh the models."); }
	}, []);
	useEffect(() => { void reload(); }, [reload]);
	useSettingsSaved(section => { if (section === "offline") void reload(); });
	async function save(enabled: boolean, selected = model) {
		setBusy(true); setError("");
		try {
			const res = await fetch("/api/ollama", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled, model: selected, baseUrl: status?.baseUrl }) });
			const body = await res.json(); if (!res.ok) throw Error(body.error || "Could not change offline learning.");
			await reload(); notifySettingsSaved("keys"); notifySettingsSaved("offline");
		} catch (e) { setError(e instanceof Error ? e.message : "Could not change offline learning."); }
		finally { setBusy(false); }
	}
	return <section className="flex flex-col gap-2 border-b border-border pb-4" aria-label="Offline learning">
		<div className="flex items-center justify-between gap-3"><div><p className="text-sm">Offline learning</p><p className="text-xs text-muted-foreground">Use Ollama on this computer. Your cloud choices stay saved.</p></div><Toggle label="Offline learning" checked={status?.enabled === true} disabled={busy || !status || (!status.enabled && !model)} onChange={on => void save(on)} /></div>
		<div className="flex items-center gap-2"><select aria-label="Offline model" value={model} disabled={busy || !status} onChange={e => { setModel(e.target.value); if (status?.enabled) void save(true,e.target.value); }} className="h-8 min-w-0 flex-1 rounded-sm border border-border bg-background px-2 text-xs"><option value="">Choose a downloaded model</option>{status?.model && !status.models.some(m => m.id === status.model) && <option value={status.model}>{status.model} (unavailable)</option>}{status?.models.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}</select><button type="button" disabled={busy} onClick={() => void reload()} className="rounded-sm px-2 py-1 text-xs hover:bg-muted focus-visible:outline-2">Refresh</button></div>
		{status?.enabled && <p className="text-xs text-muted-foreground">New AI requests stay local. Web research and online dictation are paused.</p>}
		{error && <p role="alert" className="text-xs text-destructive">{error}</p>}
	</section>;
}
