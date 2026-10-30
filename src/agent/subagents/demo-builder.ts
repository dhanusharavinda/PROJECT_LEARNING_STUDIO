import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import { serverExecute } from "../tool-execute.ts";
import type { PiEngine } from "../models.ts";
import { runSubagent } from "./pi-run.ts";
import type { DemoResult } from "../../core/contracts.ts";
import { getHeadless, type DemoRunResult, type HeadlessApi } from "./headless.ts";
import { healToolRecord } from "../tools/heal.ts";
import { INTERACTIVE_DEMO_PROBE, interactionReportProblem, offlineDemoDocument } from "../../core/demo-quality.ts";
import { reviewInteractiveDemo } from "./demo-reviewer.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

/**
 * The demo-builder sub-agent (vision §2 interactive demos + §2.5 "sub-agents
 * verify; they never one-shot"): given a brief it writes a self-contained
 * single-file HTML/JS demo, TESTS IT HEADLESSLY (run_demo), and iterates
 * fix → re-run until clean — before anything reaches the lesson.
 *
 * Shape: a ToolLoopAgent with two executable tools (write_demo / run_demo) —
 * the engine is injectable (tests use a scripted faux engine) and the headless
 * API is injectable (tests use a fake; production uses the app's own
 * Chromium browser service, system Chrome as fallback).
 *
 * Failure semantics (decided in the W6 brief): `tested: true` means "the
 * verify loop ran"; on failure the result is { title, html: "", tested: true,
 * notes: "FAILED: <reason>" } — the card renders the failure note, no iframe.
 * The job wrapper treats html === "" as failure and marks the job error.
 */

export interface DemoBuilderInput {
	title: string;
	brief: string;
}

export interface DemoBuilderOptions {
	/** An independent model checks the final source and actual browser pixels. */
	reviewEngine?: PiEngine;
	/** Production quality paths require actual pixels and an image-capable critic. */
	requireRenderReview?: boolean;
	onReviewUsage?: (usage: Usage) => void;
	/** New visual-learning paths require real parameter and numerical checks. */
	requireInteractionVerification?: boolean;
	/** Test seam: scripted engine; production uses the demoBuilder role. */
	engine?: PiEngine;
	headless?: HeadlessApi;
	/** Max agent steps (each write/run/fix is one step). Default 24 ≈ 6 cycles. */
	maxSteps?: number;
	/** Live activity-line callback (updates the job record). */
	onActivity?: (line: string) => void;
	/** Kills the run mid-model-call (2026-09 real-kill abort semantics). */
	abortSignal?: AbortSignal;
	/** Money channel: one call per agent step, folded into JobRecord.usage. */
	onUsage?: (usage: Usage) => void;
	/** Debug: raw provider-event recording key (LH_PROVIDER_EVENTS=1). */
	chatId?: string;
}

