import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { PATHS } from "../../config.ts";
import { blackboardPython } from "./blackboard.ts";
import type { ManimSceneArtifact } from "../core/manim-scene.ts";
export type { ManimSceneArtifact } from "../core/manim-scene.ts";

const VERSION = "restricted-manim-scene-2";
export interface RenderManimSceneOptions { signal?: AbortSignal; onProgress?: (line: string) => void }
const workerFile = () => path.join(PATHS.root, "src", "server", "manim-scene-worker.py");
const sha = (value: string | Uint8Array) => crypto.createHash("sha256").update(value).digest("hex");

export interface ManimReviewPlan {
	durationSeconds: number;
	samples: { seconds: number; moment: string; label: string }[];
	sectionCount: number;
	coveredSections: number;
}
/** Cover sections and long gaps, without allocating an image for every play. */
export function manimReviewPlan(durationSeconds: number, inputSections: { title: string; start: number; end: number }[] = []): ManimReviewPlan {
	if (!(Number.isFinite(durationSeconds) && durationSeconds > 0 && durationSeconds <= 120)) throw new Error("Use a review timeline between zero and 120 seconds.");
	const sections = inputSections.filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start && s.start >= 0 && s.start < durationSeconds).map(s => ({ ...s, end: Math.min(s.end, durationSeconds) }));
	const times: number[] = [];
	const frame = (time: number) => Math.max(0, Math.ceil(time * 30) - 1);
	const endFrame = Math.ceil(durationSeconds * 30);
	const add = (time: number) => {
		const value = Math.max(.001, Math.min(durationSeconds - .001, Math.round(time * 1000) / 1000));
		if (value <= 0 || value >= durationSeconds || frame(value) === endFrame || times.some(t => frame(t) === frame(value))) return false;
		times.push(value); return true;
	};
	const numericSlots = 11;
	const sectionSlots = Math.min(numericSlots, sections.length);
	for (let i = 0; i < sectionSlots; i++) {
		const index = sections.length <= numericSlots ? i : Math.floor(i * (sections.length - 1) / sectionSlots);
		const section = sections[index]!;
		add(section.start + (section.end - section.start) * .65);
	}
	while (times.length < numericSlots) {
		const points = [0, ...times, durationSeconds].sort((a,b) => a-b);
		const gaps = points.slice(1).map((end, i) => ({ start: points[i]!, end })).sort((a,b) => (b.end-b.start)-(a.end-a.start));
		if (!gaps.some(gap => add((gap.start + gap.end) / 2))) break;
	}
	const labelAt = (time: number) => sections.find(s => time >= s.start && time < s.end)?.title || (time >= durationSeconds ? "Final state" : "Lesson");
	const samples = times.sort((a,b) => a-b).map(seconds => ({ seconds, moment: seconds.toFixed(3), label: labelAt(seconds) }));
	samples.push({ seconds: durationSeconds, moment: "end", label: sections.at(-1)?.title || "Final state" });
	const coveredSections = sections.filter(s => samples.some(sample => sample.seconds >= s.start && (sample.seconds < s.end || (sample.moment === "end" && s.end === durationSeconds)))).length;
	return { durationSeconds, samples, sectionCount: sections.length, coveredSections };
}

