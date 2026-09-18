"use client";

import { useRouter } from "next/navigation";
import { NativeSelect } from "@/components/common/native-select";

const STATUSES = ["DRAFT", "PROCESSING", "REVIEW", "FINALIZED", "PAID"];

export function RunFilters({ year, status }: { year?: number; status?: string }) {
  const router = useRouter();
  const thisYear = new Date().getUTCFullYear();
  const years = Array.from({ length: 6 }, (_, i) => thisYear + 1 - i);
  const go = (next: { year?: string; status?: string }) => {
    const q = new URLSearchParams();
    const y = next.year ?? (year ? String(year) : "");
    const s = next.status ?? status ?? "";
    if (y) q.set("year", y);
    if (s) q.set("status", s);
    router.push(`/payroll${q.size ? `?${q}` : ""}`);
  };
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      <NativeSelect className="w-32" value={year ?? ""} onChange={(e) => go({ year: e.target.value })} aria-label="Year">
        <option value="">All years</option>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </NativeSelect>
      <NativeSelect className="w-40" value={status ?? ""} onChange={(e) => go({ status: e.target.value })} aria-label="Status">
        <option value="">All statuses</option>
        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </NativeSelect>
    </div>
  );
}
