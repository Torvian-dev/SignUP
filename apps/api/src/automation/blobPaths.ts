import { env } from "../config/env.js";
export { getDecrypted, putEncrypted } from "../lib/blob.js";

export const BLOB = {
  artifacts: env.BLOB_CONTAINER_ARTIFACTS,
  browserState: env.BLOB_CONTAINER_BROWSER_STATE,
  documents: env.BLOB_CONTAINER_DOCUMENTS,
};
