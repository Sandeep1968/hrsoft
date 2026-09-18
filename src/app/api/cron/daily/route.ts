import { NextResponse, type NextRequest } from "next/server";
import { assertCron } from "@/lib/cron";
import { db } from "@/lib/db";
import { purgeExpiredSessions } from "@/lib/auth/session";
import { purgeRateLimits } from "@/lib/ratelimit";
import { addDays, todayUtc } from "@/lib/dates";
import { runDailyAttendanceJob } from "@/server/services/attendance";

export const maxDuration = 300;

/** Runs nightly (00:00 IST). Idempotent — safe to re-run. */
export async function GET(req: NextRequest) {
  const denied = assertCron(req);
  if (denied) return denied;
  const started = Date.now();
  const today = todayUtc();
  const yesterday = addDays(today, -1);
  const result: Record<string, unknown> = {};

  result.sessionsPurged = await purgeExpiredSessions();
  result.rateLimitsPurged = await purgeRateLimits();

  // Employee lifecycle transitions
  const activated = await db.employee.updateMany({ where: { status: "ONBOARDING", joiningDate: { lte: today } }, data: { status: "ACTIVE" } });
  result.activated = activated.count;
  const exited = await db.employee.findMany({ where: { status: "ON_NOTICE", exitDate: { lt: today } }, select: { id: true, userId: true } });
  if (exited.length) {
    await db.$transaction([
      db.employee.updateMany({ where: { id: { in: exited.map((e) => e.id) } }, data: { status: "EXITED" } }),
      db.user.updateMany({ where: { id: { in: exited.flatMap((e) => (e.userId ? [e.userId] : [])) } }, data: { status: "SUSPENDED" } }),
      db.session.deleteMany({ where: { userId: { in: exited.flatMap((e) => (e.userId ? [e.userId] : [])) } } }),
    ]);
  }
  result.exited = exited.length;

  // Attendance auto-marking for yesterday (and today, so today's calendar shows holidays/week-offs)
  result.attendanceYesterday = await runDailyAttendanceJob(yesterday);
  result.attendanceToday = await runDailyAttendanceJob(today);

  result.ms = Date.now() - started;
  return NextResponse.json({ data: result });
}
