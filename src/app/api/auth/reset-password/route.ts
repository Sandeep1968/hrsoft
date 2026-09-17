import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, parseBody } from "@/lib/api";
import { resetPassword } from "@/server/services/auth";

export async function POST(req: NextRequest) {
  try {
    const body = await parseBody(req, z.object({ token: z.string().min(10), password: z.string().min(1).max(128) }));
    await resetPassword(body.token, body.password);
    return NextResponse.json({ data: { ok: true } });
  } catch (e) {
    return errorResponse(e);
  }
}
