import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type StoredObject = {
  bucket: string;
  key: string;
  contentType: string;
  size: number | null;
  etag: string | null;
};

export type StorageObjectMetadata = {
  bucket: string;
  key: string;
  contentType: string | null;
  size: number | null;
  etag: string | null;
};

let s3Client: S3Client | null = null;

export function storageBucket(): string {
  return process.env.R2_BUCKET || process.env.CLOUDFLARE_R2_BUCKET || "instamosaic-local";
}

export function isR2Configured(): boolean {
  return Boolean(r2Endpoint() && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && storageBucket());
}

export function jobInputKey(jobId: string, filename: string): string {
  return `jobs/${jobId}/inputs/${safeFilename(filename)}`;
}

export function jobOutputKey(jobId: string, variant: string, filename: string): string {
  return `jobs/${jobId}/outputs/${variant}/${safeFilename(filename)}`;
}

export async function uploadBuffer(input: {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
  metadata?: Record<string, string>;
}): Promise<StoredObject> {
  if (isR2Configured()) {
    const result = await s3().send(new PutObjectCommand(putInput({
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      Metadata: input.metadata
    })));
    return {
      bucket: storageBucket(),
      key: input.key,
      contentType: input.contentType,
      size: input.body.byteLength,
      etag: stripQuotes(result.ETag ?? null)
    };
  }

  const destination = localObjectPath(input.key);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, input.body);
  return { bucket: storageBucket(), key: input.key, contentType: input.contentType, size: input.body.byteLength, etag: null };
}

export async function uploadFile(input: {
  key: string;
  filePath: string;
  contentType: string;
  metadata?: Record<string, string>;
}): Promise<StoredObject> {
  const fileStat = await stat(input.filePath);
  if (isR2Configured()) {
    const result = await s3().send(new PutObjectCommand(putInput({
      Key: input.key,
      Body: createReadStream(input.filePath),
      ContentType: input.contentType,
      Metadata: input.metadata
    })));
    return {
      bucket: storageBucket(),
      key: input.key,
      contentType: input.contentType,
      size: fileStat.size,
      etag: stripQuotes(result.ETag ?? null)
    };
  }

  const destination = localObjectPath(input.key);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, await readFile(input.filePath));
  return { bucket: storageBucket(), key: input.key, contentType: input.contentType, size: fileStat.size, etag: null };
}

export async function downloadToFile(input: { key: string; destination: string }): Promise<void> {
  await mkdir(path.dirname(input.destination), { recursive: true });
  if (isR2Configured()) {
    const result = await s3().send(new GetObjectCommand({ Bucket: storageBucket(), Key: input.key }));
    if (!result.Body) throw new Error(`R2 object has no body: ${input.key}`);
    await writeFile(input.destination, Buffer.from(await result.Body.transformToByteArray()));
    return;
  }

  await writeFile(input.destination, await readFile(localObjectPath(input.key)));
}

export async function readObjectBuffer(key: string): Promise<Buffer> {
  if (isR2Configured()) {
    const result = await s3().send(new GetObjectCommand({ Bucket: storageBucket(), Key: key }));
    if (!result.Body) throw new Error(`R2 object has no body: ${key}`);
    return Buffer.from(await result.Body.transformToByteArray());
  }
  return readFile(localObjectPath(key));
}

export async function headObject(key: string): Promise<StorageObjectMetadata> {
  if (isR2Configured()) {
    const result = await s3().send(new HeadObjectCommand({ Bucket: storageBucket(), Key: key }));
    return {
      bucket: storageBucket(),
      key,
      contentType: result.ContentType ?? null,
      size: result.ContentLength ?? null,
      etag: stripQuotes(result.ETag ?? null)
    };
  }
  const fileStat = await stat(localObjectPath(key));
  return { bucket: storageBucket(), key, contentType: null, size: fileStat.size, etag: null };
}

export async function deleteObject(key: string): Promise<void> {
  if (isR2Configured()) {
    await s3().send(new DeleteObjectCommand({ Bucket: storageBucket(), Key: key }));
    return;
  }
}

export async function signedObjectUrl(input: { key: string; expiresInSeconds?: number }): Promise<string> {
  if (!isR2Configured()) throw new Error("R2 is not configured; signed URLs are unavailable.");
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: storageBucket(), Key: input.key }),
    { expiresIn: input.expiresInSeconds ?? 900 }
  );
}

function s3(): S3Client {
  if (s3Client) return s3Client;
  const endpoint = r2Endpoint();
  if (!endpoint || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
    throw new Error("R2 storage is not configured.");
  }
  s3Client = new S3Client({
    region: process.env.R2_REGION || "auto",
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
  });
  return s3Client;
}

function putInput(input: Omit<PutObjectCommandInput, "Bucket">): PutObjectCommandInput {
  return {
    Bucket: storageBucket(),
    ...input
  };
}

function r2Endpoint(): string | undefined {
  return process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);
}

function localObjectPath(key: string): string {
  return path.join(process.env.LOCAL_OBJECT_STORAGE_DIR || path.join(os.tmpdir(), "instamosaic-object-storage"), key);
}

function safeFilename(value: string): string {
  const base = path.basename(value).replace(/[^A-Za-z0-9._-]+/g, "-");
  return base || "file";
}

function stripQuotes(value: string | null): string | null {
  return value?.replace(/^"+|"+$/g, "") ?? null;
}
