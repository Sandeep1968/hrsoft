export class AppError extends Error {
  /**
   * For 401/403/404 the digest matches Next.js's own HTTP access interrupts
   * (`notFound()` / `forbidden()` / `unauthorized()`), so a service error
   * thrown while rendering a page produces a real 404/403/401 response with
   * the matching `not-found.tsx` / `forbidden.tsx` / `unauthorized.tsx`.
   * Other statuses carry an `HRSOFT;<status>;<code>` digest that `error.tsx`
   * reads (Next forwards digests to the client even when it redacts messages).
   * API routes catch AppError before Next sees it, so JSON mapping is unaffected.
   */
  readonly digest: string;

  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.digest = status === 401 || status === 403 || status === 404 ? `NEXT_HTTP_ERROR_FALLBACK;${status}` : `HRSOFT;${status};${code}`;
  }
}

/** Parse a digest produced by AppError (used by error boundaries). */
export function parseErrorDigest(digest?: string): { status: number; code: string } | null {
  if (!digest?.startsWith("HRSOFT;")) return null;
  const [, status, code] = digest.split(";");
  return { status: Number(status), code };
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super("UNAUTHORIZED", message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action") {
    super("FORBIDDEN", message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(entity = "Resource") {
    super("NOT_FOUND", `${entity} not found`, 404);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", details?: unknown) {
    super("VALIDATION", message, 422, details);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super("CONFLICT", message, 409);
  }
}

export class RateLimitedError extends AppError {
  constructor(message = "Too many requests, try again later") {
    super("RATE_LIMITED", message, 429);
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
