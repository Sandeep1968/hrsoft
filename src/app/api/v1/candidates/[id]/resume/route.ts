import { ok, route } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { uploadResume } from "@/server/services/hiring";

/** multipart/form-data with a `resume` file field. */
export const POST = route<{ id: string }>(async (req, { actor, params }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("resume");
  if (!(file instanceof File) || file.size === 0) throw new ValidationError("Attach a resume file in the `resume` field");
  return ok(await uploadResume(actor, params.id, { buffer: Buffer.from(await file.arrayBuffer()), mimeType: file.type, name: file.name }));
});
