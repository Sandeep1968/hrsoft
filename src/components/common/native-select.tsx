import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Native <select> styled like the shadcn Input. Prefer this over the
 * Base UI Select for forms — it needs no client JS and works with FormData.
 */
export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
