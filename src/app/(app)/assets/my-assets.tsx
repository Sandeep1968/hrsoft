"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fmtDate } from "@/lib/dates";
import type { AssetDto } from "@/server/services/assets";

type MyAsset = AssetDto & { assignedAt: string; condition: string | null };

export function MyAssets({ items }: { items: MyAsset[] }) {
  const [acked, setAcked] = useState<Set<string>>(new Set());
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((a) => (
        <Card key={a.id}>
          <CardContent className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div><div className="font-medium">{a.name}</div><div className="text-xs text-muted-foreground">{a.assetTag} · {a.category.name}</div></div>
              <Button size="xs" variant={acked.has(a.id) ? "secondary" : "outline"} disabled={acked.has(a.id)} onClick={() => { setAcked(new Set([...acked, a.id])); toast.success("Acknowledged"); }}><Check /> {acked.has(a.id) ? "Acknowledged" : "Acknowledge"}</Button>
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Serial</dt><dd>{a.serialNumber ?? "—"}</dd>
              <dt className="text-muted-foreground">Assigned</dt><dd>{fmtDate(a.assignedAt)}</dd>
              <dt className="text-muted-foreground">Condition</dt><dd>{a.condition ?? "—"}</dd>
              <dt className="text-muted-foreground">Warranty</dt><dd className={a.warrantyState === "EXPIRED" ? "text-red-600" : a.warrantyState === "EXPIRING" ? "text-amber-700" : ""}>{a.warrantyUntil ? fmtDate(a.warrantyUntil) : "—"}</dd>
            </dl>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
