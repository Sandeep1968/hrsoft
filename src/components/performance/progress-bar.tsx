import { cn } from "@/lib/utils";

export function ProgressBar({ value, className, tone }: { value: number; className?: string; tone?: "auto" | "neutral" }) {
  const v = Math.max(0, Math.min(100, value));
  const color = tone === "neutral" ? "bg-primary" : v >= 70 ? "bg-emerald-500" : v >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${v}%` }} />
      </div>
      <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{Math.round(v)}%</span>
    </div>
  );
}
