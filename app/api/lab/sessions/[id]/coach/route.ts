import { labCoachPost, labCoachCancel } from "@/src/server";
export const runtime = "nodejs";
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) { return labCoachPost(req, (await context.params).id); }
export async function DELETE(req: Request, context: { params: Promise<{ id: string }> }) { return labCoachCancel(req, (await context.params).id); }
