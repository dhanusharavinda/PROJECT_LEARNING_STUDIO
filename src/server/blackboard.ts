import fs from "node:fs/promises";
import syncFs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { PATHS } from "../../config.ts";
import { blackboardPlanSchema, blackboardSections, compileBlackboardScene, type BlackboardPlan, type BlackboardArtifact } from "../core/blackboard.ts";
import { desktopAPIAuthorized } from "./desktop-access.ts";
import type { JobRecord } from "../core/contracts.ts";

const VERSION = "manimgx-0.1.1-board-4";
const digest = (bytes: Uint8Array) => crypto.createHash("sha256").update(bytes).digest("hex");
const base = () => path.join(PATHS.data, "blackboard");
const cacheId = (source: string) => crypto.createHash("sha256").update(VERSION + source).digest("hex");
const validId = (id: unknown): id is string => typeof id === "string" && /^[a-f0-9]{64}$/.test(id);

function jobArtifactIds(job: Pick<JobRecord, "kind" | "input" | "result">): Set<string> {
	const ids = new Set<string>();
	if (job.kind !== "animation") return ids;
	const resultId = (job.result as { id?: unknown } | undefined)?.id;
	if (validId(resultId)) ids.add(resultId);
	const plan = blackboardPlanSchema.safeParse(job.input);
	if (plan.success) ids.add(cacheId(compileBlackboardScene(plan.data)));
	return ids;
}
const lessonArtifactIds = (record: unknown): string[] => [...JSON.stringify(record ?? {}).matchAll(/\/api\/blackboard\/media\/([a-f0-9]{64})\/(?:video|poster)/g)].map(match => match[1]!);

/** Session deletion calls this without yielding, before removing its jobs.
 * A failed read or removal preserves the lesson for a safe retry. Only exact
 * hash directories are candidates, and another job or saved lesson keeps them. */
export function deleteChatBlackboardsSync(chatId: string, jobs: readonly JobRecord[], lesson?: unknown): void {
	const candidates = new Set([...jobs.flatMap(job => [...jobArtifactIds(job)]), ...lessonArtifactIds(lesson)]);
	if (!candidates.size) return;
	const retained = new Set<string>();
	const scanRecords = (directory: string, visit: (record: Record<string, unknown>) => void) => {
		let entries: syncFs.Dirent[];
		try { entries = syncFs.readdirSync(directory, { withFileTypes: true }); }
		catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
		for (const entry of entries) {
			if (!entry.name.endsWith(".json")) continue;
			if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Cannot verify animation references.");
			const record: unknown = JSON.parse(syncFs.readFileSync(path.join(directory, entry.name), "utf8"));
			if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("Cannot verify animation references.");
			visit(record as Record<string, unknown>);
		}
	};
	// Include orphan job records too. Looking only through the chat picker could
	// miss a valid reference whose lesson is temporarily unavailable.
	scanRecords(path.join(PATHS.data, "jobs"), record => {
		if (record.chatId === chatId) return;
		for (const id of jobArtifactIds(record as unknown as JobRecord)) retained.add(id);
	});
	scanRecords(PATHS.chats, record => {
		if (record.id === chatId) return;
		for (const id of lessonArtifactIds(record)) retained.add(id);
	});
	const root = path.resolve(base());
	let rootStat: syncFs.Stats;
	try { rootStat = syncFs.lstatSync(root); }
	catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
	if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Cannot safely remove animation cache.");
	const realRoot = syncFs.realpathSync(root);
	for (const id of candidates) {
		if (retained.has(id)) continue;
		const target = path.resolve(realRoot, id);
		if (!validId(id) || path.relative(realRoot, target) !== id) throw new Error("Invalid animation cache path.");
		let stat: syncFs.Stats;
		try { stat = syncFs.lstatSync(target); }
		catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
		if (!stat.isDirectory() || stat.isSymbolicLink() || path.relative(realRoot, syncFs.realpathSync(target)) !== id) throw new Error("Cannot safely remove animation cache.");
		syncFs.rmSync(target, { recursive: true, force: true });
	}
}
export function blackboardPython() {
	return process.env.LH_MANIMGX_PYTHON || path.join(PATHS.root, ".runtime", "manimgx-portable", process.platform === "win32" ? "python.exe" : "bin/python3");
}
export async function blackboardAvailability() {
	try { await fs.access(blackboardPython()); return { available: true, engine: "manimgx" as const }; }
	catch { return { available: false, engine: "manimgx" as const, message: "The animation runtime is not installed. Run the Learning Studio runtime setup." }; }
}

