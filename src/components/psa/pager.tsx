import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Server-rendered previous/next pager that preserves the current query string. */
export function Pager({ page, pages, total, basePath, params }: { page: number; pages: number; total: number; basePath: string; params: Record<string, string | string[] | undefined> }) {
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && k !== "page") sp.set(k, Array.isArray(v) ? v[0] : v);
    sp.set("page", String(p));
    return `${basePath}?${sp.toString()}`;
  };
  if (pages <= 1) return <div className="mt-3 text-xs text-muted-foreground">{total.toLocaleString("en-IN")} record{total === 1 ? "" : "s"}</div>;
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
      <span>Page {page} of {pages} · {total.toLocaleString("en-IN")} records</span>
      <div className="flex gap-1">
        <Button size="xs" variant="outline" disabled={page <= 1} nativeButton={false} render={<Link href={href(Math.max(1, page - 1))} aria-disabled={page <= 1} />}>Previous</Button>
        <Button size="xs" variant="outline" disabled={page >= pages} nativeButton={false} render={<Link href={href(Math.min(pages, page + 1))} aria-disabled={page >= pages} />}>Next</Button>
      </div>
    </div>
  );
}
