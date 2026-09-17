import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const started = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", db: "ok", latencyMs: Date.now() - started, version: process.env.npm_package_version ?? "0.1.0" });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ status: "degraded", db: "error" }, { status: 503 });
  }
}
