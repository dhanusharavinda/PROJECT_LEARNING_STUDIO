import { labHandoffPost } from "@/src/server";
export const runtime = "nodejs";
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) { return labHandoffPost(req, (await context.params).id); }
