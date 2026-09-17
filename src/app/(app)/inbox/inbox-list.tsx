"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { fmtDateTime } from "@/lib/dates";

interface Item { id: string; type: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string }

export function InboxList({ items }: { items: Item[] }) {
  const router = useRouter();
  const unread = items.filter((i) => !i.readAt).length;
  async function markAll() {
    await apiFetch("/api/v1/notifications", { method: "PATCH", body: { all: true } });
    router.refresh();
  }
  async function markOne(id: string) {
    await apiFetch("/api/v1/notifications", { method: "PATCH", body: { ids: [id] } });
    router.refresh();
  }
  return (
    <div>
      {unread > 0 && (
        <div className="mb-3 flex justify-end">
          <Button variant="outline" size="sm" onClick={markAll}>Mark all as read</Button>
        </div>
      )}
      <ul className="divide-y rounded-lg border">
        {items.map((i) => (
          <li key={i.id} className={cn("flex items-start gap-3 p-3", !i.readAt && "bg-primary/5")}>
            <span className={cn("mt-2 size-2 shrink-0 rounded-full", i.readAt ? "bg-transparent" : "bg-primary")} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{i.link ? <Link href={i.link} onClick={() => markOne(i.id)} className="hover:underline">{i.title}</Link> : i.title}</div>
              {i.body && <div className="text-sm text-muted-foreground">{i.body}</div>}
              <div className="mt-1 text-xs text-muted-foreground">{fmtDateTime(i.createdAt)}</div>
            </div>
            {!i.readAt && <Button variant="ghost" size="xs" onClick={() => markOne(i.id)}>Mark read</Button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
