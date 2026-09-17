import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z, type ZodType } from "zod";
import { getActor } from "@/lib/auth/session";
import { AppError, UnauthorizedError, ValidationError } from "@/lib/errors";
import type { Actor } from "@/lib/rbac/authorize";
import { Prisma } from "@/generated/prisma/client";

/**
 * Route-handler wrapper: authenticates (session cookie or API key), maps
 * AppError / Zod / Prisma errors to JSON, and never leaks stack traces.
 *
 *   export const GET = route(async (req, { actor, params }) => { ... return ok(data) })
 */
export interface RouteCtx<P = Record<string, string>> {
  actor: Actor;
  params: P;
  query: URLSearchParams;
}

type Handler<P> = (req: NextRequest, ctx: RouteCtx<P>) => Promise<Response>;

interface RouteOpts {
  /** Allow unauthenticated access (actor will be a throw-on-use proxy). */
  public?: boolean;
}

export function route<P = Record<string, string>>(handler: Handler<P>, opts: RouteOpts = {}) {
  return async (req: NextRequest, segment: { params: Promise<P> }): Promise<Response> => {
    try {
      const params = await segment.params;
      const actor = await getActor();
      if (!actor && !opts.public) throw new UnauthorizedError();
      return await handler(req, { actor: actor as Actor, params, query: req.nextUrl.searchParams });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown): Response {
  if (e instanceof AppError) {
    return NextResponse.json({ error: { code: e.code, message: e.message, details: e.details ?? undefined } }, { status: e.status });
  }
  if (e instanceof z.ZodError) {
    return NextResponse.json(
      { error: { code: "VALIDATION", message: "Validation failed", details: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } },
      { status: 422 },
    );
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") return NextResponse.json({ error: { code: "CONFLICT", message: "A record with the same unique value already exists" } }, { status: 409 });
    if (e.code === "P2025") return NextResponse.json({ error: { code: "NOT_FOUND", message: "Record not found" } }, { status: 404 });
    if (e.code === "P2003") return NextResponse.json({ error: { code: "CONFLICT", message: "Related record is missing or still referenced" } }, { status: 409 });
  }
  console.error("Unhandled API error", e);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong" } }, { status: 500 });
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

export function created<T>(data: T) {
  return NextResponse.json({ data }, { status: 201 });
}

export function noContent() {
  return new NextResponse(null, { status: 204 });
}

/** Parse and validate a JSON body against a Zod schema. */
export async function parseBody<S extends ZodType>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
  return schema.parse(json);
}

export function parseQuery<S extends ZodType>(query: URLSearchParams, schema: S): z.infer<S> {
  const obj: Record<string, string | string[]> = {};
  for (const [k, v] of query.entries()) {
    const existing = obj[k];
    if (existing === undefined) obj[k] = v;
    else obj[k] = Array.isArray(existing) ? [...existing, v] : [existing, v];
  }
  return schema.parse(obj);
}

// ── Pagination ────────────────────────────────────────────────────────────

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  sort: z.string().max(60).optional(),
  order: z.enum(["asc", "desc"]).default("asc"),
});
export type Pagination = z.infer<typeof paginationSchema>;

export function paginate(p: Pick<Pagination, "page" | "pageSize">) {
  return { skip: (p.page - 1) * p.pageSize, take: p.pageSize };
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

export function toPage<T>(items: T[], total: number, p: Pick<Pagination, "page" | "pageSize">): Page<T> {
  return { items, total, page: p.page, pageSize: p.pageSize, pages: Math.max(1, Math.ceil(total / p.pageSize)) };
}

/** Common zod helpers */
export const zUuid = z.string().uuid();
export const zDate = z.coerce.date();
export const zDateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .transform((s) => new Date(`${s}T00:00:00.000Z`));
export const zMoney = z.coerce.number().min(0).max(1_000_000_000);
