import "server-only";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";
import { randomToken } from "@/lib/crypto";

/**
 * File storage abstraction. Uses S3 (or any S3-compatible endpoint such as
 * Supabase Storage, Cloudflare R2, MinIO) when S3_BUCKET is set; otherwise
 * falls back to the local `.uploads/` directory for development.
 */
export interface StoredFile {
  key: string;
  size: number;
  mimeType: string;
}

const LOCAL_DIR = path.join(process.cwd(), ".uploads");
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

let s3: S3Client | null | undefined;
function client() {
  if (s3 !== undefined) return s3;
  const e = env();
  s3 = e.S3_BUCKET
    ? new S3Client({
        region: e.S3_REGION,
        endpoint: e.S3_ENDPOINT || undefined,
        forcePathStyle: Boolean(e.S3_ENDPOINT),
        credentials: e.S3_ACCESS_KEY_ID ? { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY } : undefined,
      })
    : null;
  return s3;
}

export function makeKey(prefix: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  return `${prefix}/${new Date().toISOString().slice(0, 10)}/${randomToken(12)}-${safe}`;
}

export async function putFile(key: string, body: Buffer, mimeType: string): Promise<StoredFile> {
  if (body.byteLength > MAX_BYTES) throw new Error("File exceeds 10 MB limit");
  if (!ALLOWED_MIME.has(mimeType)) throw new Error(`File type ${mimeType} is not allowed`);
  const c = client();
  if (c) {
    await c.send(new PutObjectCommand({ Bucket: env().S3_BUCKET, Key: key, Body: body, ContentType: mimeType }));
  } else {
    const p = path.join(LOCAL_DIR, key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, body);
  }
  return { key, size: body.byteLength, mimeType };
}

export async function getFile(key: string): Promise<Buffer> {
  const c = client();
  if (c) {
    const r = await c.send(new GetObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  return readFile(path.join(LOCAL_DIR, key));
}

export async function deleteFile(key: string): Promise<void> {
  const c = client();
  if (c) await c.send(new DeleteObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
  else await unlink(path.join(LOCAL_DIR, key)).catch(() => {});
}

/** Short-lived download URL. Local mode streams through the app's authenticated files route. */
export async function downloadUrl(key: string): Promise<string> {
  const c = client();
  if (c) return getSignedUrl(c, new GetObjectCommand({ Bucket: env().S3_BUCKET, Key: key }), { expiresIn: 300 });
  return `/api/v1/files/${encodeURIComponent(key)}`;
}
