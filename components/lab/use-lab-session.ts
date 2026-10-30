"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LabSession } from "../../src/core/index.ts";
import { isUpdatePreparing, registerUpdateGuard } from "../update-readiness.ts";
import { labRequest, LabRequestError, mergeLabDraft, type LabDraft } from "./lab-client.ts";

export function useLabSession(initial: LabSession) {
	const [session, setSession] = useState(initial);
	const current = useRef(initial);
	const pending = useRef<LabDraft>({});
	const inflight = useRef<Promise<LabSession> | null>(null);
	const [saveState, setSaveState] = useState<"saved" | "unsaved" | "saving" | "error">("saved");
	const [saveError, setSaveError] = useState("");
	const [conflict, setConflict] = useState(false);
	const [editVersion, setEditVersion] = useState(0);
	const alive = useRef(true);
	useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
	const replace = useCallback((saved: LabSession) => {
		current.current = mergeLabDraft(saved, pending.current);
		if (alive.current) setSession(current.current);
	}, []);
	const edit = useCallback((patch: LabDraft) => {
		if (isUpdatePreparing()) return;
		pending.current = { ...pending.current, ...patch };
		current.current = mergeLabDraft(current.current, patch);
		setSession(current.current);
		setSaveState("unsaved");
		setEditVersion(value => value + 1);
	}, []);
	const flush = useCallback(async (): Promise<LabSession> => {
		if (inflight.current) return inflight.current;
		const work = async () => {
			while (Object.keys(pending.current).length) {
				const submitted = pending.current;
				pending.current = {};
				if (alive.current) { setSaveState("saving"); setSaveError(""); }
				try {
					const { session: saved } = await labRequest<{ session: LabSession }>(`/api/lab/sessions/${current.current.id}`, { method: "PATCH", body: JSON.stringify({ ...submitted, revision: current.current.revision }) });
					replace(saved);
				} catch (error) {
					pending.current = { ...submitted, ...pending.current };
					if (alive.current) {
						setSaveState("error");
						setConflict(error instanceof LabRequestError && error.status === 409);
						setSaveError(error instanceof Error ? error.message : "Your changes could not be saved. Try again.");
					}
					throw error;
				}
			}
			if (alive.current) { setSaveState("saved"); setConflict(false); }
			return current.current;
		};
		inflight.current = work().finally(() => { inflight.current = null; });
		return inflight.current;
	}, [replace]);
	useEffect(() => registerUpdateGuard(async () => {
		if (conflict) throw new Error("Resolve the saved draft conflict before restarting.");
		await flush();
	}), [conflict, flush]);
	useEffect(() => {
		if (!editVersion || conflict) return;
		const timer = setTimeout(() => { void flush().catch(() => {}); }, 650);
		return () => clearTimeout(timer);
	}, [editVersion, flush, conflict]);
	useEffect(() => {
		const beforeUnload = (event: BeforeUnloadEvent) => {
			if (Object.keys(pending.current).length || inflight.current) { event.preventDefault(); event.returnValue = ""; }
		};
		window.addEventListener("beforeunload", beforeUnload);
		return () => window.removeEventListener("beforeunload", beforeUnload);
	}, []);
	return { session, current, edit, replace, flush, saveState, saveError, conflict };
}
