import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: { default: "Careers", template: "%s · Careers" }, description: "Open roles at Acme Technologies." };
export const dynamic = "force-dynamic";

/** Minimal branded public layout — no app shell, no session. */
export default function CareersLayout({ children }: LayoutProps<"/careers">) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/careers" className="flex items-center gap-2 font-semibold">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">A</span>
            <span className="truncate">Acme Technologies</span> <span className="hidden font-normal text-muted-foreground sm:inline">· Careers</span>
          </Link>
          <Link href="/login" className="shrink-0 text-sm text-muted-foreground hover:text-foreground">Sign in</Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
      <footer className="border-t py-6 text-center text-xs text-muted-foreground">© {new Date().getFullYear()} Acme Technologies · Powered by HRsoft</footer>
    </div>
  );
}
