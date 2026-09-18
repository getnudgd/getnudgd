export interface SignedUploadUrl {
  url: string;
  expiresAt: Date;
  headers: Record<string, string>;
  objectKey: string;
}

export interface SignedDownloadUrl {
  url: string;
  expiresAt: Date;
}

export interface StorageAdapter {
  createSignedUploadUrl(bucket: string, objectKey: string): Promise<SignedUploadUrl>;
  createSignedDownloadUrl(bucket: string, objectKey: string): Promise<SignedDownloadUrl>;
}
