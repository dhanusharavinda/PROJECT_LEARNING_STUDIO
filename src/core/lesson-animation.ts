import type { LhMessage } from "./native-messages.ts";
import type { BlackboardPlan } from "./blackboard.ts";
import type { VisualFormat } from "./visual-learning.ts";

/** Saved beside the job so a restart can resume planning or reuse its plan. */
export interface LessonAnimationRequest {
	mode: "lesson-animation";
	sourceMessageId: string;
	intentMessageId?: string;
	automatic: boolean;
	context: string;
	plan?: BlackboardPlan;
	preferredFormat?: VisualFormat;
	resolvedFormat?: Exclude<VisualFormat, "auto">;
	visualBrief?: string;
	visualTitle?: string;
}
export function isLessonAnimationRequest(value: unknown): value is LessonAnimationRequest {
	return !!value && typeof value === "object" && (value as LessonAnimationRequest).mode === "lesson-animation";
}
export interface CodedManimRequest { mode: "manim-scene"; title: string; brief: string }
export function isCodedManimRequest(value: unknown): value is CodedManimRequest { return !!value && typeof value === "object" && (value as CodedManimRequest).mode === "manim-scene"; }
export function messageText(message: LhMessage): string {
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	return Array.isArray(content) ? content.filter(b => b?.type === "text" && typeof b.text === "string").map(b => b.text).join("\n") : "";
}
/** Explicit requests only. A later opt-out cancels any unfulfilled intent. */
export function visualTeachingRequest(messages: LhMessage[]): LhMessage | undefined {
	for (const message of [...messages].reverse()) {
		if (message.role !== "user") continue;
		const text = messageText(message);
		if (/\b(?:no|without|skip|stop|avoid|don['’]?t|do not)\b.{0,35}\b(?:animations?|animate|visuals?|visually)\b/i.test(text)) return;
		if (/\b(?:visuall?y|visuall|visual (?:explanation|lesson|teaching)|animate|visuali[sz]e|interactive|simulate|simulation)\b/i.test(text) || /\b(?:teach|explain|show|draw)\b.{0,50}\b(?:visuals?|diagram|plot|chart|3d)\b/i.test(text) || (/\b(?:generate|render|create|make|show|use|want|need|with)\b.{0,45}\b(?:animations?|animated (?:board|diagram|explanation))\b/i.test(text))) return message;
	}
}
