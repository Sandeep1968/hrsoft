"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Minimal page navigation that keeps the other query params. */
export function Pager({ page, pages, total, basePath, params = {} }: { page: number; pages: number; total: number; basePath: string; params?: Record<string, string | undefined> }) {
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    q.set("page", String(p));
    return `${basePath}?${q.toString()}`;
  };
  if (pages <= 1) return <div className="mt-3 text-xs text-muted-foreground">{total.toLocaleString("en-IN")} records</div>;
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
      <span>
        Page {page} of {pages} · {total.toLocaleString("en-IN")} records
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} nativeButton={false} render={<Link href={href(page - 1)} aria-disabled={page <= 1} />}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pages} nativeButton={false} render={<Link href={href(page + 1)} aria-disabled={page >= pages} />}>
          Next
        </Button>
      </div>
    </div>
  );
}
