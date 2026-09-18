"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtDate, fmtMoney } from "@/lib/dates";
import type { PayslipView } from "@/server/services/payroll";

export function PayslipPrint({ view }: { view: PayslipView }) {
  const rows = Math.max(view.earningLines.length, view.deductionLines.length);
  return (
    <div>
      <style>{`@media print { body * { visibility: hidden; } #payslip, #payslip * { visibility: visible; } #payslip { position: absolute; inset: 0; margin: 0; padding: 16mm; box-shadow: none; border: 0; } @page { size: A4; margin: 0; } }`}</style>
      <div className="mb-3 flex justify-end print:hidden">
        <Button variant="outline" onClick={() => window.print()}><Printer /> Print / Save PDF</Button>
      </div>
      <div id="payslip" className="rounded-xl border bg-white p-6 text-sm text-black shadow-sm dark:bg-white dark:text-black">
        <div className="flex items-start justify-between border-b pb-4">
          <div>
            <div className="text-lg font-semibold">{view.company.name}</div>
            <div className="text-xs text-neutral-600">{view.company.address}</div>
            <div className="text-xs text-neutral-600">{view.company.pan && `PAN ${view.company.pan}`}{view.company.tan && ` · TAN ${view.company.tan}`}</div>
          </div>
          <div className="text-right">
            <div className="text-base font-semibold">Payslip</div>
            <div className="text-xs text-neutral-600">{view.monthLabel}</div>
            {view.paidAt && <div className="text-xs text-neutral-600">Paid {fmtDate(view.paidAt)}{view.paymentRef ? ` · ${view.paymentRef}` : ""}</div>}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 py-4 text-xs sm:grid-cols-4">
          {[
            ["Employee", `${view.employee.displayName}`],
            ["Employee code", view.employee.employeeCode],
            ["Designation", view.employee.designation ?? "—"],
            ["Department", view.employee.department ?? "—"],
            ["Location", view.employee.location ?? "—"],
            ["Date of joining", fmtDate(view.employee.joiningDate)],
            ["PAN", view.employee.pan ?? "—"],
            ["UAN", view.employee.uan ?? "—"],
            ["Bank", view.employee.bankName ? `${view.employee.bankName} ••••${view.employee.accountLast4}` : "—"],
            ["Tax regime", view.employee.taxRegime ?? "—"],
            ["Working days", String(view.workingDays)],
            ["Payable days", `${view.payableDays}${view.lopDays ? ` (LOP ${view.lopDays})` : ""}`],
          ].map(([k, v]) => (
            <div key={k}><dt className="text-neutral-500">{k}</dt><dd className="font-medium">{v}</dd></div>
          ))}
        </dl>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-y bg-neutral-100 text-xs uppercase tracking-wide text-neutral-600">
              <th className="px-2 py-1.5 text-left">Earnings</th><th className="px-2 py-1.5 text-right">Amount</th>
              <th className="border-l px-2 py-1.5 text-left">Deductions</th><th className="px-2 py-1.5 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, i) => {
              const e = view.earningLines[i];
              const d = view.deductionLines[i];
              return (
                <tr key={i} className="border-b border-neutral-200">
                  <td className="px-2 py-1.5">{e?.name ?? ""}</td><td className="px-2 py-1.5 text-right tabular-nums">{e ? fmtMoney(e.amount) : ""}</td>
                  <td className="border-l px-2 py-1.5">{d?.name ?? ""}</td><td className="px-2 py-1.5 text-right tabular-nums">{d ? fmtMoney(d.amount) : ""}</td>
                </tr>
              );
            })}
            <tr className="border-y bg-neutral-50 font-semibold">
              <td className="px-2 py-1.5">Gross earnings</td><td className="px-2 py-1.5 text-right tabular-nums">{fmtMoney(view.gross)}</td>
              <td className="border-l px-2 py-1.5">Total deductions</td><td className="px-2 py-1.5 text-right tabular-nums">{fmtMoney(view.totalDeductions)}</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-4 flex items-center justify-between rounded-lg bg-neutral-900 px-4 py-3 text-white print:bg-neutral-100 print:text-black">
          <div>
            <div className="text-xs uppercase tracking-wide opacity-70">Net pay</div>
            <div className="text-xs">{view.netPayInWords}</div>
          </div>
          <div className="text-2xl font-semibold tabular-nums">{fmtMoney(view.netPay)}</div>
        </div>

        {view.employerLines.length > 0 && (
          <div className="mt-4 text-xs text-neutral-600">
            <div className="font-medium text-neutral-800">Employer contributions (not part of net pay)</div>
            <div className="mt-1 flex flex-wrap gap-x-4">{view.employerLines.map((l) => <span key={l.code}>{l.name}: {fmtMoney(l.amount)}</span>)}<span>Total cost to company: {fmtMoney(view.employerCost)}</span></div>
          </div>
        )}
        <p className="mt-6 text-center text-[10px] text-neutral-500">This is a system-generated payslip and does not require a signature.</p>
      </div>
    </div>
  );
}
