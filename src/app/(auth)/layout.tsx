export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between bg-primary text-primary-foreground p-10">
        <div className="text-2xl font-semibold tracking-tight">HRsoft</div>
        <div className="space-y-4 max-w-md">
          <h1 className="text-3xl font-semibold leading-tight">People, payroll and performance in one accurate system.</h1>
          <p className="text-primary-foreground/80">
            Core HR, attendance, leave, India-compliant payroll, OKRs, hiring, expenses and helpdesk — with role-based access built in.
          </p>
        </div>
        <div className="text-xs text-primary-foreground/60">© {new Date().getFullYear()} HRsoft</div>
      </div>
      <div className="flex items-center justify-center p-6">{children}</div>
    </div>
  );
}
