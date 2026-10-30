import type { BlackboardPlan, BlackboardArtifact } from "../../core/blackboard.ts";
import type { AnimationResult } from "../../core/contracts.ts";
import type { PiEngine } from "../models.ts";
import type { SearchProvider } from "../../core/search.ts";
import {
	accumulateJobUsage,
	buildSubagentSteer,
	isSubagentFailure,
	piUsageToStep,
	type DemoResult,
	type DemoToolInput,
	type JobKind,
	type JobRecord,
	type JobUsage,
	type PdfResult,
	type PdfToolInput,
	type ResearchResult,
	type ResearchToolInput,
	type SteerMessage,
	type UsageStepLike,
	type VisualResult,
	type VisualToolInput,
} from "../../core/contracts.ts";
import { registerJobAbort, unregisterJobAbort } from "./aborts.ts";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ModelRole } from "../../../config.ts";
import { ROLE_SLOT, modelsNotConfigured, type ModelSlotName, type ProviderKeyMissing } from "../../core/settings.ts";
import type { ChatStore, JobStore } from "../../core/ports.ts";
import { runDemoBuilder } from "./demo-builder.ts";
import { runPdfReaderAgent } from "./pdf-reader.ts";
import { runResearcherAgent } from "./researcher.ts";
import { runVisualMaker } from "./visual-maker.ts";
import { isLessonAnimationRequest, isCodedManimRequest, type CodedManimRequest, type LessonAnimationRequest } from "../../core/lesson-animation.ts";
import { planLessonAnimation } from "./animation-planner.ts";
import { visualFormatDisabledMessage, type VisualFormat } from "../../core/visual-learning.ts";
import { directLessonVisual } from "./visual-director.ts";
import { runManimSceneBuilder, type ManimSceneBuilderOptions } from "./manim-scene-builder.ts";

/**
 * The background job runner (contracts.ts "THE ASYNC PROTOCOL" §2–3), created
 * via createJobRunner({ chatStore, jobStore, deliver }) — the composition root
 * (chat-handler) injects the storage ports and the WAKE SEAM (the server-side
 * steer delivery, src/server/jobs.ts); this module never imports an adapter.
 *
 *   runJob(jobId) — runs the kind's sub-agent loop in the background
 *     (the job tools' execute fires this via the spawn seam, fire-and-forget),
 *     updating the job's activity line on every iteration. On completion the
 *     runner builds the STEER MESSAGE (buildSubagentSteer) and hands it to
 *     `deliver` without waiting. The worker's final outcome and pending
 *     delivery are saved together; the session owns delivery from then on.
 *
 *   On failure the result is the failure shape (empty html/svg + "FAILED: …"
 *   notes; research: failure brief) — and it STILL steers, because the
 *   teacher must learn the outcome. Failed delivery starts stay quietly
 *   pending and never rewrite the worker's computation outcome.
 */

/**
 * Test seam: the spawn wiring has no injection point at the tool layer, so
 * tests swap in a scripted pi engine here to keep job tests off the network.
 * Undefined in production. (The jobs spawn through the module-level KIND
 * runners, which read these at call time.)
 */
export const researchModelOverride: { current?: PiEngine } = {};
export const demoModelOverride: { current?: PiEngine } = {};
export const demoReviewModelOverride: { current?: PiEngine } = {};
export const visualModelOverride: { current?: PiEngine } = {};
export const pdfModelOverride: { current?: PiEngine } = {};

/** The dispatch-time tool input (from src/agent/tools/jobs.ts schemas). */
type JobToolInput = ResearchToolInput | DemoToolInput | VisualToolInput | PdfToolInput | BlackboardPlan | LessonAnimationRequest | CodedManimRequest;

