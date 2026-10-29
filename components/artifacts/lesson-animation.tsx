"use client";
import { useContext, useState } from "react";
import { Clapperboard, LoaderCircle, RotateCcw } from "lucide-react";
import { JobsContext } from "@/components/jobs-context";
import { Hint } from "@/components/ui/hint";
import { isLessonAnimationRequest, type JobRecord } from "@/src/core";
import { AnimationOutputCard } from "./animation-card";

export function LessonAnimationAction({ chatId, sourceMessageId, busy = false, showOnlyExisting = false, onQueued }: { chatId: string; sourceMessageId?: string; busy?: boolean; showOnlyExisting?: boolean; onQueued?: () => void }) {
	const jobs = useContext(JobsContext);
	const [localJob, setLocalJob] = useState<JobRecord | null>(null);
	const [sending, setSending] = useState(false);
	const [error, setError] = useState("");
	if (!sourceMessageId) return null;
	const matching = jobs.filter(j => isLessonAnimationRequest(j.input) && j.input.sourceMessageId === sourceMessageId);
	const job = matching.find(j => j.id === localJob?.id) ?? matching.at(-1) ?? localJob;
	if (showOnlyExisting && !job) return null;
	const running = sending || job?.status === "running";
	async function generate() {
		setSending(true); setError("");
		try {
			const response = await fetch(`/api/chats/${encodeURIComponent(chatId)}/animation`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceMessageId, retry: job?.status === "error" }) });
			const body = await response.json();
			if (!response.ok) throw new Error(body.error || "Could not start the animation. Try again.");
			setLocalJob(body.job); onQueued?.();
		} catch (e) { setError(e instanceof Error ? e.message : "Could not start the animation. Try again."); }
		finally { setSending(false); }
	}
	return <div className="my-3 space-y-2" data-testid="lesson-animation-action">
		{job?.status === "done" && job.result ? <AnimationOutputCard output={job.result} /> : <>
			<Hint label="Renders locally with ManimGX. Planning uses your selected AI model.">
				<button type="button" disabled={busy || running} onClick={() => void generate()} className="inline-flex min-h-8 items-center gap-1.5 rounded-sm px-2 py-1 font-ui text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-default disabled:opacity-60">
					{running ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> : job?.status === "error" ? <RotateCcw className="size-3.5" aria-hidden="true" /> : <Clapperboard className="size-3.5" aria-hidden="true" />}
					{running ? job?.activity || "Starting animation" : job?.status === "error" ? "Retry animation" : "Generate animation"}
				</button>
			</Hint>
			{(error || job?.status === "error") && <p role="alert" className="font-ui text-xs text-destructive">{error || job?.error || "The animation could not be created. Try again."}</p>}
		</>}
	</div>;
}
