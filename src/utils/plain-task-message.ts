/**
 * Plain-text GoPartTime task message builder.
 *
 * Turns the task metadata + content into normal Discord message content
 * (no embeds). Every label and every value is sent as its own message, so
 * workers can select a value without the label:
 *
 *   subreddit
 *   https://www.reddit.com/r/MobileGaming
 *   title
 *   Does Mahjong ever stop feeling confusing?
 *   flair
 *   Discussion
 *   content
 *   <first content chunk>
 *
 * Comments use `post` and `comment` labels instead. Every returned message
 * is <= 2000 characters; long content is split into paragraph-aware chunks
 * (see chunkText).
 */

import { chunkText } from './discord-chunker';

export const MAX_MESSAGE_LENGTH = 2000;
const DEFAULT_CHUNK_TARGET = 1900;

export interface TaskMessageFields {
  subreddit?: string | null;
  subredditUrl?: string | null;
  flair?: string | null;
  title?: string | null;
  postLink?: string | null;
}

export interface TaskMessagePlan {
  /** Ordered label/value messages (kind: metadata). */
  metadata: string[];
  /** Paragraph-aware content chunks (kind: content). */
  content: string[];
  /** Final instruction message telling the worker how to submit (kind: instruction). */
  instruction: string;
}

function buildMetadata(fields: TaskMessageFields): string[] {
  const messages: string[] = [];

  if (fields.postLink) {
    messages.push('post', fields.postLink);
    return messages;
  }

  if (fields.subreddit || fields.subredditUrl) {
    messages.push('subreddit', fields.subredditUrl || fields.subreddit || '');
  }
  if (fields.title) {
    messages.push('title', fields.title);
  }
  if (fields.flair) {
    messages.push('flair', fields.flair);
  }

  return messages;
}

/**
 * Builds the ordered plain messages for a task: every label and every value
 * gets its own metadata message, followed by the paragraph-aware content
 * chunks. The content label (`content` for posts, `comment` for comments) is
 * always sent before the first chunk and is omitted when there is no content.
 * The final instruction message tells the worker how to submit the task.
 */
export function buildTaskMessagePlan(fields: TaskMessageFields, content: string): TaskMessagePlan {
  const contentStr = content || '';
  const metadata = buildMetadata(fields);

  if (contentStr.length === 0) {
    return { metadata, content: [], instruction: buildInstructionMessage(fields) };
  }

  const contentLabel = fields.postLink ? 'comment' : 'content';
  const chunks = chunkText(contentStr, {
    target: DEFAULT_CHUNK_TARGET,
    hardMax: MAX_MESSAGE_LENGTH,
  });

  return {
    metadata: [...metadata, contentLabel],
    content: chunks,
    instruction: buildInstructionMessage(fields),
  };
}

export function buildInstructionMessage(fields: TaskMessageFields): string {
  return fields.postLink
    ? "That's it. first do any random comment related to post and then after 10 mins edit that random comment and paste the given comment and share the link of the comment by replying to this message"
    : "That's it, post everything exactly as it is and share the link of the post by replying to this message within 10 minutes";
}
