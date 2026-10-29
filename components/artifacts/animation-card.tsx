"use client";

import { useContext, useRef, useState } from "react";
import { Download, RotateCcw } from "lucide-react";
import type { AnimationResult, ArtifactPartProps } from "@/src/core";
import { ChatActionsContext } from "@/components/chat";
import { DispatchCard } from "@/components/artifacts/dispatch-card";
import { slugFilename } from "@/components/artifacts/download";

export function AnimationCard({ part }: ArtifactPartProps) {
	return <DispatchCard toolCallId={part.toolCallId} kind="animation" />;
}

export function AnimationOutputCard({ output }: { output: unknown }) {
	const result = output as AnimationResult;
	const video = useRef<HTMLVideoElement>(null);
	const actions = useContext(ChatActionsContext);
	const [failed, setFailed] = useState(false);
	const available = !!result?.url && /^\/api\/blackboard\/media\/[a-f0-9]{64}\/video$/.test(result.url);
	return <section className="overflow-hidden rounded-xl border bg-card text-card-foreground" data-testid="animation-card">
		<header className="flex items-center justify-between gap-3 px-4 py-3">
			<div className="min-w-0"><h3 className="truncate font-medium">{result?.title || "Animated board"}</h3><p className="text-xs text-muted-foreground">{available ? `ManimGX · ${Math.round(result.durationSeconds)} seconds${result.cacheHit ? " · saved render" : ""}` : "Render unavailable"}</p></div>
			{available && <a href={result.url} download={`${slugFilename(result.title)}.mp4`} aria-label="Download animation" className="rounded-md p-2 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2"><Download className="size-4" /></a>}
		</header>
		{available && !failed ? <video ref={video} src={result.url} poster={result.url.replace(/video$/, "poster")} controls playsInline preload="metadata" className="aspect-video w-full bg-black" onError={() => setFailed(true)} aria-label={result.title} /> : <div role="status" className="px-4 pb-4 text-sm text-muted-foreground">{failed ? "This video could not be opened. Download it or ask the teacher to create a new version." : result?.notes || "The animation could not be rendered. You can continue the lesson and try again."}</div>}
		{available && result.sections?.length > 0 && <nav aria-label="Animation chapters" className="flex flex-wrap gap-1 border-t px-3 py-2">{result.sections.map((section, index) => <button key={`${index}-${section.start}`} type="button" onClick={() => { if (video.current) { video.current.currentTime = section.start; void video.current.play().catch(() => {}); } }} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2">{section.title}</button>)}</nav>}
		{actions && <footer className="flex justify-end border-t px-3 py-2"><button type="button" onClick={() => actions.sendText(available && !failed ? `Ask me a prediction or application question about the animated board "${result.title}".` : `Please retry the animated board "${result?.title || "Animated board"}" using a corrected plan.`)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-muted">{(!available || failed) && <RotateCcw className="size-3" />}{available && !failed ? "Check my understanding" : "Ask teacher to retry"}</button></footer>}
	</section>;
}
