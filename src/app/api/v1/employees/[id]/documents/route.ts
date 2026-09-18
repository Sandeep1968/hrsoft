import { created, ok, route } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { listDocuments, uploadDocument, uploadDocumentSchema } from "@/server/services/documents";

export const GET = route<{ id: string }>(async (_req, { actor, params }) => ok(await listDocuments(actor, params.id)));

/** POST multipart/form-data: file, type, name?, expiresAt?, visibility? */
export const POST = route<{ id: string }>(async (req, { actor, params }) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ValidationError("Expected multipart/form-data");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new ValidationError("A file is required");
  const meta = uploadDocumentSchema.parse({
    type: form.get("type") ?? undefined,
    name: (form.get("name") as string | null) || file.name,
    expiresAt: form.get("expiresAt") ?? undefined,
    visibility: form.get("visibility") ?? undefined,
  });
  const buf = Buffer.from(await file.arrayBuffer());
  return created(await uploadDocument(actor, params.id, { ...meta, file: buf, mimeType: file.type || "application/octet-stream", fileName: file.name }));
});
