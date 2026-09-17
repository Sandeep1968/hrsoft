import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, parseBody } from "@/lib/api";
import { requestPasswordReset } from "@/server/services/auth";

export async function POST(req: NextRequest) {
  try {
    const body = await parseBody(req, z.object({ email: z.string().email() }));
    await requestPasswordReset(body.email, { ip: req.headers.get("x-forwarded-for") });
    return NextResponse.json({ data: { ok: true } });
  } catch (e) {
    return errorResponse(e);
  }
}
