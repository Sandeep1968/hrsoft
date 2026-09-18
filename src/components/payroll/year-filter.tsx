"use client";

import { useRouter } from "next/navigation";
import { NativeSelect } from "@/components/common/native-select";

export function YearFilter({ year, years }: { year?: number; years: number[] }) {
  const router = useRouter();
  return (
    <div className="mb-3">
      <NativeSelect className="w-32" value={year ?? ""} onChange={(e) => router.push(`/payroll/my${e.target.value ? `?year=${e.target.value}` : ""}`)} aria-label="Year">
        <option value="">All years</option>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </NativeSelect>
    </div>
  );
}
