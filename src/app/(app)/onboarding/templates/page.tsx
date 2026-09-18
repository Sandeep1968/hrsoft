import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { EmptyState, PageHeader } from "@/components/common";
import { listTemplates } from "@/server/services/onboarding";
import { TemplateEditor } from "./template-editor";

export const metadata = { title: "Onboarding templates" };

export default async function TemplatesPage() {
  const actor = await requireActor();
  if (!can(actor, "onboarding:manage")) return <EmptyState title="Not allowed" description="You need the Manage onboarding templates permission." />;
  const templates = await listTemplates(actor);
  return (
    <div>
      <PageHeader title="Onboarding templates" description="Checklists applied to new joiners. The default template is used when none is chosen." breadcrumb={[{ label: "Onboarding", href: "/onboarding" }, { label: "Templates" }]} />
      <TemplateEditor templates={templates} />
    </div>
  );
}
