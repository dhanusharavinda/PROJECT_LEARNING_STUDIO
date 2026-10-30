import type { ChatStore, JobStore } from "../core/ports.ts";
import { isLessonAnimationRequest, messageText, visualTeachingRequest, type LessonAnimationRequest } from "../core/lesson-animation.ts";
import type { VisualFormat } from "../core/visual-learning.ts";

export function queueLessonAnimation(deps: { chatStore: ChatStore; jobStore: JobStore; spawn: (id: string) => void }, chatId: string, sourceMessageId: string, options: { intentMessageId?: string; retry?: boolean; automatic?: boolean; format?: VisualFormat } = {}) {
	const chat = deps.chatStore.getChat(chatId);
	if (!chat) throw new Error("This lesson could not be found.");
	const sourceIndex = chat.messages.findIndex(m => m.id === sourceMessageId && (m.role === "assistant" || (options.intentMessageId === m.id && m.role === "user")));
	if (sourceIndex < 0 || messageText(chat.messages[sourceIndex]!).trim().length < (options.intentMessageId === sourceMessageId ? 1 : 40)) throw new Error("Choose a saved explanation to animate.");
	const jobs = deps.jobStore.listJobs(chatId);
	const preferredFormat = options.format ?? "auto";
	const matches = jobs.filter(j => isLessonAnimationRequest(j.input) && (j.input.preferredFormat ?? "auto") === preferredFormat && (j.input.sourceMessageId === sourceMessageId || (options.intentMessageId && j.input.intentMessageId === options.intentMessageId)));
	const existing = matches.find(j=>j.status==="running") ?? matches.find(j=>j.status==="done");
	if (existing) return existing;
	if (jobs.filter(j => (isLessonAnimationRequest(j.input) || j.kind === "animation" || j.kind === "demo") && j.status === "running").length >= 2) throw new Error("Two visuals are already being prepared. Wait for one to finish.");
	// Include the lesson's opening goal plus recent user/teacher text, never raw tool results or reasoning.
	const opening = chat.messages.find(m => m.role === "user");
	const recent = chat.messages.slice(Math.max(0, sourceIndex - 16), sourceIndex + 1)
		.filter(m => m.role === "user" || m.role === "assistant").map(m => `${m.role}: ${messageText(m).slice(0, 4500)}`).join("\n\n");
	const context = `Lesson goal: ${opening ? messageText(opening).slice(0, 1200) : chat.title}\n\nRecent lesson:\n${recent.slice(-14000)}\n\nAnimate this explanation:\n${messageText(chat.messages[sourceIndex]!).slice(0, 6000)}`;
	const input: LessonAnimationRequest = { mode: "lesson-animation", sourceMessageId, context, preferredFormat, automatic: options.automatic ?? !!options.intentMessageId, ...(options.intentMessageId ? { intentMessageId: options.intentMessageId } : {}) };
	const job = deps.jobStore.createJob({ kind: preferredFormat === "interactive" ? "demo" : preferredFormat === "diagram" ? "visual" : "animation", chatId, toolCallId: `lesson-animation-${crypto.randomUUID()}`, input });
	deps.spawn(job.id);
	return job;
}

/** A fallback independent of whether a teacher chooses the animation tool. */
export function queueRequestedVisual(deps: Parameters<typeof queueLessonAnimation>[0], chatId: string, newMessageIds: Set<string>, format: VisualFormat = "auto") {
	const chat = deps.chatStore.getChat(chatId);
	if (!chat) return;
	const intent = visualTeachingRequest(chat.messages);
	if (!intent) return;
	const intentIndex = chat.messages.indexOf(intent);
	const existingJobs = deps.jobStore.listJobs(chatId);
	if (existingJobs.some(j => isLessonAnimationRequest(j.input) && j.input.intentMessageId === intent.id)) return;
	// A native animation already dispatched for this request satisfies it without a second plan call.
	const dispatchedCalls = new Set(chat.messages.slice(intentIndex).flatMap(m => m.role === "assistant" && Array.isArray(m.content) ? m.content.filter(b => b.type === "toolCall" && ["animation","demo","visual"].includes(b.name)).map(b => (b as {id:string}).id) : []));
	if (existingJobs.some(j => ["animation", "demo", "visual"].includes(j.kind) && dispatchedCalls.has(j.toolCallId) && (j.status !== "error" || j.delivery?.kind === "abort" || j.error === "Aborted by learner"))) return;
	const source = chat.messages.slice(intentIndex).filter(m => m.role === "assistant" && messageText(m).trim().length >= 40).at(-1);
	if (newMessageIds.size) return queueLessonAnimation(deps, chatId, source?.id || intent.id, { intentMessageId: intent.id, format });
}
