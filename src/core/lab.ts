import type { CallUsage, ChatSettings } from "./contracts.ts";
import type { SessionPricing } from "./prices.ts";

export type LabTrackId = "dsa" | "ai" | "electronics" | "systems";
export type LabItemKind = "lesson" | "coding" | "interview" | "design";
export type LabProgressState = "collected" | "read" | "practiced" | "proven";
export type LabStage = "understand" | "plan" | "attempt" | "test" | "reflect";
export const LAB_STAGES: LabStage[] = ["understand", "plan", "attempt", "test", "reflect"];
export interface LabTrack { id: LabTrackId; title: string; description: string; icon?: string }
export interface LabResource { id: string; title: string; url: string; kind: "docs" | "video" | "article" | "course"; description?: string }
export interface LabQuestion { id: string; prompt: string; options?: string[]; answer?: number; explanation: string; rubric?: string[] }
export interface LabCodeTest { id: string; name: string; args: unknown[]; expected: unknown; tolerance?: number }
export interface LabCodingSpec { language: "python"; entrypoint: string; starterCode: string; tests: LabCodeTest[]; solution: string; complexity: string }
export interface LabItem {
	id: string; trackId: LabTrackId; kind: LabItemKind; title: string; summary: string;
	difficulty: "Foundation" | "Intermediate" | "Advanced"; minutes: number; order: number;
	tags: string[]; prerequisites: string[]; objectives: string[]; content: string;
	hints: string[]; questions: LabQuestion[]; resources: LabResource[]; coding?: LabCodingSpec;
}
export interface LabCatalog { version: number; tracks: LabTrack[]; items: LabItem[] }
export interface LabMessage { id: string; role: "user" | "assistant"; content: string; createdAt: string; action?: LabCoachAction }
export type LabCoachAction = "ask" | "hint" | "review" | "interview" | "report";
export interface LabRunResult { testId: string; actual?: unknown; passed: boolean; error?: string }
export interface LabRun {
	id: string; at: string; codeHash: string; results: LabRunResult[]; passed: number; total: number;
	stdout: string; durationMs: number; error?: string; evidence: "local-browser-tests";
}
export interface LabFeedback { summary: string; strengths: string[]; improvements: string[]; score?: number; questionId?: string; basedOnRevision?: number; source: "ai-review" }
export interface LabUsage { at: string; model: string; calls: CallUsage[] }
export interface LabSession {
	id: string; itemId: string; title: string; kind: LabItemKind; trackId: LabTrackId;
	createdAt: string; updatedAt: string; revision: number; status: "active" | "completed";
	stage: LabStage; reasoning: string; code: string; reflection: string;
	messages: LabMessage[]; runs: LabRun[]; feedback: LabFeedback[]; usage: LabUsage[];
	questionIndex: number; answers: Record<string, string>; quizAnswers: Record<string, number>;
	hintsUsed: number; elapsedSeconds: number; timerMinutes?: number; startedAt?: string;
	settings?: ChatSettings; linkedChatIds: string[];
	/** Derived on read using the existing catalog, never an advertised fixed price. */
	pricing?: SessionPricing;
}
export interface LabProgress { itemId: string; state: LabProgressState; updatedAt: string; attempts: number; bestScore?: number; weakAreas: string[] }
export interface LabLibrary { version: 1; bookmarks: string[]; progress: Record<string, LabProgress> }
export interface LabOverview { catalog: LabCatalog; sessions: LabSession[]; library: LabLibrary; pricing?: SessionPricing }
export interface LabSessionPatch {
	revision: number; reasoning?: string; code?: string; reflection?: string; stage?: LabStage;
	questionIndex?: number; answers?: Record<string, string>; quizAnswers?: Record<string, number>;
	elapsedSeconds?: number; settings?: ChatSettings; complete?: boolean;
}
export type LabStreamEvent =
	| { type: "status"; message: string }
	| { type: "text"; text: string }
	| { type: "done"; session: LabSession; feedback?: LabFeedback }
	| { type: "error"; error: string };

export const labProgressLabel: Record<LabProgressState, string> = { collected: "Saved", read: "Read", practiced: "Practiced", proven: "Verified exercise" };
export function labItemById(catalog: LabCatalog, id: string): LabItem | undefined { return catalog.items.find(item => item.id === id); }

/** Reading, an AI review, and completing an exercise are different evidence. */
export function labStageBlocker(session: LabSession, item: LabItem, target: LabStage): string | null {
	const next = LAB_STAGES.indexOf(target);
	if (next < 0) return "Choose a valid stage.";
	if (next <= LAB_STAGES.indexOf(session.stage)) return null;
	if (next > LAB_STAGES.indexOf(session.stage) + 1) return "Finish the current stage first.";
	if (next >= 1 && session.reasoning.trim().length < 30) return "Explain the problem in your own words first.";
	if (next >= 3 && item.coding && session.code.trim() === item.coding.starterCode.trim()) return "Write your own attempt before testing.";
	if (next >= 3 && !item.coding && !Object.values(session.answers).some(answer => answer.trim().length >= 20)) return "Save an answer before reviewing your work.";
	if (next >= 4 && item.coding && !session.runs.length) return "Run your code first. Passing is not required to reflect.";
	return null;
}

export function labQuestionScore(session: LabSession, item: LabItem): number | undefined {
	const questions = item.questions.filter(question => question.options && question.answer !== undefined);
	if (!questions.length || questions.some(question => session.quizAnswers[question.id] === undefined)) return undefined;
	return Math.round(100 * questions.filter(question => session.quizAnswers[question.id] === question.answer).length / questions.length);
}

export function labHandoffPrompt(session: LabSession, item: LabItem, mode: "teach" | "practice"): string {
	const latest = session.runs.at(-1);
	const evidence = latest ? JSON.stringify({ at: latest.at, codeHash: latest.codeHash, passed: latest.passed, total: latest.total, error: latest.error, results: latest.results }).slice(0, 12000) : "No recorded tests";
	return `${mode === "practice" ? "Help me practice" : "Teach me"} ${item.title}.\n\nLearning goals:\n${item.objectives.map(goal => `- ${goal}`).join("\n")}\n\nExercise context:\n${item.content}\n\nMy reasoning:\n${session.reasoning || "Not yet written"}\n\nMy current attempt:\n${item.coding ? session.code : Object.entries(session.answers).map(([id, answer]) => `${item.questions.find(question => question.id === id)?.prompt ?? id}: ${answer}`).join("\n")}\n\nLatest recorded browser tests (may predate the current code):\n${evidence}\n\nReflection:\n${session.reflection || "Not yet written"}\n\nCoach suggestions, not verified evidence:\n${session.feedback.at(-1)?.improvements.join("\n") || "None yet"}\n\nUse this saved Lab context. Ask me to reason, check understanding, and use interactive visuals when helpful. Never treat an AI answer as proof that my code passed. Never use em dashes.`;
}
