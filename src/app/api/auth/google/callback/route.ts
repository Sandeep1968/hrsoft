import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { exchangeGoogleCode } from "@/lib/auth/google";
import { loginWithGoogle } from "@/server/services/auth";
import { setSessionCookie } from "@/lib/auth/session";
import { isAppError } from "@/lib/errors";

export async function GET(req: NextRequest) {
  const store = await cookies();
  const state = req.nextUrl.searchParams.get("state");
  const code = req.nextUrl.searchParams.get("code");
  const savedState = store.get("g_state")?.value;
  const verifier = store.get("g_verifier")?.value;
  const next = store.get("g_next")?.value;
  for (const c of ["g_state", "g_verifier", "g_next"]) store.set(c, "", { maxAge: 0, path: "/" });
  if (!state || !code || !savedState || !verifier || state !== savedState) {
    return NextResponse.redirect(new URL("/login?error=google_state", req.url));
  }
  try {
    const profile = await exchangeGoogleCode(code, verifier);
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const session = await loginWithGoogle(profile, { ip, userAgent: req.headers.get("user-agent") });
    await setSessionCookie(session.token, session.expiresAt);
    return NextResponse.redirect(new URL(next && next.startsWith("/") ? next : "/dashboard", req.url));
  } catch (e) {
    const msg = isAppError(e) ? e.message : "Google sign-in failed";
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msg)}`, req.url));
  }
}
