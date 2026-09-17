import { NextResponse } from "next/server";
import { revokeCurrentSession } from "@/lib/auth/session";

export async function POST() {
  await revokeCurrentSession();
  return NextResponse.json({ data: { ok: true } });
}
