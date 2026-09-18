# HRsoft — Module Implementation Guide

Read this fully before writing any module code. The foundation (auth, RBAC, DB,
shell, shared components) is done; modules must follow these conventions so the
codebase stays coherent.

## Stack facts (do not fight them)

- **Next.js 16.3** App Router, TypeScript strict, Tailwind v4. Middleware is
  called `proxy.ts` (already written). `params` and `searchParams` are
  **Promises** — always `await` them. Page/layout prop types are the global
  `PageProps<"/route">` / `LayoutProps<"/route">` (run `npx next typegen` if TS
  complains). No `cacheComponents`; pages under `(app)` are dynamic (the layout
  sets `export const dynamic = "force-dynamic"`).
- **Prisma 7.10** with `@prisma/adapter-pg`. Import the client from
  `@/lib/db` (`db`), types/enums from `@/generated/prisma/client`
  (`import { Prisma, type LeaveRequest, RequestStatus } from "@/generated/prisma/client"`).
  Money/decimal columns come back as `Prisma.Decimal` — convert with `Number()`
  before sending to client components; **never pass Decimal or Date objects to
  client components** (serialize to number / ISO string).
- **Do not edit `prisma/schema.prisma`.** If a field is truly missing, work
  around it (JSON columns exist on many models) and list the desired change in
  your final report. Migrations are applied only by the integrator.
- **shadcn (base-nova style, Base UI primitives — NOT Radix).** Components in
  `src/components/ui/*`. Differences from classic shadcn:
  - Polymorphism uses the `render` prop, e.g. `<Button nativeButton={false} render={<Link href="/x" />}>Go</Button>` and `<DropdownMenuItem render={<Link href="/x" />}>`.
  - For form selects use `NativeSelect` from `@/components/common/native-select`
    (plain `<select>`, works with FormData). Avoid the Base UI `Select`.
  - `Dialog`, `Sheet`, `Tabs`, `DropdownMenu`, `Popover`, `Tooltip`, `Checkbox`,
    `Switch`, `Table`, `Card`, `Badge`, `Input`, `Textarea`, `Label`, `Skeleton`,
    `Progress`, `Alert`, `Avatar` exist. Read the component file before using a
    prop you are not sure about.
  - Toasts: `import { toast } from "sonner"`.
- Shared helpers: `PageHeader`, `StatCard`, `EmptyState`, `StatusBadge`, `DL`
  from `@/components/common`; `fmtDate`, `fmtDateTime`, `fmtMoney`,
  `toDateOnly`, `isoDate`, `addDays`, `eachDay`, `monthRange`, `weekStart`,
  `financialYear`, `todayUtc`, `MONTHS` from `@/lib/dates`; `cn` from `@/lib/utils`.
- Client fetch: `apiFetch<T>(url, { method, body })` from `@/lib/client/api`
  (throws `ApiError` with `.message`; returns `json.data`).

## Layering (mandatory)

```
src/server/services/<module>.ts   ← ALL business logic + RBAC. Every exported fn takes `actor: Actor` first.
src/app/api/v1/<resource>/...     ← thin route handlers: parse → call service → ok()/created()
src/app/(app)/<route>/page.tsx    ← server components read via services (never raw db for mutations)
src/app/(app)/<route>/*.tsx       ← "use client" components for forms/interaction (call /api/v1 via apiFetch, then router.refresh())
```

- Services import `"server-only"` at the top.
- Every service function that reads or writes employee data calls
  `authorize(actor, "<permission>", { employeeId })` or uses
  `scopeFilter(actor, "<permission>")` / `visibleEmployeeIds(actor, perm)` for
  lists. Never check role names. See `src/lib/rbac/authorize.ts`.
- Mutations call `audit(actor, "<module>.<verb>", "<EntityType>", id, { before, after })`
  from `@/lib/audit` and, where a person should be told, `notify({...})` from
  `@/lib/notify` (in-app, `email: true` for approvals / payslips).
- Throw `NotFoundError`, `ForbiddenError`, `ValidationError`, `ConflictError`
  from `@/lib/errors` — the route wrapper maps them to JSON.
- Pagination: accept `paginationSchema` (`page`, `pageSize`, `q`, `sort`,
  `order`) via `parseQuery(query, paginationSchema.extend({...}))`; return
  `toPage(items, total, p)`. Cap `pageSize` at 200 (the schema does). Always
  add `orderBy` and use the existing indexes.
- Validation: zod schemas live next to the service (`export const createXSchema = z.object(...)`)
  and are reused by the route. Date-only inputs use `zDateOnly`.

### Route handler template

```ts
// src/app/api/v1/leave-requests/route.ts
import { created, ok, parseBody, parseQuery, paginationSchema, route } from "@/lib/api";
import { applyLeave, applyLeaveSchema, listLeaveRequests } from "@/server/services/leave";

export const GET = route(async (_req, { actor, query }) => ok(await listLeaveRequests(actor, parseQuery(query, paginationSchema))));
export const POST = route(async (req, { actor }) => created(await applyLeave(actor, await parseBody(req, applyLeaveSchema))));

// src/app/api/v1/leave-requests/[id]/route.ts
export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await getLeaveRequest(actor, params.id)));
```

### Approval contract (shared across modules)

