# HRsoft Architecture

## Request flow

```
Browser ──► proxy.ts (cookie present? security headers) ──► App Router
                                                             │
        Server Component page ──► service fn(actor, …) ──► Prisma ──► Postgres
        Client component ──fetch──► /api/v1 route() ──► service fn(actor, …) ──► Prisma
                                     │
                                     └─ getActor(): session cookie → Session row → User + roles → Actor{perms}
                                        or  Authorization: Bearer hrs_… → ApiKey → Actor (narrowed scopes)
```

- `src/proxy.ts` is an *optimistic* gate only (redirects to `/login` when no
  session cookie). Real authentication happens in `getActor()` (React-cached
  per request) and authorisation in every service function.
- Route handlers are wrapped by `route()` (`src/lib/api.ts`) which authenticates,
  validates with Zod, and maps `AppError`/Zod/Prisma errors to JSON without
  leaking internals.
- Server Components call services directly (no HTTP hop); client components
  call `/api/v1` via `apiFetch` and then `router.refresh()`.

## Layering

| Layer | Path | Rule |
|---|---|---|
| Services | `src/server/services/*.ts` | All business logic. First arg is always `actor`. Every function calls `authorize`/`scopeFilter`. Writes call `audit()` and `notify()`. |
| Pure engines | `src/server/payroll/engine.ts` | No I/O, fully unit-tested (statutory maths, tax slabs). |
| API | `src/app/api/v1/**` | Thin: parse → service → `ok()`. The same routes serve the UI and external API keys. |
| Pages | `src/app/(app)/**` | Server components; client islands for forms. |
| Shell | `src/app/(app)/layout.tsx`, `src/components/shell/*` | Session provider, permission-filtered sidebar, header. |
| Lib | `src/lib/*` | env, db, crypto, RBAC, auth, mail, storage, rate limit, audit, notify, dates. |

## Authentication

- Passwords: Argon2id (19 MiB, t=2). Policy: ≥10 chars, letters + numbers.
- Sessions: 256-bit random token in an `HttpOnly; SameSite=Lax; Secure` cookie;
  only the SHA-256 hash is stored (`Session.tokenHash`). 14-day sliding expiry.
- Login rate limits: 8 / 15 min per email, 40 / 15 min per IP, stored in
  Postgres so they hold across serverless instances. Unknown users still pay
  an Argon2 verify to blunt user enumeration by timing.
- Google Workspace: OIDC with PKCE via `arctic`; `hd`/domain enforced with
  `GOOGLE_ALLOWED_DOMAIN`; SSO **links** to an existing user by verified email
  and never auto-provisions.
- Password reset: single-use 1-hour token (hash stored), revokes all sessions.
- API keys: `hrs_` + 32 random bytes; hash stored; scopes ⊆ creator's permissions.

## Authorisation (RBAC)

Permissions live in `src/lib/rbac/permissions.ts` (`module:action`, ~65 of
them). `Role` → `RolePermission(permission, scope)` → `UserRole`. A user's
effective scope is the widest across roles. `authorize()` resolves Team scope
with a recursive CTE over `Employee.managerId` (depth ≤ 12, cached per request).
`scopeFilter()` turns the scope into a Prisma `where` so lists never over-fetch.

Sensitive PII (PAN, Aadhaar, UAN, bank account) is AES-256-GCM encrypted at rest
with `FIELD_ENCRYPTION_KEY`; decryption requires `employees:read_sensitive` for
that employee, otherwise values are masked. Audit log entries redact any key
matching `/pass|secret|token|hash|aadhaar|pan|accountNumber/i`.

## Data model

~65 models (see `prisma/schema.prisma`). Highlights:

- `Employee` is the hub; `User` is optional (1:1) so contractors/ex-employees
  can exist without login. `managerId` self-relation drives Team scope, org
  chart and approvals.
- Dates that are calendar days (`joiningDate`, `AttendanceRecord.date`,
  `LeaveRequest.startDate`, …) are `DATE` columns handled as UTC midnight.
- Money is `Decimal(14,2)`; payslip line items are JSON keyed by component code
  so structures can change without migrations.
- Approval workflows share one shape: `status`, `approverId`, `decidedAt`,
  `decisionNote` and a `POST …/:id/decide` endpoint.
- `AuditLog` is append-only with before/after JSON; `RateLimit` and `Session`
  are purged by the daily cron.

## Scaling to 2,000 users (and beyond)

Measured on the seeded 2,000-employee database (see `docs/REVIEW.md` for numbers):

- **Indexes** on every `(employeeId, date)` / `(approverId, status)` /
  `(status, createdAt)` hot path; UUIDv7 keys keep B-trees append-friendly.
- **Pagination everywhere** (max 200 rows), `select` of only needed columns,
  aggregates in SQL (`groupBy`, `$queryRaw`).
- **Payroll** processes 200 employees per transaction with progress tracking;
  2,000 payslips compute in well under a minute.
- **Bulk jobs** (attendance auto-mark, leave accrual, cycle launch, survey
  invites) use `createMany`/`updateMany` in chunks of 1,000.
- **Connections**: `pg` pool of `DB_POOL_MAX` per instance; Neon PgBouncer in
  front. Prisma 7's adapter path avoids the Rust engine cold start on Vercel.
- **Caching**: session → actor is cached per request; nothing user-specific is
  cached across requests (correctness over cleverness). Public careers pages can
  be statically cached.
- Growth path: read replicas for reports, partition `AttendanceRecord` by year
  at ~10M rows, move payroll processing to a queue worker.

## Background jobs

| Endpoint | Schedule (IST) | Work |
|---|---|---|
| `/api/cron/daily` | 00:00 | Attendance auto-marking for yesterday (week-off / holiday / on-leave / absent), expired session + rate-limit purge, employee status transitions (ONBOARDING → ACTIVE on joining date, ON_NOTICE → EXITED after last working day) |
| `/api/cron/monthly` | 00:30 on the 1st | Leave accrual for the new month; year-end carry-forward on 1 Jan |

Both require `Authorization: Bearer $CRON_SECRET`.

## Observability

- `GET /api/health` (DB round-trip latency).
- Structured `console.error` on unhandled API errors (Vercel captures logs);
  plug in Sentry by wrapping `errorResponse()`.
- Every mutation lands in `AuditLog` with actor, IP, before/after.
