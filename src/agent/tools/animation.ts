import { Type } from "typebox";
import { blackboardPlanSchema } from "../../core/blackboard.ts";

const point = () => Type.Array(Type.Number({ minimum: -5, maximum: 5 }), { minItems: 2, maxItems: 2 });
export const animationInputSchema = Type.Object({
	title: Type.String({ minLength: 1, maxLength: 120 }),
	beats: Type.Array(Type.Object({
		title: Type.String({ minLength: 1, maxLength: 90 }),
		caption: Type.String({ minLength: 1, maxLength: 260 }),
		kind: Type.Union([Type.Literal("flow"), Type.Literal("vectors"), Type.Literal("gradient_descent"), Type.Literal("text")]),
		duration: Type.Number({ minimum: 2, maximum: 10 }),
		nodes: Type.Optional(Type.Array(Type.Object({ id: Type.String({ pattern: "^[a-zA-Z0-9_-]{1,30}$" }), label: Type.String({ minLength: 1, maxLength: 100 }) }), { maxItems: 6, description: "Every node referenced by this beat's edges must be listed here, including nodes repeated from a previous beat." })),
		edges: Type.Optional(Type.Array(Type.Object({ from: Type.String({ maxLength: 30 }), to: Type.String({ maxLength: 30 }), label: Type.Optional(Type.String({ minLength: 1, maxLength: 45 })) }), { maxItems: 8, description: "Connect ids in this same beat's nodes list. Each beat is self-contained." })),
		a: Type.Optional(point()), b: Type.Optional(point()),
		start: Type.Optional(Type.Number({ minimum: -4, maximum: 4 })), learningRate: Type.Optional(Type.Number({ minimum: 0.05, maximum: 0.4 })), iterations: Type.Optional(Type.Integer({ minimum: 2, maximum: 12 })),
	}), { minItems: 1, maxItems: 8 }),
});

/** Reuse an explicitly defined node across chapters without inventing a label. */
export function normalizeAnimationInput(input: unknown): unknown {
	if (!input || typeof input !== "object" || !Array.isArray((input as { beats?: unknown }).beats)) return input;
	const root = input as { beats: Array<Record<string, unknown>> };
	const known = new Map<string, Set<string>>();
	for (const beat of root.beats) for (const node of Array.isArray(beat?.nodes) ? beat.nodes : []) {
		if (typeof node?.id === "string" && typeof node?.label === "string") { const labels = known.get(node.id) || new Set<string>(); labels.add(node.label); known.set(node.id, labels); }
	}
	return { ...root, beats: root.beats.map(beat => {
		if (beat?.kind !== "flow" || !Array.isArray(beat.nodes) || !Array.isArray(beat.edges)) return beat;
		const nodes = [...beat.nodes]; const ids = new Set(nodes.map(n => n?.id));
		for (const edge of beat.edges) for (const id of [edge?.from, edge?.to]) {
			const labels = known.get(id);
			if (!ids.has(id) && labels?.size === 1 && nodes.length < 6) { nodes.push({ id, label: [...labels][0] }); ids.add(id); }
		}
		return { ...beat, nodes };
	}) };
}
export function validateAnimationInput(input: unknown) {
	return blackboardPlanSchema.parse(normalizeAnimationInput(input));
}
