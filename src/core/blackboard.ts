import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max).transform(s => s.replaceAll("\u2014", ", "));
const point = z.tuple([z.number().finite().min(-5).max(5), z.number().finite().min(-5).max(5)]);
const beat = z.object({
	title: text(90), caption: text(260),
	kind: z.enum(["flow", "vectors", "gradient_descent", "text"]),
	duration: z.number().min(2).max(10),
	nodes: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,30}$/), label: text(100) }).strict()).min(1).max(6).optional(),
	edges: z.array(z.object({ from: z.string().max(30), to: z.string().max(30), label: text(45).optional() }).strict()).max(8).optional(),
	a: point.optional(), b: point.optional(),
	start: z.number().finite().min(-4).max(4).optional(),
	learningRate: z.number().min(0.05).max(0.4).optional(),
	iterations: z.number().int().min(2).max(12).optional(),
}).strict().superRefine((b, ctx) => {
	if (b.kind === "flow") {
		if (!b.nodes?.length) ctx.addIssue({ code: "custom", message: "A flow needs nodes." });
		const ids = new Set(b.nodes?.map(n => n.id));
		if (ids.size !== b.nodes?.length) ctx.addIssue({ code: "custom", message: "Node identities must be unique." });
		for (const edge of b.edges || []) if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) ctx.addIssue({ code: "custom", message: "Connect two existing distinct nodes." });
	}
	if (b.kind === "vectors" && (!b.a || !b.b || b.a.every(v => v === 0) || b.b.every(v => v === 0))) ctx.addIssue({ code: "custom", message: "Provide two nonzero 2D vectors." });
});

export const blackboardPlanSchema = z.object({ title: text(120), beats: z.array(beat).min(1).max(8) }).strict().superRefine((p, ctx) => {
	if (p.beats.reduce((s, b) => s + b.duration, 0) > 60) ctx.addIssue({ code: "custom", message: "Keep a board at or below 60 seconds." });
});
export type BlackboardPlan = z.infer<typeof blackboardPlanSchema>;
export interface BlackboardArtifact {
	id: string; title: string; url: string; posterUrl: string; durationSeconds: number;
	sections: { title: string; start: number; end: number }[];
	cacheHit: boolean; engine: "manimgx";
}
export function blackboardSections(plan: BlackboardPlan) {
	let cursor = 0;
	return plan.beats.map(b => { const start = cursor; cursor += b.duration; return { title: b.title, start, end: cursor }; });
}
export function vectorCosine(a: [number, number], b: [number, number]) {
	return (a[0]*b[0]+a[1]*b[1])/(Math.hypot(...a)*Math.hypot(...b));
}
export function quadraticDescent(start: number, rate: number, iterations: number) {
	const steps: { x: number; loss: number }[] = [];
	let x = start;
	for (let i=0;i<iterations;i++) { steps.push({x,loss:x*x}); x-=rate*2*x; }
	return steps;
}

