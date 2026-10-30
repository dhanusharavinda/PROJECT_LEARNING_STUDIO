import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { PATHS } from "../../config.ts";
import type { ChatSettings } from "../core/contracts.ts";
import type { LabItem, LabLibrary, LabProgress, LabSession } from "../core/lab.ts";

export class LabError extends Error {
	constructor(message: string, public status = 400) { super(message); this.name = "LabError"; }
}
export function validLabId(id: string): boolean { return /^[a-zA-Z0-9_-]{1,100}$/.test(id); }
const freshLibrary = (): LabLibrary => ({ version: 1, bookmarks: [], progress: {} });

/** All read-modify-write operations are synchronous within one desktop server. */
export function createLabStore(directory = path.join(PATHS.data, "lab")) {
	function file(id: string) {
		if (!validLabId(id)) throw new LabError("Invalid Lab session ID.");
		return path.join(directory, "sessions", `${id}.json`);
	}
	function atomicWrite(target: string, value: unknown) {
		fs.mkdirSync(path.dirname(target), { recursive: true });
		const temporary = `${target}.${randomUUID()}.tmp`;
		try { fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { flag: "wx" }); fs.renameSync(temporary, target); }
		finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
	}
	function get(id: string): LabSession | null {
		const target = file(id);
		if (!fs.existsSync(target)) return null;
		try {
			const data = JSON.parse(fs.readFileSync(target, "utf8"));
			if (data.version !== 1 || data.id !== id || !Number.isInteger(data.revision) || !Array.isArray(data.messages) || !Array.isArray(data.runs)) throw new Error("Invalid record");
			const { version: _version, ...session } = data;
			return session as LabSession;
		} catch { throw new LabError("This Lab session could not be read. Its file has been preserved.", 500); }
	}
	function requireSession(id: string) { const session = get(id); if (!session) throw new LabError("Lab session not found.", 404); return session; }
	function list(): LabSession[] {
		const folder = path.join(directory, "sessions");
		if (!fs.existsSync(folder)) return [];
		return fs.readdirSync(folder).filter(name => name.endsWith(".json") && validLabId(name.slice(0, -5))).flatMap(name => {
			try { const session = get(name.slice(0, -5)); return session ? [session] : []; }
			catch { return []; }
		}).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}
	function create(item: LabItem, settings?: ChatSettings, timerMinutes?: number): LabSession {
		const now = new Date().toISOString();
		const session: LabSession = {
			id: `lab_${randomUUID()}`, itemId: item.id, title: item.title, trackId: item.trackId, kind: item.kind,
			createdAt: now, updatedAt: now, revision: 0, status: "active", stage: "understand",
			reasoning: "", code: item.coding?.starterCode ?? "", reflection: "", messages: [], runs: [], feedback: [], usage: [],
			questionIndex: 0, answers: {}, quizAnswers: {}, hintsUsed: 0, elapsedSeconds: 0,
			...(timerMinutes ? { timerMinutes, startedAt: now } : {}), ...(settings ? { settings } : {}), linkedChatIds: [],
		};
		atomicWrite(file(session.id), { ...session, version: 1 });
		return session;
	}
	function mutate(id: string, change: (session: LabSession) => void, revision?: number): LabSession {
		const session = requireSession(id);
		if (revision !== undefined && revision !== session.revision) throw new LabError("This attempt changed in another window. Reload it before saving your draft.", 409);
		change(session);
		session.revision++;
		session.updatedAt = new Date().toISOString();
		atomicWrite(file(id), { ...session, version: 1 });
		return session;
	}
	function remove(id: string) { requireSession(id); fs.unlinkSync(file(id)); }
	function library(): LabLibrary {
		const target = path.join(directory, "library.json");
		if (!fs.existsSync(target)) return freshLibrary();
		try {
			const value = JSON.parse(fs.readFileSync(target, "utf8"));
			if (value.version !== 1 || !Array.isArray(value.bookmarks) || !value.progress || typeof value.progress !== "object") throw new Error("Invalid library");
			return value;
		} catch { throw new LabError("The Lab library could not be read. Its file has been preserved.", 500); }
	}
	function changeLibrary(change: (library: LabLibrary) => void): LabLibrary {
		const value = library(); change(value); atomicWrite(path.join(directory, "library.json"), value); return value;
	}
	function progress(itemId: string, change: (progress: LabProgress) => void) {
		return changeLibrary(value => {
			const entry = value.progress[itemId] ?? { itemId, state: "collected", updatedAt: new Date().toISOString(), attempts: 0, weakAreas: [] };
			change(entry); entry.updatedAt = new Date().toISOString(); value.progress[itemId] = entry;
		});
	}
	return { create, get, requireSession, list, mutate, remove, library, changeLibrary, progress };
}
export type LabStore = ReturnType<typeof createLabStore>;
export const labStore = createLabStore();
