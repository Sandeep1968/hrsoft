"use client";

import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/common";
import { OverviewTab } from "./overview-tab";
import { JobTab } from "./job-tab";
import { DocumentsTab } from "./documents-tab";
import { BankTab } from "./bank-tab";
import { OnboardingTaskList } from "./onboarding-tab";
import type { EmployeeProfile } from "@/server/services/employees";
import type { OrgLookups } from "@/server/services/org";
import type { DocumentDto } from "@/server/services/documents";
import type { OnboardingTaskDto } from "@/server/services/onboarding";
import type { ExitRequestDto } from "@/server/services/exits";

export interface ProfilePerms {
  isSelf: boolean;
  isHr: boolean;
  canEditAll: boolean;
  canEditSelf: boolean;
  canSensitive: boolean;
  canDocsWrite: boolean;
  canExit: boolean;
}

const TABS = ["overview", "job", "documents", "bank", "onboarding"] as const;

export function ProfileView({ profile, lookups, documents, tasks, myExit, perms, initialTab }: { profile: EmployeeProfile; lookups: OrgLookups; documents: DocumentDto[]; tasks: OnboardingTaskDto[]; myExit: ExitRequestDto | null; perms: ProfilePerms; initialTab?: string }) {
  const [tab, setTab] = useState<string>(TABS.includes(initialTab as (typeof TABS)[number]) ? (initialTab as string) : "overview");
  const pending = tasks.filter((t) => t.status === "PENDING" || t.status === "IN_PROGRESS").length;
  const initials = profile.displayName.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div>
      <div className="mb-6 flex items-center gap-4">
        <Avatar className="size-14">
          {profile.photoUrl && <AvatarImage src={profile.photoUrl} alt="" />}
          <AvatarFallback className="text-lg">{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{profile.displayName}</h1>
            <StatusBadge status={profile.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {[profile.employeeCode, profile.designation?.name, profile.department?.name, profile.location?.name].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="job">Job</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="bank">Bank &amp; IDs</TabsTrigger>
          {(tasks.length > 0 || perms.isHr) && (
            <TabsTrigger value="onboarding">
              Onboarding{pending > 0 && <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-[10px] text-primary">{pending}</span>}
            </TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="overview"><OverviewTab profile={profile} lookups={lookups} canEditAll={perms.canEditAll} canEditSelf={perms.canEditSelf} /></TabsContent>
        <TabsContent value="job"><JobTab profile={profile} lookups={lookups} canEdit={perms.canEditAll} canExit={perms.canExit} isSelf={perms.isSelf} myExit={myExit} /></TabsContent>
        <TabsContent value="documents"><DocumentsTab employeeId={profile.id} documents={documents} canWrite={perms.canDocsWrite} isHr={perms.isHr} /></TabsContent>
        <TabsContent value="bank"><BankTab profile={profile} canEdit={perms.canSensitive} isHr={perms.canEditAll} /></TabsContent>
        <TabsContent value="onboarding"><OnboardingTaskList tasks={tasks} /></TabsContent>
      </Tabs>
    </div>
  );
}