Every approvable entity exposes
`POST /api/v1/<resource>/:id/decide` with body
`{ decision: "APPROVED" | "REJECTED", note?: string }` and returns the updated
entity. Resources: `leave-requests`, `regularizations`, `remote-work-requests`,
`expense-claims`, `timesheets`, `exit-requests`. The service must verify the
actor holds the module's `*:approve` permission for that employee
(`authorize(actor, "leave:approve", { employeeId })`) and that the actor is not
approving their own request unless scope is ALL.

Default approver resolution: the employee's `managerId`; if null, leave
`approverId` null and let anyone with ALL-scope approve. Store `approverId`,
`decidedAt`, `decisionNote`.

### Page template

```tsx
// src/app/(app)/leave/page.tsx
import { getActor } from "@/lib/auth/session";
import { PageHeader } from "@/components/common";
import { listLeaveRequests } from "@/server/services/leave";

export const metadata = { title: "Leave" };

export default async function LeavePage({ searchParams }: PageProps<"/leave">) {
  const actor = (await getActor())!;            // layout guarantees a session
  const sp = await searchParams;
  const page = await listLeaveRequests(actor, { page: Number(sp.page ?? 1), pageSize: 25, order: "desc" });
  return (<div><PageHeader title="Leave" actions={<ApplyLeaveButton />} />…</div>);
}
```

Pages must handle the "no employee profile" case (`actor.employeeId === null`,
e.g. the super admin) gracefully — show an EmptyState instead of crashing.

## RBAC quick reference

Permissions are in `src/lib/rbac/permissions.ts` (read it). Scope semantics:
`SELF` = own records, `TEAM` = self + direct/indirect reports, `ALL`.

```ts
await authorize(actor, "leave:approve", { employeeId: req.employeeId });  // throws
const where = await scopeFilter(actor, "attendance:read");               // {} | {employeeId: {in}} | {employeeId}
const ids = await visibleEmployeeIds(actor, "employees:read");            // null = all
can(actor, "payroll:run")                                                 // boolean, no throw
requireEmployee(actor)                                                    // employeeId or Forbidden
```

Client-side gating: `const can = useCan(); can("leave:approve", "TEAM")` from
`@/components/shell/session-provider` (UI only; server always re-checks).

Sensitive fields (`panEnc`, `aadhaarEnc`, `uanEnc`, `BankAccount.accountNumberEnc`)
are encrypted with `encryptField`/`decryptField` from `@/lib/crypto` and only
decrypted for actors holding `employees:read_sensitive` for that employee;
otherwise return `mask()`ed values.

## Data conventions

- Date-only columns (`@db.Date`) are UTC-midnight `Date`s. Build them with
  `toDateOnly()` / `zDateOnly`. Compare with `.getTime()`.
- Timezone for display is Asia/Kolkata; `fmtDate`/`fmtDateTime` handle it.
- Working days = days that are not weekly-off (shift `weeklyOffDays`, default
  Sat/Sun) and not a holiday in the employee's location calendar (fallback:
  calendar with `locationId: null`).
- Leave balance available = `opening + accrued + carriedForward + adjusted - used`.
- Payroll month is `(year, month)` 1-12; payslip earnings/deductions JSON is
  `{ [componentCode]: amount }`.

## Performance rules (2,000 users)

- Never load all employees into memory in a request; paginate or aggregate in SQL
  (`groupBy`, `$queryRaw` with recursive CTE for org trees).
- Batch writes with `createMany` / `updateMany`; wrap multi-row mutations in
  `db.$transaction`.
- Payroll processing runs in chunks of 200 employees per transaction and records
  progress on `PayrollRun.processedCount`.
- Lists default to 25 rows and select only needed columns.

## Testing

- Unit tests: `src/**/*.test.ts` (Vitest, `npm test`). Pure logic (payroll
  engine, leave day counting, working-day calc, RBAC scope filter) must have
  tests. Tests can hit the local DB (`DATABASE_URL` in `.env`, seeded with
  2000 employees; demo logins in `prisma/seed.ts`). Do not truncate tables in
  tests; create and clean up your own rows.
- `npm run typecheck` and `npm run lint` must pass for your files.

## Seed data you can rely on

Org "Acme Technologies"; legal entity with PT state TS; 4 locations; 12
departments; designations; shifts; leave types CL/SL/EL/ML/PL/LOP; salary
components BASIC/HRA/CONV/SPECIAL/PF_EE/ESI_EE/PT/TDS/PF_ER/ESI_ER and
default structure "Standard India CTC"; expense categories; asset categories;
ticket categories; onboarding template; 2000 employees each with a user
(password `Password123!`), salary, leave balances, 30 days attendance.
Demo logins: admin@, hr@, payroll@, finance@, recruiter@, it@, pm@, manager@,
employee@ (all `@acme.example`). `manager@` has direct reports; `employee@`
reports to `manager@`.

## Deliverables per module (definition of done)

1. Service(s) with RBAC on every function, zod schemas, audit + notify.
2. `/api/v1` routes for every list/get/create/update/decide action.
3. Pages + client components in `(app)`; mobile-friendly (stack on small screens).
4. Unit tests for pure logic; at least one service-level test against the DB.
5. `npm run typecheck` clean, `npm run lint` clean for your files.
6. A short report: routes, permissions used, any schema gaps, anything skipped.
