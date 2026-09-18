"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/client/api";
import { cn } from "@/lib/utils";

export interface EmployeeOption {
  id: string;
  displayName: string;
  employeeCode: string;
  workEmail: string;
  designation?: { name: string } | null;
}

/** Search-as-you-type employee picker backed by /api/v1/employees/search. */
export function EmployeePicker({ value, onChange, placeholder = "Search by name, code or email…", autoFocus, className }: { value: EmployeeOption | null; onChange: (e: EmployeeOption | null) => void; placeholder?: string; autoFocus?: boolean; className?: string }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<EmployeeOption[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) return;
    timer.current = setTimeout(async () => {
      try {
        setItems(await apiFetch<EmployeeOption[]>(`/api/v1/employees/search?q=${encodeURIComponent(q.trim())}&limit=8`));
        setOpen(true);
      } catch {
        setItems([]);
      }
    }, 200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  if (value) {
    return (
      <div className={cn("flex h-8 items-center justify-between rounded-lg border border-input px-2.5 text-sm", className)}>
        <span className="truncate">{value.displayName} <span className="text-muted-foreground">· {value.employeeCode}</span></span>
        <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => onChange(null)}>Change</button>
      </div>
    );
  }
  return (
    <div className={cn("relative", className)}>
      <Input value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value.trim().length < 2) { setItems([]); setOpen(false); } }} onFocus={() => items.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} placeholder={placeholder} autoFocus={autoFocus} autoComplete="off" />
      {open && items.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border bg-popover p-1 text-sm shadow-md">
          {items.map((e) => (
            <li key={e.id}>
              <button type="button" className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-muted" onMouseDown={(ev) => ev.preventDefault()} onClick={() => { onChange(e); setQ(""); setOpen(false); }}>
                <span>{e.displayName}</span>
                <span className="text-xs text-muted-foreground">{e.employeeCode} · {e.designation?.name ?? e.workEmail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
