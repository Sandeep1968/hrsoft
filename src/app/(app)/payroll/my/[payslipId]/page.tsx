import { requireActor } from "@/lib/auth/session";
import { PageHeader } from "@/components/common";
import { payslipViewModel } from "@/server/services/payroll";
import { PayslipPrint } from "@/components/payroll/payslip-print";

export const metadata = { title: "Payslip" };

export default async function PayslipPage({ params }: PageProps<"/payroll/my/[payslipId]">) {
  const actor = await requireActor();
  const { payslipId } = await params;
  const view = await payslipViewModel(actor, payslipId);
  return (
    <div className="mx-auto max-w-4xl">
      <div className="print:hidden">
        <PageHeader title={`Payslip — ${view.monthLabel}`} breadcrumb={[{ label: "Payslips", href: "/payroll/my" }, { label: view.monthLabel }]} />
      </div>
      <PayslipPrint view={view} />
    </div>
  );
}
