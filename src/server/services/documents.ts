import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ALLOWED_MIME, deleteFile, downloadUrl, makeKey, putFile } from "@/lib/storage";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { toDateOnly } from "@/lib/dates";
import { type Actor, authorize, can, scopeOf } from "@/lib/rbac/authorize";

export const DOCUMENT_TYPES = ["ID_PROOF", "ADDRESS_PROOF", "PAN", "AADHAAR", "OFFER_LETTER", "APPOINTMENT_LETTER", "EDUCATION", "EXPERIENCE", "PAYSLIP", "CONTRACT", "POLICY_ACK", "OTHER"] as const;
export const DOCUMENT_VISIBILITY = ["EMPLOYEE_AND_HR", "HR_ONLY"] as const;

export const uploadDocumentSchema = z.object({
  type: z.enum(DOCUMENT_TYPES).default("OTHER"),
  name: z.string().trim().min(1).max(160),
  expiresAt: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  visibility: z.enum(DOCUMENT_VISIBILITY).default("EMPLOYEE_AND_HR"),
});

export interface DocumentDto {
  id: string;
  employeeId: string;
  type: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  visibility: string;
  expiresAt: string | null;
  uploadedBy: string | null;
  createdAt: string;
  canDelete: boolean;
}

function toDto(d: { id: string; employeeId: string; type: string; name: string; mimeType: string; sizeBytes: number; visibility: string; expiresAt: Date | null; createdAt: Date; uploadedBy: { displayName: string } | null }, canDelete: boolean): DocumentDto {
  return { id: d.id, employeeId: d.employeeId, type: d.type, name: d.name, mimeType: d.mimeType, sizeBytes: d.sizeBytes, visibility: d.visibility, expiresAt: d.expiresAt ? d.expiresAt.toISOString().slice(0, 10) : null, uploadedBy: d.uploadedBy?.displayName ?? null, createdAt: d.createdAt.toISOString(), canDelete };
}

/** SELF-scoped readers never see HR_ONLY documents. */
function hrOnlyHidden(actor: Actor, employeeId: string): boolean {
  return scopeOf(actor, "documents:read") === "SELF" || (actor.employeeId === employeeId && !can(actor, "documents:read", "TEAM"));
}

export async function listDocuments(actor: Actor, employeeId: string): Promise<DocumentDto[]> {
  await authorize(actor, "documents:read", { employeeId });
  const hideHrOnly = hrOnlyHidden(actor, employeeId);
  const rows = await db.employeeDocument.findMany({
    where: { employeeId, ...(hideHrOnly ? { visibility: { not: "HR_ONLY" } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { uploadedBy: { select: { displayName: true } } },
  });
  const canDelete = await allowed(actor, employeeId);
  return rows.map((r) => toDto(r, canDelete));
}

async function allowed(actor: Actor, employeeId: string) {
  try {
    await authorize(actor, "documents:write", { employeeId });
    return true;
  } catch {
    return false;
  }
}

export async function uploadDocument(actor: Actor, employeeId: string, input: z.infer<typeof uploadDocumentSchema> & { file: Buffer; mimeType: string; fileName: string }) {
  await authorize(actor, "documents:write", { employeeId });
  if (!(await db.employee.findUnique({ where: { id: employeeId }, select: { id: true } }))) throw new NotFoundError("Employee");
  if (!ALLOWED_MIME.has(input.mimeType)) throw new ValidationError(`File type ${input.mimeType} is not allowed (PDF, PNG, JPEG, WEBP, CSV, DOCX, XLSX)`);
  if (input.file.byteLength === 0) throw new ValidationError("File is empty");
  if (input.file.byteLength > 10 * 1024 * 1024) throw new ValidationError("File exceeds 10 MB");
  // Employees can only upload documents they can also see.
  const visibility = hrOnlyHidden(actor, employeeId) ? "EMPLOYEE_AND_HR" : input.visibility;
  const key = makeKey(`employees/${employeeId}`, input.fileName || input.name);
  const stored = await putFile(key, input.file, input.mimeType);
  const row = await db.employeeDocument.create({
    data: {
      employeeId,
      type: input.type,
      name: input.name,
      fileKey: stored.key,
      mimeType: stored.mimeType,
      sizeBytes: stored.size,
      uploadedById: actor.employeeId,
      expiresAt: input.expiresAt ? toDateOnly(input.expiresAt) : null,
      visibility,
    },
    include: { uploadedBy: { select: { displayName: true } } },
  });
  await audit(actor, "documents.upload", "EmployeeDocument", row.id, { after: { employeeId, type: input.type, name: input.name, sizeBytes: stored.size } });
  return toDto(row, true);
}

export async function deleteDocument(actor: Actor, employeeId: string, docId: string) {
  const doc = await db.employeeDocument.findUnique({ where: { id: docId } });
  if (!doc || doc.employeeId !== employeeId) throw new NotFoundError("Document");
  await authorize(actor, "documents:write", { employeeId });
  if (doc.visibility === "HR_ONLY" && hrOnlyHidden(actor, employeeId)) throw new NotFoundError("Document");
  await db.employeeDocument.delete({ where: { id: docId } });
  await deleteFile(doc.fileKey);
  await audit(actor, "documents.delete", "EmployeeDocument", docId, { before: { employeeId, name: doc.name, type: doc.type } });
  return { id: docId };
}

export async function documentUrl(actor: Actor, employeeId: string, docId: string): Promise<{ url: string; name: string; mimeType: string }> {
  const doc = await db.employeeDocument.findUnique({ where: { id: docId } });
  if (!doc || doc.employeeId !== employeeId) throw new NotFoundError("Document");
  await authorize(actor, "documents:read", { employeeId });
  if (doc.visibility === "HR_ONLY" && hrOnlyHidden(actor, employeeId)) throw new NotFoundError("Document");
  return { url: await downloadUrl(doc.fileKey), name: doc.name, mimeType: doc.mimeType };
}

/** Resolve a storage key to its document and authorize the actor to read it (used by the local files route). */
export async function authorizeFileKey(actor: Actor, fileKey: string) {
  const doc = await db.employeeDocument.findFirst({ where: { fileKey }, select: { id: true, employeeId: true, name: true, mimeType: true, visibility: true } });
  if (!doc) throw new NotFoundError("File");
  try {
    await authorize(actor, "documents:read", { employeeId: doc.employeeId });
  } catch {
    throw new NotFoundError("File");
  }
  if (doc.visibility === "HR_ONLY" && hrOnlyHidden(actor, doc.employeeId)) throw new NotFoundError("File");
  return doc;
}
