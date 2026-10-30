"use client";

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { DownloadIcon } from "lucide-react";
import { Toggle } from "@/components/settings/controls";
import { InvertDiscIcon } from "@/components/artifacts/invert-disc";
import { ChatActionsContext } from "@/components/chat";
import { downloadFile, slugFilename } from "@/components/artifacts/download";
import { DispatchCard } from "@/components/artifacts/dispatch-card";
import type { ArtifactPartProps, DemoResult } from "@/src/core";
import { useVisualLearning } from "@/components/visual-learning-toggle";
import { SourceCode } from "./source-code";
import { JobsContext } from "@/components/jobs-context";

/**
 * Demo artifact card (W6): while the part is input-available, a job activity
 * card (the chat view's jobs feed — the job-card idiom); when output-available, the demo
 * runs in a SANDBOXED iframe (sandbox="allow-scripts", no allow-same-origin →
 * no access to app storage/cookies/DOM).
 *
 * The bridge script (contracts.ts "Demo iframe bridge") is auto-injected into
 * every demo by buildDemoSrcDoc — never the model's job: ResizeObserver →
 * postMessage {type:"demo-resize",height} (parent sizes the iframe) and
 * window.onerror → {type:"demo-error",message} (error chip on the card, with
 * a "Send to teacher" button that feeds the error back into the lesson — the
 * fix loop).
 *
 * Bridge message handling is a pure function (reduceDemoBridgeState) so
 * tests cover it without a DOM.
 */

// ─── bridge injection + message handling (pure, testable) ───────────────────

export const DEMO_BRIDGE_SCRIPT = `<script>(function(){
var send=function(m){try{parent.postMessage(m,"*")}catch(e){}};
var post=function(){
var b=document.body;
if(!b){send({type:"demo-resize",height:document.documentElement.scrollHeight});return}
var h=Math.max(b.scrollHeight,b.getBoundingClientRect().height);
var cs=getComputedStyle(b);
h+=(parseFloat(cs.marginTop)||0)+(parseFloat(cs.marginBottom)||0);
send({type:"demo-resize",height:Math.ceil(h)})
};
if(typeof ResizeObserver!=="undefined"){new ResizeObserver(post).observe(document.documentElement)}
window.addEventListener("resize",post);
window.addEventListener("load",post);
window.addEventListener("error",function(e){send({type:"demo-error",message:e.message||String(e)})});
setTimeout(post,50);
setTimeout(post,400);
})();</script>`;

