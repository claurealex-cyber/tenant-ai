import { createStorageClientFromEnv, getBucketFromEnv } from "@tenant-ai/shared";

export const storageClient = createStorageClientFromEnv();
export const storageBucket = getBucketFromEnv();
