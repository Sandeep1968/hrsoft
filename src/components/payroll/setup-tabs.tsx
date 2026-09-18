"use client";

import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Page } from "@/lib/api";
import type { StructureDto, SalaryDto } from "@/server/services/payroll";
import { ComponentsTab, type ComponentRow } from "./components-tab";
import { StructuresTab } from "./structures-tab";
import { SalariesTab, type SalaryListRow } from "./salaries-tab";

export function SetupTabs({ tab, components, structures, salaries, query }: { tab: string; components: ComponentRow[]; structures: StructureDto[]; salaries: Page<SalaryDto & SalaryListRow>; query: { q: string; page: number } }) {
  const router = useRouter();
  return (
    <Tabs value={tab} onValueChange={(v) => router.push(`/payroll/setup?tab=${v}`)}>
      <TabsList>
        <TabsTrigger value="components">Components</TabsTrigger>
        <TabsTrigger value="structures">Structures</TabsTrigger>
        <TabsTrigger value="salaries">Employee salaries</TabsTrigger>
      </TabsList>
      <TabsContent value="components" className="mt-3"><ComponentsTab components={components} /></TabsContent>
      <TabsContent value="structures" className="mt-3"><StructuresTab structures={structures} components={components.filter((c) => c.isActive)} /></TabsContent>
      <TabsContent value="salaries" className="mt-3"><SalariesTab salaries={salaries} structures={structures} query={query} /></TabsContent>
    </Tabs>
  );
}
