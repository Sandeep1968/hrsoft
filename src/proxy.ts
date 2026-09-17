import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic auth gate. Only checks that a session cookie exists; the real
 * session validation and RBAC happen in layouts, services and route handlers.
 */
const PUBLIC_PREFIXES = ["/login", "/forgot-password", "/reset-password", "/api/auth", "/api/health", "/api/cron", "/careers", "/api/v1/public"];
const SESSION_COOKIE = "hrsoft_session";

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  const hasApiKey = req.headers.get("authorization")?.startsWith("Bearer hrs_") ?? false;

  const res = NextResponse.next();
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");

  if (isPublic) {
    if ((pathname === "/login") && hasSession) return NextResponse.redirect(new URL("/dashboard", req.url));
    return res;
  }
  if (pathname.startsWith("/api/")) {
    if (!hasSession && !hasApiKey) {
      return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Authentication required" } }, { status: 401 });
    }
    return res;
  }
  if (!hasSession) {
    const url = new URL("/login", req.url);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:png|jpg|svg|ico|webp)$).*)"],
};
