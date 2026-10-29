import { blackboardMediaResponse } from "@/src/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, context: { params: Promise<{ id: string; kind: string }> }) {
	const { id, kind } = await context.params;
	return blackboardMediaResponse(req, id, kind);
}
