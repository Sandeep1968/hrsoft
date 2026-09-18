import { route } from "@/lib/api";
import { getFile } from "@/lib/storage";
import { authorizeFileKey } from "@/server/services/documents";

/** Streams a local-storage file after verifying the actor may read the document that owns the key. */
export const GET = route<{ key: string[] }>(async (_req, { actor, params }) => {
  const key = params.key.map((s) => decodeURIComponent(s)).join("/");
  const doc = await authorizeFileKey(actor, key);
  const body = await getFile(key);
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Length": String(body.byteLength),
      "Content-Disposition": `inline; filename="${doc.name.replace(/[^\w.\- ]/g, "_")}"`,
      "Cache-Control": "private, no-store",
    },
  });
});
