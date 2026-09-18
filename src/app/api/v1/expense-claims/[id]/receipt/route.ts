import { ok, route } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { uploadReceipt } from "@/server/services/expenses";

/** POST multipart/form-data: file=<receipt>, itemId=<expense item id> */
export const POST = route<{ id: string }>(async (req, { actor, params }) => {
  const form = await req.formData().catch(() => {
    throw new ValidationError("Expected multipart/form-data");
  });
  const file = form.get("file");
  const itemId = form.get("itemId");
  if (!(file instanceof File)) throw new ValidationError("file is required");
  if (typeof itemId !== "string" || !itemId) throw new ValidationError("itemId is required");
  const buffer = Buffer.from(await file.arrayBuffer());
  return ok(await uploadReceipt(actor, params.id, itemId, { name: file.name || "receipt", mimeType: file.type || "application/octet-stream", buffer }));
});
