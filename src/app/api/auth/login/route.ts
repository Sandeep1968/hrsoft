import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { errorResponse, parseBody } from "@/lib/api";
import { loginWithPassword } from "@/server/services/auth";
import { setSessionCookie } from "@/lib/auth/session";

const schema = z.object({ email: z.string().email(), password: z.string().min(1).max(128) });

export async function POST(req: NextRequest) {
  try {
    const body = await parseBody(req, schema);
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const session = await loginWithPassword(body.email, body.password, { ip, userAgent: req.headers.get("user-agent") });
    await setSessionCookie(session.token, session.expiresAt);
    return NextResponse.json({ data: { ok: true } });
  } catch (e) {
    return errorResponse(e);
  }
}
