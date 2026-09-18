"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/common/native-select";
import { STATUS_LABEL } from "../format";

export function TeamToolbar({ departments, date, departmentId, status, q }: { departments: { id: string; name: string }[]; date: string; departmentId?: string; status?: string; q?: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  function set(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("page");
    router.push(`/attendance/team?${next.toString()}`);
  }
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="grid gap-1">
        <span className="text-xs text-muted-foreground">Date</span>
        <Input type="date" value={date} onChange={(e) => set({ date: e.target.value })} className="w-40" />
      </div>
      <div className="grid gap-1">
        <span className="text-xs text-muted-foreground">Department</span>
        <NativeSelect value={departmentId ?? ""} onChange={(e) => set({ departmentId: e.target.value || undefined })} className="w-48">
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1">
        <span className="text-xs text-muted-foreground">Status</span>
        <NativeSelect value={status ?? ""} onChange={(e) => set({ status: e.target.value || undefined })} className="w-40">
          <option value="">Any status</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1">
        <span className="text-xs text-muted-foreground">Search</span>
        <Input placeholder="Name or code" defaultValue={q ?? ""} className="w-48" onKeyDown={(e) => e.key === "Enter" && set({ q: (e.target as HTMLInputElement).value || undefined })} />
      </div>
    </div>
  );
}
