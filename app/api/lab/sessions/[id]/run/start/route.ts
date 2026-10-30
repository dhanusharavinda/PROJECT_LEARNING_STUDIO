import { labRunStart } from "@/src/server";
export const runtime = "nodejs";
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) { return labRunStart(req, (await context.params).id); }