async function python(args: string[], folder: string, signal?: AbortSignal): Promise<string> {
	signal?.throwIfAborted();
	const executable = blackboardPython();
	await fs.access(executable).catch(() => { throw new Error("The ManimGX runtime is missing. Reinstall Learning Studio and try again."); });
	const cache = path.join(folder, "runtime-cache"); await fs.mkdir(cache, { recursive: true });
	const env: NodeJS.ProcessEnv = { NODE_ENV: "production", PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: folder, TMP: folder, USERPROFILE: cache, HOME: cache, APPDATA: cache, LOCALAPPDATA: cache, XDG_CACHE_HOME: cache, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };
	return new Promise((resolve, reject) => {
		const child = spawn(executable, ["-I", ...args], { cwd: folder, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
		let output = "", failure: Error | undefined;
		const stop = (reason: Error) => { failure = reason; child.kill(); };
		const timer = setTimeout(() => stop(new Error("The scene exceeded three minutes. Try a shorter explanation.")), 180000);
		const abort = () => stop(new Error("Scene generation was canceled."));
		signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
		const collect = (bytes: Buffer) => { output = (output + bytes.toString("utf8")).slice(-50000); };
		child.stdout.on("data", collect); child.stderr.on("data", collect);
		child.on("error", error => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(error); });
		child.on("close", code => { clearTimeout(timer); signal?.removeEventListener("abort", abort); if (failure) reject(failure); else if (code !== 0) reject(new Error(output.slice(-12000) || `Native scene process exited with code ${code}.`)); else resolve(output); });
	});
}

/** Validates generated Python without importing or executing it. */
export async function validateManimSource(sourceCode: string, options: RenderManimSceneOptions = {}): Promise<void> {
	if (typeof sourceCode !== "string" || !sourceCode.trim() || sourceCode.length > 60000) throw new Error("Provide a scene of at most 60,000 characters.");
	const folder = path.join(PATHS.data, "blackboard", "source-validation", crypto.randomUUID());
	await fs.mkdir(folder, { recursive: true });
	try { await fs.writeFile(path.join(folder, "source.json"), JSON.stringify({ sourceCode })); await python([workerFile(), "validate", "source.json"], folder, options.signal); }
	finally { await fs.rm(folder, { recursive: true, force: true }); }
}

// Serialize GPU rendering across this module. Rejected work never blocks its successor.
const shared = globalThis as typeof globalThis & { __lhAdvancedSceneQueue?: Promise<void>; __lhAdvancedSceneWaiting?: number };
async function queue(signal?: AbortSignal) {
	if ((shared.__lhAdvancedSceneWaiting || 0) >= 4) throw new Error("Four scenes are already queued. Wait for one to finish.");
	shared.__lhAdvancedSceneWaiting = (shared.__lhAdvancedSceneWaiting || 0) + 1;
	const previous = shared.__lhAdvancedSceneQueue || Promise.resolve();
	let release!: () => void; shared.__lhAdvancedSceneQueue = new Promise(resolve => { release = resolve; });
	let abort: (() => void) | undefined;
	try {
		await Promise.race([previous.catch(() => {}), new Promise<never>((_resolve, reject) => { abort = () => reject(new Error("Scene generation was canceled.")); if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true }); })]);
	} catch (error) { shared.__lhAdvancedSceneWaiting!--; void previous.catch(() => {}).then(release); throw error; }
	finally { if (abort) signal?.removeEventListener("abort", abort); }
	return () => { shared.__lhAdvancedSceneWaiting!--; release(); };
}

