# HRsoft — End-to-End Review (18 Sep 2026)

Scope: the full stack as built — 65 Prisma models, 213 API route files, 71
pages, 19 test files — reviewed for correctness, RBAC coverage, scale to
2,000 users, and production readiness. Everything below was verified by
running it, not by reading alone.

## Verdict

**Ready for a pilot deployment.** Type-check, lint, all 113 tests and the
production build are green. Every `/api/v1` route goes through the
authenticating wrapper; every service function authorises against the
permission catalogue; sensitive PII is encrypted; the seeded 2,000-user
database serves ~1,000 requests/second from one local instance with p99 under
250 ms. The "Known gaps" section lists what to do before calling it GA.

## What was checked

| Check | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors, 0 warnings |
| `npm test` (Vitest, unit + DB integration on the 2,000-employee DB) | 19 files, **113 tests passed** |
| `npm run build` (Next 16 production build) | success |
| Page smoke (every page as `admin@`, `manager@`, `employee@` against the production build) | admin 53×200, 8×404 (bogus ids), 0×500 · manager 49×200, 8×403, 4×404 · employee 48×200, 9×403, 4×404 |
| Load test (`npm run loadtest`, 150 logged-in users, 100 concurrent connections, 30 s, 8 hot endpoints incl. the SSR dashboard) | **1,025 req/s, p50 74 ms, p99 235 ms, 30,764 requests, 0 errors** |
| Payroll processing, 2,000 employees | **1.1 s** (service level), 2.7 s over HTTP |
| Review-cycle launch for 2,000 employees | < 1 s (`createMany` chunks) |
| Headcount / attrition / attendance reports | SQL aggregates; each < 200 ms on 2,000 employees / 60k attendance rows |

## RBAC review

- **Catalogue**: 65 permissions (`module:action`) × scope Self / Team / All;
  9 system roles plus custom roles from the UI. Matrix: `docs/RBAC.md`.
- **Enforcement points audited**:
  - 213 route files: all `/api/v1/*` handlers use `route()`; the only
    `public: true` routes are the three careers endpoints (rate-limited by IP).
    Cron routes require the `CRON_SECRET` bearer. Auth routes are the login
    surface and are rate-limited.
  - 26 service modules: every one calls `authorize` / `scopeFilter` /
    `visibleEmployeeIds` / `can` except `auth.ts` (pre-auth by definition) and
    `calendar.ts` (pure helpers with no employee data exposure).
  - No page performs a mutation directly on the DB; no `dangerouslySetInnerHTML`; no `eval`.
- **Team scope** is resolved by a recursive CTE over `managerId` (depth ≤ 12)
  and cached per request. Approval endpoints refuse self-approval unless the
  actor holds All scope. Tested in `authorize.test.ts`, `leave.test.ts`,
  `expenses.test.ts`, `timesheets.test.ts`, `rbac.test.ts`.
- **Fixed during review**: the hiring module had injected an
  `employees:write` grant into a derived actor to convert an accepted offer
  into an employee. Replaced with an explicit rule inside `createEmployee`
  (`employees:write` All **or** `hiring:manage` All) so no code path
  manufactures permissions.
- **Sensitive data**: PAN / Aadhaar / UAN / bank account are AES-256-GCM
  encrypted; decrypted only under `employees:read_sensitive` for that
  employee, otherwise masked. Bank advice and PF ECR exports require
  `payroll:finalize` / `employees:read_sensitive` and are audited. Audit
  before/after JSON redacts secret-looking keys.

## Security review

- Sessions: random 256-bit token, SHA-256 stored, `HttpOnly` `SameSite=Lax`
  `Secure` cookie, sliding 14-day expiry, revoked on password reset / suspend / exit.
- Passwords: Argon2id; unknown-user logins still run a verify to blunt timing
  enumeration; 8 attempts / 15 min per email, 40 / 15 min per IP (DB-backed so
  it holds across serverless instances).
- Google SSO: PKCE + state cookie, verified email required, optional domain
  lock, links only to pre-existing users (no auto-provisioning).
- Headers: `X-Frame-Options: DENY`, `nosniff`, referrer policy, permissions
  policy, `poweredByHeader` off.
- Uploads: 10 MB cap, MIME allow-list, keys randomised; local-mode downloads
  go through an authenticated route that checks document ownership.
