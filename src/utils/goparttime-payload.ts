import { z } from 'zod';

/**
 * Unified GoPartTime → backend payload produced by the Tampermonkey
 * extension (scripts/goparttime-send.user.js).
 *
 * Validated at the API boundary; the GoPartTime task ID is the primary
 * external task identifier used for duplicate prevention.
 */

export const goPartTimeImageSchema = z.object({
  order: z.number().int().positive(),
  url: z.string().url(),
});

export const goPartTimePayloadSchema = z
  .object({
    taskId: z
      .union([
        z.number().int().positive(),
        z.string().regex(/^\d+$/, 'taskId must be a positive integer'),
      ])
      .transform((value) => String(value)),

    type: z.enum(['post', 'comment']),

    // Ticket: Discord channel ID (snowflake) or channel name (e.g. "Ticket-0009")
    ticket: z.string().min(1).max(64),

    deadline: z.string().max(64).optional().nullable(),
    payment: z.string().max(32).optional().nullable(),

    // Post-only fields
    subreddit: z.string().min(1).max(64).optional().nullable(),
    subredditUrl: z.string().url().optional().nullable(),
    flair: z.string().max(64).optional().nullable(),
    title: z.string().max(300).optional().nullable(),

    // Comment-only field
    postLink: z.string().url().optional().nullable(),

    // Content as extracted from the task dialog (div.prose innerHTML)
    contentHtml: z.string().min(1).max(100_000),

    images: z.array(goPartTimeImageSchema).max(20).optional().default([]),

    sourceUrl: z.string().url().optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.contentHtml.trim().length === 0) {
      ctx.addIssue({ code: 'custom', path: ['contentHtml'], message: 'Content is missing.' });
    }

    if (data.images.length > 0) {
      const orders = data.images.map((image) => image.order).sort((a, b) => a - b);
      const expected = Array.from({ length: orders.length }, (_, index) => index + 1);
      if (orders.join(',') !== expected.join(',')) {
        ctx.addIssue({
          code: 'custom',
          path: ['images'],
          message: 'Image orders must be sequential starting at 1.',
        });
      }
    }

    if (data.type === 'post') {
      if (!data.title || data.title.trim().length === 0) {
        ctx.addIssue({ code: 'custom', path: ['title'], message: 'Title is required for posts.' });
      }
      if (!data.subreddit || data.subreddit.trim().length === 0) {
        ctx.addIssue({ code: 'custom', path: ['subreddit'], message: 'Subreddit is required for posts.' });
      }
    }

    if (data.type === 'comment') {
      if (!data.postLink || data.postLink.trim().length === 0) {
        ctx.addIssue({ code: 'custom', path: ['postLink'], message: 'Post link is required for comments.' });
      }
    }
  });

export type GoPartTimePayload = z.infer<typeof goPartTimePayloadSchema>;
export type GoPartTimeImage = z.infer<typeof goPartTimeImageSchema>;