/** Code is interpreted with drawing/math capabilities, never unrestricted Python. */
export async function renderManimScene(input: { title: string; sourceCode: string }, options: RenderManimSceneOptions = {}): Promise<ManimSceneArtifact> {
	options.signal?.throwIfAborted();
	if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 160) throw new Error("Use a scene title of at most 160 characters.");
	if (typeof input.sourceCode !== "string" || !input.sourceCode.trim() || input.sourceCode.length > 60000) throw new Error("Provide a scene of at most 60,000 characters.");
	const workerSource = await fs.readFile(workerFile(), "utf8");
	const id = sha(VERSION + sha(workerSource) + input.title + input.sourceCode), folder = path.join(PATHS.data, "blackboard", id);
	const cached = async (): Promise<ManimSceneArtifact | null> => {
		try {
			const receipt = JSON.parse(await fs.readFile(path.join(folder, "receipt.json"), "utf8"));
			if (receipt.version !== VERSION || receipt.id !== id) return null;
			const [video, poster, storyboard, reviewPlan] = await Promise.all([fs.readFile(path.join(folder, "BlackboardLesson.mp4")), fs.readFile(path.join(folder, "poster.png")), fs.readFile(path.join(folder, "storyboard.png")), fs.readFile(path.join(folder, "review-plan.json"))]);
			if (sha(video) !== receipt.videoSha256 || sha(poster) !== receipt.posterSha256 || sha(storyboard) !== receipt.storyboardSha256 || sha(reviewPlan) !== receipt.reviewPlanSha256) return null;
			return { ...receipt.artifact, cacheHit: true };
		} catch { return null; }
	};
	const hit = await cached(); if (hit) return hit;
	const release = await queue(options.signal);
	try {
		const existing = await cached(); if (existing) return existing;
		await fs.mkdir(folder, { recursive: true });
		await fs.unlink(path.join(folder, "receipt.json")).catch(() => {});
		await fs.writeFile(path.join(folder, "source.json"), JSON.stringify({ sourceCode: input.sourceCode }));
		options.onProgress?.("Checking scene capabilities and calculations");
		await python([workerFile(), "validate", "source.json"], folder, options.signal);
		// Only this trusted wrapper is imported by the native renderer.
		const wrapper = `import runpy\n_module=runpy.run_path(${JSON.stringify(workerFile())})\nLearningScene=_module["load_scene"](${JSON.stringify(path.join(folder, "source.json"))},__name__)\nimport manimgx as _m\n_m.config.pixel_width=1280\n_m.config.pixel_height=720\n_m.config.frame_rate=30\n`;
		await fs.writeFile(path.join(folder, "scene.py"), wrapper);
		options.onProgress?.("Checking the complete scene timeline");
		const analyzed = await python([workerFile(), "analyze", "source.json"], folder, options.signal);
		await fs.writeFile(path.join(folder, "analyze.log"), analyzed);
		const preliminary = JSON.parse(await fs.readFile(path.join(folder, "scene-report.json"), "utf8"));
		if (!(preliminary.durationSeconds > 0 && preliminary.durationSeconds <= 120) || !preliminary.mathAssertions) throw new Error("The scene needs visible teaching time and executed mathematical or structural assertions.");
		const reviewPlan = manimReviewPlan(preliminary.durationSeconds, preliminary.sections || []);
		await fs.writeFile(path.join(folder, "review-plan.json"), JSON.stringify(reviewPlan));
		options.onProgress?.("Inspecting each chapter across the scene");
		const inspected = await python(["-m", "manimgx", "inspect", "scene.py", "-t", reviewPlan.samples.map(s => s.moment).join(","), "-o", "review-source.png"], folder, options.signal);
		await fs.writeFile(path.join(folder, "inspect.log"), inspected);
		await python([workerFile(), "contact-sheet", "review-plan.json"], folder, options.signal);
		options.onProgress?.("Rendering the code-driven animation");
		const rendered = await python([workerFile(), "render", "source.json"], folder, options.signal);
		await fs.writeFile(path.join(folder, "render.log"), rendered);
		await fs.rename(path.join(folder, "LearningScene.mp4"), path.join(folder, "BlackboardLesson.mp4"));
		const report = JSON.parse(await fs.readFile(path.join(folder, "scene-report.json"), "utf8"));
		const [video, poster, storyboard, reviewBytes] = await Promise.all([fs.readFile(path.join(folder, "BlackboardLesson.mp4")), fs.readFile(path.join(folder, "poster.png")), fs.readFile(path.join(folder, "storyboard.png")), fs.readFile(path.join(folder, "review-plan.json"))]);
		if (!video.length || !poster.length) throw new Error("The native renderer returned empty media.");
		const artifact: ManimSceneArtifact = { id, title: input.title.replaceAll("\u2014", ", "), url: `/api/blackboard/media/${id}/video`, posterUrl: `/api/blackboard/media/${id}/poster`, durationSeconds: report.durationSeconds, sections: report.sections || [], cacheHit: false, engine: "manimgx", sourceCode: input.sourceCode, verification: { boundary: "restricted-scene-interpreter", mathAssertions: report.mathAssertions, layoutChecked: !report.threeD, threeD: report.threeD, visualReviewed: false, reviewCoverage: { sampledFrames: reviewPlan.samples.length, sectionCount: reviewPlan.sectionCount, coveredSections: reviewPlan.coveredSections } } };
		await fs.writeFile(path.join(folder, "receipt.tmp"), JSON.stringify({ version: VERSION, id, artifact, videoBytes: video.length, posterBytes: poster.length, videoSha256: sha(video), posterSha256: sha(poster), storyboardSha256: sha(storyboard), reviewPlanSha256: sha(reviewBytes), resources: report.resources }));
		await fs.rename(path.join(folder, "receipt.tmp"), path.join(folder, "receipt.json"));
		return artifact;
	} catch (error) {
		await fs.writeFile(path.join(folder, "last-error.log"), String(error)).catch(() => {});
		throw error;
	} finally { release(); }
}

export async function manimSceneStoryboard(id: string): Promise<Buffer> {
	if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid scene.");
	return fs.readFile(path.join(PATHS.data, "blackboard", id, "storyboard.png"));
}
