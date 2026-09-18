# Deploying HRsoft (Vercel + Neon)

## 1. Database — Neon (PostgreSQL 16)

1. Create a Neon project in **AWS ap-south-1 (Mumbai)**.
2. Copy both connection strings:
   - **Pooled** (host contains `-pooler`) → `DATABASE_URL`, append `?sslmode=require&pgbouncer=true`.
   - **Direct** → `DIRECT_URL` (used for `prisma migrate deploy`).
3. Sizing for 2,000 users: Neon "Launch" (autoscaling 0.25–2 CU) is sufficient.
   The app opens at most `DB_POOL_MAX` (default 10) connections per serverless
   instance and PgBouncer multiplexes them. Set `DB_POOL_MAX=5` on Vercel to be
   safe with high concurrency.
4. Run the migrations from your machine once:

```bash
DATABASE_URL="<direct url>" npx prisma migrate deploy
```

5. Seed system roles and lookups (**do this once, without demo employees**):

```bash
DATABASE_URL="<direct url>" SEED_EMPLOYEES=0 npm run db:seed
```

   Then create the first Super Admin (change the values):

```bash
DATABASE_URL="<direct url>" npx tsx scripts/create-admin.ts admin@yourcompany.com "Your Name" 'A-strong-password-123'
```

## 2. Google Workspace SSO

1. Google Cloud Console → APIs & Services → Credentials → **OAuth client ID** (Web application).
2. Authorised redirect URI: `https://<your-domain>/api/auth/google/callback`
   (and `http://localhost:3100/api/auth/google/callback` for local dev).
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_ALLOWED_DOMAIN=yourcompany.com`
   so only Workspace accounts on your domain can sign in. Google SSO never
   creates accounts: the user must already exist in HRsoft (invited by HR or
   created as an employee) with the same email.

## 3. Vercel

1. Import the repo. Framework: Next.js. Root: repo root. Build command is the
   default (`npm run build` runs `prisma generate && next build`).
2. Environment variables (Production + Preview):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon pooled URL |
| `DIRECT_URL` | Neon direct URL |
| `APP_URL` | `https://<your-domain>` |
| `SESSION_SECRET` | `openssl rand -base64 48` |
| `FIELD_ENCRYPTION_KEY` | `openssl rand -hex 32` — **never rotate without re-encrypting** |
| `CRON_SECRET` | `openssl rand -hex 24` (Vercel sends it as `Authorization: Bearer`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_ALLOWED_DOMAIN` | from step 2 |
| `SMTP_URL` | e.g. `smtps://user:pass@smtp.sendgrid.net:465` (or Resend/SES SMTP) |
| `EMAIL_FROM` | `HRsoft <no-reply@yourcompany.com>` |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | document/receipt storage (AWS S3, Cloudflare R2 or Supabase Storage S3 endpoint) |
| `DB_POOL_MAX` | `5` |

3. `vercel.json` pins the region to `bom1` (Mumbai, next to Neon) and defines
   two crons: daily at 00:00 IST (`/api/cron/daily`: attendance auto-marking,
   session purge) and monthly on the 1st (`/api/cron/monthly`: leave accrual).
4. Deploy. Health check: `GET /api/health` returns `{ status: "ok" }`.

## 4. Post-deploy checklist

- [ ] Sign in as the Super Admin, open **Settings** and fill in the organisation
      and legal entity (PAN, TAN, PF/ESI codes, PT state).
- [ ] Settings → Roles: review the matrix (`docs/RBAC.md`).
- [ ] Attendance Admin: shifts and holiday calendars per location.
- [ ] Leave Admin: leave types and quotas.
- [ ] Salary Setup: components and structures; then import employees
      (Directory → Import CSV) with CTC.
- [ ] Rotate the seed password policy: all imported users get a temporary
      password and `mustChangePassword`.
- [ ] Point the Google Workspace domain at the app and disable password login
      for SSO-only users if desired (leave `passwordHash` null).

## 5. Backups and retention

Neon keeps point-in-time restore history (7 days on Launch; extend for payroll
audits). Payslips and audit logs are never deleted by the app. Export the
payroll register CSV every month and archive it.

## 6. Self-hosting instead

`docker compose up -d` starts Postgres; `Dockerfile` builds a production image
that runs `prisma migrate deploy` on start. Set the same env vars; run crons
from any scheduler by calling the cron endpoints with `Authorization: Bearer $CRON_SECRET`.
