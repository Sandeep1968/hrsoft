import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Forbidden() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
      <ShieldAlert className="size-8 text-amber-600" />
      <h1 className="text-xl font-semibold">Access denied</h1>
      <p className="text-sm text-muted-foreground">You don&apos;t have permission to view this page. If you think you should, ask your HR administrator to review your role.</p>
      <Button nativeButton={false} render={<Link href="/dashboard" />}>Back to dashboard</Button>
    </div>
  );
}
