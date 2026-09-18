"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/common/native-select";
import { cn } from "@/lib/utils";

export function ClaimFilters({ status, view, showApprove, showAll, pendingApprovals }: { status?: string; view: string; showApprove: boolean; showAll: boolean; pendingApprovals: number }) {
  const router = useRouter();
  const go = (v: string, s?: string) => {
    const p = new URLSearchParams();
    if (v !== "mine") p.set("view", v);
    if (s) p.set("status", s);
    router.push(`/expenses${p.size ? `?${p}` : ""}`);
  };
  const tabs = [
    { key: "mine", label: "My claims" },
    ...(showApprove ? [{ key: "approve", label: `To approve${pendingApprovals ? ` (${pendingApprovals})` : ""}` }] : []),
    ...(showAll ? [{ key: "all", label: "Team" }] : []),
  ];
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg bg-muted p-[3px]">
        {tabs.map((t) => (
          <Button key={t.key} variant="ghost" size="sm" className={cn("rounded-md", view === t.key && "bg-background shadow-sm")} onClick={() => go(t.key)}>{t.label}</Button>
        ))}
      </div>
      {view !== "approve" && (
        <NativeSelect className="w-40" value={status ?? ""} onChange={(e) => go(view, e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "REIMBURSED"].map((s) => <option key={s} value={s}>{s}</option>)}
        </NativeSelect>
      )}
    </div>
  );
}