export interface JobRunnerDeps {
	manimSceneRuntime?: Pick<ManimSceneBuilderOptions,"validateSource"|"renderScene"|"storyboard">;
	animationReviewEngineFor?: (chatId: string, automatic: boolean) => PiEngine | undefined;
	visualAnimationsEnabled?: () => boolean;
	visualFormatEnabled?: (format: Exclude<VisualFormat,"auto">) => boolean;
	animationEngineFor?: (chatId: string, automatic: boolean) => PiEngine | undefined;
	renderBlackboard?: (plan: BlackboardPlan, options: { signal: AbortSignal; onProgress: (line: string) => void }) => Promise<BlackboardArtifact>;
	chatStore: ChatStore;
	jobStore: JobStore;
	/**
	 * Hand a finished job's steer to the session delivery registry. The
	 * promise tracks durable marker acceptance, but the worker never waits
	 * on it. Its persisted pending obligation survives process restart.
	 */
	deliver: (steer: SteerMessage) => Promise<void>;
	/** Settings-resolved engine per role (model slots wave, 2026-09-20):
	 *  the role-override → slot chain, read FRESH per job (the server
	 *  wiring passes effectiveSettings-based resolution). Test overrides
	 *  (below) still win. BYOK (owner, 2026-09-22): the chain may end
	 *  EMPTY → undefined; runJob then refuses the spawn honestly instead
	 *  of guessing a model. */
	engineFor?: (role: ModelRole) => PiEngine | undefined;
	/** The search seam (search port wave, 2026-09-20): resolves the LIVE
	 *  provider fresh per job — server/search.ts composition injected by
	 *  the wiring; null = honestly unavailable (the researcher's web_search
	 *  reports it as recoverable text). Absent seam (tests) reads the same;
	 *  research dispatch and web_fetch do not require search credentials. */
	searchProvider?: () => SearchProvider | null;
	/** Key-presence gate (provider-key interlude, 2026-09-25): given the
	 *  resolved engine's provider + the kind's slot tier, return the
	 *  refusal envelope when the provider's key is missing (null = run).
	 *  Injected because the agent layer may not read the key store; absent
	 *  in tests that inject engines directly (test engines never owe a key). */
	providerKeyMissing?: (provider: string, tier: ModelSlotName) => ProviderKeyMissing | null;
}

export interface JobRunner {
	/** Run one job's sub-agent loop to completion (background; never throws).
	 *  The tool input rides along from dispatch (the spawn fires mid-stream,
	 *  before the tool part is persisted). Recovery reads saved job input,
	 *  with transcript fallback for legacy jobs. Delivery is not awaited. */
	runJob(jobId: string, input?: JobToolInput): Promise<void>;
}

/** One job loop's injected machinery: the kill switch (real abort, 2026-09
 * semantics) and the usage tap (money channel — every model call folds into
 * JobRecord.usage as it completes). */
interface LoopContext {
	/** Fires when abortJob kills the run; abortSignal is passed into every
	 * model call so the spend stops mid-call, not at the next loop check. */
	abortSignal: AbortSignal;
	/** The job's chat (debug: raw provider-event recording under
	 * LH_PROVIDER_EVENTS=1 — forwarded into every subagent run). */
	chatId?: string;
	/** Fold one model call's usage into the job record (progress write). */
	onUsage: (step: UsageStepLike) => void;
}

/** The kind→role table (model slots wave, 2026-09-20): which ModelRole's
 * engine each sub-agent kind runs — the engineFor injection key. */
const KIND_ROLE: Record<Exclude<JobKind, "animation">, ModelRole> = {
	research: "researcher",
	demo: "demoBuilder",
	visual: "visualMaker",
	pdf: "pdfReader",
};

