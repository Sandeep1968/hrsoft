"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type J = unknown;

function flatten(v: J, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v as Record<string, J>)) flatten(x, prefix ? `${prefix}.${k}` : k, out);
  } else out[prefix || "(value)"] = v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  return out;
}

/** Collapsible before/after viewer: shows a key-level diff, with the raw JSON underneath. */
export function JsonDiff({ before, after }: { before: J; after: J }) {
  const [open, setOpen] = useState(false);
  if (before === null && after === null) return <span className="text-xs text-muted-foreground">—</span>;
  const b = flatten(before ?? {});
  const a = flatten(after ?? {});
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => b[k] !== a[k]);
  return (
    <div className="text-xs">
      <button type="button" className="flex items-center gap-1 text-muted-foreground hover:text-foreground" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />} {keys.length} change{keys.length === 1 ? "" : "s"}
      </button>
      {open && (
        <div className="mt-1 space-y-2">
          {keys.length > 0 && (
            <table className="w-full max-w-xl">
              <tbody>
                {keys.map((k) => (
                  <tr key={k} className="align-top">
                    <td className="pr-2 font-mono text-muted-foreground">{k}</td>
                    <td className={cn("pr-2 font-mono line-through", b[k] === undefined ? "text-muted-foreground/40" : "text-red-700 dark:text-red-300")}>{b[k] ?? "∅"}</td>
                    <td className={cn("font-mono", a[k] === undefined ? "text-muted-foreground/40" : "text-emerald-700 dark:text-emerald-300")}>{a[k] ?? "∅"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <details className="text-muted-foreground"><summary className="cursor-pointer">Raw JSON</summary>
            <div className="mt-1 grid gap-2 sm:grid-cols-2">
              <pre className="max-h-64 overflow-auto rounded bg-muted p-2">{JSON.stringify(before, null, 2) ?? "null"}</pre>
              <pre className="max-h-64 overflow-auto rounded bg-muted p-2">{JSON.stringify(after, null, 2) ?? "null"}</pre>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
