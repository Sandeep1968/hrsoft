import { NextResponse, type NextRequest } from "next/server";
import { assertCron } from "@/lib/cron";
import { runMonthlyLeaveAccrual, runYearEndCarryForward } from "@/server/services/leave";

export const maxDuration = 300;

/** Runs on the 1st of every month (00:30 IST). Idempotent. */
export async function GET(req: NextRequest) {
  const denied = assertCron(req);
  if (denied) return denied;
  const started = Date.now();
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const result: Record<string, unknown> = {};
  if (month === 1) result.carryForward = await runYearEndCarryForward(year - 1);
  result.accrual = await runMonthlyLeaveAccrual(year, month);
  result.ms = Date.now() - started;
  return NextResponse.json({ data: result });
}
