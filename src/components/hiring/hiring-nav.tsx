import Link from "next/link";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/hiring", label: "Jobs" },
  { href: "/hiring/candidates", label: "Candidates" },
  { href: "/hiring/interviews", label: "My interviews" },
  { href: "/hiring/analytics", label: "Analytics" },
];

export function HiringNav({ active }: { active: string }) {
  return (
    <div className="mb-4 -mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <div className="inline-flex h-8 items-center gap-0.5 rounded-lg bg-muted p-[3px] text-muted-foreground">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={cn("inline-flex h-full items-center rounded-md px-2.5 text-sm font-medium whitespace-nowrap transition-colors hover:text-foreground", active === n.href && "bg-background text-foreground shadow-sm")}>{n.label}</Link>
        ))}
      </div>
    </div>
  );
}
