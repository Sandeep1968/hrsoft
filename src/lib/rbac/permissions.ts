/**
 * HRsoft permission catalogue.
 *
 * A permission is `<module>:<action>`. Every role grants a permission at a
 * scope: SELF (only records about me), TEAM (me + my direct and indirect
 * reports), or ALL. The effective scope for a user is the widest scope across
 * all of their roles. Services call `authorize()` / `scopeFilter()` from
 * `@/lib/rbac/authorize` — never check role names directly.
 */

export const PERMISSIONS = {
  // Organisation
  "org:read": "View organisation settings, departments, locations",
  "org:manage": "Manage organisation, legal entities, departments, designations, locations",

  // Core HR
  "employees:read": "View employee profiles and directory",
  "employees:read_sensitive": "View PAN, Aadhaar, UAN, bank details",
  "employees:write": "Create and edit employee records",
  "employees:delete": "Exit / delete employees",
  "employees:import": "Bulk import employees (CSV)",
  "onboarding:read": "View onboarding tasks",
  "onboarding:manage": "Manage onboarding templates and tasks",
  "documents:read": "View employee documents",
  "documents:write": "Upload / delete employee documents",
  "exits:manage": "Manage resignations and exit clearance",

  // Attendance
  "attendance:read": "View attendance records",
  "attendance:punch": "Clock in / clock out",
  "attendance:write": "Edit attendance records directly",
  "attendance:approve": "Approve regularisation and remote-work requests",
  "attendance:manage": "Manage shifts, holiday calendars, attendance policy",

  // Leave
  "leave:read": "View leave requests and balances",
  "leave:apply": "Apply for leave",
  "leave:approve": "Approve or reject leave requests",
  "leave:manage": "Manage leave types, balances and adjustments",

  // Payroll
  "payroll:read": "View payslips and salary",
  "payroll:run": "Create and process payroll runs",
  "payroll:finalize": "Finalise, lock and mark payroll as paid",
  "payroll:manage": "Manage salary components, structures and employee salaries",
  "tax:declare": "Submit investment declarations",
  "tax:verify": "Verify investment proofs",

  // Expenses
  "expenses:read": "View expense claims",
  "expenses:submit": "Create and submit expense claims",
  "expenses:approve": "Approve or reject expense claims",
  "expenses:reimburse": "Mark expense claims as reimbursed",
  "expenses:manage": "Manage expense categories and policy",

  // Assets
  "assets:read": "View assets",
  "assets:manage": "Create assets, assign and return them",

  // Helpdesk
  "helpdesk:read": "View tickets",
  "helpdesk:raise": "Raise helpdesk tickets",
  "helpdesk:agent": "Work on assigned tickets, comment and resolve",
  "helpdesk:manage": "Manage ticket categories and assign tickets",

  // Performance
  "performance:read": "View OKRs, reviews and feedback",
  "performance:write": "Create OKRs, update key results, write reviews and feedback",
  "performance:review": "Write manager reviews for reports",
  "performance:manage": "Manage review cycles and calibration",

  // Hiring
  "hiring:read": "View job openings, candidates and applications",
  "hiring:write": "Create jobs, add candidates, move applications",
  "hiring:interview": "Submit interview feedback",
  "hiring:manage": "Publish jobs, make offers, convert hires",

  // Engagement
  "engagement:read": "View surveys, announcements and results",
  "engagement:respond": "Respond to surveys",
  "engagement:manage": "Create surveys, announcements and view analytics",

  // Projects & timesheets
  "projects:read": "View projects",
  "projects:manage": "Create projects, tasks and members",
  "timesheets:read": "View timesheets",
  "timesheets:submit": "Fill and submit timesheets",
  "timesheets:approve": "Approve timesheets",

  // Reports & system
  "reports:view": "View analytics dashboards and reports",
  "reports:export": "Export reports (CSV)",
  "settings:manage": "Manage system settings and integrations",
  "rbac:manage": "Manage roles, permissions and user role assignments",
  "users:manage": "Invite, suspend and reset users",
  "audit:read": "View the audit log",
  "apikeys:manage": "Create and revoke API keys",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export type Scope = "SELF" | "TEAM" | "ALL";

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const SCOPE_RANK: Record<Scope, number> = { SELF: 1, TEAM: 2, ALL: 3 };

export function isPermission(value: string): value is Permission {
  return value in PERMISSIONS;
}

export function moduleOf(p: Permission): string {
  return p.split(":")[0];
}

type Grant = [Permission, Scope];
const all = (...ps: Permission[]): Grant[] => ps.map((p) => [p, "ALL"]);
const team = (...ps: Permission[]): Grant[] => ps.map((p) => [p, "TEAM"]);
const self = (...ps: Permission[]): Grant[] => ps.map((p) => [p, "SELF"]);

/**
 * System roles. Seeded on first run; SUPER_ADMIN and EMPLOYEE cannot be deleted.
 * Custom roles can be created from the RBAC admin screen.
 */
export const SYSTEM_ROLES: Record<
  string,
  { name: string; description: string; grants: Grant[] }
> = {
  SUPER_ADMIN: {
    name: "Super Admin",
    description: "Full access to every module and setting.",
    grants: all(...ALL_PERMISSIONS),
  },
  EMPLOYEE: {
    name: "Employee",
    description: "Self-service: own profile, attendance, leave, payslips, expenses, tickets, OKRs, timesheets.",
    grants: [
      ...all("org:read", "employees:read", "engagement:read", "engagement:respond", "projects:read", "assets:read"),
      ...self(
        "employees:read_sensitive",
        "onboarding:read",
        "documents:read",
        "documents:write",
        "attendance:read",
        "attendance:punch",
        "leave:read",
        "leave:apply",
        "payroll:read",
        "tax:declare",
        "expenses:read",
        "expenses:submit",
        "helpdesk:read",
        "helpdesk:raise",
        "performance:read",
        "performance:write",
        "hiring:interview",
        "timesheets:read",
        "timesheets:submit",
      ),
    ],
  },
  MANAGER: {
    name: "Manager",
    description: "Everything an employee can do, plus team-scoped visibility and approvals for direct and indirect reports.",
    grants: [
      ...team(
        "employees:read",
        "onboarding:read",
        "attendance:read",
        "attendance:approve",
        "leave:read",
        "leave:approve",
        "expenses:read",
        "expenses:approve",
        "performance:read",
        "performance:review",
        "performance:write",
        "timesheets:read",
        "timesheets:approve",
        "helpdesk:read",
        "reports:view",
      ),
    ],
  },
  HR_ADMIN: {
    name: "HR Admin",
    description: "Owns the employee lifecycle: records, onboarding, attendance, leave, performance, engagement, helpdesk.",
    grants: all(
      "org:read",
      "org:manage",
      "employees:read",
      "employees:read_sensitive",
      "employees:write",
      "employees:delete",
      "employees:import",
      "onboarding:read",
      "onboarding:manage",
      "documents:read",
      "documents:write",
      "exits:manage",
      "attendance:read",
      "attendance:write",
      "attendance:approve",
      "attendance:manage",
      "leave:read",
      "leave:approve",
      "leave:manage",
      "expenses:read",
      "assets:read",
      "helpdesk:read",
      "helpdesk:agent",
      "helpdesk:manage",
      "performance:read",
      "performance:manage",
      "hiring:read",
      "engagement:read",
      "engagement:manage",
      "projects:read",
      "timesheets:read",
      "reports:view",
      "reports:export",
      "users:manage",
    ),
  },
  PAYROLL_ADMIN: {
    name: "Payroll Admin",
    description: "Runs payroll, manages salary structures, verifies tax declarations.",
    grants: all(
      "org:read",
      "employees:read",
      "employees:read_sensitive",
      "attendance:read",
      "leave:read",
      "payroll:read",
      "payroll:run",
      "payroll:finalize",
      "payroll:manage",
      "tax:verify",
      "expenses:read",
      "expenses:reimburse",
      "reports:view",
      "reports:export",
    ),
  },
  FINANCE: {
    name: "Finance",
    description: "Approves and reimburses expenses, reads payroll totals and project billing.",
    grants: all(
      "org:read",
      "employees:read",
      "expenses:read",
      "expenses:approve",
      "expenses:reimburse",
      "expenses:manage",
      "payroll:read",
      "projects:read",
      "timesheets:read",
      "reports:view",
      "reports:export",
    ),
  },
  RECRUITER: {
    name: "Recruiter",
    description: "Owns the hiring pipeline.",
    grants: all("org:read", "employees:read", "hiring:read", "hiring:write", "hiring:interview", "hiring:manage", "reports:view"),
  },
  IT_ADMIN: {
    name: "IT Admin",
    description: "Manages assets, IT helpdesk tickets and API keys.",
    grants: all("org:read", "employees:read", "assets:read", "assets:manage", "helpdesk:read", "helpdesk:agent", "helpdesk:manage", "apikeys:manage"),
  },
  PROJECT_MANAGER: {
    name: "Project Manager",
    description: "Manages projects, tasks and approves timesheets across the company.",
    grants: all("org:read", "employees:read", "projects:read", "projects:manage", "timesheets:read", "timesheets:approve", "reports:view"),
  },
};

export const SYSTEM_ROLE_KEYS = Object.keys(SYSTEM_ROLES);
