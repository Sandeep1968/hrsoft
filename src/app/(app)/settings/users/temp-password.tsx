"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TempPasswordBox({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
      <code className="flex-1 select-all break-all font-mono text-sm">{value}</code>
      <Button size="sm" variant="outline" onClick={async () => { await navigator.clipboard.writeText(value).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}</Button>
    </div>
  );
}
