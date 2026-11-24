import { Hono } from 'hono';
import { type ObjectStore, readUploadToken } from '@ligo/storage';

// `PUT /storage/upload/:token`: the server's own presigned upload, for a machine without R2
// (design doc section 8, upload flow 5). The token is the whole permission: the server signs one
// only after checking the user (`POST /api/replays/sign`, 5-8). It is never logged.

export interface UploadRouteDeps {
  secret: string;
  store: ObjectStore;
  now: () => number;
  logger: { error: (details: object, message: string) => void };
}

export function uploadRoute(deps: UploadRouteDeps): Hono {
  const app = new Hono();
  app.put('/storage/upload/:token', async (c) => {
    const grant = readUploadToken(deps.secret, c.req.param('token'), deps.now());
    if (!grant) return c.body(null, 403);
    const declared = Number(c.req.header('content-length'));
    if (c.req.header('content-type') !== grant.contentType || declared !== grant.size) {
      return c.body(null, 400);
    }
    // Read no more than granted: a body longer than its header says is refused too.
    const body = c.req.raw.body as ReadableStream<Uint8Array> | null;
    const reader = body?.getReader();
    const data = new Uint8Array(grant.size);
    let received = 0;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      if (received + value.length > grant.size) {
        await reader.cancel();
        return c.body(null, 400);
      }
      data.set(value, received);
      received += value.length;
    }
    if (received !== grant.size) return c.body(null, 400);
    try {
      await deps.store.put(grant.key, data, grant.contentType);
    } catch {
      deps.logger.error({ key: grant.key }, 'An upload could not be stored');
      return c.body(null, 500);
    }
    return c.body(null, 200);
  });
  return app;
}
