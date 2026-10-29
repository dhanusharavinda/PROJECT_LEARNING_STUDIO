import assert from "node:assert/strict";
import { test } from "node:test";
import { deepseekTeachingPreset } from "../src/core/studio-models.ts";
import type { ModelCatalogEntry } from "../src/core/contracts/models.ts";
const flash: ModelCatalogEntry = { id: "deepseek-flash", provider: "deepseek", name: "Flash", input: ["text", "image"], reasoning: true, supportedLevels: ["off", "low", "high"], cost: null, contextWindow: 1000000, maxTokens: 384000 };
test("DeepSeek preset pins all teaching roles explicitly with low reasoning", () => {
	const preset = deepseekTeachingPreset([flash]);
	assert.equal(preset?.strong?.model?.id, "deepseek-flash");
	assert.equal(preset?.cheap?.thinkingLevel, "low");
	assert.deepEqual(preset?.vision?.model, preset?.strong?.model);
});
test("preset refuses absent, unrelated, legacy, and text-only models", () => {
	for (const models of [[], [{ ...flash, provider: "other" }], [{ ...flash, id: "deepseek-chat" }], [{ ...flash, input: ["text"] as ("text" | "image")[] }]]) assert.equal(deepseekTeachingPreset(models), null);
});
