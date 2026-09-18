import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Reject anything else. */
export function assertCron(req: NextRequest): NextResponse | null {
  const secret = env().CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret || !header.startsWith("Bearer ") || !safeEqual(header.slice(7), secret)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Invalid cron secret" } }, { status: 401 });
  }
  return null;
}
