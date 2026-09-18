"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/client/api";
import { cn } from "@/lib/utils";

export interface PickedEmployee {
  id: string;
  employeeCode: string;
  displayName: string;
  department: { name: string } | null;
  designation: { name: string } | null;
}

/** Type-ahead employee search backed by /api/v1/payroll/employees. */
export function EmployeePicker({ value, onChange, placeholder = "Search by name or code" }: { value: PickedEmployee | null; onChange: (e: PickedEmployee | null) => void; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickedEmployee[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const term = q.trim();
    const t = setTimeout(async () => {
      if (term.length < 2) {
        setResults([]);
        return;
      }
      try {
        setResults(await apiFetch<PickedEmployee[]>(`/api/v1/payroll/employees?q=${encodeURIComponent(term)}`));
        setOpen(true);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-sm">
        <span>
          <span className="font-medium">{value.displayName}</span> <span className="text-muted-foreground">· {value.employeeCode}{value.department ? ` · ${value.department.name}` : ""}</span>
        </span>
        <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => { onChange(null); setQ(""); }}>
          Change
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} onFocus={() => results.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && results.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-lg border bg-popover p-1 text-sm shadow-md">
          {results.map((r) => (
            <li key={r.id}>
              <button type="button" className={cn("flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-muted")} onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange(r); setOpen(false); }}>
                <span className="font-medium">{r.displayName}</span>
                <span className="text-xs text-muted-foreground">{r.employeeCode}{r.designation ? ` · ${r.designation.name}` : ""}{r.department ? ` · ${r.department.name}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
