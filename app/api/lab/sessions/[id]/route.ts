import { labSessionGet, labSessionPatch, labSessionDelete } from "@/src/server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(_req: Request, context: Context) { return labSessionGet((await context.params).id); }
export async function PATCH(req: Request, context: Context) { return labSessionPatch(req, (await context.params).id); }
export async function DELETE(req: Request, context: Context) { return labSessionDelete(req, (await context.params).id); }
