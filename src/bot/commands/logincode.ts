import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import {
  planIssueCode,
  storeIssuedCode,
  clearOtpRecord,
  inviterOtpKey,
  buildInviterLoginMessage,
  formatOtpCode,
  WorkerRedisUnavailableError,
  WORKER_OTP_TTL_SECONDS,
  isWorkerPortalAvailable,
} from '../../services/worker-auth.service';
import { errorEmbed, warningEmbed, successEmbed } from '../embeds';
import { logger } from '../../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('logincode')
  .setDescription('Get a Worker Panel login code (for inviters, or if your DMs are closed)');

/**
 * Ticket-less login path. An inviter never gets a task, so they have no ticket
 * to read a code from: this command (or the website's DM) is how they prove
 * their Discord account. Prefers a DM; falls back to an ephemeral reply so a
 * closed DM inbox can never lock someone out.
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isWorkerPortalAvailable()) {
    await interaction.reply({ embeds: [warningEmbed('The Worker Panel is not available right now.')], ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const key = inviterOtpKey(interaction.user.id);

  try {
    const plan = await planIssueCode(key);
    if (!plan.ok) {
      const text =
        plan.reason === 'active'
          ? 'A code was already sent to your DMs. It expires in 5 minutes.'
          : plan.reason === 'cooldown'
            ? 'Please wait before requesting another code.'
            : plan.reason === 'locked'
              ? 'Too many attempts. Try again later.'
              : 'Too many codes requested. Try again later.';
      await interaction.editReply({ embeds: [warningEmbed(text)] });
      return;
    }

    // Prefer the private DM; the ephemeral reply is the fallback.
    let delivered = false;
    try {
      await interaction.user.send(buildInviterLoginMessage(plan.code));
      delivered = true;
    } catch {
      logger.info('logincode: DM failed, falling back to an ephemeral reply', {});
    }

    // Store only after a successful DM: a DM failure must leave no usable code.
    if (delivered) {
      await storeIssuedCode(key, plan.code, null);
      await interaction.editReply({
        embeds: [successEmbed(`Your login code is on its way to your DMs. It expires in ${Math.round(WORKER_OTP_TTL_SECONDS / 60)} minutes.`)],
      });
      return;
    }

    await clearOtpRecord(key).catch(() => undefined);
    await interaction.editReply({
      embeds: [
        warningEmbed(
          `We could not DM you, so here is your code: **${formatOtpCode(plan.code)}**\n` +
            'It expires in 5 minutes. Open the Worker Panel, choose "I only invite", and enter it. ' +
            'Nobody else can see this message.',
        ),
      ],
    });
  } catch (error) {
    if (error instanceof WorkerRedisUnavailableError) {
      await interaction.editReply({
        embeds: [errorEmbed('Service temporarily unavailable. Please try again shortly.')],
      });
      return;
    }
    logger.error('logincode command failed', { error });
    await interaction.editReply({ embeds: [errorEmbed('Internal server error.')] });
  }
}
