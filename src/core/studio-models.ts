import type { ModelCatalogEntry } from "./contracts/models.ts";
import type { ModelsSettings } from "./settings.ts";

/** Explicit, user-applied preset. It never substitutes an unrelated provider. */
export function deepseekTeachingPreset(models: readonly ModelCatalogEntry[]): ModelsSettings | null {
	const flash = models.find((m) => m.provider === "deepseek" && m.id === "deepseek-flash");
	if (!flash || !flash.input.includes("image")) return null;
	const level = flash.supportedLevels.includes("low") ? "low" as const : undefined;
	const slot = () => ({ model: { provider: flash.provider, id: flash.id }, ...(level ? { thinkingLevel: level } : {}) });
	return { strong: slot(), cheap: slot(), vision: slot() };
}
