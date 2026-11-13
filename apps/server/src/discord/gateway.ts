import type { Client } from 'discord.js';
import { isDiscordAttachmentUrl } from '../services/attachments.ts';
import type { OutgoingMessage } from './commands/types.ts';
import { toDiscordMessage } from './outgoing.ts';

/**
 * What the bot does outside the reply to an interaction. Services and commands use this
 * interface, so tests run on an in-memory fake and never reach Discord.
 */
export interface DiscordGateway {
  /** Posts in a channel found by its stored ID. */
  postMessage(
    channelId: string,
    message: OutgoingMessage,
  ): Promise<{ messageId: string; url: string }>;
  editMessage(channelId: string, messageId: string, message: OutgoingMessage): Promise<void>;
  /** Downloads a file attached to a command. Rejects other hosts and files over `maxBytes`. */
  downloadAttachment(url: string, maxBytes: number): Promise<Uint8Array>;
}

const DOWNLOAD_TIMEOUT_MS = 10_000;

/** Reads a stream to the end, giving up as soon as it holds more than `maxBytes`. */
export async function readCapped(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Attachment is larger than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

export function createDiscordGateway(client: Client): DiscordGateway {
  const sendable = async (channelId: string) => {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isSendable()) throw new Error(`Channel ${channelId} cannot receive messages`);
    return channel;
  };

  return {
    async postMessage(channelId, message) {
      const channel = await sendable(channelId);
      const posted = await channel.send(toDiscordMessage(message));
      return { messageId: posted.id, url: posted.url };
    },

    async editMessage(channelId, messageId, message) {
      const channel = await sendable(channelId);
      await channel.messages.edit(messageId, toDiscordMessage(message));
    },

    async downloadAttachment(url, maxBytes) {
      // Error messages never repeat the address: it is a signed link.
      if (!isDiscordAttachmentUrl(url)) throw new Error('Not a Discord attachment address');
      const response = await fetch(url, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        redirect: 'error',
      });
      if (!response.ok || !response.body) {
        throw new Error(`Discord answered ${response.status} for an attachment`);
      }
      return readCapped(response.body, maxBytes);
    },
  };
}
