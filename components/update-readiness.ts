"use client";

const guards = new Set<() => Promise<void>>();
const listeners = new Set<() => void>();
let preparing = false;
export const isUpdatePreparing = () => preparing;
export function subscribeUpdatePreparing(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function registerUpdateGuard(guard: () => Promise<void>) { guards.add(guard); return () => { guards.delete(guard); }; }

/** Freeze input before flushing pending drafts. The server admission lock
 * protects accepted work after this renderer-only gap is closed. */
export async function beforeRestart(): Promise<() => void> {
	if (preparing) throw new Error("A restart is already being prepared.");
	preparing = true;
	const body = typeof document === "undefined" ? null : document.body;
	const previousInert = body?.inert ?? false;
	if (body) body.inert = true;
	for (const listener of listeners) listener();
	let released = false;
	const release = () => {
		if (released) return; released = true;
		preparing = false;
		if (body) body.inert = previousInert;
		for (const listener of listeners) listener();
	};
	try { for (const guard of guards) await guard(); return release; }
	catch (error) { release(); throw error; }
}
