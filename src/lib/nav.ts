import type { Permission } from "@/lib/rbac/permissions";

export interface NavItem {
  label: string;
  href: string;
  icon: string; // lucide icon name (resolved in the sidebar component)
  /** Any of these permissions (at any scope) shows the item. Empty = always. */
  permissions?: Permission[];
  /** Only show when the user has direct/indirect reports. */
  managerOnly?: boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    title: "Me",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: "LayoutDashboard" },
      { label: "My Profile", href: "/me", icon: "UserCircle" },
      { label: "Attendance", href: "/attendance", icon: "Clock", permissions: ["attendance:read"] },
      { label: "Leave", href: "/leave", icon: "CalendarDays", permissions: ["leave:read"] },
      { label: "Payslips & Tax", href: "/payroll/my", icon: "Wallet", permissions: ["payroll:read"] },
      { label: "Expenses", href: "/expenses", icon: "Receipt", permissions: ["expenses:read"] },
      { label: "Timesheets", href: "/timesheets", icon: "Timer", permissions: ["timesheets:read"] },
      { label: "Performance", href: "/performance", icon: "Target", permissions: ["performance:read"] },
      { label: "Helpdesk", href: "/helpdesk", icon: "LifeBuoy", permissions: ["helpdesk:read"] },
      { label: "Inbox", href: "/inbox", icon: "Inbox" },
    ],
  },
  {
    title: "Team",
    items: [
      { label: "My Team", href: "/team", icon: "Users", managerOnly: true },
      { label: "Approvals", href: "/approvals", icon: "CheckSquare", permissions: ["leave:approve", "attendance:approve", "expenses:approve", "timesheets:approve"] },
    ],
  },
  {
    title: "Organisation",
    items: [
      { label: "Directory", href: "/employees", icon: "BookUser", permissions: ["employees:read"] },
      { label: "Org Chart", href: "/org-chart", icon: "Network", permissions: ["employees:read"] },
      { label: "Onboarding", href: "/onboarding", icon: "ClipboardCheck", permissions: ["onboarding:manage"] },
      { label: "Exits", href: "/exits", icon: "LogOut", permissions: ["exits:manage"] },
      { label: "Engagement", href: "/engagement", icon: "Megaphone", permissions: ["engagement:read"] },
      { label: "Hiring", href: "/hiring", icon: "Briefcase", permissions: ["hiring:read"] },
      { label: "Projects", href: "/projects", icon: "FolderKanban", permissions: ["projects:read"] },
      { label: "Assets", href: "/assets", icon: "Laptop", permissions: ["assets:read"] },
    ],
  },
  {
    title: "Payroll & Finance",
    items: [
      { label: "Payroll Runs", href: "/payroll", icon: "Banknote", permissions: ["payroll:run"] },
      { label: "Salary Setup", href: "/payroll/setup", icon: "Settings2", permissions: ["payroll:manage"] },
      { label: "Tax Proofs", href: "/payroll/tax", icon: "FileCheck", permissions: ["tax:verify"] },
      { label: "Reimbursements", href: "/expenses/finance", icon: "HandCoins", permissions: ["expenses:reimburse"] },
    ],
  },
  {
    title: "Admin",
    items: [
      { label: "Reports", href: "/reports", icon: "BarChart3", permissions: ["reports:view"] },
      { label: "Attendance Admin", href: "/attendance/admin", icon: "CalendarClock", permissions: ["attendance:manage"] },
      { label: "Leave Admin", href: "/leave/admin", icon: "CalendarRange", permissions: ["leave:manage"] },
      { label: "Helpdesk Admin", href: "/helpdesk/admin", icon: "Headset", permissions: ["helpdesk:manage", "helpdesk:agent"] },
      { label: "Settings", href: "/settings", icon: "Settings", permissions: ["org:manage", "settings:manage"] },
      { label: "Roles & Access", href: "/settings/roles", icon: "ShieldCheck", permissions: ["rbac:manage"] },
      { label: "Users", href: "/settings/users", icon: "UserCog", permissions: ["users:manage"] },
      { label: "Audit Log", href: "/settings/audit", icon: "ScrollText", permissions: ["audit:read"] },
      { label: "API Keys", href: "/settings/api-keys", icon: "KeyRound", permissions: ["apikeys:manage"] },
    ],
  },
];