export function createJobRunner(deps: JobRunnerDeps): JobRunner {
	const { chatStore, jobStore, deliver } = deps;
	const enabledFormat = (format: Exclude<VisualFormat,"auto">) => (format === "diagram" || deps.visualAnimationsEnabled?.() !== false) && deps.visualFormatEnabled?.(format) !== false;
	function requireFormat(format: Exclude<VisualFormat,"auto">) {
		if (format !== "diagram" && deps.visualAnimationsEnabled?.() === false) throw new Error("Animations are off. Choose Diagram or turn animations on.");
		if (!enabledFormat(format)) throw new Error(visualFormatDisabledMessage(format));
	}

	/** Running usage totals per live job (the loop's onUsage folds here,
	 * then writes through the job store so the poll sees progress). */
	const usageTotals = new Map<string, JobUsage>();
	function recordUsage(jobId: string, model: string, step: UsageStepLike) {
		const next=accumulateJobUsage(usageTotals.get(jobId) ?? jobStore.getJob(jobId)?.usage,model,step);
		usageTotals.set(jobId,next); jobStore.updateJob(jobId,{usage:next});
	}

	function makeLoopContext(jobId: string, engine: PiEngine, controller = new AbortController()): LoopContext {
		const chatId = jobStore.getJob(jobId)?.chatId;
		// Provider-qualified stamp: the engine's actual model — the only
		// thing that ran (BYOK: no config-pin fallback stamps exist).
		const model = `${engine.model.provider}:${engine.model.id}`;
		// Real-kill wiring (2026-09 abort semantics): the controller is what
		// the abort endpoint fires (agent/subagents/aborts.ts registry); the
		// signal rides into every model call of the loop.
		registerJobAbort(jobId, controller);
		return {
			abortSignal: controller.signal,
			chatId,
			onUsage: (step) => {
				recordUsage(jobId,model,step);
			},
		};
	}

	/** True while the job may still write terminal state (result, error,
	 * steer). False once abortJob has flipped it to error ("Aborted by learner") —
	 * the runner then unwinds silently; the abort path owns the record and
	 * the abort steer. */
	function stillRunning(jobId: string): boolean {
		return jobStore.getJob(jobId)?.status === "running";
	}

	/** The kind→runner map: one sub-agent loop per kind. Each kind's
	 *  runner narrows the union input itself (dispatch-time inputs are
	 *  kind-correct by construction; transcript fallbacks are cast after). */
	/** The engine one job runs on: test override first (the old seam —
	 *  tests swap scripted engines without touching deps), then the injected
	 *  settings-resolved engineFor. undefined = the BYOK chain came up
	 *  empty (owner, 2026-09-22) — runJob refuses below, honestly. */
	function pickEngine(kind: Exclude<JobKind, "animation">): PiEngine | undefined {
		const testOverride: Record<string, { current?: PiEngine } | undefined> = {
			researcher: researchModelOverride,
			demoBuilder: demoModelOverride,
			visualMaker: visualModelOverride,
			pdfReader: pdfModelOverride,
		};
		return testOverride[KIND_ROLE[kind]]?.current ?? deps.engineFor?.(KIND_ROLE[kind]);
	}

	const KIND_RUNNERS: Record<
		Exclude<JobKind, "animation">,
		(jobId: string, engine: PiEngine, input: JobToolInput | undefined, loop: LoopContext) => Promise<void>
	> = {
		research: (jobId, engine, input, loop) => runResearchJob(jobId, engine, input, loop),
		demo: (jobId, engine, input, loop) => runDemoJob(jobId, engine, input, loop),
		visual: (jobId, engine, input, loop) => runVisualJob(jobId, engine, input, loop),
		pdf: (jobId, engine, input, loop) => runPdfJob(jobId, engine, input, loop),
	};

	async function runJob(jobId: string, input?: JobToolInput): Promise<void> {
		const job = jobStore.getJob(jobId);
		if (!job) {
			console.error(`[job ${jobId}] not found — nothing to run`);
			return;
		}
		if (job.status !== "running") return; // already finished / re-run after crash recovery
		const receivedVisual = resolveInput(job, input);
		if ((isLessonAnimationRequest(receivedVisual) && !receivedVisual.plan && deps.manimSceneRuntime) || isCodedManimRequest(receivedVisual)) {
			await runContextVisual(job, receivedVisual as LessonAnimationRequest | CodedManimRequest);
			return;
		}
		if (job.kind === "animation") {
			const received = resolveInput(job, input);
			const request = isLessonAnimationRequest(received) ? received : undefined;
			let animationPlan = request?.plan ?? (request ? undefined : received as BlackboardPlan | undefined);
			const controller = new AbortController();
			registerJobAbort(jobId, controller);
			try {
				if (!jobContext(jobId)) return;
				requireFormat("video");
				if (!deps.renderBlackboard) throw new Error("Animated board renderer is unavailable. Restart the application and try again.");
				if (request && !animationPlan) {
					const engine = deps.animationEngineFor?.(job.chatId, request.automatic);
					if (!engine) throw new Error("Choose a teaching model in Providers before generating an animation.");
					const missing = deps.providerKeyMissing?.(engine.model.provider, "strong");
					if (missing) throw new Error("Connect your selected teaching provider in Settings, then try again.");
					jobStore.updateJob(jobId, { activity: "Planning the animation" });
					const loop = makeLoopContext(jobId, engine, controller);
					animationPlan = await planLessonAnimation(request.context, engine, controller.signal, usage => loop.onUsage(piUsageToStep(usage)), job.chatId);
					if (!stillRunning(jobId) || !jobContext(jobId)) return;
					jobStore.updateJob(jobId, { input: { ...request, plan: animationPlan } });
				}
				const result = await deps.renderBlackboard(animationPlan as BlackboardPlan, { signal: controller.signal, onProgress: (line) => { if (stillRunning(jobId)) jobStore.updateJob(jobId, { activity: line }); } });
				await finishJob(jobId, result);
			} catch (error) {
				if (controller.signal.aborted) return;
				const reason = error instanceof Error ? error.message : String(error);
				if (stillRunning(jobId)) jobStore.updateJob(jobId, { error: reason });
				await finishJob(jobId, { id: "", title: typeof animationPlan?.title === "string" ? animationPlan.title : "Animated board", url: "", posterUrl: "", durationSeconds: 0, sections: [], cacheHit: false, engine: "manimgx", notes: reason });
			} finally { unregisterJobAbort(jobId); usageTotals.delete(jobId); }
			return;
		}
		const run = KIND_RUNNERS[job.kind];
		if (!run) {
			console.error(`[job ${jobId}] unknown kind: ${job.kind}`);
			jobStore.updateJob(jobId, { status: "error", error: `unknown kind ${job.kind}`, activity: "failed" });
			return;
		}
		// The per-need refusal guards (BYOK 2026-09-22 / provider-key
		// interlude 2026-09-25): no engine for the kind's tier, or the
		// resolved engine's provider key gone — both refuse through the SAME
		// convention as every other failed job: record the honest error (no
		// status flip: finalizeJob owns the terminal flip after delivery),
		// then steer the kind's failure shape through finishJob so the wake
		// pipeline resumes the lesson and the teacher reads the refusal
		// instead of waiting forever on a job it already dispatched.
		const refuse = async (reason: string): Promise<void> => {
			if (stillRunning(jobId)) jobStore.updateJob(jobId, { error: reason });
			const resolved = resolveInput(job, input) as
				| ResearchToolInput
				| DemoToolInput
				| VisualToolInput
				| PdfToolInput
				| undefined;
			const pdf = resolved as PdfToolInput | undefined;
			const failure: ResearchResult | DemoResult | VisualResult | PdfResult =
				job.kind === "research"
					? { brief: `Research failed: ${reason}`, sources: [] }
					: job.kind === "demo"
						? {
								title: typeof (resolved as DemoToolInput | undefined)?.title === "string" && (resolved as DemoToolInput).title.trim() ? (resolved as DemoToolInput).title : "Interactive demo",
								html: "",
								tested: true,
								notes: `FAILED: ${reason}`,
							}
						: job.kind === "visual"
							? { svg: "", notes: `FAILED: ${reason}` }
							: {
									path: typeof pdf?.path === "string" ? pdf.path : "",
									question: typeof pdf?.question === "string" ? pdf.question : "",
									brief: `PDF failed: ${reason}`,
									pagesRead: [],
									pagesConsulted: [],
								};
			await finishJob(jobId, failure);
		};
		let engine: PiEngine | undefined;
		try {
			if (job.kind === "demo") requireFormat("interactive");
			if (job.kind === "visual") requireFormat("diagram");
			engine = job.kind === "demo" && !demoModelOverride.current && deps.animationEngineFor ? deps.animationEngineFor(job.chatId,true) : pickEngine(job.kind);
		} catch (error) {
			await refuse(error instanceof Error ? error.message : String(error));
			return;
		}
		if (!engine) {
			const tier = ROLE_SLOT[KIND_ROLE[job.kind]];
			const envelope = modelsNotConfigured([tier]);
			console.info(`[job ${jobId}] refused — ${JSON.stringify(envelope)}`);
			await refuse(`${envelope.error} (missing: ${tier})`);
			return;
		}
		// Key presence (2026-09-25): the engine exists, but its provider's
		// key may be gone — refuse the spawn BEFORE the loop, same
		// convention (the injected check reads the key store; absent in
		// engine-injecting tests).
		const keyRefusal =
			deps.providerKeyMissing?.(engine.model.provider, ROLE_SLOT[KIND_ROLE[job.kind]]) ?? null;
		if (keyRefusal) {
			console.info(`[job ${jobId}] refused — ${JSON.stringify(keyRefusal)}`);
			await refuse(keyRefusal.error);
			return;
		}
		try {
			await run(jobId, engine, input, makeLoopContext(jobId, engine));
		} finally {
			unregisterJobAbort(jobId);
			// The last usage write may have been mid-flight when the loop died;
			// persist what was folded (the abort path patches only status, so
			// this never resurrects an aborted job — merge patch).
			const usage = usageTotals.get(jobId);
			if (usage) jobStore.updateJob(jobId, { usage });
			usageTotals.delete(jobId);
		}
	}

	async function runContextVisual(job: JobRecord, request: LessonAnimationRequest | CodedManimRequest) {
		const controller = new AbortController(); registerJobAbort(job.id,controller);
		const contextual = isLessonAnimationRequest(request);
		let format = contextual ? request.resolvedFormat : "video" as const;
		let title = contextual ? request.visualTitle || "Visual explanation" : request.title;
		try {
			if (!jobContext(job.id)) return;
			const allowedFormats = (["interactive", "video", "diagram"] as const).filter(enabledFormat);
			if (!allowedFormats.length) throw new Error("All visual formats are turned off. Enable a format in Settings, Agent.");
			if (format) requireFormat(format);
			if (contextual && request.preferredFormat && request.preferredFormat !== "auto") requireFormat(request.preferredFormat);
			const engine = deps.animationEngineFor?.(job.chatId, contextual ? request.automatic : true);
			if (!engine) throw new Error("Choose a teaching model in Providers before generating a visual.");
			if (deps.providerKeyMissing?.(engine.model.provider,"strong")) throw new Error("Connect your teaching provider, then try again.");
			const loop = makeLoopContext(job.id,engine,controller);
			const onActivity = (activity:string) => { if(stillRunning(job.id)) jobStore.updateJob(job.id,{activity}); };
			let brief = contextual ? request.visualBrief : request.brief;
			if (!format || !brief) {
				onActivity("Choosing the clearest visual explanation");
				const preferred = deps.visualAnimationsEnabled?.() === false ? "diagram" : contextual ? request.preferredFormat || "auto" : "video";
				const direction = await directLessonVisual(contextual ? request.context : request.brief,preferred,engine,{signal:controller.signal,onUsage:usage=>loop.onUsage(piUsageToStep(usage)),chatId:job.chatId,allowedFormats});
				format=direction.format; brief=direction.brief; title=direction.title;
				if (!stillRunning(job.id)) return;
				jobStore.updateJob(job.id,{kind:format==="interactive"?"demo":format==="diagram"?"visual":"animation",input:contextual?{...request,resolvedFormat:format,visualBrief:brief,visualTitle:title}:request});
			}
			requireFormat(format);
			if (!stillRunning(job.id)) return;
			let result: DemoResult | VisualResult | BlackboardArtifact;
			const preciseBrief = `${brief}\n\nTeaching requirements: use the requested concept and actual formulas; explain assumptions and projections. Compute values instead of animating arbitrary data. Include meaningful independent numerical or structural checks. Keep labels clear and readable. Never use em dashes.`;
			const reviewEngine=demoReviewModelOverride.current ?? deps.animationReviewEngineFor?.(job.chatId,contextual?request.automatic:true) ?? (engine.model.input.includes("image")?engine:undefined);
			if (format!=="diagram" && deps.animationReviewEngineFor && !reviewEngine) throw new Error("Choose a vision-capable model in Providers so the generated visual can be independently checked.");
			if (format==="interactive") {
				onActivity("Building and testing the interactive explanation");
				result=await runDemoBuilder({title,brief:preciseBrief},{engine,reviewEngine,requireRenderReview:!!deps.animationReviewEngineFor,onReviewUsage:usage=>recordUsage(job.id,`${reviewEngine!.model.provider}:${reviewEngine!.model.id}`,piUsageToStep(usage)),abortSignal:controller.signal,chatId:job.chatId,onUsage:usage=>loop.onUsage(piUsageToStep(usage)),onActivity,requireInteractionVerification:true});
			} else if (format==="diagram") {
				onActivity("Drawing and checking the diagram");
				const visualEngine=engine.model.input.includes("image")?engine:deps.animationReviewEngineFor?.(job.chatId,contextual?request.automatic:true);
				if (!visualEngine) throw new Error("Choose a vision-capable model to check the generated diagram.");
				result=await runVisualMaker({brief:preciseBrief},{engine:visualEngine,abortSignal:controller.signal,chatId:job.chatId,onUsage:usage=>recordUsage(job.id,`${visualEngine.model.provider}:${visualEngine.model.id}`,piUsageToStep(usage)),onActivity});
			} else {
				if (!deps.manimSceneRuntime) throw new Error("The code-driven ManimGX runtime is unavailable. Reinstall the current application.");
				onActivity("Authoring and reviewing the ManimGX scene");
				result=await runManimSceneBuilder({title,brief:preciseBrief},{...deps.manimSceneRuntime,engine,visionEngine:reviewEngine,abortSignal:controller.signal,chatId:job.chatId,onUsage:usage=>loop.onUsage(piUsageToStep(usage)),onReviewUsage:(usage,model)=>recordUsage(job.id,model,piUsageToStep(usage)),onActivity});
			}
			await finishJob(job.id,result);
		} catch(error) {
			if (controller.signal.aborted || !stillRunning(job.id)) return;
			const reason=error instanceof Error?error.message:String(error); jobStore.updateJob(job.id,{error:reason});
			const current=jobStore.getJob(job.id)!;
			await finishJob(job.id,current.kind==="demo"?{title,html:"",tested:true,notes:`FAILED: ${reason}`} : current.kind==="visual"?{svg:"",notes:`FAILED: ${reason}`} : {id:"",title,url:"",posterUrl:"",durationSeconds:0,sections:[],cacheHit:false,engine:"manimgx",notes:reason});
		} finally { unregisterJobAbort(job.id); usageTotals.delete(job.id); }
	}

	/** Dispatch input wins, then the job's saved arguments. Legacy jobs
	 * without saved input fall back to the durable transcript, which may
	 * lack a call if the dispatching turn died before settlement. */
	function resolveInput(
		job: JobRecord,
		input: JobToolInput | undefined,
	): JobToolInput | undefined {
		if (input) return input;
		if (job.input !== undefined) return job.input as JobToolInput;
		const chat = chatStore.getChat(job.chatId);
		if (!chat) return undefined;
		// Wave D: the record is native history — the scan reads the native
		// assistant blocks directly (a toolCall's arguments are the input).
		for (const m of chat.messages) {
			if ((m as { role?: string }).role !== "assistant") continue;
			const content = (m as { content?: unknown }).content;
			if (!Array.isArray(content)) continue;
			for (const block of content as Array<{ type?: string; id?: string; arguments?: unknown }>) {
				if (block.type !== "toolCall" || block.id !== job.toolCallId) continue;
				return block.arguments as JobToolInput | undefined;
			}
		}
		return undefined;
	}

	/**
	 * Save the computation outcome and session delivery obligation together.
	 * Worker liveness ends after cleanup, not after a lesson consumes the result.
	 */
	async function finishJob(jobId: string, result: ResearchResult | DemoResult | VisualResult | PdfResult | AnimationResult): Promise<void> {
		const job = jobStore.getJob(jobId);
		if (!job) return;
		// Aborted mid-run (abortJob flips the record before
		// the loop unwinds): no result write, no steer — the abort path owns
		// the record and queues the abort steer itself.
		if (job.status !== "running") return;
		const failed = isSubagentFailure(job.kind, result);
		jobStore.updateJob(jobId, {
			result,
			status: failed ? "error" : "done",
			activity: failed ? "failed" : "finished",
			...(failed && !job.error && "notes" in result && typeof result.notes === "string" ? { error: result.notes.replace(/^FAILED:\s*/, "").slice(0, 2500) } : {}),
			...(!isLessonAnimationRequest(job.input) ? { delivery: { kind: "result" as const, status: "pending" as const } } : {}),
		});
		// On-demand boards are displayed directly under their source explanation.
		// They must not wait behind a quiz or produce a second artifact through a wake turn.
		if (isLessonAnimationRequest(job.input)) return;
		// The saved result now belongs to the session. Do not keep the worker,
		// abort registration, or temporary resources alive behind a question.
		void deliver(buildSubagentSteer(job, result)).catch((err: unknown) => {
			console.error(`[job ${jobId}] pending delivery:`, err);
		});
	}

	/** Chat-record + input resolution shared by all three runners. */
	function jobContext(jobId: string): { job: JobRecord; chatId: string } | null {
		const job = jobStore.getJob(jobId);
		if (!job || job.status !== "running") return null;
		const chat = chatStore.getChat(job.chatId);
		if (!chat) {
			jobStore.updateJob(jobId, { status: "error", error: `Chat not found: ${job.chatId}`, activity: "failed" });
			return null;
		}
		return { job, chatId: job.chatId };
	}

	// ─── research ───────────────────────────────────────────────────────────

	async function runResearchJob(
		jobId: string,
		model: PiEngine | undefined,
		passedInput: JobToolInput | undefined,
		loop: LoopContext,
	): Promise<void> {
		const ctx = jobContext(jobId);
		if (!ctx) return;
		const { job } = ctx;

		const input = (passedInput ?? resolveInput(job, passedInput)) as ResearchToolInput | undefined;
		if (!(typeof input?.question === "string" && input.question.trim())) {
			jobStore.updateJob(jobId, { error: "research question unavailable" });
			await finishJob(jobId, { brief: "Research failed: the research question is unavailable.", sources: [] });
			return;
		}
		const question = input.question;
		const context = typeof input?.context === "string" && input.context.trim() ? input.context : undefined;

		const prompt = [
			`Research question: ${question}`,
			context ? `Context (what this is needed for): ${context}` : null,
			"Produce your final brief in the required format.",
		]
			.filter(Boolean)
			.join("\n\n");

		const fetchedUrls: string[] = [];
		// Per-job PDF dir (researcher PDF wave, 2026-10-07): web_fetch_pdf
		// downloads land here; every pdf tool is scoped to it; it dies with
		// the job (never enters the record).
		const pdfDir = await fs.mkdtemp(path.join(os.tmpdir(), "lh-research-"));

		try {
			jobStore.updateJob(jobId, { activity: "researching" });
			const brief = await runResearcherAgent(prompt, {
				engine: model,
				search: deps.searchProvider,
				pdfDir,
				abortSignal: loop.abortSignal,
				chatId: loop.chatId,
				// Money channel: each agent step is one model call — fold its
				// usage into the record as it completes (progress write).
				onUsage: (usage) => loop.onUsage(piUsageToStep(usage)),
					onToolStart: (toolName, args) => {
					const input = args as { query?: string; url?: string } | undefined;
					if (typeof input?.url === "string" && (toolName === "web_fetch" || toolName === "web_fetch_pdf")) {
						fetchedUrls.push(input.url);
					}
					jobStore.updateJob(jobId, { activity: activityLine(toolName, input) });
				},
			});
			if (!brief.trim()) throw new Error("the researcher produced no text");
			const research: ResearchResult = { brief: brief.trim(), sources: parseSources(brief.trim(), fetchedUrls) };
			await finishJob(jobId, research);
		} catch (err) {
			// Real-kill abort (2026-09): the abort path flipped the record and
			// queued the abort steer — unwind silently, keep the usage
			// folded so far (flushed by runJob's finally).
			if (loop.abortSignal.aborted) return;
			const reason = err instanceof Error ? err.message : String(err);
			if (stillRunning(jobId)) jobStore.updateJob(jobId, { error: reason });
			await finishJob(jobId, { brief: `Research failed: ${reason}`, sources: [] });
		} finally {
			await fs.rm(pdfDir, { recursive: true, force: true });
		}
	}

	// ─── demo + visual ──────────────────────────────────────────────────────

	async function runDemoJob(
		jobId: string,
		model: PiEngine | undefined,
		passedInput: JobToolInput | undefined,
		loop: LoopContext,
	): Promise<void> {
		const ctx = jobContext(jobId);
		if (!ctx) return;
		const { job } = ctx;

		const input = (passedInput ?? resolveInput(job, passedInput)) as DemoToolInput | undefined;
		const title = typeof input?.title === "string" && input.title.trim() ? input.title : "Interactive demo";
		const brief = typeof input?.brief === "string" ? input.brief : "";

		try {
			jobStore.updateJob(jobId, { activity: "building demo" });
			const reviewEngine=demoReviewModelOverride.current ?? deps.animationReviewEngineFor?.(job.chatId,true) ?? (model?.model.input.includes("image")?model:undefined);
			if(deps.animationReviewEngineFor&&!reviewEngine) throw new Error("Choose a vision-capable model to review the interactive visual.");
			const result = await runDemoBuilder(
				{ title, brief },
				{
					engine: model,
					abortSignal: loop.abortSignal,
					chatId: loop.chatId,
					requireInteractionVerification: true,
					requireRenderReview: !!deps.animationReviewEngineFor,
					reviewEngine,
					onReviewUsage:usage=>recordUsage(jobId,`${reviewEngine!.model.provider}:${reviewEngine!.model.id}`,piUsageToStep(usage)),
					onUsage: (usage) => loop.onUsage(piUsageToStep(usage)),
					onActivity: (line) => jobStore.updateJob(jobId, { activity: line }),
				},
			);
			if (isDemoFailure(result) && stillRunning(jobId))
				jobStore.updateJob(jobId, { error: result.notes ?? "demo build failed" });
			await finishJob(jobId, result);
		} catch (err) {
			if (loop.abortSignal.aborted) return;
			const reason = err instanceof Error ? err.message : String(err);
			if (stillRunning(jobId)) jobStore.updateJob(jobId, { error: reason });
			await finishJob(jobId, { title, html: "", tested: true, notes: `FAILED: ${reason}` });
		}
	}

	async function runVisualJob(
		jobId: string,
		model: PiEngine | undefined,
		passedInput: JobToolInput | undefined,
		loop: LoopContext,
	): Promise<void> {
		const ctx = jobContext(jobId);
		if (!ctx) return;
		const { job } = ctx;

		const input = (passedInput ?? resolveInput(job, passedInput)) as VisualToolInput | undefined;
		const brief = typeof input?.brief === "string" ? input.brief : "";

		try {
			jobStore.updateJob(jobId, { activity: "drawing figure" });
			const result = await runVisualMaker(
				{ brief },
				{
					engine: model,
					abortSignal: loop.abortSignal,
					chatId: loop.chatId,
					onUsage: (usage) => loop.onUsage(piUsageToStep(usage)),
					onActivity: (line) => jobStore.updateJob(jobId, { activity: line }),
				},
			);
			if (isVisualFailure(result) && stillRunning(jobId))
				jobStore.updateJob(jobId, { error: result.notes ?? "visual build failed" });
			await finishJob(jobId, result);
		} catch (err) {
			if (loop.abortSignal.aborted) return;
			const reason = err instanceof Error ? err.message : String(err);
			if (stillRunning(jobId)) jobStore.updateJob(jobId, { error: reason });
			await finishJob(jobId, { svg: "", notes: `FAILED: ${reason}` });
		}
	}

	// ─── pdf reading (sources v0) ────────────────────────────────────────────

	async function runPdfJob(
		jobId: string,
		model: PiEngine | undefined,
		passedInput: JobToolInput | undefined,
		loop: LoopContext,
	): Promise<void> {
		const ctx = jobContext(jobId);
		if (!ctx) return;
		const { job } = ctx;

		const input = (passedInput ?? resolveInput(job, passedInput)) as PdfToolInput | undefined;
		const path = typeof input?.path === "string" && input.path.trim() ? input.path.trim() : "";
		const question = typeof input?.question === "string" ? input.question : "";

		try {
			jobStore.updateJob(jobId, { activity: "reading pdf" });
			const result = await runPdfReaderAgent(
				{ path, question },
			{
				engine: model,
				abortSignal: loop.abortSignal,
				chatId: loop.chatId,
				onUsage: (usage) => loop.onUsage(piUsageToStep(usage)),
				onActivity: (line) => jobStore.updateJob(jobId, { activity: line }),
			},
			);
			if (isPdfFailure(result) && stillRunning(jobId))
				jobStore.updateJob(jobId, { error: result.brief.replace(/^PDF failed:\s*/i, "") });
			await finishJob(jobId, result);
		} catch (err) {
			if (loop.abortSignal.aborted) return;
			const reason = err instanceof Error ? err.message : String(err);
			if (stillRunning(jobId)) jobStore.updateJob(jobId, { error: reason });
			await finishJob(jobId, { path, question, brief: `PDF failed: ${reason}`, pagesRead: [], pagesConsulted: [] });
		}
	}

	return { runJob };
}

