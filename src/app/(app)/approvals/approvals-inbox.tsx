"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtDateTime } from "@/lib/dates";
import { DecideButtons } from "./decide-dialog";

export interface ApprovalItemDto {
  type: string;
  id: string;
  employee: { id: string; displayName: string; employeeCode: string; photoUrl: string | null };
  title: string;
  subtitle: string;
  amountOrDays: number | null;
  submittedAt: string;
  decideUrl: string;
  link: string;
}

const LABELS: Record<string, string> = { all: "All", leave: "Leave", regularization: "Regularisation", remote_work: "Work from home", expense: "Expenses", timesheet: "Timesheets", exit: "Exits" };

export function ApprovalsInbox({ items: initial, counts }: { items: ApprovalItemDto[]; counts: Record<string, number> }) {
  const [items, setItems] = useState(initial);
  const types = ["all", ...Object.keys(counts).filter((k) => counts[k] > 0)];
  const remaining = (t: string) => (t === "all" ? items.length : items.filter((i) => i.type === t).length);

  function List({ list }: { list: ApprovalItemDto[] }) {
    if (list.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">Nothing waiting for you here.</p>;
    return (
      <ul className="divide-y rounded-lg border">
        {list.map((it) => (
          <li key={`${it.type}-${it.id}`} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
            <Avatar>
              {it.employee.photoUrl && <AvatarImage src={it.employee.photoUrl} alt="" />}
              <AvatarFallback>{it.employee.displayName.slice(0, 1)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 text-sm">
                <span className="font-medium">{it.employee.displayName}</span>
                <span className="text-xs text-muted-foreground">{it.employee.employeeCode}</span>
                <span className="rounded bg-muted px-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">{LABELS[it.type] ?? it.type}</span>
              </div>
              <div className="text-sm">{it.title}</div>
              <div className="truncate text-xs text-muted-foreground" title={it.subtitle}>{it.subtitle}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">Submitted {fmtDateTime(it.submittedAt)} · <Link href={it.link} className="inline-flex items-center gap-0.5 hover:underline">Open <ExternalLink className="size-3" /></Link></div>
            </div>
            <DecideButtons decideUrl={it.decideUrl} title={`${it.employee.displayName} · ${it.title}`} onDone={() => setItems((s) => s.filter((x) => !(x.type === it.type && x.id === it.id)))} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Tabs defaultValue="all">
      <TabsList className="flex-wrap">
        {types.map((t) => (
          <TabsTrigger key={t} value={t}>{LABELS[t] ?? t} <span className="ml-1 rounded-full bg-background/80 px-1.5 text-[10px] tabular-nums">{remaining(t)}</span></TabsTrigger>
        ))}
      </TabsList>
      {types.map((t) => (
        <TabsContent key={t} value={t}><List list={t === "all" ? items : items.filter((i) => i.type === t)} /></TabsContent>
      ))}
    </Tabs>
  );
}
