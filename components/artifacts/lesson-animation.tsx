"use client";
import { useContext, useEffect, useState } from "react";
import { ChevronDown, Clapperboard, GitBranch, LoaderCircle, RotateCcw, SlidersHorizontal, WandSparkles } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { JobsContext } from "@/components/jobs-context";
import { Hint } from "@/components/ui/hint";
import { useVisualLearning } from "@/components/visual-learning-toggle";
import { isLessonAnimationRequest, type JobRecord, type VisualFormat } from "@/src/core";
import { AnimationOutputCard } from "./animation-card";
import { DemoOutputCard } from "./demo-card";
import { VisualOutputCard } from "./visual-card";

export const VISUAL_FORMATS = [
	{ id: "auto", label: "Choose best visual", icon: WandSparkles },
	{ id: "interactive", label: "Interactive demo", icon: SlidersHorizontal },
	{ id: "video", label: "Animation", icon: Clapperboard },
	{ id: "diagram", label: "Diagram", icon: GitBranch },
] as const;

interface VisualJobSelection { sourceMessageId: string; jobId: string }

function contextualVisualJobs(jobs: JobRecord[], sourceMessageId: string, localJob: JobRecord | null): JobRecord[] {
	const matching = jobs.filter(j => isLessonAnimationRequest(j.input) && j.input.sourceMessageId === sourceMessageId).sort((a,b) => a.createdAt.localeCompare(b.createdAt));
	const local = localJob && isLessonAnimationRequest(localJob.input) && localJob.input.sourceMessageId === sourceMessageId ? localJob : null;
	if (local && !matching.some(j => j.id === local.id)) matching.push(local);
	return matching.sort((a,b) => a.createdAt.localeCompare(b.createdAt));
}

/** Follow new results until the learner deliberately reopens a saved visual. */
export function selectLessonVisualJob(jobs: JobRecord[], sourceMessageId: string, localJob: JobRecord | null, selection: VisualJobSelection | null = null): JobRecord | null {
	const matching = contextualVisualJobs(jobs, sourceMessageId, localJob);
	const selected = selection?.sourceMessageId === sourceMessageId ? matching.find(j => j.id === selection.jobId) : null;
	return selected ?? matching.at(-1) ?? null;
}

export function LessonAnimationAction({ chatId, sourceMessageId, busy = false, showOnlyExisting = false, onQueued }: { chatId: string; sourceMessageId?: string; busy?: boolean; showOnlyExisting?: boolean; onQueued?: () => void }) {
	const jobs = useContext(JobsContext);
	const motion = useVisualLearning();
	const [localJob, setLocalJob] = useState<JobRecord | null>(null);
	const [selection, setSelection] = useState<VisualJobSelection | null>(null);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState("");
	useEffect(() => { setSelection(null); setError(""); }, [sourceMessageId]);
	if (!sourceMessageId) return null;
	const job = selectLessonVisualJob(jobs, sourceMessageId, localJob, selection);
	if (showOnlyExisting && !job) return null;
	const contextual = contextualVisualJobs(jobs, sourceMessageId, localJob);
	const savedFormats = VISUAL_FORMATS.filter(format => format.id !== "auto").flatMap(format => {
		const kind = format.id === "interactive" ? "demo" : format.id === "video" ? "animation" : "visual";
		const saved = contextual.findLast(j => j.kind === kind && j.status === "done" && j.result);
		return saved ? [{ ...format, job: saved }] : [];
	});
	const running = sending || job?.status === "running";
	async function generate(format: VisualFormat = "auto") {
		if (sending || busy || running) return;
		if (!motion.enabled && (format === "interactive" || format === "video")) { setError("Turn on Animations to generate a moving visual."); return; }
		setSending(true); setError("");
		try {
			const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/animation`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceMessageId, retry: job?.status === "error", mode: !motion.enabled && format === "auto" ? "diagram" : format }) });
			const body = await response.json();
			if (!response.ok) throw new Error(body.error || "Could not start the visual. Try again.");
			if (!body.job || typeof body.job.id !== "string" || !["running", "done", "error"].includes(body.job.status)) throw new Error("The visual status could not be loaded. Try again.");
			setLocalJob(body.job); setSelection({ sourceMessageId: sourceMessageId!, jobId: body.job.id }); onQueued?.();
		} catch (e) { setError(e instanceof Error ? e.message : "Could not start the visual. Try again."); }
		finally { setSending(false); }
	}
	return <div className="my-3 space-y-2" data-testid="lesson-animation-action">
		{job?.status === "done" && job.result ? job.kind === "demo" ? <DemoOutputCard output={job.result} /> : job.kind === "visual" ? <VisualOutputCard output={job.result} /> : <AnimationOutputCard output={job.result} /> : null}
		<div className="flex flex-wrap items-center gap-0.5">
			<Hint label="Choose the clearest way to explore this explanation. Uses your selected AI model.">
				<button type="button" disabled={busy || running || !motion.loaded} onClick={() => void generate()} className="inline-flex min-h-8 items-center gap-1.5 rounded-sm px-2 py-1 font-ui text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-default disabled:opacity-60">
					{running ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : job?.status === "error" ? <RotateCcw className="size-3.5" aria-hidden="true" /> : <WandSparkles className="size-3.5" aria-hidden="true" />}
					{running ? job?.activity || "Starting visual" : job?.status === "error" ? "Retry visual" : motion.enabled ? "Generate visual" : "Generate diagram"}
				</button>
			</Hint>
			<DropdownMenu.Root modal={false}>
				<DropdownMenu.Trigger asChild><button type="button" disabled={busy || running || !motion.loaded} aria-label="Choose visual format" className="inline-flex size-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"><ChevronDown className="size-3.5" aria-hidden="true" /></button></DropdownMenu.Trigger>
				<DropdownMenu.Portal><DropdownMenu.Content align="start" sideOffset={5} className="z-50 min-w-44 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
					{VISUAL_FORMATS.map(({id,label,icon:Icon}) => <DropdownMenu.Item key={id} disabled={!motion.enabled && (id === "interactive" || id === "video")} onSelect={() => void generate(id)} className="flex min-h-8 cursor-default items-center gap-2 rounded-sm px-2 py-1.5 font-ui text-xs outline-none data-highlighted:bg-accent data-disabled:opacity-40"><Icon className="size-3.5" aria-hidden="true" />{label}</DropdownMenu.Item>)}
				</DropdownMenu.Content></DropdownMenu.Portal>
			</DropdownMenu.Root>
			{savedFormats.length > 1 && <div role="group" aria-label="Saved visuals" className="ml-1 flex items-center gap-0.5 border-l border-border/70 pl-1">
				{savedFormats.map(({ id, label, icon: Icon, job: saved }) => <Hint key={id} label={`Show saved ${label.toLowerCase()}`}><button type="button" aria-label={`Show saved ${label.toLowerCase()}`} aria-pressed={job?.kind === saved.kind} disabled={sending} onClick={() => { setSelection({ sourceMessageId, jobId: saved.id }); setError(""); }} className="inline-flex size-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60"><Icon className="size-3.5" aria-hidden="true" /></button></Hint>)}
			</div>}
		</div>
		{(error || job?.status === "error") && <p role="alert" className="font-ui text-xs text-destructive">{error || job?.error || "The visual could not be created. Try again."}</p>}
	</div>;
}