const INSTRUCTIONS = `You are a demo builder, a specialist sub-agent inside a learning application. You
receive a brief for ONE interactive teaching instrument and deliver a single self-contained HTML document
that runs it. You never see the lesson; the brief is everything you know.

Runtime contract (the document runs in a sandboxed iframe, sandbox="allow-scripts", opaque origin):
- Single file. Use Canvas 2D, SVG, or WebGL for 2D and 3D as the concept requires. A rotating camera,
  a projected 3D loss surface, a network with meaningful weighted signals, a vector field, or a
  continuously recomputed mathematical plot are appropriate. A video or decorative animation is not
  an interactive instrument. Prefer self-contained code; never require external resources for offline use.
- NO localStorage, sessionStorage, or document.cookie — the sandbox makes them throw.
- The parent sizes the iframe to the document height automatically; just build normal flowing layout.
  Make the demo fill the width and size its own height sensibly.

Build quality:
- The demo must directly serve the brief: every control named in the brief must exist and do the thing.
- Controls need labels; sliders/inputs need current-value readouts. A learner should operate it unguided.
- Smooth enough interaction; requestAnimationFrame for animation, not setInterval when it matters.
- Match the brief's visual style. Use a restrained dark charcoal surface with clear labels, teal controls,
  and orange moving signals when no style is specified. Use responsive flowing layout, a bounded canvas,
  readable contrast, touch-size controls, and a numerical readout. Never use em dashes.
- Put the main working visualization first, immediately after a short title and at most one sentence.
  This is an instrument inside a chat, not a long article. At a typical 720 px embed width, aim to fit
  the visible plot, primary controls and one concise current-result readout within the first 640 px
  of document height. Place primary controls directly beside or immediately below the visualization.
  Do not put a full controls dashboard, stability-badge grid, equation wall or long preamble before it.
- Keep the default composition compact and premium: one clear visual, restrained typography, minimal
  panel chrome, and only essential controls/readouts visible. A learner should see the phenomenon and
  change it without scrolling past explanation. Put optional derivations, full formula lists, secondary
  diagnostics and self-test explanations in default-collapsed <details> after the instrument. Keep a
  short defining formula or essential model caveat visible when needed for an honest interpretation.
- Adapt at narrow widths with a responsive, bounded plot and stacked controls. Never force a wide
  desktop grid or 100vh iframe layout, clip labels, or shrink text into illegibility to meet a height
  target. Preserve the full mathematics and useful complexity in the expandable detail, not above the plot.
- Every slider must change the underlying calculation or explicitly identified camera/view parameter.
  Derive the model first. Display the formula and units when useful. Never use random particles as a
  substitute for computed signals, silently clip divergence to look convergent, or label a toy model as
  a full neural network. Distinguish illustrations from literal high-dimensional representations.
- Give motion pause/play, single-step and reset. Expose current parameters and results. Honor
  window.__learningMotionEnabled and the learning-motion-change event, pausing without discarding state.
- Teach with an intervention: invite a prediction, let the learner change one parameter, show the result,
  and provide a concise explanation of what changed. Ask a concept question rather than implying that
  watching the animation establishes understanding.

THE HOUSE RULE — never deliver untested:
1. Call write_demo with the complete HTML document.
2. Call run_demo. It loads the file in a headless browser, waits ~2s, and reports console errors, uncaught
   errors (window.onerror), and failed requests. Optionally pass a probe: a JS expression evaluated in
   the page (e.g. "typeof window.simulate === 'function'" or a state assertion) to check deeper.
3. If run_demo reports problems, FIX the document and call write_demo again, then run_demo again.
   Iterate until run_demo reports PASSED.
4. Only then finish. Your final message is 1-3 sentences of NOTES for the teacher (what the demo shows,
   its controls, what to try) — NEVER the HTML itself.

Never claim success you did not see: a PASSED run_demo is the only definition of done.`;

const INTERACTION_INSTRUCTIONS = `
STRICT INTERACTIVE VERIFICATION:
The delivered document must be dependency-free and work offline in an opaque-origin iframe. No fetch,
CDN, iframe, external font or image dependency. Author any needed Canvas, SVG or WebGL code in the file.
Expose window.__learningDemo with snapshot(), reset(), and selfTest(). snapshot() must return a JSON-safe
object {parameters:{parameterName:number,...}, values:{computedModelValues...}, playing:boolean,steps:number}.
Never fake these values. Values must reflect the same calculation used by the rendered figure.
Use input[type=range] with data-demo-control="parameterName" and a real label; its input event must update
snapshot().parameters[parameterName]. Provide buttons with data-demo-action="toggle-play", "step", and "reset".
The toggle must really set playing true/false, pause must freeze values, step must advance the simulation,
and reset must restore steps to zero. Keep current parameters on reset unless an explicitly labeled restore-defaults
control is used. selfTest() returns at least two {label,passed,detail?} numerical assertions calculated from
independently known examples, such as a known derivative, equilibrium, dot product, or conservation identity.
These checks must exercise the calculation functions used by the simulation, not return constant true.
run_demo will actually operate every marked slider and button and check these assertions. A blank canvas,
no-op controls, missing contract, nonfinite values, a false assertion, or a prose claim of testing will fail.
Write the full instrument, call run_demo, use its failure details to repair, then re-test before finishing.`;

interface BuilderState {
	html: string | null;
	/** The html that the last run_demo tested (null = never tested). */
	testedHtml: string | null;
	lastResult: DemoRunResult | null;
}

const writeDemoInput = Type.Object({
	html: Type.String({ description: "The complete HTML document: <!doctype html>…</html>, all JS inline." }),
});

const runDemoInput = Type.Object({
	probe: Type.Optional(
		Type.String({
			description:
				"Optional JS expression evaluated in the page after settling, e.g. \"document.querySelectorAll('input').length\".",

		}),
	),
});

