"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/client/api";
import { cn } from "@/lib/utils";

export interface PickedEmployee { id: string; name: string; code: string; designation: string | null }

/** Type-ahead employee picker backed by /api/v1/performance/people. Single or multi select. */
export function EmployeePicker({ value, onChange, multiple = false, placeholder = "Search by name or code…", exclude = [] }: { value: PickedEmployee[]; onChange: (v: PickedEmployee[]) => void; multiple?: boolean; placeholder?: string; exclude?: string[] }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickedEmployee[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      try {
        const r = await apiFetch<PickedEmployee[]>(`/api/v1/performance/people?q=${encodeURIComponent(q)}`);
        setResults(r.filter((e) => !exclude.includes(e.id) && !value.some((v) => v.id === e.id)));
      } catch {
        setResults([]);
      }
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open, value.length]);

  function pick(e: PickedEmployee) {
    onChange(multiple ? [...value, e] : [e]);
    setQ("");
    setOpen(false);
  }

  return (
    <div className="relative">
      {value.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {value.map((v) => (
            <span key={v.id} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs">
              {v.name}
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => onChange(value.filter((x) => x.id !== v.id))} aria-label={`Remove ${v.name}`}>×</button>
            </span>
          ))}
        </div>
      )}
      {(multiple || value.length === 0) && (
        <Input value={q} placeholder={placeholder} onChange={(e) => setQ(e.target.value)} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      )}
      {open && results.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-lg border bg-popover p-1 text-sm shadow-md">
          {results.map((e) => (
            <li key={e.id}>
              <button type="button" className={cn("flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-muted")} onMouseDown={(ev) => ev.preventDefault()} onClick={() => pick(e)}>
                <span>{e.name}</span>
                <span className="text-xs text-muted-foreground">{e.code}{e.designation ? ` · ${e.designation}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
