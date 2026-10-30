import { desktopAPIAuthorized } from "./desktop-access.ts";

interface AdmissionState { active: Map<symbol, string>; preparedUntil: number }
const scope = globalThis as typeof globalThis & { __lsDesktopUpdateAdmission?: AdmissionState };
const state = () => scope.__lsDesktopUpdateAdmission ??= { active: new Map(), preparedUntil: 0 };
export const UPDATE_PREPARE_TTL_MS = 30_000;

export class DesktopUpdatePendingError extends Error {
	readonly status = 409;
	constructor() {
		super("Learning Studio is preparing to restart for an update. Try again shortly.");
		this.name = "DesktopUpdatePendingError";
	}
}

/** Synchronous admission closes the check/start race. Completion is idempotent.
 * Reservations have no expiry: a slow lesson remains protected until it ends. */
export function beginDesktopWork(kind: string): () => void {
	const current = state();
	if (current.preparedUntil > Date.now()) throw new DesktopUpdatePendingError();
	const token = Symbol(kind);
	current.active.set(token, kind);
	return () => { current.active.delete(token); };
}

/** An abandoned restart lock expires. Active work is never expired by a poll. */
export function prepareDesktopUpdate(now = Date.now()): { ready: true } | { ready: false; reason: "busy" } {
	const current = state();
	if (current.active.size > 0) return { ready: false, reason: "busy" };
	current.preparedUntil = now + UPDATE_PREPARE_TTL_MS;
	return { ready: true };
}

export function releaseDesktopUpdate(): void { state().preparedUntil = 0; }

/** The desktop main process supplies its per-launch capability directly.
 * Browser mode never exposes a restart admission endpoint. */
export async function desktopUpdateReadinessResponse(request: Request): Promise<Response> {
	if (process.env.LH_DESKTOP_SERVER !== "1" || !process.env.LH_DESKTOP_API_SECRET || !desktopAPIAuthorized(request.headers)) {
		return Response.json({ error: "Desktop access required." }, { status: 403 });
	}
	let body: unknown;
	try { body = await request.json(); }
	catch { return Response.json({ error: "Invalid update request." }, { status: 400 }); }
	if (!body || typeof body !== "object" || Array.isArray(body) || !("op" in body)) return Response.json({ error: "Invalid update request." }, { status: 400 });
	if (body.op === "prepare") return Response.json(prepareDesktopUpdate());
	if (body.op === "release") { releaseDesktopUpdate(); return Response.json({ ready: false, released: true }); }
	return Response.json({ error: "Unknown update operation." }, { status: 400 });
}
