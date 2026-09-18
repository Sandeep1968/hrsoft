import { requireActor } from "@/lib/auth/session";
import { fmtDateTime } from "@/lib/dates";
import { EmptyState, PageHeader } from "@/components/common";
import { NativeSelect } from "@/components/common/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pager } from "@/components/psa/pager";
import { auditActions, listAuditLogs, listAuditSchema } from "@/server/services/auditlog";
import { JsonDiff } from "./json-diff";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const q = listAuditSchema.parse({ page: sp.page ?? "1", pageSize: "50", order: "desc", q: s("q"), action: s("action"), entityType: s("entityType"), entityId: s("entityId"), from: s("from") ? `${s("from")}T00:00:00.000Z` : undefined, to: s("to") ? `${s("to")}T23:59:59.999Z` : undefined });
  const [page, options] = await Promise.all([listAuditLogs(actor, q), auditActions(actor)]);
  return (
    <div>
      <PageHeader title="Audit log" description="Every mutation, who made it and what changed. Sensitive fields are redacted at write time." />
      <form method="get" className="mb-3 flex flex-wrap items-center gap-2">
        <Input name="q" placeholder="Search action, entity or actor email" defaultValue={s("q") ?? ""} className="w-64" />
        <NativeSelect name="action" defaultValue={s("action") ?? ""} className="w-52"><option value="">Any action</option>{options.actions.map((a) => <option key={a} value={a}>{a}</option>)}</NativeSelect>
        <NativeSelect name="entityType" defaultValue={s("entityType") ?? ""} className="w-44"><option value="">Any entity</option>{options.entityTypes.map((e) => <option key={e} value={e}>{e}</option>)}</NativeSelect>
        <Input name="entityId" placeholder="Entity id" defaultValue={s("entityId") ?? ""} className="w-44" />
        <Input type="date" name="from" defaultValue={s("from") ?? ""} className="w-36" />
        <Input type="date" name="to" defaultValue={s("to") ?? ""} className="w-36" />
        <Button type="submit" variant="outline" size="sm">Filter</Button>
      </form>
      {page.items.length === 0 ? <EmptyState title="No audit entries match" /> : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Actor</TableHead><TableHead>Action</TableHead><TableHead>Entity</TableHead><TableHead>Changes</TableHead><TableHead>IP</TableHead></TableRow></TableHeader>
            <TableBody>
              {page.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtDateTime(r.createdAt)}</TableCell>
                  <TableCell>{r.actor ? <><div className="text-sm">{r.actor.name}</div><div className="text-xs text-muted-foreground">{r.actor.email}</div></> : <span className="text-xs text-muted-foreground">system</span>}</TableCell>
                  <TableCell className="font-mono text-xs">{r.action}</TableCell>
                  <TableCell className="text-xs">{r.entityType}{r.entityId && <div className="max-w-40 truncate font-mono text-muted-foreground" title={r.entityId}>{r.entityId}</div>}</TableCell>
                  <TableCell className="whitespace-normal"><JsonDiff before={r.before} after={r.after} /></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.ip ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pager page={page.page} pages={page.pages} total={page.total} basePath="/settings/audit" params={sp} />
    </div>
  );
}
