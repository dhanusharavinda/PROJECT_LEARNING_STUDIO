"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, ArrowUpRight, Bookmark, Check, ChevronRight, Clock3, Code2, Download, ExternalLink, MessageSquare, Play, RotateCcw, Square } from "lucide-react";
import { SidebarToggle } from "@/components/sidebar";
import { useSettingsDialog } from "@/components/settings/settings-dialog";
import { MessageResponse } from "@/components/ai-elements/message";
import { stashOpeningPrompt } from "@/components/opening-prompt";
import { LAB_STAGES, labStageBlocker, type LabCatalog, type LabCoachAction, type LabItem, type LabLibrary, type LabSession, type LabStage } from "@/src/core";
import { formatLabTime, labCodeHash, labRequest, readLabEvents } from "./lab-client";
import { useLabSession } from "./use-lab-session";
import { LabCoach } from "./lab-coach";
import { LabQuestions } from "./lab-questions";
import styles from "./lab.module.css";

const LabCodeEditor = dynamic(() => import("./lab-code-editor"), { ssr: false, loading: () => <div className={styles.empty}>Opening code editor...</div> });
const stageNames: Record<LabStage, string> = { understand: "Understand", plan: "Plan", attempt: "Attempt", test: "Test", reflect: "Reflect" };
type View = "brief" | "work" | "resources" | "history";