/** Install motion control before authored scripts, after any document policy. */
export function demoMotionScript(initialEnabled: boolean): string {
	return `<script>(function(){
var clock=performance.now.bind(performance),enabled=${initialEnabled ? "true" : "false"},pausedAt=enabled?null:clock(),pausedDuration=0,nextFrame=1;
var raf=requestAnimationFrame.bind(window),cancel=cancelAnimationFrame.bind(window),timeout=setTimeout.bind(window),clear=clearTimeout.bind(window),interval=setInterval.bind(window);
var frames=new Map(),timers=new Map(),animations=[],media=[];
try{Object.defineProperty(performance,'now',{configurable:true,value:function(){return(enabled?clock():pausedAt)-pausedDuration}})}catch(e){}
var style=document.createElement('style');style.textContent='html[data-learning-motion="paused"] *,html[data-learning-motion="paused"] *::before,html[data-learning-motion="paused"] *::after{animation-play-state:paused!important;transition:none!important}';(document.head||document.documentElement).appendChild(style);
var nativeAnimate=Element.prototype.animate;if(nativeAnimate)Element.prototype.animate=function(){var animation=nativeAnimate.apply(this,arguments);if(!enabled){animation.pause();animations.push(animation)}return animation};
document.addEventListener('play',function(event){if(!enabled&&event.target&&typeof event.target.pause==='function')event.target.pause()},true);
function frame(id){var entry=frames.get(id);if(!entry||!enabled)return;entry.native=raf(function(time){if(!frames.has(id))return;if(!enabled){entry.native=null;return}frames.delete(id);entry.fn(time-pausedDuration)})}
window.requestAnimationFrame=function(fn){var id=nextFrame++;frames.set(id,{fn:fn,native:null});frame(id);return id};
window.cancelAnimationFrame=function(id){var entry=frames.get(id);if(entry&&entry.native!==null)cancel(entry.native);frames.delete(id)};
window.setTimeout=function(fn,delay){var args=Array.prototype.slice.call(arguments,2);if(typeof fn!=='function')return timeout.apply(window,arguments);var id=timeout(function(){var item=timers.get(id);if(!item)return;if(!enabled){item.pending=true;return}timers.delete(id);fn.apply(window,args)},delay);timers.set(id,{fn:fn,args:args,pending:false});return id};
window.clearTimeout=function(id){timers.delete(id);clear(id)};
window.setInterval=function(fn,delay){var args=Array.prototype.slice.call(arguments,2);if(typeof fn!=='function')return interval.apply(window,arguments);return interval(function(){if(enabled)fn.apply(window,args)},delay)};
function apply(next){if(next===enabled){document.documentElement.dataset.learningMotion=next?'playing':'paused';return}var now=clock();enabled=next;window.__learningMotionEnabled=next;
if(!next){pausedAt=now;frames.forEach(function(entry){if(entry.native!==null){cancel(entry.native);entry.native=null}});animations=typeof document.getAnimations==='function'?document.getAnimations().filter(function(a){return a.playState==='running'}):[];animations.forEach(function(a){a.pause()});media=Array.from(document.querySelectorAll('video,audio')).filter(function(m){return !m.paused});media.forEach(function(m){m.pause()})}
else{if(pausedAt!==null)pausedDuration+=now-pausedAt;pausedAt=null;frames.forEach(function(_,id){frame(id)});timers.forEach(function(item,id){if(item.pending){timers.delete(id);timeout(function(){item.fn.apply(window,item.args)},0)}});animations.forEach(function(a){try{a.play()}catch(e){}});media.forEach(function(m){try{var p=m.play();if(p)p.catch(function(){})}catch(e){}});animations=[];media=[]}
document.documentElement.dataset.learningMotion=next?'playing':'paused';window.dispatchEvent(new CustomEvent('learning-motion-change',{detail:{enabled:next}}));document.dispatchEvent(new CustomEvent('learning-motion-change',{detail:{enabled:next}}))}
window.__learningMotionEnabled=enabled;document.documentElement.dataset.learningMotion=enabled?'playing':'paused';
window.addEventListener('message',function(event){if(event.source!==parent||!event.data||event.data.type!=='learning-motion'||typeof event.data.enabled!=='boolean')return;apply(event.data.enabled)});
})();</script>`;
}

