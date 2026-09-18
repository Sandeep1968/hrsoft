import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { fmtDate } from "@/lib/dates";
import { EmptyState, PageHeader, StatCard, StatusBadge } from "@/components/common";
import { NativeSelect } from "@/components/common/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pager } from "@/components/psa/pager";
import { assetLookups, assetsSummary, listAssetCategories, listAssets, listAssetsSchema, myAssets } from "@/server/services/assets";
import { AssetDialog } from "./asset-dialog";
import { AssetActions } from "./asset-actions";
import { AssetCategoriesDialog } from "./asset-categories-dialog";
import { MyAssets } from "./my-assets";

export const metadata = { title: "Assets" };
const STATUSES = ["AVAILABLE", "ASSIGNED", "IN_REPAIR", "RETIRED", "LOST"];

export default async function AssetsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireActor();
  const sp = await searchParams;
  const manage = can(actor, "assets:manage");

  if (!manage) {
    const mine = actor.employeeId ? await myAssets(actor) : [];
    return (
      <div>
        <PageHeader title="My assets" description="Equipment currently issued to you. Contact IT via the helpdesk to report damage or request a swap." />
        {mine.length === 0 ? <EmptyState title="Nothing assigned" description="Assets issued to you will show up here." /> : <MyAssets items={mine} />}
      </div>
    );
  }

  const q = listAssetsSchema.parse({
    page: sp.page ?? "1",
    pageSize: "25",
    order: "asc",
    q: typeof sp.q === "string" && sp.q ? sp.q : undefined,
    status: STATUSES.includes(String(sp.status)) ? sp.status : undefined,
    categoryId: typeof sp.categoryId === "string" && sp.categoryId ? sp.categoryId : undefined,
    locationId: typeof sp.locationId === "string" && sp.locationId ? sp.locationId : undefined,
    warrantyExpiring: sp.warranty === "1" ? "true" : undefined,
  });
  const [page, summary, lookups, categories] = await Promise.all([listAssets(actor, q), assetsSummary(actor), assetLookups(actor), listAssetCategories(actor)]);

  return (
    <div>
      <PageHeader title="Assets" description="Inventory, assignments and warranty tracking." actions={<><AssetCategoriesDialog categories={categories} /><AssetDialog lookups={lookups} /></>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total assets" value={summary.total} hint={`${summary.byStatus.AVAILABLE} available · ${summary.byStatus.ASSIGNED} assigned`} />
        <StatCard label="In repair" value={summary.byStatus.IN_REPAIR} hint={`${summary.byStatus.RETIRED} retired · ${summary.byStatus.LOST} lost`} />
        <StatCard label="Warranty expiring" value={summary.warrantyExpiringCount} hint="within 90 days" />
        <StatCard label="Book value" value={new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(summary.bookValue)} hint="purchase cost of active assets" />
      </div>

      <form method="get" className="mt-6 mb-3 flex flex-wrap items-center gap-2">
        <Input name="q" placeholder="Tag, name or serial" defaultValue={typeof sp.q === "string" ? sp.q : ""} className="w-52" />
        <NativeSelect name="status" defaultValue={String(sp.status ?? "")} className="w-36"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll("_", " ")}</option>)}</NativeSelect>
        <NativeSelect name="categoryId" defaultValue={typeof sp.categoryId === "string" ? sp.categoryId : ""} className="w-40"><option value="">All categories</option>{lookups.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
        <NativeSelect name="locationId" defaultValue={typeof sp.locationId === "string" ? sp.locationId : ""} className="w-40"><option value="">All locations</option>{lookups.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</NativeSelect>
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="warranty" value="1" defaultChecked={sp.warranty === "1"} /> Warranty ≤ 90d</label>
        <Button type="submit" variant="outline" size="sm">Filter</Button>
      </form>

      {page.items.length === 0 ? <EmptyState title="No assets" description="Add your first asset or widen the filters." /> : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Tag</TableHead><TableHead>Asset</TableHead><TableHead>Category</TableHead><TableHead>Status</TableHead><TableHead>Assigned to</TableHead><TableHead>Location</TableHead><TableHead>Warranty</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {page.items.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono text-xs">{a.assetTag}</TableCell>
                  <TableCell><div className="font-medium">{a.name}</div><div className="text-xs text-muted-foreground">{a.serialNumber ?? ""}</div></TableCell>
                  <TableCell>{a.category.name}</TableCell>
                  <TableCell><StatusBadge status={a.status} /></TableCell>
                  <TableCell>{a.assignedTo ? <>{a.assignedTo.displayName}<div className="text-xs text-muted-foreground">since {fmtDate(a.assignedTo.assignedAt)}</div></> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>{a.location?.name ?? "—"}</TableCell>
                  <TableCell className={a.warrantyState === "EXPIRED" ? "text-red-600" : a.warrantyState === "EXPIRING" ? "text-amber-700" : "text-muted-foreground"}>{a.warrantyUntil ? <>{fmtDate(a.warrantyUntil)}{a.warrantyState === "EXPIRING" && <div className="text-xs">{a.warrantyDaysLeft}d left</div>}{a.warrantyState === "EXPIRED" && <div className="text-xs">expired</div>}</> : "—"}</TableCell>
                  <TableCell><AssetActions asset={a} lookups={lookups} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pager page={page.page} pages={page.pages} total={page.total} basePath="/assets" params={sp} />

      {summary.byCategory.length > 0 && (
        <div className="mt-6 rounded-lg border p-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">By category</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {summary.byCategory.map((c) => (
              <div key={String(c.categoryId)} className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
                <span>{c.category}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{c.ASSIGNED} assigned · {c.AVAILABLE} free · {c.total} total</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
