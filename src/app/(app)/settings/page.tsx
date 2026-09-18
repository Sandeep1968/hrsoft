import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { EmptyState, PageHeader } from "@/components/common";
import { getOrganization, listCustomFields, listDepartments, listDesignations, listLegalEntities, listLocations, flattenDepartments } from "@/server/services/org";
import { SettingsTabs } from "./settings-tabs";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const actor = await requireActor();
  const sp = await searchParams;
  if (!can(actor, "org:read")) return <EmptyState title="Not allowed" description="You need the View organisation settings permission." />;
  const [org, entities, locations, departments, designations, customFields] = await Promise.all([
    getOrganization(actor),
    listLegalEntities(actor),
    listLocations(actor, true),
    listDepartments(actor, true),
    listDesignations(actor, true),
    listCustomFields(actor),
  ]);
  const readOnly = !can(actor, "org:manage");
  return (
    <div>
      <PageHeader title="Organisation settings" description={readOnly ? "Read-only view. Ask an HR admin to make changes." : "Company profile, legal entities, locations, departments, designations and custom fields."} />
      <SettingsTabs
        readOnly={readOnly}
        initialTab={typeof sp.tab === "string" ? sp.tab : undefined}
        org={org}
        entities={entities}
        locations={locations.map((l) => ({ id: l.id, name: l.name, address: l.address, city: l.city, state: l.state, country: l.country, timezone: l.timezone, latitude: l.latitude, longitude: l.longitude, geoRadiusM: l.geoRadiusM, isActive: l.isActive, employeeCount: l.employeeCount }))}
        departments={flattenDepartments(departments).map((d) => ({ id: d.id, name: d.name, code: d.code, parentId: d.parentId, headId: d.headId, head: d.head, isActive: d.isActive, employeeCount: d.employeeCount, depth: d.depth }))}
        designations={designations}
        customFields={customFields}
      />
    </div>
  );
}
