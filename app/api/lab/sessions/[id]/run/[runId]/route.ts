import { labRunCancel } from "@/src/server";
export const runtime = "nodejs";
export async function DELETE(req: Request, context: { params: Promise<{ id: string; runId: string }> }) {
	const { id, runId } = await context.params;
	return labRunCancel(req, id, runId);
}
