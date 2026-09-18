import type { StorageAdapter } from "./types";

const TEN_MINUTES_MS = 10 * 60 * 1000;

export function createFakeStorageAdapter(): StorageAdapter {
  return {
    async createSignedUploadUrl(bucket, objectKey) {
      return {
        url: `https://fake-storage.local/${bucket}/${objectKey}?sig=fake-upload`,
        expiresAt: new Date(Date.now() + TEN_MINUTES_MS),
        headers: { "x-fake-upload": "true" },
        objectKey,
      };
    },
    async createSignedDownloadUrl(bucket, objectKey) {
      return {
        url: `https://fake-storage.local/${bucket}/${objectKey}?sig=fake-download`,
        expiresAt: new Date(Date.now() + TEN_MINUTES_MS),
      };
    },
  };
}
