"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShieldAlert, SearchX, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseErrorDigest } from "@/lib/errors";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const parsed = parseErrorDigest(error.digest);
  const status = parsed?.status ?? 500;

  useEffect(() => {
    if (status === 401) router.replace("/login");
    if (status >= 500 && !parsed) console.error(error);
  }, [status, parsed, error, router]);

  if (status === 403) {
    return (
      <Shell icon={<ShieldAlert className="size-8 text-amber-600" />} title="Access denied" body="You don't have permission to view this page. If you think you should, ask your HR administrator to review your role.">
        <Button nativeButton={false} render={<Link href="/dashboard" />}>Back to dashboard</Button>
      </Shell>
    );
  }
  if (status === 404) {
    return (
      <Shell icon={<SearchX className="size-8 text-muted-foreground" />} title="Not found" body="The record you're looking for doesn't exist or was removed.">
        <Button variant="outline" onClick={() => router.back()}>Go back</Button>
        <Button nativeButton={false} render={<Link href="/dashboard" />}>Dashboard</Button>
      </Shell>
    );
  }
  if (status === 422 || status === 409 || status === 400) {
    return (
      <Shell icon={<AlertTriangle className="size-8 text-amber-600" />} title="This request can't be completed" body={parsed?.code === "VALIDATION" ? "The link contains an invalid value." : "The record is in a state that doesn't allow this action."}>
        <Button variant="outline" onClick={() => router.back()}>Go back</Button>
      </Shell>
    );
  }
  return (
    <Shell icon={<AlertTriangle className="size-8 text-destructive" />} title="Something went wrong" body="The error has been logged. Try again, and contact IT support if it keeps happening.">
      <Button variant="outline" onClick={() => reset()}>Try again</Button>
      <Button nativeButton={false} render={<Link href="/dashboard" />}>Dashboard</Button>
    </Shell>
  );
}

function Shell({ icon, title, body, children }: { icon: React.ReactNode; title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
      {icon}
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
      <div className="mt-2 flex gap-2">{children}</div>
    </div>
  );
}