export function createDemoBuilderTools(
	state: BuilderState,
	headless: HeadlessApi,
	onActivity?: (line: string) => void,
	requireInteractionVerification = false,
): Record<string, AgentTool<any>> {
	return healToolRecord({
		write_demo: {
			name: "write_demo",
			label: "write_demo",
			description:
				"Write the complete self-contained HTML document for the demo (overwrites any previous version). " +
				"Always follow with run_demo to test it headlessly.",
			parameters: writeDemoInput,
			execute: serverExecute("write_demo", writeDemoInput, async ({ html }) => {
				if (!html || html.trim().length === 0) return "ERROR: empty document — write the full HTML.";
				state.html = html;
				onActivity?.(`write_demo: ${(html.length / 1024).toFixed(1)} KB`);
				return `Saved (${html.length} bytes). Now call run_demo to test it — never deliver untested.`;
			}),
		},
		run_demo: {
			name: "run_demo",
			label: "run_demo",
			description:
				"Headlessly execute the current demo in a browser and report console errors, uncaught errors, and failed requests. " +
				"Optionally pass a probe expression to assert on page state.",
			parameters: runDemoInput,
			execute: serverExecute("run_demo", runDemoInput, async ({ probe }) => {
				if (!state.html) return "ERROR: nothing to run — call write_demo first.";
				const reason = headless.unavailableReason();
				if (reason) return `HEADLESS UNAVAILABLE: ${reason}`;
				let result: DemoRunResult;
				try {
					result = await verifyDemo(headless,state.html,requireInteractionVerification,probe);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					onActivity?.("run_demo: browser error");
					return `HEADLESS ERROR (retrying may help): ${msg}`;
				}
				state.testedHtml = state.html;
				state.lastResult = result;
				onActivity?.(
					result.ok ? "run_demo: clean" : `run_demo: ${summarizeCounts(result)}`,
				);
				return formatRunResult(result);
			}),
		},
	});
}

export async function verifyDemo(headless: HeadlessApi, html: string, strict: boolean, probe?: string, captureScreenshot = false): Promise<DemoRunResult> {
	const expression = strict ? `(async()=>({quality:await(${INTERACTIVE_DEMO_PROBE}),custom:${probe ? `await(${probe})` : "undefined"}}))()` : probe;
	const result=await headless.runDemo(html,{...(expression?{probe:expression}:{}),...(strict?{sandboxed:true}:{}),...(captureScreenshot?{captureScreenshot:true}:{})});
	let problem: string | null=null;
	if(strict){const report=result.probeResult as {quality?:unknown;custom?:unknown}|undefined;problem=interactionReportProblem(report?.quality);if(!problem && report?.custom===false)problem="The custom probe returned false.";}
	else if(result.probeResult===false)problem="The probe assertion returned false.";
	return problem ? {...result,ok:false,pageErrors:[...result.pageErrors,problem]} : result;
}

function summarizeCounts(result: DemoRunResult): string {
	const counts = [
		result.consoleErrors.length > 0 ? `${result.consoleErrors.length} console error${result.consoleErrors.length === 1 ? "" : "s"}` : null,
		result.pageErrors.length > 0 ? `${result.pageErrors.length} page error${result.pageErrors.length === 1 ? "" : "s"}` : null,
		result.failedRequests.length > 0 ? `${result.failedRequests.length} failed request${result.failedRequests.length === 1 ? "" : "s"}` : null,
	].filter(Boolean);
	return counts.length > 0 ? counts.join(", ") : "ok";
}

function formatRunResult(result: DemoRunResult): string {
	if (result.ok) {
		const probe =
			result.probeResult !== undefined
				? ` Probe result: ${JSON.stringify(result.probeResult) ?? "undefined"}.`
				: "";
		return `PASSED: no console errors, no uncaught errors, no failed requests.${probe} If you are satisfied, finish with your notes; otherwise keep improving and re-test.`;
	}
	const sections: string[] = [`FAILED: ${summarizeCounts(result)}.`];
	if (result.consoleErrors.length > 0)
		sections.push(`Console errors:\n${result.consoleErrors.slice(0, 10).map((e) => `- ${e}`).join("\n")}`);
	if (result.pageErrors.length > 0)
		sections.push(`Uncaught errors:\n${result.pageErrors.slice(0, 10).map((e) => `- ${e}`).join("\n")}`);
	if (result.failedRequests.length > 0)
		sections.push(`Failed requests:\n${result.failedRequests.slice(0, 10).map((r) => `- ${r}`).join("\n")}`);
	sections.push("Fix the document (write_demo) and re-test (run_demo).");
	return sections.join("\n");
}

/** Short summary of a run for failure notes. */
function failureSummary(result: DemoRunResult | null): string {
	if (!result) return "never tested";
	const details = [...result.consoleErrors, ...result.pageErrors, ...result.failedRequests].slice(0, 5);
	return details.length > 0 ? `${summarizeCounts(result)} — ${details.join(" | ")}` : summarizeCounts(result);
}

