import { labRunPost } from "@/src/server";
export const runtime = "nodejs";
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) { return labRunPost(req, (await context.params).id); }
