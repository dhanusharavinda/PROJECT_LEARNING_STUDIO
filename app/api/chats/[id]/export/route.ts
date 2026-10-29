import { getChat, stores } from "@/src/server";
import { lessonExport, blackboardPlanSchema } from "@/src/core";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
	const { id } = await context.params;
	if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) return Response.json({ error: "Invalid lesson" }, { status: 400 });
	const chat = getChat(id);
	if (!chat) return Response.json({ error: "Lesson not found" }, { status: 404 });
	const boards = stores.jobStore.listJobs(id).filter(job => job.kind === "animation" && job.status === "done").flatMap(job => {
		const parsed = blackboardPlanSchema.safeParse(job.input);
		return parsed.success ? [parsed.data] : [];
	});
	const { filename, markdown } = lessonExport(chat, boards);
	return new Response(markdown, { headers: {
		"Content-Type": "text/markdown; charset=utf-8",
		"Content-Disposition": `attachment; filename="${filename}"`,
		"Cache-Control": "no-store",
		"X-Content-Type-Options": "nosniff",
	} });
}
