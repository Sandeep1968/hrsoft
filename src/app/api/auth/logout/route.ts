import { NextResponse, type NextRequest } from "next/server";
import { revokeCurrentSession } from "@/lib/auth/session";

export async function POST() {
  await revokeCurrentSession();
  return NextResponse.json({ data: { ok: true } });
}

/** GET variant used to clear a stale cookie and bounce to the login page. */
export async function GET(req: NextRequest) {
  await revokeCurrentSession();
  const next = req.nextUrl.searchParams.get("next");
  return NextResponse.redirect(new URL(next && next.startsWith("/") ? next : "/login", req.url));
}
