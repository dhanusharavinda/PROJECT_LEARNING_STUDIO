import type { LabSession, LabSessionPatch, LabStreamEvent } from "../../src/core/index.ts";

export class LabRequestError extends Error {
	constructor(message: string, public status: number) { super(message); }
}

export async function labRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
	const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options.headers }, cache: "no-store" });
	const value = await response.json().catch(() => ({})) as T & { error?: string };
	if (!response.ok) throw new LabRequestError(value.error || `Request failed (${response.status}). Try again.`, response.status);
	return value;
}

/** Chunk boundaries can fall anywhere, including inside a JSON string. */
export async function readLabEvents(response: Response, onEvent: (event: LabStreamEvent) => void): Promise<void> {
	if (!response.ok) {
		const value = await response.json().catch(() => ({})) as { error?: string };
		throw new LabRequestError(value.error || "The coach could not start. Check your provider settings and retry.", response.status);
	}
	if (!response.body) throw new Error("The coach connection ended before a response arrived.");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let pending = "", complete = false;
	const parse = (line: string) => {
		if (!line.trim()) return;
		const event = JSON.parse(line) as LabStreamEvent;
		onEvent(event);
		if (event.type === "done" || event.type === "error") complete = true;
	};
	try {
		while (true) {
			const { value, done } = await reader.read();
			pending += decoder.decode(value, { stream: !done });
			let newline: number;
			while ((newline = pending.indexOf("\n")) >= 0) { parse(pending.slice(0, newline)); pending = pending.slice(newline + 1); }
			if (done) break;
		}
		parse(pending);
		if (!complete) throw new Error("The coach connection was interrupted. Your saved work is safe. Try again.");
	} finally { reader.releaseLock(); }
}

export type LabDraft = Omit<LabSessionPatch, "revision" | "complete">;

/** Server revisions remain authoritative while unsaved local fields stay visible. */
export function mergeLabDraft(saved: LabSession, pending: LabDraft): LabSession { return { ...saved, ...pending }; }

export function formatLabTime(seconds: number): string {
	const bounded = Math.max(0, Math.floor(seconds));
	return `${Math.floor(bounded / 60).toString().padStart(2, "0")}:${(bounded % 60).toString().padStart(2, "0")}`;
}

export async function labCodeHash(code: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
	return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}
