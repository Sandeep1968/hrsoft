"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/common/native-select";

export function CalendarNav({ year, month, departments, departmentId }: { year: number; month: number; departments: { id: string; name: string }[]; departmentId?: string }) {
  const router = useRouter();
  function go(delta: number, dept = departmentId) {
    let y = year;
    let m = month + delta;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    router.push(`/leave/calendar?year=${y}&month=${m}${dept ? `&departmentId=${dept}` : ""}`);
  }
  return (
    <div className="flex items-center gap-2">
      <NativeSelect value={departmentId ?? ""} onChange={(e) => go(0, e.target.value || undefined)} className="w-44">
        <option value="">All departments</option>
        {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </NativeSelect>
      <Button size="icon-sm" variant="outline" aria-label="Previous month" onClick={() => go(-1)}><ChevronLeft /></Button>
      <Button size="icon-sm" variant="outline" aria-label="Next month" onClick={() => go(1)}><ChevronRight /></Button>
    </div>
  );
}
