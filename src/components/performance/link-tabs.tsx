import Link from "next/link";
import { cn } from "@/lib/utils";

/** Server-rendered tab strip driven by a search param (no client JS, each tab loads only its own data). */
export function LinkTabs({ tabs, active, hrefFor }: { tabs: { key: string; label: string; count?: number }[]; active: string; hrefFor: (key: string) => string }) {
  return (
    <div className="mb-4 -mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <div className="inline-flex h-8 items-center gap-0.5 rounded-lg bg-muted p-[3px] text-muted-foreground">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={hrefFor(t.key)}
            className={cn("inline-flex h-full items-center gap-1.5 rounded-md px-2.5 text-sm font-medium whitespace-nowrap transition-colors hover:text-foreground", active === t.key && "bg-background text-foreground shadow-sm")}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && <span className="rounded-full bg-primary/10 px-1.5 text-[10px] text-primary">{t.count}</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}