/** Inject resize/error reporting without giving the iframe app-origin access. */
export function buildDemoSrcDoc(html: string, initialMotionEnabled = true): string {
	const motion = demoMotionScript(initialMotionEnabled);
	const controlled = /<script\b/i.test(html) ? html.replace(/<script\b/i, `${motion}<script`) : /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${motion}</head>`) : `${html}${motion}`;
	if (/<\/body>/i.test(controlled)) return controlled.replace(/<\/body>/i, `${DEMO_BRIDGE_SCRIPT}</body>`);
	return `${controlled}${DEMO_BRIDGE_SCRIPT}`;
}

export interface DemoBridgeState {
	height: number | null;
	error: string | null;
}

export const INITIAL_DEMO_BRIDGE_STATE: DemoBridgeState = { height: null, error: null };

const MIN_HEIGHT = 80;
const MAX_HEIGHT = 2400;

/** Pure reducer over incoming postMessage data (contracts.ts DemoBridgeMessage). */
export function reduceDemoBridgeState(state: DemoBridgeState, data: unknown): DemoBridgeState {
	if (typeof data !== "object" || data === null) return state;
	const message = data as { type?: unknown; height?: unknown; message?: unknown };
	if (message.type === "demo-resize") {
		if (typeof message.height !== "number" || !Number.isFinite(message.height) || message.height <= 0) return state;
		const height = Math.min(Math.max(Math.round(message.height), MIN_HEIGHT), MAX_HEIGHT);
		return height === state.height ? state : { ...state, height };
	}
	if (message.type === "demo-error") {
		const text = typeof message.message === "string" && message.message.trim() ? message.message : "unknown error";
		return text === state.error ? state : { ...state, error: text };
	}
	return state;
}

// ─── the demo card ──────────────────────────────────────────────────────────

/** The demo tool-call box: the part's output is the dispatch ack — the box
 * is the DispatchCard (live status via the chat view's jobs feed). The demo
 * itself renders from the steer message via DemoOutputCard. */
export function DemoCard({ part }: ArtifactPartProps) {
	const job = useContext(JobsContext).find(j => j.toolCallId === part.toolCallId && j.kind === "demo");
	if (part.state !== "output-available") return null;
	if (job?.status !== "running" && job?.result && job.delivery?.status === "pending") return <DemoOutputCard output={job.result} />;
	return <DispatchCard toolCallId={part.toolCallId} kind="demo" />;
}

/** The demo artifact — exported: the steer card renders the delivered
 *  result. `messageId` + `initialInverted` carry the PERSISTED invert
 *  switch (details.ui.inverted via the artifact-ui route, owner 2026-10-07). */
export function DemoOutputCard({
	output,
	messageId,
	initialInverted = false,
}: {
	output: unknown;
	messageId?: string;
	initialInverted?: boolean;
}) {
	const result = output as DemoResult | undefined;
	if (!result || typeof result.html !== "string" || typeof result.title !== "string") {
		return (
			<div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
				Demo completed, but the result could not be displayed.
			</div>
		);
	}
	const failed = result.html.length === 0;
	if (failed) {
		return (
			<div className="rounded-xl border bg-card p-4 text-card-foreground" data-testid="demo-card-failed">
				<div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
					Interactive demo
					<span className="rounded bg-red-500/15 px-1.5 py-0.5 text-red-500">failed</span>
				</div>
				<p className="mt-2 text-sm text-muted-foreground">{result.notes ?? "The demo could not be built."}</p>
			</div>
		);
	}
	return (
		<DemoFrame title={result.title} html={result.html} messageId={messageId} initialInverted={initialInverted} />
	);
}

function DemoFrame({
	title,
	html,
	messageId,
	initialInverted = false,
}: {
	title: string;
	html: string;
	messageId?: string;
	initialInverted?: boolean;
}) {
	const actions = useContext(ChatActionsContext);
	const motion = useVisualLearning();
	const iframeRef = useRef<HTMLIFrameElement | null>(null);
	const [state, setState] = useState<DemoBridgeState>(INITIAL_DEMO_BRIDGE_STATE);
	// Brightness inversion (owner, 2026-10-07): the switch state PERSISTS on
	// the steer record (details.ui.inverted) — seeded here, written through
	// the silent artifact-ui route on toggle. Without a chat page (tests,
	// previews) the toggle stays local-only. The filter rides the iframe
	// element, which carries the card's white backing, so one filter flips
	// page + content together while hue-rotate(180deg) undoes invert's hue
	// flip.
	const [inverted, setInverted] = useState(initialInverted);
	const toggleInverted = (next: boolean) => {
		setInverted(next);
		if (!actions?.chatId || !messageId) return;
		void fetch(`/api/chats/${actions.chatId}/artifact-ui`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ input: { messageId, inverted: next } }),
		}).catch(() => {});
	};
	// Start paused until the parent supplies its saved preference. Keep srcDoc
	// stable when toggling so a learner's sliders and model state survive.
	const srcDoc = useMemo(() => buildDemoSrcDoc(html, false), [html]);
	const sendMotion = () => iframeRef.current?.contentWindow?.postMessage({ type: "learning-motion", enabled: motion.enabled }, "*");
	useEffect(() => { iframeRef.current?.contentWindow?.postMessage({ type: "learning-motion", enabled: motion.enabled }, "*"); }, [motion.enabled]);

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			// Only messages from THIS demo's iframe (the sandbox gives it an
			// opaque origin; the window reference still matches).
			if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
			setState((prev) => reduceDemoBridgeState(prev, event.data));
		};
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, []);

	return (
		<div className="rounded-xl border bg-card p-4 text-card-foreground" data-testid="demo-card">
			{/* Caption header (owner, 2026-10-07): kind label + title in the
			   label's size/tracking (title normal-case, foreground) — the
			   figure card's grammar plus a name. Switch + download far right. */}
			<div className="flex items-center justify-between gap-2">
				<div className="flex min-w-0 items-baseline gap-2">
					<span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
						interactive demo
					</span>
					<span className="truncate text-xs font-medium tracking-wide text-foreground">{title}</span>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					<Toggle
						checked={inverted}
						onChange={toggleInverted}
						label="Invert demo brightness"
						title="Invert colors"
						discIcon={<InvertDiscIcon className="size-3" />}
					/>
					<button
						type="button"
						aria-label="Download demo as HTML"
						title="Download as HTML"
						onClick={() => downloadFile(`${slugFilename(title)}.html`, html, "text/html")}
						data-testid="demo-download"
						className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<DownloadIcon className="size-3.5" />
					</button>
				</div>
			</div>
			{state.error && (
				<DemoErrorChip
					title={title}
					message={state.error}
					onSend={actions ? () => actions.sendText(`The demo "${title}" threw an error: ${state.error}`) : undefined}
				/>
			)}
			{!motion.enabled && <p role="status" className="mt-2 text-xs text-muted-foreground">Animations paused. Your controls stay saved.</p>}
			<iframe
				ref={iframeRef}
				title={title}
				// allow-scripts ONLY — no allow-same-origin: the demo can run code
				// but never touch the app's storage, cookies, or DOM.
				sandbox="allow-scripts"
				srcDoc={srcDoc}
				onLoad={sendMotion}
				// scrolling OFF (owner, 2026-10-07): the bridge auto-sizes the
				// iframe to its content, so an internal scrollbar can only appear
				// before the first resize lands — and a scrollable iframe TRAPS
				// the wheel (session scrolling stalls over the demo). With
				// scrolling disabled the wheel chains straight to the session.
				scrolling="no"
				className="mt-2 w-full rounded-lg border bg-white"
				// content-box: the bridge reports the CONTENT height — with the
				// preflight's border-box the 2px border would eat into it and clip
				// the bottom of the demo (smoke finding, 2026-10-07).
				style={{
					height: state.height ?? 360,
					boxSizing: "content-box",
					filter: inverted ? "invert(1) hue-rotate(180deg)" : undefined,
				}}
				data-testid="demo-iframe"
			/>
			<SourceCode code={html} language="HTML" />
		</div>
	);
}

export function DemoErrorChip({
	title,
	message,
	onSend,
}: {
	title: string;
	message: string;
	onSend?: () => void;
}) {
	return (
		<div
			className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500"
			data-testid="demo-error-chip"
		>
			<span className="font-medium">This demo threw an error</span>
			<span className="min-w-0 flex-1 truncate font-mono text-xs" title={message}>
				{message}
			</span>
			{onSend && (
				<button
					type="button"
					onClick={onSend}
					className="rounded-md border border-red-500/40 px-2 py-1 text-xs font-medium hover:bg-red-500/15"
					data-testid="demo-error-send"
				>
					Send to teacher
				</button>
			)}
		</div>
	);
}
