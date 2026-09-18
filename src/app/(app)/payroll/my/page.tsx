import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { PageHeader, EmptyState, StatusBadge } from "@/components/common";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtMoney, financialYear, todayUtc } from "@/lib/dates";
import { getDeclaration, listMyPayslips, monthLabel, taxProjection } from "@/server/services/payroll";
import { MyPayrollTabs } from "@/components/payroll/my-payroll-tabs";
import { TaxDeclarationForm } from "@/components/payroll/tax-declaration-form";
import { YearFilter } from "@/components/payroll/year-filter";

export const metadata = { title: "Payslips & Tax" };

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function MyPayrollPage({ searchParams }: PageProps<"/payroll/my">) {
  const actor = await requireActor();
  const sp = await searchParams;
  const tab = str(sp.tab) === "tax" ? "tax" : "payslips";
  const year = Number(str(sp.year)) || undefined;
  if (!actor.employeeId) {
    return (
      <div>
        <PageHeader title="Payslips & Tax" />
        <EmptyState title="No employee profile" description="Payslips and tax declarations are only available for employee accounts." />
      </div>
    );
  }
  const fy = str(sp.fy) || financialYear(todayUtc());
  const [payslips, declaration, projection] = await Promise.all([
    listMyPayslips(actor, undefined, { year }),
    getDeclaration(actor, actor.employeeId, fy),
    taxProjection(actor, actor.employeeId, fy),
  ]);
  const years = [...new Set(payslips.map((p) => p.year))].sort((a, b) => b - a);
  const thisYear = todayUtc().getUTCFullYear();

  return (
    <div>
      <PageHeader title="Payslips & Tax" description="Your published payslips and investment declaration for the financial year." />
      <MyPayrollTabs tab={tab}>
        {{
          payslips: (
            <div>
              <YearFilter year={year} years={years.length ? years : [thisYear]} />
              {payslips.length === 0 ? (
                <EmptyState title="No payslips yet" description="Payslips appear here once payroll for a month is finalised." />
              ) : (
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Month</TableHead>
                        <TableHead className="text-right">Payable days</TableHead>
                        <TableHead className="text-right">Gross</TableHead>
                        <TableHead className="text-right">Deductions</TableHead>
                        <TableHead className="text-right">Net pay</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payslips.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell><Link href={`/payroll/my/${p.id}`} className="font-medium hover:underline">{monthLabel(p.month)} {p.year}</Link></TableCell>
                          <TableCell className="text-right tabular-nums">{p.payableDays}{p.lopDays > 0 && <span className="text-xs text-amber-700"> ({p.lopDays} LOP)</span>}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtMoney(p.gross)}</TableCell>
                          <TableCell className="text-right tabular-nums">{fmtMoney(p.totalDeductions)}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{fmtMoney(p.netPay)}</TableCell>
                          <TableCell><StatusBadge status={p.paidAt ? "PAID" : p.runStatus} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          ),
          tax: <TaxDeclarationForm fy={fy} declaration={declaration} projection={projection} />,
        }}
      </MyPayrollTabs>
    </div>
  );
}
