import { schema, type Db, type Tx } from '@ligo/db';
import { and, asc, eq } from 'drizzle-orm';

// The bot's posts in a staff queue channel, kept by what they are about, so that whoever handles
// it, in Discord or later on the website, can mark each post as handled (maintainer,
// 13 November 2026).

const { queuePost } = schema;

export type QueueEntity = (typeof schema.QUEUE_POST_ENTITIES)[number];

export interface PostRef {
  channelId: string;
  messageId: string;
}

export function recordQueuePost(
  db: Db | Tx,
  about: { entity: QueueEntity; entityId: number },
  post: PostRef,
  now: number,
): void {
  db.insert(queuePost)
    .values({ ...about, channelId: post.channelId, messageId: post.messageId, postedAt: now })
    .run();
}

/** Every post about it, oldest first. */
export function queuePostsOf(
  db: Pick<Db, 'select'>,
  about: { entity: QueueEntity; entityId: number },
): PostRef[] {
  return db
    .select({ channelId: queuePost.channelId, messageId: queuePost.messageId })
    .from(queuePost)
    .where(and(eq(queuePost.entity, about.entity), eq(queuePost.entityId, about.entityId)))
    .orderBy(asc(queuePost.id))
    .all();
}
