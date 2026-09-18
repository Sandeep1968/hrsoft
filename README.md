# HRsoft

**Live:** https://hrsoft-opal.vercel.app · **Repo:** https://github.com/Sandeep1968/hrsoft (private) · Vercel project `hrsoft` + Neon store `neon-sky-flame` (Mumbai).

A production-grade HRMS for Indian companies — modelled on the Keka feature set —
with role-based access control built into every layer.

**Modules:** Core HR (records, documents, org chart, onboarding, exits) ·
Attendance (clock in/out, shifts, holidays, regularisation, WFH) · Leave (types,
accrual, balances, approvals) · Payroll (India: PF, ESI, PT, TDS old/new regime,
LOP proration, payslips, bank advice, PF ECR) · Expenses · Assets · Helpdesk ·
Performance (OKRs, review cycles, calibration, 360 feedback, praise) · Hiring
(jobs, pipeline, interviews, offers, careers page) · Engagement (announcements,
surveys, eNPS) · Projects & Timesheets · Reports · Admin (roles & permissions,
users, audit log, API keys, webhooks).

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Server Components, Route Handlers), TypeScript strict |
| UI | Tailwind v4 + shadcn (Base UI primitives), lucide icons, recharts |
| Database | PostgreSQL 16 via Prisma 7 (`@prisma/adapter-pg`), UUIDv7 keys, 80+ indexes |
| Auth | Email + password (Argon2id), Google Workspace SSO (OIDC/PKCE), DB-backed sessions, API keys |
| Authorisation | Permission catalogue × scope (Self / Team / All), system + custom roles — see `docs/RBAC.md` |
| Jobs | Vercel Cron → `/api/cron/daily`, `/api/cron/monthly` |
| Email / files | SMTP (nodemailer) · S3-compatible storage with local fallback |
| Tests | Vitest (unit + DB integration), autocannon load test |

## Quick start (local)

```bash
docker compose up -d                 # Postgres 16 on :5434
cp .env.example .env                 # then set DATABASE_URL to the compose DB (see .env.example comments)
npm install
npx prisma migrate deploy
npm run db:seed                      # org, roles, lookups, 2000 employees
npm run dev                          # http://localhost:3000
```

Local `.env` for the compose database:

```
DATABASE_URL="postgresql://hrsoft:hrsoft@localhost:5434/hrsoft?schema=public"
DIRECT_URL="postgresql://hrsoft:hrsoft@localhost:5434/hrsoft?schema=public"
```

Demo logins (password `Password123!`): `admin@`, `hr@`, `payroll@`, `finance@`,
`recruiter@`, `it@`, `pm@`, `manager@`, `employee@` — all `@acme.example`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` / `lint` / `test` | TypeScript, ESLint, Vitest |
| `npm run db:migrate` / `db:deploy` / `db:seed` / `db:reset` / `db:studio` | Prisma |
| `npm run loadtest` | 2,000-user load test against a running server |
| `npx tsx scripts/create-admin.ts <email> <name> <password>` | Create a Super Admin |
| `npx tsx scripts/gen-rbac-doc.ts` | Regenerate `docs/RBAC.md` |

## Documentation

- `docs/ARCHITECTURE.md` — layering, request flow, data model, scaling notes
- `docs/RBAC.md` — roles × permissions matrix (generated)
- `docs/DEPLOYMENT.md` — Vercel + Neon + Google SSO setup
- `docs/MODULE-GUIDE.md` — conventions for adding a module
- `docs/REVIEW.md` — end-to-end review report and known gaps

## Public API

Every screen is backed by JSON endpoints under `/api/v1`. Create an API key in
**Settings → API Keys** and call:

```bash
curl -H "Authorization: Bearer hrs_..." https://<host>/api/v1/employees?pageSize=50
```

API keys inherit (at most) the creating user's permissions, narrowed to the
scopes chosen at creation. Responses are `{ data }` or `{ error: { code, message, details } }`.