/** Data is JSON, never Python supplied by a model. No imports, expressions, or paths are accepted. */
export function compileBlackboardScene(input: BlackboardPlan): string {
	const plan = blackboardPlanSchema.parse(input);
	const calculatedPlan = {...plan, beats:plan.beats.map(b => ({...b,calculation:b.kind === "vectors" ? {cosine:vectorCosine(b.a!,b.b!)} : b.kind === "gradient_descent" ? {steps:quadraticDescent(b.start??3.5,b.learningRate??.2,b.iterations??6)} : undefined}))};
	return `import json, math, textwrap
import manimgx as m
P = json.loads(${JSON.stringify(JSON.stringify(calculatedPlan))})
m.config.background_color = "#fbfaf5"
INK = "#24392f"
SAGE = "#39745b"
LILAC = "#8a6ba2"
def label(s, size=28, width=11.5, lines=48):
    t = m.Text("\\n".join(textwrap.wrap(s, lines)), font_size=size, color=INK)
    if t.width > width: t.scale(width / t.width)
    return t
class BlackboardLesson(m.Scene):
    def construct(self):
        for beat_index,b in enumerate(P["beats"]):
            self.next_section(b["title"])
            title = label(b["title"], 36).move_to([0,3.25,0])
            caption = label(b["caption"], 25, 11.5, 80).move_to([0,-3.1,0])
            objects = [title, caption]
            trace = []
            if b["kind"] == "flow":
                nodes = b["nodes"]
                positions, boxes = {}, []
                cols = min(3, len(nodes))
                for i,n in enumerate(nodes):
                    row = i // cols
                    col = i % cols if row % 2 == 0 else cols - 1 - i % cols
                    pos = [(col-(cols-1)/2)*4.0, 1.3-row*2.6, 0]
                    positions[n["id"]] = pos
                    rect = m.RoundedRectangle(width=3.35, height=1.35, corner_radius=.12, color=SAGE, fill_color="#e9efe4", fill_opacity=1).move_to(pos)
                    t = label(n["label"], 27, 3.0, 24).move_to(pos)
                    if t.height > 1.05: t.scale(1.05/t.height)
                    boxes.append(m.VGroup(rect,t))
                order = {n["id"]: i for i,n in enumerate(nodes)}
                for box in boxes: trace.append(box)
                for e in b.get("edges", []):
                    a,c = positions[e["from"]], positions[e["to"]]
                    horizontal = abs(a[1]-c[1]) < .1
                    sign = 1 if (c[0]-a[0] if horizontal else c[1]-a[1]) > 0 else -1
                    start = [a[0]+sign*1.75,a[1],0] if horizontal else [a[0],a[1]+sign*.75,0]
                    end = [c[0]-sign*1.75,c[1],0] if horizontal else [c[0],c[1]-sign*.75,0]
                    target_step = max(order[e["from"]],order[e["to"]])
                    trace[target_step].add(m.Arrow(start,end,color=SAGE,buff=0,stroke_width=3))
                    if e.get("label"):
                        trace[target_step].add(label(e["label"],17,2.4,22).move_to([(start[0]+end[0])/2,(start[1]+end[1])/2+.3,0]))
            elif b["kind"] == "vectors":
                a,c = b["a"], b["b"]
                scale = .44
                origin=[0,-.3,0]
                plane=m.NumberPlane(x_range=[-5,5,1],y_range=[-5,5,1],x_length=4.4,y_length=4.4,axis_config={"color":INK},background_line_style={"stroke_color":"#cddbcf","stroke_width":1}).move_to(origin)
                objects.append(plane)
                for i,(v,color,name) in enumerate([(a,SAGE,"a"),(c,LILAC,"b")]):
                    end=[v[0]*scale,v[1]*scale-.3,0]
                    trace.append(m.Arrow(origin,end,color=color,buff=0,stroke_width=6))
                    legend=m.Text(name+" = "+str(v),font_size=24,color=color)
                    if legend.width > 2.8: legend.scale(2.8/legend.width)
                    objects.append(legend.move_to([4.2,1.0-i*.8,0]))
                cosine=b["calculation"]["cosine"]
                trace.append(label("cosine similarity = "+format(cosine,".3f"),28).move_to([0,2.65,0]))
            elif b["kind"] == "gradient_descent":
                axes=m.Axes(x_range=[-4,4,1],y_range=[0,17,4],x_length=9,y_length=4.5,axis_config={"color":INK}).move_to([0,-.1,0])
                curve=axes.plot(lambda x:x*x,color=SAGE)
                objects.extend([axes,curve,label("Loss = x squared",26).move_to([0,2.65,0])])
                for point in b["calculation"]["steps"]:
                    trace.append(m.Dot(axes.c2p(point["x"],point["loss"]),color=LILAC,radius=.07))
            else:
                objects.append(label(b["caption"],40,10,45).move_to([0,0,0]))
                objects.remove(caption)
            group=m.VGroup(*objects)
            self.play(m.FadeIn(group),run_time=.35)
            if trace:
                step=(b["duration"]-.7)*.7/len(trace)
                for dot in trace: self.play(m.Create(dot),run_time=step)
                self.wait((b["duration"]-.7)*.3)
                group.add(*trace)
            else: self.wait(b["duration"]-.7)
            if beat_index == len(P["beats"])-1: self.wait(.35)
            else:
                self.play(m.FadeOut(group),run_time=.35)
                self.clear()
`;
}
