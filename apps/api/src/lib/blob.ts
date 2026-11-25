import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { env } from "../config/env.js";
import { decryptBufferForOrg, encryptForOrg } from "./crypto.js";

/**
 * Blob storage with application-layer encryption on top of Azure SSE.
 * Falls back to a local directory in development.
 */
const svc = env.AZURE_STORAGE_ACCOUNT_URL
  ? new BlobServiceClient(env.AZURE_STORAGE_ACCOUNT_URL, new DefaultAzureCredential())
  : null;
const LOCAL_ROOT = "/tmp/formagent-blobs";

export async function putEncrypted(orgId: string, container: string, path: string, data: Buffer): Promise<string> {
  const body = (await encryptForOrg(orgId, data))!;
  const key = `${orgId}/${path}`;
  if (svc) {
    await svc.getContainerClient(container).getBlockBlobClient(key).uploadData(body, {
      blobHTTPHeaders: { blobContentType: "application/octet-stream" },
    });
  } else {
    const p = join(LOCAL_ROOT, container, key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }
  return key;
}

export async function getDecrypted(orgId: string, container: string, key: string): Promise<Buffer | null> {
  let body: Buffer;
  try {
    body = svc
      ? await svc.getContainerClient(container).getBlobClient(key).downloadToBuffer()
      : await readFile(join(LOCAL_ROOT, container, key));
  } catch {
    return null;
  }
  return decryptBufferForOrg(orgId, body);
}