export async function runDemoBuilder(input: DemoBuilderInput, opts: DemoBuilderOptions = {}): Promise<DemoResult> {
	const headless = opts.headless ?? getHeadless();
	const title = input.title.trim() || "Interactive demo";
	const brief = input.brief.trim() || "(no brief)";
	const notes = (text: string) => (text.trim() ? text.trim() : undefined);

	const reason = headless.unavailableReason();
	if (reason) {
		return { title, html: "", tested: true, notes: `FAILED: ${reason}` };
	}

	if (opts.requireRenderReview && (!opts.reviewEngine || !opts.reviewEngine.model.input.includes("image"))) {
		return { title, html: "", tested: true, notes: "FAILED: visual review requires an image-capable independent review model." };
	}
	const state: BuilderState = { html: null, testedHtml: null, lastResult: null };

	const prompt = [
		`Demo title: ${title}`,
		`Brief (all you know about the lesson — this comes from the teacher, verbatim):`,
		brief,
		"",
		"Build the demo, test it with run_demo, iterate until PASSED, then finish with your notes.",
	].join("\n");

	let finalText = "";
	let history: AgentMessage[] = [];
	const attempts=opts.reviewEngine?3:1;
	for(let attempt=0;attempt<attempts;attempt++){
	try {
		const result = await runSubagent(Object.values(createDemoBuilderTools(state, headless, opts.onActivity,opts.requireInteractionVerification)), {
			role: "demoBuilder",
			engine: opts.engine,
			systemPrompt: INSTRUCTIONS+(opts.requireInteractionVerification?INTERACTION_INSTRUCTIONS:""),
			...(history.length?{messages:history}:{prompt}),
			maxTurns: attempt===0 ? opts.maxSteps ?? 24 : Math.min(opts.maxSteps ?? 24,12),
			abortSignal: opts.abortSignal,
			onUsage: (usage) => opts.onUsage?.(usage),
			onToolStart: (toolName) => opts.onActivity?.(toolName),
			chatId: opts.chatId,
		});
		finalText = result.text;
		history=[...history,...result.newMessages];
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { title, html: "", tested: true, notes: msg === "terminated" ? "FAILED: The model provider interrupted generation. Retry the visual, or choose another available model." : `FAILED: the builder crashed: ${msg}` };
	}

	// The model produced nothing.
	if (!state.html) {
		return {
			title,
			html: "",
			tested: true,
			notes: `FAILED: the builder never wrote a demo.${finalText ? ` (${finalText.slice(0, 300)})` : ""}`,
		};
	}

	// The verify gate: the delivered html must have a clean headless run —
	// even when the model claims success or forgets the final run_demo.
	if (state.testedHtml !== state.html || !state.lastResult?.ok || opts.reviewEngine) {
		opts.onActivity?.("final verification");
		let verify: DemoRunResult;
		try {
			verify = await verifyDemo(headless,state.html,opts.requireInteractionVerification===true,undefined,!!opts.reviewEngine);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { title, html: "", tested: true, notes: `FAILED: final verification crashed: ${msg}` };
		}
		state.lastResult = verify;
		if (!verify.ok) {
			return {
				title,
				html: "",
				tested: true,
				notes: `FAILED: the demo never passed headless verification (${failureSummary(verify)}).`,
			};
		}
	}
	if (opts.requireRenderReview && !state.lastResult?.screenshot?.length) {
		return { title, html: "", tested: true, notes: `FAILED: the browser could not capture the simulation for visual review. ${state.lastResult?.screenshotError ?? "No usable browser pixels were returned."}` };
	}
	if(opts.reviewEngine){
		opts.onActivity?.("Reviewing the simulation and its mathematics");
		try{
			const review=await reviewInteractiveDemo({title,brief,html:state.html,screenshot:state.lastResult?.screenshot},{engine:opts.reviewEngine,signal:opts.abortSignal,onUsage:opts.onReviewUsage,chatId:opts.chatId});
			if(!review.approved){
				const issues=review.issues.join("; ") || "The independent reviewer did not approve this instrument.";
				if(attempt===attempts-1)return{title,html:"",tested:true,notes:`FAILED: independent quality review: ${issues}`};
				opts.onActivity?.("Repairing the review findings");
				history.push({role:"user",content:`An independent reviewer rejected the instrument. Repair these concrete problems in the current HTML, then run_demo again. Do not merely describe the fixes. Issues: ${issues}`,timestamp:Date.now()});
				continue;
			}
			const scope=review.scope==="code-and-render"?"Independent source and rendered-scene review passed.":"Independent source review passed. No visual review was possible because a usable image or image-capable review model was unavailable.";
			finalText=[finalText,scope].filter(Boolean).join(" ");
		}catch(error){return{title,html:"",tested:true,notes:`FAILED: independent quality review could not finish: ${error instanceof Error?error.message:String(error)}`};}
	}

	return { title, html: opts.requireInteractionVerification ? offlineDemoDocument(state.html) : state.html, tested: true, notes: notes(finalText) };
	}
	return {title,html:"",tested:true,notes:"FAILED: the instrument did not complete the required quality checks."};
}
