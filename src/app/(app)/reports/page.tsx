import Link from "next/link";
import { BarChart3, SlidersHorizontal } from "lucide-react";
import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { EmptyState, PageHeader } from "@/components/common";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { REPORT_CATALOGUE } from "@/server/services/reports";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const actor = await requireActor();
  if (!can(actor, "reports:view")) return <div><PageHeader title="Reports" /><EmptyState title="No access" description="You need reports:view to open analytics." /></div>;
  const groups = [...new Set(REPORT_CATALOGUE.map((r) => r.group))];
  const scopeNote = can(actor, "reports:view", "ALL") ? "Organisation-wide figures." : "Figures are limited to your team.";
  return (
    <div>
      <PageHeader title="Reports" description={`Aggregated analytics with CSV export. ${scopeNote}`} />
      {groups.map((g) => (
        <section key={g} className="mb-6">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {REPORT_CATALOGUE.filter((r) => r.group === g).map((r) => (
              <Link key={r.name} href={`/reports/${r.name}`} className="group">
                <Card className="h-full transition-colors group-hover:ring-primary/40">
                  <CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="size-4 text-muted-foreground" /> {r.title}</CardTitle><CardDescription>{r.description}</CardDescription></CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
      {can(actor, "employees:read") && (
        <section>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Build your own</h2>
          <Link href="/reports/custom" className="group block sm:max-w-md">
            <Card className="transition-colors group-hover:ring-primary/40">
              <CardHeader><CardTitle className="flex items-center gap-2"><SlidersHorizontal className="size-4 text-muted-foreground" /> Custom employee report</CardTitle><CardDescription>Pick columns and filters over the employee directory, preview, and export to CSV.</CardDescription></CardHeader>
              <CardContent className="text-xs text-muted-foreground">Allow-listed columns only — safe for HR partners and auditors.</CardContent>
            </Card>
          </Link>
        </section>
      )}
    </div>
  );
}
