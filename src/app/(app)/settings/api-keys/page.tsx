import Link from "next/link";
import { requireActor } from "@/lib/auth/session";
import { can } from "@/lib/rbac/authorize";
import { PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listApiKeys } from "@/server/services/apikeys";
import { permissionGroups } from "@/server/services/rbac";
import { ApiKeysPanel } from "./api-keys-panel";

export const metadata = { title: "API keys" };

export default async function ApiKeysPage() {
  const actor = await requireActor();
  const keys = await listApiKeys(actor);
  const groups = permissionGroups().filter((g) => g.permissions.some((p) => actor.perms.has(p.permission))).map((g) => ({ ...g, permissions: g.permissions.filter((p) => actor.perms.has(p.permission)) }));
  const showOwner = can(actor, "rbac:manage", "ALL");
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="API keys" description="Bearer tokens for integrations. Each key inherits the creating user's permissions, narrowed to the selected scopes." actions={can(actor, "settings:manage") && <Button variant="outline" nativeButton={false} render={<Link href="/settings/webhooks" />}>Webhooks</Button>} />
      <ApiKeysPanel keys={keys} groups={groups} showOwner={showOwner} />
      <Card className="mt-6">
        <CardHeader><CardTitle>Calling the API</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Send the key as a bearer token. Every <code>/api/v1</code> endpoint the UI uses is available; responses are <code>{`{ "data": … }`}</code> or <code>{`{ "error": { code, message } }`}</code>.</p>
          <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">{`curl -H "Authorization: Bearer hrs_…" \\
  "${process.env.APP_URL ?? "https://your-hrsoft.example"}/api/v1/employees?page=1&pageSize=25"

# create a ticket
curl -X POST -H "Authorization: Bearer hrs_…" -H "Content-Type: application/json" \\
  -d '{"categoryId":"…","subject":"VPN down","description":"…","priority":"HIGH"}' \\
  "${process.env.APP_URL ?? "https://your-hrsoft.example"}/api/v1/tickets"`}</pre>
          <p className="text-xs text-muted-foreground">Keys are hashed at rest; only the 12-character prefix is stored in clear. Revoked or expired keys return 401.</p>
        </CardContent>
      </Card>
    </div>
  );
}