export function LabSessionWorkspace({ initial, item, catalog, library, onBack, onBookmark, onOpenItem }: {
	initial: LabSession; item: LabItem; catalog: LabCatalog; library: LabLibrary;
	onBack: () => Promise<void>; onBookmark: (id: string) => Promise<void>; onOpenItem: (item: LabItem) => void;
}) {
	const { session, current, edit, replace, flush, saveState, saveError, conflict } = useLabSession(initial);
	const router = useRouter();
	const settings = useSettingsDialog();
	const [view, setView] = useState<View>(initial.stage === "understand" ? "brief" : "work");
	const [mobilePane, setMobilePane] = useState<"work" | "coach">("work");
	const [busy, setBusy] = useState<"" | "coach" | "run" | "handoff">("");
	const [error, setError] = useState("");
	const [coachError, setCoachError] = useState("");
	const [streaming, setStreaming] = useState("");
	const [status, setStatus] = useState("");
	const [consoleText, setConsoleText] = useState("");
	const [coachWidth, setCoachWidth] = useState(320);
	const [seconds, setSeconds] = useState(initial.elapsedSeconds);
	const [currentCodeHash, setCurrentCodeHash] = useState("");
	const controller = useRef<AbortController | null>(null);
	const runLease = useRef<string | null>(null);
	const started = useRef(Date.now());
	const initialElapsed = useRef(initial.elapsedSeconds);
	const moving = useRef<{ x: number; width: number } | null>(null);
	const mounted = useRef(true);
	const locked = !!busy || session.status === "completed";
	useEffect(() => {
		let live = true;
		if (item.coding) void labCodeHash(session.code).then(hash => { if (live) setCurrentCodeHash(hash); });
		return () => { live = false; };
	}, [session.code, item.coding]);
	useEffect(() => {
		if (session.status === "completed") return;
		const timer = setInterval(() => setSeconds(initialElapsed.current + Math.floor((Date.now() - started.current) / 1000)), 1000);
		return () => clearInterval(timer);
	}, [session.status]);
	useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); if (runLease.current) void fetch(`/api/lab/sessions/${initial.id}/run/${runLease.current}`, { method: "DELETE", keepalive: true }); }; }, [initial.id]);
	const safeAction = async (action: () => Promise<void>) => {
		setError("");
		try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "That action could not finish. Try again."); }
	};
	const saveWork = useCallback(async () => {
		if (current.current.status !== "completed") edit({ elapsedSeconds: initialElapsed.current + Math.floor((Date.now() - started.current) / 1000) });
		return flush();
	}, [current, edit, flush]);
	const ask = async (action: LabCoachAction, message?: string, questionId?: string) => {
		if (busy) return;
		setBusy("coach"); setCoachError(""); setStreaming(""); setStatus("Connecting to your coach...");
		const aborter = new AbortController(); controller.current = aborter;
		try {
			await saveWork();
			const response = await fetch(`/api/lab/sessions/${session.id}/coach`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, message, questionId }), signal: aborter.signal });
			await readLabEvents(response, event => {
				if (event.type === "text") setStreaming(value => value + event.text);
				if (event.type === "status") setStatus(event.message);
				if (event.type === "done") { replace(event.session); setStreaming(""); }
				if (event.type === "error") setCoachError(event.error);
			});
		} catch (cause) {
			if (!aborter.signal.aborted) setCoachError(cause instanceof Error ? cause.message : "The coach could not respond. Try again.");
		} finally {
			controller.current = null;
			try {
				// A cancelled stream can finish before the provider settles its final usage write.
				// Keep the editor locked until the canonical revision is stable.
				while (mounted.current) {
					const value = await labRequest<{ session: LabSession; busy: boolean }>(`/api/lab/sessions/${session.id}`);
					if (!value.busy) { replace(value.session); setStreaming(""); break; }
					setStatus("Waiting for the coach to finish saving...");
					await new Promise(resolve => setTimeout(resolve, 500));
				}
			} catch { setCoachError("Connection interrupted. Your saved work is safe. Refresh this activity to reconnect."); }
			setBusy(""); setStatus("");
		}
	};
	const cancel = () => {
		controller.current?.abort();
		if (busy === "coach") void labRequest(`/api/lab/sessions/${session.id}/coach`, { method: "DELETE" }).catch(() => {});
	};
	const runCode = async () => {
		if (!item.coding || busy) return;
		setBusy("run"); setError(""); setConsoleText(""); setView("work");
		const aborter = new AbortController(); controller.current = aborter;
		let runId: string | undefined;
		try {
			const saved = await saveWork();
			const codeHash = await labCodeHash(saved.code);
			const lease = await labRequest<{ runId: string; expiresAt: string }>(`/api/lab/sessions/${session.id}/run/start`, { method: "POST", body: JSON.stringify({ revision: saved.revision, codeHash }) });
			runId = lease.runId; runLease.current = runId;
			const { runLabPython } = await import("./lab-python");
			const result = await runLabPython({ code: saved.code, entrypoint: item.coding.entrypoint, tests: item.coding.tests, signal: aborter.signal, onOutput: text => setConsoleText(value => (value + text).slice(-16000)) });
			if (aborter.signal.aborted) return;
			const receipt = await labRequest<{ session: LabSession }>(`/api/lab/sessions/${session.id}/run`, { method: "POST", body: JSON.stringify({ ...result, revision: saved.revision, codeHash, runId }) });
			replace(receipt.session);
			setConsoleText("");
		} catch (cause) { setError(aborter.signal.aborted ? "Run stopped. Your code is saved." : cause instanceof Error ? cause.message : "Python could not run. Try again."); }
		finally {
			if (runId) await labRequest(`/api/lab/sessions/${session.id}/run/${runId}`, { method: "DELETE" }).catch(() => {});
			runLease.current = null; controller.current = null; setBusy("");
		}
	};
	const advance = async (stage: LabStage) => {
		await safeAction(async () => {
			const saved = await saveWork();
			const blocker = labStageBlocker(saved, item, stage);
			if (blocker) throw new Error(blocker);
			const result = await labRequest<{ session: LabSession }>(`/api/lab/sessions/${session.id}`, { method: "PATCH", body: JSON.stringify({ revision: saved.revision, stage }) });
			replace(result.session); setView(stage === "understand" ? "brief" : "work");
			if (saved.stage === "understand" && stage === "plan") await labRequest("/api/lab/library", { method: "POST", body: JSON.stringify({ itemId: item.id, state: "read" }) });
		});
	};
	const complete = () => safeAction(async () => {
		const saved = await saveWork();
		const result = await labRequest<{ session: LabSession }>(`/api/lab/sessions/${session.id}`, { method: "PATCH", body: JSON.stringify({ revision: saved.revision, complete: true }) });
		replace(result.session); setView("history");
	});
	const handoff = (mode: "teach" | "practice") => safeAction(async () => {
		setBusy("handoff");
		try {
			await saveWork();
			const result = await labRequest<{ chatId: string; openingPrompt: string }>(`/api/lab/sessions/${session.id}/handoff`, { method: "POST", body: JSON.stringify({ mode }) });
			if (!stashOpeningPrompt(result.chatId, result.openingPrompt)) throw new Error("This browser could not prepare the lesson. Your Lab work is saved. Allow local storage and try again.");
			router.push(`/chat/${result.chatId}`);
		} finally { setBusy(""); }
	});
	const exportDraft = () => {
		const text = `# ${item.title}\n\n## Reasoning\n${session.reasoning}\n\n## Attempt\n${item.coding ? "```python\n" + session.code + "\n```" : Object.entries(session.answers).map(([id, answer]) => `### ${item.questions.find(q => q.id === id)?.prompt ?? id}\n${answer}`).join("\n\n")}\n\n## Reflection\n${session.reflection}\n`;
		const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
		const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${item.id}-draft.md`; anchor.click(); URL.revokeObjectURL(url);
	};
	const latestRun = session.runs.at(-1);
	const runIsStale = !!latestRun && latestRun.codeHash !== currentCodeHash;
	const nextStage = LAB_STAGES[LAB_STAGES.indexOf(session.stage) + 1];
	const elapsed = session.timerMinutes ? Math.max(0, session.timerMinutes * 60 - seconds) : seconds;
	return <main className={styles.lab} data-testid="lab-session">
		<header className={`${styles.header} lh-drag lh-header-gutter`}>
			<div className={styles.titleRow}><SidebarToggle /><button className={`${styles.iconButton} lh-no-drag`} aria-label="Back to Lab" disabled={!!busy} onClick={() => void safeAction(async () => { await saveWork(); await onBack(); })}><ArrowLeft size={17} /></button><div className={styles.sessionTitle}><span>Experimental Lab</span><h1>{item.title}</h1></div></div>
			<div className={`${styles.inlineActions} lh-no-drag`}><span className={styles.saveStatus} role="status">{saveState === "saving" ? "Saving..." : saveState === "error" ? "Not saved" : saveState === "unsaved" ? "Unsaved" : "Saved locally"}</span><button className={styles.iconButton} aria-label="Export draft" title="Export draft" onClick={exportDraft}><Download size={16} /></button><button className={styles.iconButton} aria-label={library.bookmarks.includes(item.id) ? "Unsave activity" : "Save activity"} onClick={() => void onBookmark(item.id)}><Bookmark size={16} fill={library.bookmarks.includes(item.id) ? "currentColor" : "none"} /></button></div>
		</header>
		<div className={styles.stageRow} aria-label="Exercise stages">{LAB_STAGES.map((stage, index) => <button key={stage} aria-current={session.stage === stage ? "step" : undefined} disabled={!!busy || session.status === "completed" || index > LAB_STAGES.indexOf(session.stage) + 1} onClick={() => void advance(stage)}><span>{index < LAB_STAGES.indexOf(session.stage) ? <Check size={12} /> : index + 1}</span>{stageNames[stage]}</button>)}<div className={`${styles.timer} ${session.timerMinutes && elapsed === 0 ? styles.timerExpired : ""}`} title={session.timerMinutes ? "Interview time remaining" : "Study time"}><Clock3 size={13} />{formatLabTime(elapsed)}</div></div>
		{saveError && <div className={styles.error} role="alert">{saveError}<button onClick={() => void flush().catch(() => {})} disabled={conflict}>Retry save</button>{conflict && <><button onClick={exportDraft}>Export my draft</button><button onClick={() => window.location.reload()}>Reload saved version</button></>}</div>}
		{error && <div className={styles.error} role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError("")}>Dismiss</button></div>}
		<div className={styles.mobileTabs}><button aria-pressed={mobilePane === "work"} onClick={() => setMobilePane("work")}>Activity</button><button aria-pressed={mobilePane === "coach"} onClick={() => setMobilePane("coach")}><MessageSquare size={14} />Coach</button></div>
		<div className={styles.sessionPanes} style={{ "--coach-width": `${coachWidth}px` } as CSSProperties} data-mobile-pane={mobilePane}>
			<section className={styles.workPane}>
				<div className={styles.workTabs} role="tablist" aria-label="Activity views">{([['brief', 'Brief'], ['work', item.coding ? 'Code & checks' : 'My work'], ['resources', 'Resources'], ['history', 'History']] as [View, string][]).map(([id, label]) => <button key={id} role="tab" aria-selected={view === id} onClick={() => setView(id)}>{label}</button>)}</div>
				<div className={styles.workScroll} role="tabpanel">
					{view === "brief" && <div className={styles.reading}><div className={styles.activityMeta}><span>{item.difficulty}</span><span>{item.minutes} min</span><span>{item.kind}</span></div><h2>{item.title}</h2><p className={styles.summary}>{item.summary}</p><ul className={styles.objectives}>{item.objectives.map(objective => <li key={objective}>{objective}</li>)}</ul><MessageResponse>{item.content}</MessageResponse><div className={styles.reasoning}><label htmlFor="lab-reasoning">In your own words</label><p>What is the problem, and what would a good answer need to show?</p><textarea id="lab-reasoning" value={session.reasoning} onChange={event => edit({ reasoning: event.target.value })} disabled={locked} rows={5} placeholder="Describe the idea without copying the lesson." /></div>{item.prerequisites.length > 0 && <div className={styles.prerequisites}><h3>Before this activity</h3>{item.prerequisites.map(id => { const prerequisite = catalog.items.find(value => value.id === id); return prerequisite ? <button key={id} disabled={!!busy} onClick={() => void safeAction(async () => { await saveWork(); onOpenItem(prerequisite); })}>{prerequisite.title}<ArrowUpRight size={14} /></button> : <span key={id}>{id}</span>; })}</div>}</div>}
					{view === "work" && <div className={styles.workContent}>
						{session.stage === "plan" && <div className={styles.reasoning}><label htmlFor="lab-plan">Your reasoning and plan</label><p>Describe the approach, its assumptions, and what could fail.</p><textarea id="lab-plan" value={session.reasoning} onChange={event => edit({ reasoning: event.target.value })} disabled={locked} rows={7} /></div>}
						{item.coding && <><div className={styles.codeToolbar}><span><Code2 size={14} />Python · {item.coding.entrypoint}</span><div className={styles.inlineActions}><button title="Restore starter code" aria-label="Restore starter code" className={styles.iconButton} disabled={locked} onClick={() => { if (window.confirm("Replace this attempt with the starter code? Your previous test runs stay in History.")) edit({ code: item.coding!.starterCode }); }}><RotateCcw size={14} /></button>{busy === "run" ? <button className={styles.primary} onClick={cancel}><Square size={13} />Stop</button> : <button className={styles.primary} disabled={locked} onClick={() => void runCode()}><Play size={13} />Run tests</button>}</div></div><LabCodeEditor value={session.code} onChange={code => edit({ code })} disabled={locked} /><div className={styles.testResults}><div className={styles.sectionTitle}><h3>Tests</h3><span>{busy === "run" ? "Running locally..." : latestRun ? runIsStale ? "Code changed. Run again." : `${latestRun.passed} / ${latestRun.total} passed` : `${item.coding.tests.length} checks ready`}</span></div>{item.coding.tests.map(test => { const result = runIsStale ? undefined : latestRun?.results.find(value => value.testId === test.id); return <details key={test.id} className={styles.testRow}><summary><span className={result?.passed ? styles.verified : result ? styles.failed : ""}>{result ? result.passed ? "Pass" : "Fail" : "Ready"}</span>{test.name}<ChevronRight size={13} /></summary><dl><dt>Input</dt><dd><code>{JSON.stringify(test.args)}</code></dd><dt>Expected</dt><dd><code>{JSON.stringify(test.expected)}</code></dd>{result && <><dt>{result.error ? "Error" : "Actual"}</dt><dd><code>{result.error ?? JSON.stringify(result.actual)}</code></dd></>}</dl></details>; })}{(consoleText || latestRun?.stdout || latestRun?.error) && <pre className={styles.console}>{consoleText || latestRun?.error || latestRun?.stdout}</pre>}<p className={styles.subtle}>Python runs in an isolated browser worker. Test results verify these cases, not every possible input.</p></div></>}
						<LabQuestions item={item} session={session} edit={edit} disabled={locked} onInterview={id => { setMobilePane("coach"); void ask(item.kind === "interview" ? "interview" : "review", undefined, id); }} />
						{session.stage === "reflect" && <div className={styles.reasoning}><label htmlFor="lab-reflection">What changed in your understanding?</label><p>Name one mistake, one useful principle, and how you would test it next time.</p><textarea id="lab-reflection" value={session.reflection} onChange={event => edit({ reflection: event.target.value })} rows={6} disabled={locked} /></div>}
					</div>}
					{view === "resources" && <div className={styles.reading}><h2>Keep learning</h2><p className={styles.summary}>References selected for this activity.</p><div className={styles.resourceList}>{item.resources.map(resource => <article key={resource.id}><div><h3><a href={resource.url} target="_blank" rel="noreferrer">{resource.title}<ExternalLink size={13} /></a></h3><p>{resource.description}</p><span>{resource.kind}</span></div><button className={styles.iconButton} aria-label={`${library.bookmarks.includes(resource.id) ? "Unsave" : "Save"} ${resource.title}`} onClick={() => void onBookmark(resource.id)}><Bookmark size={15} fill={library.bookmarks.includes(resource.id) ? "currentColor" : "none"} /></button></article>)}</div></div>}
					{view === "history" && <div className={styles.reading}><h2>{session.status === "completed" ? "Session complete" : "Your evidence"}</h2><p className={styles.summary}>Attempts and feedback stay separate from simply reading a lesson.</p><dl className={styles.evidence}><dt>Time spent</dt><dd>{formatLabTime(seconds)}</dd><dt>Hints used</dt><dd>{session.hintsUsed}</dd><dt>Test runs</dt><dd>{session.runs.length}</dd><dt>Stage</dt><dd>{stageNames[session.stage]}</dd></dl>{session.reflection && <section className={styles.historySection}><h3>Your reflection</h3><p>{session.reflection}</p></section>}{session.runs.slice().reverse().map(run => <details className={styles.historySection} key={run.id}><summary>{run.passed} / {run.total} tests passed<span>{new Date(run.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></summary><p>{Math.round(run.durationMs)} ms · Local browser tests</p>{run.results.map(result => <p key={result.testId}>{result.passed ? "Pass" : "Fail"}: {item.coding?.tests.find(test => test.id === result.testId)?.name ?? result.testId}{result.error ? `: ${result.error}` : ""}</p>)}</details>)}{session.feedback.slice().reverse().map((feedback, index) => <section className={styles.historySection} key={index}><h3>Coach review{feedback.score !== undefined ? ` · ${feedback.score}/100` : ""}</h3><p>{feedback.summary}</p><ul>{feedback.strengths.map(value => <li key={value}>{value}</li>)}{feedback.improvements.map(value => <li key={value}>{value}</li>)}</ul><small>AI feedback, separate from verified tests.</small></section>)}{!session.runs.length && !session.feedback.length && <p className={styles.subtle}>Run an exercise or request a review to start your history.</p>}<div className={styles.handoff}><h3>Continue with your teacher</h3><p>Carry the activity, your attempt, and your reflection into a lesson or practice session.</p><div><button disabled={!!busy} onClick={() => void handoff("teach")}>Teach me this<ArrowUpRight size={14} /></button><button disabled={!!busy} onClick={() => void handoff("practice")}>Practice more<ArrowUpRight size={14} /></button></div></div></div>}
				</div>
				<footer className={styles.sessionFooter}><span>{session.status === "completed" ? "Completed locally" : `${stageNames[session.stage]}: ${session.stage === "understand" ? "explain it in your own words" : session.stage === "plan" ? "choose an approach" : session.stage === "attempt" ? "make your own attempt" : session.stage === "test" ? "test and review" : "record what you learned"}`}</span>{session.status !== "completed" && (nextStage ? <button disabled={!!busy} className={styles.primary} onClick={() => void advance(nextStage)}>Continue<ChevronRight size={14} /></button> : <button disabled={!!busy} className={styles.primary} onClick={() => void complete()}>Finish session<Check size={14} /></button>)}</footer>
			</section>
			<div className={styles.paneResize} role="separator" aria-orientation="vertical" aria-label="Resize coach panel" aria-valuemin={270} aria-valuemax={480} aria-valuenow={coachWidth} tabIndex={0} onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setCoachWidth(value => Math.max(270, Math.min(480, value + (event.key === "ArrowLeft" ? 20 : -20)))); } }} onPointerDown={event => { moving.current = { x: event.clientX, width: coachWidth }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (moving.current) setCoachWidth(Math.max(270, Math.min(480, moving.current.width + moving.current.x - event.clientX))); }} onPointerUp={event => { moving.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { moving.current = null; }} />
			<LabCoach session={session} item={item} busy={!!busy} canCancel={busy === "coach"} streaming={streaming} status={busy === "run" ? "Running your code..." : status} error={coachError} onAsk={ask} onCancel={cancel} onSettings={() => settings.open("agent")} />
		</div>
	</main>;
}
