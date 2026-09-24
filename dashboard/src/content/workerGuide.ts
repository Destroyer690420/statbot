/**
 * Worker "How to" guide content. The owner can change wording here without
 * touching components.
 *
 * Facts only from the repo / owner brief — no invented Reddit UI steps.
 */

export interface GuideSection {
  id: string;
  title: string;
  steps: string[];
  tips: string[];
  warnings: string[];
}

/** Guide channel IDs from TICKET_GUIDE_MESSAGE (src/config/constants.ts). */
export const GUIDE_CHANNEL_IDS = [
  '1520466000477163550',
  '1520481331773968384',
  '1520620297399828571',
] as const;

/** Payment-proof channel from PAYMENT_PROOF_CHANNEL_ID (src/config/constants.ts). */
export const PAYMENT_PROOF_CHANNEL_ID = '1520613959315488930';

export function discordChannelUrl(guildId: string, channelId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

export const WORKER_GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'how-it-works',
    title: 'How it works (overview)',
    steps: [
      'You get a task in your ticket channel in Discord.',
      'Do the task on Reddit (a post or a comment).',
      'Reply with your Reddit link in your ticket.',
      'After 20 hours the bot asks for your first insight (view data) screenshot.',
      'For posts, there is a second insight after 70 hours. Comments need only the 20h insight.',
      'When all insights are in, the task becomes Completed.',
      'Your manager pays weekly and the task becomes Paid.',
    ],
    tips: [],
    warnings: [],
  },
  {
    id: 'post-task',
    title: 'Doing a POST task',
    steps: [
      'The bot sends subreddit, title, flair and content as separate messages so you can copy each one without the label.',
      'Post everything exactly as it is: the same subreddit, the exact title, the flair, and all paragraphs with a blank line between them.',
      'The bot checks the format automatically and will tell you if the title or paragraphs do not match.',
      'Reply to the bot\u2019s \u201cReply with your post link\u201d message with your post link within 10 minutes.',
      'Send exactly one Reddit link.',
    ],
    tips: ['Copy the title character-for-character \u2014 even small changes fail the check.'],
    warnings: [],
  },
  {
    id: 'comment-task',
    title: 'Doing a COMMENT task',
    steps: [
      'Post any random comment related to the post.',
      'After 10 minutes, edit that comment and paste the given comment text.',
      'Reply to the bot\u2019s message with the link of your comment.',
    ],
    tips: [],
    warnings: [],
  },
  {
    id: 'deleted-post',
    title: 'If your post gets deleted',
    steps: [
      'If a post is removed from Reddit within 10 minutes it is marked Deleted.',
      'It stays pending, no insights are asked for it, and it is never paid.',
      'It appears under Tasks \u2192 Failed.',
    ],
    tips: [],
    warnings: ['Deleted tasks are never paid \u2014 this is not a mistake, it is the rule.'],
  },
  {
    id: 'insights',
    title: 'Insights (view data screenshots)',
    steps: [
      'Insights are screenshots of your post or comment\u2019s view data \u2014 proof that your task is live and being seen.',
      'Posts need two insights: 20 hours and 70 hours after the task starts. Comments need one: 20 hours only.',
      'The bot pings you in your ticket with a reminder when an insight is due.',
      'Reply to THAT reminder message with one screenshot (png, jpg, jpeg or webp) of your view data.',
      'Open your post\u2019s insights / view data as shown in the guide channels and take a clear screenshot that shows the view count.',
      // TODO(owner): add exact steps and screenshots for where to find view data on Reddit.
      'If you miss it, the bot reminds you again 2 hours and 6 hours later, and after 3 tries your managers are pinged.',
      'A late screenshot still counts \u2014 send it as soon as you can.',
    ],
    tips: [],
    warnings: ['Always reply to the reminder message itself, otherwise the bot will not see your screenshot.'],
  },
  {
    id: 'understanding-tasks',
    title: 'Understanding your tasks',
    steps: [
      'To-do: tasks that still need something \u2014 posting, waiting for review, or an insight screenshot.',
      'Completed \u2192 Awaiting payment: all insights are in, the money is estimated at today\u2019s rates and will be paid by your manager.',
      'Completed \u2192 Paid: the payment for that task has been made.',
      'Failed: deleted or cancelled tasks. Deleted tasks are never paid and need no insights.',
    ],
    tips: [],
    warnings: [],
  },
  {
    id: 'payments',
    title: 'Payments',
    steps: [
      'Payments are made by your manager, usually weekly (IST Sunday\u2013Saturday weeks).',
      'You get a message in your ticket when a payment is credited.',
      'You may share the payment screenshot in the payment proof channel.',
      'Amounts marked estimated use today\u2019s rates.',
    ],
    tips: [],
    warnings: ['Payouts are triggered manually by the admin \u2014 there is no fixed payout day to promise.'],
  },
  {
    id: 'need-help',
    title: 'Need help?',
    steps: ['Message in your ticket \u2014 use the \u201cMy ticket\u201d button at the top to open it in Discord.'],
    tips: [],
    warnings: [],
  },
];
