import { z } from "zod";
import { ok, route } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { importEmployeesCsv } from "@/server/services/employees";

/** POST text/csv body or JSON { csv, commit }. `?commit=1` (or body.commit) creates rows; otherwise validates only. */
export const POST = route(async (req, { actor, query }) => {
  const ct = req.headers.get("content-type") ?? "";
  let csv: string;
  let commit = query.get("commit") === "1" || query.get("commit") === "true";
  if (ct.includes("application/json")) {
    const body = z.object({ csv: z.string().min(1), commit: z.boolean().optional() }).parse(await req.json().catch(() => ({})));
    csv = body.csv;
    commit = commit || Boolean(body.commit);
  } else if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    csv = file instanceof File ? await file.text() : String(form.get("csv") ?? "");
    commit = commit || form.get("commit") === "1";
  } else {
    csv = await req.text();
  }
  if (!csv.trim()) throw new ValidationError("CSV content is required");
  return ok(await importEmployeesCsv(actor, csv, { commit }));
});