- Errors: API never leaks stack traces; page-level `ForbiddenError` /
  `NotFoundError` render `forbidden.tsx` / `not-found.tsx` with real 403/404
  statuses (via Next's HTTP-interrupt digests); other failures hit `error.tsx`.
- **Fixed during review**: audit logging silently failed for login events
  because the partial actor had no `roles`; malformed uuids in URLs returned
  500 instead of 404; a stale session cookie caused a redirect loop between
  `/login` and `/dashboard` (the proxy only checked cookie presence) and pages
  assumed the layout's auth guard had run (they render in parallel) — pages now
  use `requireActor()` and the layout clears stale cookies via the logout
  route; a live clock caused a hydration mismatch; a shadcn hook violated the
  React set-state-in-effect rule.

## Scale review (2,000 users)

- Schema: UUIDv7 keys; 80+ indexes covering every `(employeeId, date)`,
  `(approverId, status)`, `(status, createdAt)` path; unique constraints on
  natural keys (attendance per day, balance per type/year, payslip per run).
- Lists are paginated (max 200) with column selection; reports aggregate in
  SQL and never load all employees; bulk jobs use `createMany` in chunks of
  1,000; payroll processes 200 employees per transaction with progress.
- Connections: `pg` pool of `DB_POOL_MAX` per instance (set 5 on Vercel)
  behind Neon's PgBouncer. Prisma 7 driver-adapter path has no Rust engine
  cold start.
- Growth headroom: at 2,000 employees the largest tables grow ~500k
  attendance rows/year and 24k payslips/year — comfortably within a single
  Postgres instance for many years. `docs/ARCHITECTURE.md` lists the next
  steps (read replica for reports, yearly partitioning of attendance).

## Functional coverage vs Keka's advertised modules

| Keka area | HRsoft | Notes |
|---|---|---|
| Core HR: records, documents, org chart, custom fields, onboarding, exits, helpdesk | ✅ | CSV import, encrypted IDs, onboarding templates, exit clearance, SLA-based helpdesk |
| Attendance & time tracking, shifts, holidays, WFH, regularisation | ✅ | Geo-tagged web punch; biometric/device sync is an integration point (API keys + `POST /api/v1/attendance/punch`) |
| Leave: types, accrual, carry-forward, half-days, approvals, team calendar | ✅ | Accrual and carry-forward run from the monthly cron |
| Payroll: one-click runs, PF / ESI / PT / TDS, LOP, payslips, bank advice, PF ECR, tax declarations | ✅ | Old + new regime, FY-keyed rule table; ECR is CSV not `#~#` format |
| Expenses & reimbursements | ✅ | Reimburse via payroll adjustment or direct |
| Performance: OKRs, review cycles, calibration, 360 feedback, praise | ✅ | |
| Hiring: jobs, pipeline, interviews, offers, careers page, convert to employee | ✅ | No offer-letter PDF |
| Engagement: announcements, surveys, eNPS, pulse | ✅ | Anonymity threshold of 5 per department |
| Projects & timesheets (PSA) | ✅ | Weekly grid, PM approval, utilisation |
| Analytics & custom report builder | ✅ | 8 SQL reports + allow-listed custom builder, CSV export |
| Mobile app | ➖ | Responsive web; PWA/native app not built |
| Integrations (Slack, Teams, Zoom, Google Workspace) | ◐ | Google SSO, open REST API with keys, outbound webhooks (HMAC-signed); no Slack/Teams bots |
| Employee self-service | ✅ | Profile, bank, documents, attendance, leave, payslips, tax, expenses, tickets, timesheets |

## Known gaps (do before GA)

1. **Email delivery** is SMTP-only and awaited inline; finalising payroll for
   2,000 people sends 2,000 emails in batches of 200 — move to a queue or a
   provider batch API for reliability on serverless.
2. **Tax rules** for FY 2026-27 use the FY 2025-26 slabs as a baseline; verify
   against the Finance Act before the first live payroll. HRA exemption is
   taken as declared (no least-of-three computation).
3. **Statutory exports**: PF ECR should be emitted in the EPFO `#~#` text
   format; ESI return, Form 16 and Form 24Q are not generated.
4. **Biometric / device attendance** needs an adapter; the API is ready.
5. **2FA (TOTP)** is not implemented; Google SSO with a domain lock is the
   recommended control until it is.
6. **Schema additions** suggested by the module builds (all additive):
   `LeaveAccrualLog`, `Payslip.taxableEarnings`, `Webhook.lastDeliveryAt/lastStatus`,
   `AssetAssignment.acknowledgedAt`, `ReviewCycle.includeDepartmentIds`,
   `SurveyResponse.departmentId`, enums for `Interview.status` and
   `FeedbackRequest.status`.
7. **Browser E2E tests** (Playwright) are not included; coverage today is
   unit + DB-integration tests plus HTTP smoke of every page per role.
8. **Observability**: wire Sentry (or similar) into `errorResponse()` and
   `error.tsx`; add request-id logging.
9. **Load test caveat**: numbers are from one local Node process against a
   local Postgres. On Vercel + Neon expect higher latency per request but
   horizontal scaling; re-run `npm run loadtest` against staging.

## How to re-run this review

```bash
npm run typecheck && npm run lint && npm test && npm run build
npx next start -p 3200 &            # then, in another shell:
BASE_URL=http://localhost:3200 CONNECTIONS=100 DURATION=30 USERS=150 npm run loadtest
```
