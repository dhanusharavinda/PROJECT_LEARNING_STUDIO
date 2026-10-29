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
		nodes: Type.Optional(Type.Array(Type.Object({ id: Type.String({ pattern: "^[a-zA-Z0-9_-]{1,30}$" }), label: Type.String({ minLength: 1, maxLength: 100 }) }), { maxItems: 6 })),
		edges: Type.Optional(Type.Array(Type.Object({ from: Type.String({ maxLength: 30 }), to: Type.String({ maxLength: 30 }), label: Type.Optional(Type.String({ minLength: 1, maxLength: 45 })) }), { maxItems: 8 })),
		a: Type.Optional(point()), b: Type.Optional(point()),
		start: Type.Optional(Type.Number({ minimum: -4, maximum: 4 })), learningRate: Type.Optional(Type.Number({ minimum: 0.05, maximum: 0.4 })), iterations: Type.Optional(Type.Integer({ minimum: 2, maximum: 12 })),
	}), { minItems: 1, maxItems: 8 }),
});

export function validateAnimationInput(input: unknown) {
	return blackboardPlanSchema.parse(input);
}
