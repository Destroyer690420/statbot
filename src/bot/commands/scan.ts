import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { isAdminOrManager, getPermissionDeniedMessage } from '../../utils/permissions';
import { errorEmbed, successEmbed } from '../embeds';
import { requestScan } from '../../services/automation/scan-request.service';
import { logger } from '../../utils/logger';

export const data = new SlashCommandBuilder()
  .setName('scan')
  .setDescription('Scan GoPartTime now and DM the digest (same as the automatic round)');

// Per-user cooldown: a scan fans out to live browser tabs, so accidental
// double-taps must not queue duplicate requests.
const SCAN_COOLDOWN_MS = 60 * 1000;
const lastScanAt = new Map<string, number>();

export function clearScanCooldown(): void {
  lastScanAt.clear();
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAdminOrManager(interaction.user.id)) {
    await interaction.reply({ embeds: [errorEmbed(getPermissionDeniedMessage())], ephemeral: true });
    return;
  }

  const now = Date.now();
  const last = lastScanAt.get(interaction.user.id) ?? 0;
  if (now - last < SCAN_COOLDOWN_MS) {
    const wait = Math.ceil((SCAN_COOLDOWN_MS - (now - last)) / 1000);
    await interaction.reply({
      embeds: [errorEmbed(`A scan was just requested — wait ${wait}s before requesting another.`)],
      ephemeral: true,
    });
    return;
  }
  lastScanAt.set(interaction.user.id, now);

  try {
    const req = requestScan(interaction.user.id);
    await interaction.reply({
      embeds: [successEmbed(
        `Scan requested (\`${req.requestId}\`). The watcher tabs pick it up on their next poll — digest DM lands in ~1–2 min. If nothing arrives in 3 min, the tabs may be closed: reopen /tasks and try again.`,
      )],
      ephemeral: true,
    });
    logger.info('On-demand scan requested', { requestId: req.requestId, userId: interaction.user.id });
  } catch (error) {
    lastScanAt.delete(interaction.user.id);
    await interaction.reply({
      embeds: [errorEmbed('Could not queue the scan. Try again.')],
      ephemeral: true,
    });
    logger.error('On-demand scan request failed', { error });
  }
}
