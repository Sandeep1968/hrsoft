"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/client/api";

interface Hit {
  id: string;
  displayName: string;
  employeeCode: string;
  workEmail: string;
  designation: { name: string } | null;
}

/** Type-ahead employee picker (used for manager and department head). */
export function ManagerPicker({ value, onChange, placeholder = "Search by name, code or email", excludeId }: { value: { id: string; displayName: string } | null; onChange: (v: { id: string; displayName: string } | null) => void; placeholder?: string; excludeId?: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (q.trim().length < 2) {
        setHits([]);
        return;
      }
      try {
        const r = await apiFetch<Hit[]>(`/api/v1/employees/search?q=${encodeURIComponent(q)}&limit=8`);
        setHits(r.filter((h) => h.id !== excludeId));
        setOpen(true);
      } catch {
        setHits([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, excludeId]);

  if (value) {
    return (
      <div className="flex h-8 items-center justify-between rounded-lg border border-input px-2.5 text-sm">
        <span className="truncate">{value.displayName}</span>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Clear" onClick={() => onChange(null)}>
          <X />
        </Button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input value={q} placeholder={placeholder} onChange={(e) => setQ(e.target.value)} onFocus={() => hits.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && hits.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-lg border bg-popover p-1 text-sm shadow-md">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                className="flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-muted"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange({ id: h.id, displayName: h.displayName });
                  setQ("");
                  setOpen(false);
                }}
              >
                <span className="font-medium">{h.displayName}</span>
                <span className="text-xs text-muted-foreground">
                  {h.employeeCode} · {h.designation?.name ?? "—"} · {h.workEmail}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
