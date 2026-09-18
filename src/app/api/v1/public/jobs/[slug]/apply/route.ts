import { created, route } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { publicApply, publicApplySchema, type UploadedFile } from "@/server/services/hiring";

/** Public careers form: multipart/form-data (text fields + optional `resume` file) or JSON. */
export const POST = route<{ slug: string }>(
  async (req, { params }) => {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? null;
    let fields: Record<string, unknown> = {};
    let resume: UploadedFile | null = null;
    if (req.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await req.formData().catch(() => null);
      if (!form) throw new ValidationError("Invalid form submission");
      for (const [k, v] of form.entries()) {
        if (v instanceof File) {
          if (k === "resume" && v.size > 0) resume = { buffer: Buffer.from(await v.arrayBuffer()), mimeType: v.type, name: v.name };
        } else if (v !== "") fields[k] = v;
      }
    } else {
      fields = (await req.json().catch(() => null)) ?? {};
      if (typeof fields !== "object" || fields === null) throw new ValidationError("Request body must be valid JSON");
    }
    const input = publicApplySchema.parse(fields);
    return created(await publicApply({ ...input, slug: params.slug, resume }, ip));
  },
  { public: true },
);
