import type { UserSettings } from "./settings.ts";
export type VisualFormat = "auto" | "interactive" | "video" | "diagram";
export function validVisualFormat(value: unknown): value is VisualFormat { return ["auto", "interactive", "video", "diagram"].includes(value as string); }
/** Existing notebooks keep visuals enabled until the user changes the switch. */
export function visualLearningEnabled(record: UserSettings | null): boolean {
	const setting = record?.visualLearning;
	return !(setting && typeof setting === "object" && (setting as { enabled?: unknown }).enabled === false);
}

export function visualFormatEnabled(record: UserSettings | null, format: Exclude<VisualFormat, "auto">): boolean {
	if (format !== "diagram" && !visualLearningEnabled(record)) return false;
	const tool = format === "interactive" ? "demo" : format === "video" ? "animation" : "visual";
	return record?.agent?.tools?.[tool] !== false;
}
export function visualFormatDisabledMessage(format: Exclude<VisualFormat, "auto">): string {
	const label = format === "interactive" ? "Interactive demos" : format === "video" ? "Animations" : "Diagrams";
	return `${label} are turned off. Enable this format in Settings, Agent, or choose an available visual format.`;
}
