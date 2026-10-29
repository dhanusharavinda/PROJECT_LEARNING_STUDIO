import type { CustomModel, UserSettings } from "./settings.ts";

export const OLLAMA_PROVIDER = "ollama-local";
export interface OfflineSettings {
	enabled: boolean;
	baseUrl: string;
	model: string;
	models: CustomModel[];
	runtimeModel?: string;
}
export function localOllamaUrl(raw: string): string {
	try {
		const u = new URL(raw);
		if (u.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) || u.username || u.password || u.search || u.hash || !["", "/"].includes(u.pathname)) return "";
		return u.origin;
	} catch { return ""; }
}
export function offlineSettings(record: UserSettings | null): OfflineSettings | undefined {
	return record?.offline as OfflineSettings | undefined;
}
export function offlineSpec(record: UserSettings | null) {
	const setting = offlineSettings(record);
	return setting?.enabled ? { provider: OLLAMA_PROVIDER, id: setting.model || "", thinkingLevel: "off" as const } : undefined;
}

let readPolicy: () => OfflineSettings | undefined = () => undefined;
export function configureOfflinePolicy(read: typeof readPolicy) { readPolicy = read; }
export function offlineProviderAllowed(provider: string): boolean { return !readPolicy()?.enabled || provider === OLLAMA_PROVIDER; }
export function offlineRuntimeModel(): string | undefined { return readPolicy()?.runtimeModel; }
export function offlineUrlAllowed(raw: string): boolean {
	if (!readPolicy()?.enabled) return true;
	try { const u = new URL(raw); return ["data:", "blob:"].includes(u.protocol) || (["http:", "https:"].includes(u.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)); }
	catch { return false; }
}