// ─── module-level pure helpers ──────────────────────────────────────────────

/** Failure shape (W6 brief): html === "" with "FAILED: …" notes. */
function isDemoFailure(result: DemoResult): boolean {
	return typeof result.html !== "string" || result.html.length === 0;
}

function isVisualFailure(result: VisualResult): boolean {
	return typeof result.svg !== "string" || result.svg.length === 0;
}

/** The pdf-reader's failure brief (mirrors the research failure shape). */
function isPdfFailure(result: PdfResult): boolean {
	return /^PDF failed:/i.test(result.brief);
}

/** The activity line shown in the UI: `web_search: "query"` / `web_fetch: host`. */
function activityLine(toolName: string, input: { query?: string; url?: string } | undefined): string {
	if (toolName === "web_search") return `web_search: "${input?.query ?? ""}"`;
	if (toolName === "web_fetch") return `web_fetch: ${hostOf(input?.url)}`;
	return toolName;
}

function hostOf(url: string | undefined): string {
	if (!url) return "(no url)";
	try {
		return new URL(url).hostname;
	} catch {
		return url.slice(0, 40);
	}
}

/** Sources for the result: markdown links cited in the brief, else fetched URLs. */
function parseSources(brief: string, fetchedUrls: string[]): ResearchResult["sources"] {
	const sources: ResearchResult["sources"] = [];
	const seen = new Set<string>();
	for (const match of brief.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) {
		const title = (match[1] ?? "").trim();
		const url = match[2]!;
		if (!title || seen.has(url)) continue;
		seen.add(url);
		sources.push({ title, url });
	}
	if (sources.length === 0) {
		for (const url of fetchedUrls) {
			if (seen.has(url)) continue;
			seen.add(url);
			sources.push({ title: hostOf(url), url });
		}
	}
	return sources.slice(0, 10);
}
