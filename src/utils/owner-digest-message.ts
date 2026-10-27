/**
 * Pure Discord DM text for the weekly owner digest. The owner asked for a
 * super-clear weekly report: tasks done / deleted / completed, revenue,
 * worker pay, commissions, and what was saved. Money figures come straight
 * from owner-earnings (creation basis, same math as the Owner Earnings page),
 * so this module only formats — it never recomputes.
 */

export interface OwnerDigestCohort {
  /** All tasks created in the week (every status). */
  total: number;
  posts: number;
  comments: number;
  /** COMPLETED or ARCHIVED, not deleted. */
  completed: number;
  /** CANCELLED status or any cancelledReason (deleted / deleted_later / …). */
  deleted: number;
  /** Everything still live but not completed yet. */
  open: number;
}

export interface OwnerDigestMoney {
  revenue: number;
  workerCost: number;
  perTaskCommissions: number;
  oneTimeBonuses: number;
  /** revenue − workerCost − perTaskCommissions − oneTimeBonuses. */
  saved: number;
}

export interface OwnerDigestRates {
  revenuePerPost: number;
  revenuePerComment: number;
  workerPerPost: number;
  workerPerComment: number;
}

export interface OwnerDigestMessageInput {
  startLabel: string;
  endLabel: string;
  cohort: OwnerDigestCohort;
  money: OwnerDigestMoney;
  rates: OwnerDigestRates;
}

const rupees = (n: number): string => `₹${Math.round(n).toLocaleString('en-IN')}`;

/**
 * Builds the DM text. Throws when the cohort buckets do not reconcile
 * (completed + deleted + open must equal total) — a wrong digest is worse
 * than no digest.
 */
export function buildOwnerDigestMessage(input: OwnerDigestMessageInput): string {
  const { startLabel, endLabel, cohort, money, rates } = input;
  const { total, posts, comments, completed, deleted, open } = cohort;

  if (completed + deleted + open !== total) {
    throw new Error(
      `Digest cohort does not reconcile: completed ${completed} + deleted ${deleted} + open ${open} != total ${total}`,
    );
  }
  const expectedSaved =
    money.revenue - money.workerCost - money.perTaskCommissions - money.oneTimeBonuses;
  if (Math.round(expectedSaved) !== Math.round(money.saved)) {
    throw new Error(
      `Digest money does not reconcile: revenue − worker − commissions (${expectedSaved}) != saved ${money.saved}`,
    );
  }

  const liveTasks = completed + open;
  const commissionsTotal = money.perTaskCommissions + money.oneTimeBonuses;

  return [
    `📊 **Weekly Owner Digest**`,
    `**${startLabel} → ${endLabel}** (IST)`,
    ``,
    `**Tasks created:** ${total} (posts ${posts} · comments ${comments})`,
    `✅ Completed: ${completed}`,
    `🗑️ Deleted: ${deleted}`,
    `⏳ Still open: ${open}`,
    `Counted for money (live tasks): ${liveTasks}`,
    ``,
    `**Money**`,
    `Revenue: **${rupees(money.revenue)}**`,
    `Worker pay: **−${rupees(money.workerCost)}**`,
    `Commissions: **−${rupees(commissionsTotal)}** (per-task ${rupees(money.perTaskCommissions)} + one-time bonuses ${rupees(money.oneTimeBonuses)})`,
    `💎 **Saved (net): ${rupees(money.saved)}**`,
    ``,
    `_Basis: tasks created ${startLabel.split(' ')[1]} ${startLabel.split(' ')[2]} → ${endLabel.split(' ')[1]} ${endLabel.split(' ')[2]}. Deleted tasks earn and pay nothing. Revenue ${rupees(rates.revenuePerPost)}/post · ${rupees(rates.revenuePerComment)}/comment. Worker pay ${rupees(rates.workerPerPost)}/post · ${rupees(rates.workerPerComment)}/comment (live rates). Commissions = special per-task + one-time referral bonuses. Same math as the Owner Earnings page; open tasks count for money on creation._`,
  ].join('\n');
}
