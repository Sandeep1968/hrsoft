/**
 * HRsoft load test — simulates a 2,000-user organisation hitting the hot
 * endpoints with authenticated sessions.
 *
 *   npm run loadtest                       # against http://localhost:3100
 *   BASE_URL=https://hrsoft.vercel.app CONNECTIONS=100 DURATION=30 npm run loadtest
 *
 * It logs in as N distinct seeded users (round-robin), then runs autocannon
 * against a mixed workload: dashboard, directory search, my attendance month,
 * leave balances, payslips list, notifications.
 */
import "dotenv/config";
import autocannon from "autocannon";

const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 50);
const DURATION = Number(process.env.DURATION ?? 20);
const USERS = Number(process.env.USERS ?? 100);
const PASSWORD = process.env.SEED_PASSWORD ?? "Password123!";

let loginSeq = 0;
async function login(email: string): Promise<string | null> {
  // The app rate-limits logins per IP (40 / 15 min). For local load tests we
  // present a distinct X-Forwarded-For per login; production sits behind a
  // proxy that overwrites this header, so it cannot be abused there.
  const spoof: Record<string, string> = process.env.LOADTEST_SPOOF_IP !== "0" ? { "x-forwarded-for": `10.99.${Math.floor(loginSeq / 250)}.${loginSeq++ % 250}` } : {};
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", ...spoof },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) {
    console.warn(`login ${email} → ${res.status}`);
    return null;
  }
  const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? null;
  return cookie;
}

async function main() {
  // Collect seeded user emails from the API (as admin) so we hit real profiles.
  const admin = await login("admin@acme.example");
  if (!admin) throw new Error(`Could not log in as admin at ${BASE} — is the server running and seeded?`);
  const list = await fetch(`${BASE}/api/v1/employees?pageSize=${USERS}`, { headers: { cookie: admin } }).then((r) => r.json());
  const emails: string[] = (list.data?.items ?? []).map((e: { workEmail: string }) => e.workEmail);
  console.log(`logging in ${emails.length} users…`);
  const cookies = (await Promise.all(emails.map(login))).filter(Boolean) as string[];
  console.log(`${cookies.length} sessions ready; running ${CONNECTIONS} connections for ${DURATION}s against ${BASE}`);

  const paths = [
    "/dashboard",
    "/api/v1/employees?pageSize=25&q=an",
    "/api/v1/attendance/today",
    "/api/v1/leave-balances",
    "/api/v1/payslips",
    "/api/v1/notifications?unread=1",
    "/api/v1/approvals",
    "/api/auth/me",
  ];
  // Each request picks the next session round-robin, so every connection
  // exercises many distinct users' data (and RBAC scopes).
  let i = 0;
  const result = await autocannon({
    url: BASE,
    connections: CONNECTIONS,
    duration: DURATION,
    requests: paths.map((path) => ({
      method: "GET" as const,
      path,
      setupRequest: (req) => ({ ...req, headers: { ...(req.headers ?? {}), cookie: cookies[i++ % cookies.length] } }),
    })) as autocannon.Request[],
  });
  console.log(autocannon.printResult(result));
  const p99 = result.latency.p99;
  const errors = result.errors + result.non2xx;
  console.log("Status codes:", JSON.stringify((result as unknown as { statusCodeStats: Record<string, { count: number }> }).statusCodeStats ?? {}));
  console.log(`\nSummary: ${result.requests.average.toFixed(0)} req/s avg, p50 ${result.latency.p50}ms, p99 ${p99}ms, non-2xx ${result.non2xx}, errors ${result.errors}`);
  if (errors > result.requests.total * 0.01) {
    console.error("FAIL: more than 1% errors");
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
