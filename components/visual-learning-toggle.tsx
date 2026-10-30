"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { LoaderCircle, Pause, Play } from "lucide-react";
import { Hint } from "@/components/ui/hint";

interface VisualLearningState {
	enabled: boolean;
	loaded: boolean;
	busy: boolean;
	error: string;
	setEnabled: (enabled: boolean) => Promise<void>;
}
const DEFAULT_VISUAL_STATE: VisualLearningState = { enabled: true, loaded: true, busy: false, error: "", setEnabled: async () => {} };
export const VisualLearningContext = createContext<VisualLearningState>(DEFAULT_VISUAL_STATE);
export const useVisualLearning = () => useContext(VisualLearningContext);

export function VisualLearningProvider({ children }: { children: ReactNode }) {
	const [enabled, setEnabledState] = useState(false);
	const [loaded, setLoaded] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const request = useRef(0);
	const saving = useRef(false);
	const reload = useCallback(async () => {
		if (saving.current) return;
		const revision = ++request.current;
		try {
			const response = await fetch("/api/visual-learning", { cache: "no-store" });
			const body = await response.json();
			if (!response.ok || typeof body.enabled !== "boolean") throw new Error(body.error || "Could not load animation settings. Try the switch again.");
			if (request.current === revision) { setEnabledState(body.enabled); setError(""); }
		} catch (e) { if (request.current === revision) setError(e instanceof Error ? e.message : "Could not load animation settings."); }
		finally { if (request.current === revision) setLoaded(true); }
	}, []);
	useEffect(() => { void reload(); const refresh = () => { void reload(); }; window.addEventListener("focus", refresh); window.addEventListener("visual-learning-changed", refresh); return () => { request.current++; window.removeEventListener("focus", refresh); window.removeEventListener("visual-learning-changed", refresh); }; }, [reload]);
	async function setEnabled(next: boolean) {
		if (saving.current) return;
		saving.current = true;
		const revision = ++request.current; setBusy(true); setError("");
		try {
			const response = await fetch("/api/visual-learning", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: next }) });
			const body = await response.json();
			if (!response.ok || typeof body.enabled !== "boolean") throw new Error(body.error || "Could not change animation settings. Try again.");
			if (request.current === revision) setEnabledState(body.enabled);
		} catch (e) { if (request.current === revision) setError(e instanceof Error ? e.message : "Could not change animation settings."); }
		finally { saving.current = false; setBusy(false); if (request.current === revision) setLoaded(true); }
	}
	return <VisualLearningContext.Provider value={{ enabled, loaded, busy, error, setEnabled }}>{children}</VisualLearningContext.Provider>;
}

export function VisualLearningToggle() {
	const state = useVisualLearning();
	return <Hint label={state.error || "Pause motion and stop new animations. Static diagrams stay available."} side="bottom">
		<button type="button" role="switch" aria-label="Animations" aria-checked={state.enabled} aria-busy={state.busy || !state.loaded} disabled={state.busy || !state.loaded} onClick={() => void state.setEnabled(!state.enabled)} className="lh-no-drag inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm px-2 font-ui text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60" data-testid="animations-toggle">
			{state.busy || !state.loaded ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : state.enabled ? <Play className="size-3.5" aria-hidden="true" /> : <Pause className="size-3.5" aria-hidden="true" />}
			<span className="hidden sm:inline">Animations</span><span className={state.enabled ? "text-foreground" : ""}>{state.enabled ? "On" : "Off"}</span>
		</button>
	</Hint>;
}
