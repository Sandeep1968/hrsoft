import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { EmptyState, PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { OrgTree } from "@/components/employees/org-tree";
import { orgChart } from "@/server/services/employees";

export const metadata = { title: "Org Chart" };

export default async function OrgChartPage({ searchParams }: PageProps<"/org-chart">) {
  const actor = await requireActor();
  const sp = await searchParams;
  const root = typeof sp.root === "string" && /^[0-9a-f-]{36}$/i.test(sp.root) ? sp.root : null;
  const nodes = await orgChart(actor, root);
  const rootNode = root ? nodes.find((n) => n.id === root) : null;
  return (
    <div>
      <PageHeader
        title="Org Chart"
        description={rootNode ? `Team under ${rootNode.displayName} (up to 4 levels).` : "Reporting lines, up to 4 levels below the top. Click a team count to focus on it."}
        actions={
          <>
            {rootNode?.managerId && <Button variant="outline" nativeButton={false} render={<Link href={`/org-chart?root=${rootNode.managerId}`} />}>Up one level</Button>}
            {root && <Button variant="outline" nativeButton={false} render={<Link href="/org-chart" />}>Full chart</Button>}
            {actor.employeeId && <Button variant="outline" nativeButton={false} render={<Link href={`/org-chart?root=${actor.employeeId}`} />}>My team</Button>}
          </>
        }
      />
      {nodes.length === 0 ? <EmptyState title="Nothing to show" description="No employees are visible to you from this root." /> : <div className="rounded-lg border p-3"><OrgTree nodes={nodes} /></div>}
    </div>
  );
}
