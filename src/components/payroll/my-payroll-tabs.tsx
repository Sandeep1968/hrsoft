"use client";

import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function MyPayrollTabs({ tab, children }: { tab: "payslips" | "tax"; children: { payslips: React.ReactNode; tax: React.ReactNode } }) {
  const router = useRouter();
  return (
    <Tabs value={tab} onValueChange={(v) => router.push(`/payroll/my?tab=${v}`)}>
      <TabsList>
        <TabsTrigger value="payslips">Payslips</TabsTrigger>
        <TabsTrigger value="tax">Tax declaration</TabsTrigger>
      </TabsList>
      <TabsContent value="payslips" className="mt-3">{children.payslips}</TabsContent>
      <TabsContent value="tax" className="mt-3">{children.tax}</TabsContent>
    </Tabs>
  );
}