/** Only fixed compiler output is executed. Secrets and provider credentials are not inherited. */
async function runPython(args: string[], cwd: string, signal?: AbortSignal, poster = false) {
	signal?.throwIfAborted();
	const python = blackboardPython();
	await fs.access(python).catch(() => { throw new Error("The animation runtime is missing. Run the Learning Studio runtime setup."); });
	const runtimeCache = path.join(base(), "runtime-cache");
	await fs.mkdir(runtimeCache, { recursive: true });
	const env: NodeJS.ProcessEnv = { NODE_ENV: "production", PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: cwd, TMP: cwd, USERPROFILE: runtimeCache, HOME: runtimeCache, LOCALAPPDATA: runtimeCache, APPDATA: runtimeCache, XDG_CACHE_HOME: runtimeCache, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };
	return new Promise<string>((resolve, reject) => {
		const command = poster ? ["-I", "-c", "from PIL import Image; im=Image.open('poster-source.png'); im.crop((0,28,im.width,im.height)).save('poster.png')"] : ["-I", "-m", "manimgx", ...args];
		const child = spawn(python, command, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
		let output = "", failure: Error | undefined;
		const stop = (e: Error) => { failure = e; child.kill(); };
		const timeout = setTimeout(() => stop(new Error("Animation rendering exceeded three minutes. Try a shorter board.")), 180000);
		const abort = () => stop(new Error("Animation rendering was canceled."));
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) abort();
		const collect = (v: Buffer) => { output = (output + v.toString("utf8")).slice(-24000); };
		child.stdout.on("data", collect); child.stderr.on("data", collect);
		child.on("error", e => { clearTimeout(timeout); signal?.removeEventListener("abort", abort); reject(e); });
		child.on("close", code => { clearTimeout(timeout); signal?.removeEventListener("abort", abort); if (failure) reject(failure); else if (code !== 0) reject(new Error(`Animation ${args[0]} failed: ${output.slice(-2500)}`)); else resolve(output); });
	});
}

const state = globalThis as typeof globalThis & { __lhBlackboardQueue?: Promise<unknown>; __lhBlackboardWaiting?: number };
async function waitForTurn(previous: Promise<unknown>, signal?: AbortSignal) {
	if (!signal) { await previous.catch(() => {}); return; }
	signal.throwIfAborted();
	let abort!: () => void;
	try {
		await Promise.race([previous.catch(() => {}),new Promise<never>((_,reject) => {
			abort = () => reject(new Error("Animation rendering was canceled while queued."));
			signal.addEventListener("abort",abort,{once:true});
			if (signal.aborted) abort();
		})]);
	} finally { signal.removeEventListener("abort",abort); }
}

