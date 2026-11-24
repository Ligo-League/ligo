import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { isStorageKey, type ObjectStore } from './object-store.ts';

// Cloudflare R2 through its S3 API (design doc section 13): one private bucket. Browsers upload
// raw replays straight to it with presigned PUTs; everything else goes through the server, which
// checks who may see it. Neither the keys nor a signed URL are ever logged.

export interface R2Settings {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Another S3 address than R2's usual `https://<account>.r2.cloudflarestorage.com`. */
  endpoint: string | null;
}

/** The one call the store makes; the real S3Client, or a fake in tests. */
export interface S3Like {
  send(command: { input: object }): Promise<unknown>;
}

const refuse = () => Promise.reject(new Error('Not a storage key'));

/** R2 answers a missing object with 404 (NoSuchKey for a read, NotFound for a head). */
function isMissing(error: unknown): boolean {
  const failure = error as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return (
    failure?.name === 'NoSuchKey' ||
    failure?.name === 'NotFound' ||
    failure?.$metadata?.httpStatusCode === 404
  );
}

export function createR2ObjectStore(
  settings: R2Settings,
  options: { client?: S3Like; now: () => number },
): ObjectStore {
  const real = new S3Client({
    region: 'auto',
    endpoint: settings.endpoint ?? `https://${settings.accountId}.r2.cloudflarestorage.com`,
    // R2 always serves path-style addresses under its own certificate.
    forcePathStyle: true,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
  });
  const client: S3Like = options.client ?? real;
  const Bucket = settings.bucket;

  return {
    async put(key, data, contentType) {
      if (!isStorageKey(key)) return refuse();
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: data,
          ContentType: contentType,
          ContentLength: data.length,
        }),
      );
    },
    async get(key, maxBytes) {
      if (!isStorageKey(key)) return null;
      try {
        // One byte more than allowed is enough to tell the object is too large.
        const answer = (await client.send(
          new GetObjectCommand({ Bucket, Key: key, Range: `bytes=0-${String(maxBytes)}` }),
        )) as { ContentLength?: number; Body?: { transformToByteArray(): Promise<Uint8Array> } };
        if (!answer.Body || (answer.ContentLength ?? 0) > maxBytes) return null;
        const data = await answer.Body.transformToByteArray();
        return data.length > maxBytes ? null : data;
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    async head(key, bytes) {
      if (!isStorageKey(key)) return null;
      try {
        const answer = (await client.send(
          new GetObjectCommand({ Bucket, Key: key, Range: `bytes=0-${String(bytes - 1)}` }),
        )) as { Body?: { transformToByteArray(): Promise<Uint8Array> } };
        return answer.Body ? (await answer.Body.transformToByteArray()).slice(0, bytes) : null;
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    async size(key) {
      if (!isStorageKey(key)) return null;
      try {
        const answer = (await client.send(new HeadObjectCommand({ Bucket, Key: key }))) as {
          ContentLength?: number;
        };
        return answer.ContentLength ?? null;
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    async delete(key) {
      if (!isStorageKey(key)) return refuse();
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    async signGet(key, { expiresInS, fileName }) {
      if (!isStorageKey(key)) return refuse();
      // Saved under a plain name: the key's own characters only, quoted.
      const safe = fileName.replace(/[^A-Za-z0-9._-]/g, '_');
      return getSignedUrl(
        real,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ResponseContentDisposition: `attachment; filename="${safe}"`,
        }),
        { expiresIn: expiresInS, signingDate: new Date(options.now()) },
      );
    },
    async signPut(key, { size, contentType, expiresInS }) {
      if (!isStorageKey(key)) return refuse();
      const expiresAt = options.now() + expiresInS * 1000;
      // Signing is local work: the real client signs even when tests fake its calls. The size
      // and type are signed headers, so R2 refuses any other file.
      const url = await getSignedUrl(
        real,
        new PutObjectCommand({ Bucket, Key: key, ContentLength: size, ContentType: contentType }),
        {
          expiresIn: expiresInS,
          signableHeaders: new Set(['content-length', 'content-type']),
          signingDate: new Date(options.now()),
        },
      );
      return { url, method: 'PUT', headers: { 'content-type': contentType }, expiresAt };
    },
  };
}
