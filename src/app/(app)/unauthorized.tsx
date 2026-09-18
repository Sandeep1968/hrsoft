import Link from "next/link";

export default function Unauthorized() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
      <h1 className="text-xl font-semibold">Session expired</h1>
      <p className="text-sm text-muted-foreground">Please sign in again to continue.</p>
      <Link href="/login" className="text-sm underline underline-offset-4">Go to sign in</Link>
    </div>
  );
}
