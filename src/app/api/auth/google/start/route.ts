import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { googleAuthorizationUrl } from "@/lib/auth/google";
import { googleEnabled, isProd } from "@/lib/env";

export async function GET(req: NextRequest) {
  if (!googleEnabled()) return NextResponse.redirect(new URL("/login?error=google_disabled", req.url));
  const { url, state, codeVerifier } = googleAuthorizationUrl();
  const store = await cookies();
  const opts = { httpOnly: true, sameSite: "lax" as const, secure: isProd(), path: "/", maxAge: 600 };
  store.set("g_state", state, opts);
  store.set("g_verifier", codeVerifier, opts);
  const next = req.nextUrl.searchParams.get("next");
  if (next && next.startsWith("/")) store.set("g_next", next, opts);
  return NextResponse.redirect(url);
}
