"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Icons from "lucide-react";
import { NAV } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { useCan, useSession } from "@/components/shell/session-provider";

function Icon({ name, className }: { name: string; className?: string }) {
  const Cmp = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[name] ?? Icons.Circle;
  return <Cmp className={className} />;
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const can = useCan();
  const session = useSession();

  return (
    <nav className="flex h-full flex-col gap-4 overflow-y-auto p-3" aria-label="Main">
      <Link href="/dashboard" className="flex items-center gap-2 px-2 py-1 text-lg font-semibold tracking-tight">
        <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm">HR</span>
        HRsoft
      </Link>
      {NAV.map((section) => {
        const items = section.items.filter((item) => {
          if (item.managerOnly && !session.hasReports) return false;
          if (!item.permissions || item.permissions.length === 0) return true;
          return item.permissions.some((p) => can(p));
        });
        if (items.length === 0) return null;
        return (
          <div key={section.title}>
            <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{section.title}</div>
            <ul className="space-y-0.5">
              {items.map((item) => {
                const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`)) || (item.href.split("/").length > 2 && pathname === item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-foreground/80 hover:bg-accent hover:text-foreground",
                        active && "bg-accent font-medium text-foreground",
                      )}
                    >
                      <Icon name={item.icon} className="size-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