export async function renderBlackboard(input: BlackboardPlan, options: { signal?: AbortSignal; onProgress?: (message: string) => void } = {}): Promise<BlackboardArtifact> {
	options.signal?.throwIfAborted();
	const plan = blackboardPlanSchema.parse(input), source = compileBlackboardScene(plan);
	const id = cacheId(source);
	const folder = path.join(base(), id);
	const artifact = (cacheHit: boolean): BlackboardArtifact => ({ id, title: plan.title, url: `/api/blackboard/media/${id}/video`, posterUrl: `/api/blackboard/media/${id}/poster`, durationSeconds: plan.beats.reduce((n,b) => n+b.duration,0), sections: blackboardSections(plan), cacheHit, engine: "manimgx" });
	const cached = async () => {
		try {
			const receipt = JSON.parse(await fs.readFile(path.join(folder, "receipt.json"), "utf8"));
			if (receipt.version !== VERSION || receipt.id !== id) return false;
			const video = await fs.readFile(path.join(folder,"BlackboardLesson.mp4")), poster = await fs.readFile(path.join(folder,"poster.png"));
			return video.length > 0 && video.length === receipt.videoBytes && digest(video) === receipt.videoSha256 && poster.length === receipt.posterBytes && digest(poster) === receipt.posterSha256;
		} catch { return false; }
	};
	if (await cached()) return artifact(true);
	if ((state.__lhBlackboardWaiting || 0) >= 4) throw new Error("The blackboard queue is full. Wait for an animation to finish.");
	state.__lhBlackboardWaiting = (state.__lhBlackboardWaiting || 0) + 1;
	const previous = state.__lhBlackboardQueue || Promise.resolve();
	let release!: () => void;
	state.__lhBlackboardQueue = new Promise<void>(r => { release = r; });
	try { options.onProgress?.("Waiting for the blackboard"); await waitForTurn(previous,options.signal); }
	catch (e) {
		state.__lhBlackboardWaiting = Math.max(0,(state.__lhBlackboardWaiting || 1)-1);
		void previous.catch(() => {}).then(release);
		throw e;
	}
	try {
		options.signal?.throwIfAborted();
		if (await cached()) return artifact(true);
		await fs.mkdir(folder, { recursive: true });
		await fs.unlink(path.join(folder,"receipt.json")).catch(() => {});
		await fs.writeFile(path.join(folder, "scene.py"), source, "utf8");
		await fs.writeFile(path.join(folder, "plan.json"), JSON.stringify(plan, null, 2));
		options.onProgress?.("Checking the animation layout");
		const inspected = await runPython(["inspect", "scene.py"], folder, options.signal);
		await fs.writeFile(path.join(folder,"inspect.log"), inspected);
		await runPython(["inspect", "scene.py", "-t", String(Math.max(.5,plan.beats[0]!.duration-.4)), "-o", "poster-source.png"], folder, options.signal);
		await runPython([], folder, options.signal, true);
		options.onProgress?.("Rendering the blackboard");
		const rendered = await runPython(["render", "scene.py", "-r", "1280x720", "--fps", "30"], folder, options.signal);
		await fs.writeFile(path.join(folder,"render.log"), rendered);
		if (!(await fs.stat(path.join(folder, "BlackboardLesson.mp4"))).size) throw new Error("The animation renderer produced an empty file.");
		const video = await fs.readFile(path.join(folder,"BlackboardLesson.mp4")), poster = await fs.readFile(path.join(folder,"poster.png"));
		await fs.writeFile(path.join(folder,"receipt.tmp"), JSON.stringify({ version: VERSION, completedAt: new Date().toISOString(), videoBytes: video.length, videoSha256: digest(video), posterBytes: poster.length, posterSha256: digest(poster), ...artifact(false) }));
		await fs.rename(path.join(folder,"receipt.tmp"),path.join(folder,"receipt.json"));
		return artifact(false);
	} finally { state.__lhBlackboardWaiting = Math.max(0, (state.__lhBlackboardWaiting || 1)-1); release(); }
}

export async function blackboardMediaResponse(req: Request, id: string, kind: string): Promise<Response> {
	if (!desktopAPIAuthorized(req.headers)) return new Response("Unauthorized", { status: 401 });
	if (!/^[a-f0-9]{64}$/.test(id) || !["video", "poster"].includes(kind)) return new Response("Not found", { status: 404 });
	const file = path.join(base(), id, kind === "video" ? "BlackboardLesson.mp4" : "poster.png");
	try {
		await fs.access(path.join(base(), id, "receipt.json"));
		const data = await fs.readFile(file), headers = new Headers({ "Content-Type": kind === "video" ? "video/mp4" : "image/png", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" });
		const range = req.headers.get("range");
		if (range) {
			const match = /^bytes=(\d+)-(\d*)$/.exec(range);
			const start = match ? Number(match[1]) : -1, end = match?.[2] ? Math.min(Number(match[2]), data.length-1) : data.length-1;
			if (start < 0 || start >= data.length || end < start) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${data.length}` } });
			headers.set("Content-Range", `bytes ${start}-${end}/${data.length}`); headers.set("Content-Length", String(end-start+1));
			return new Response(new Uint8Array(data.subarray(start,end+1)), { status: 206, headers });
		}
		headers.set("Content-Length", String(data.length));
		return new Response(new Uint8Array(data), { headers });
	} catch { return new Response("Not found", { status: 404 }); }
}
