import { requireActor } from "@/lib/auth/session";
import { PageHeader } from "@/components/common";
import { WEBHOOK_EVENTS, listWebhooks } from "@/server/services/webhooks";
import { WebhooksPanel } from "./webhooks-panel";

export const metadata = { title: "Webhooks" };

export default async function WebhooksPage() {
  const actor = await requireActor();
  const hooks = await listWebhooks(actor);
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Webhooks" description="Push HRsoft events to external systems. Each delivery is signed with the webhook's secret." breadcrumb={[{ label: "API keys", href: "/settings/api-keys" }, { label: "Webhooks" }]} />
      <WebhooksPanel hooks={hooks} events={WEBHOOK_EVENTS} />
    </div>
  );
}
