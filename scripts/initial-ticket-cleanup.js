// scripts/initial-ticket-cleanup.js
// Standalone runner for production container or host execution

const fs = require('fs');
const path = require('path');

const distDir = fs.existsSync(path.join(__dirname, 'dist'))
  ? path.join(__dirname, 'dist')
  : path.join(__dirname, '../dist');

const { Client, GatewayIntentBits } = require('discord.js');
const { initializeDatabase } = require(path.join(distDir, 'database/db'));
const { inactiveTicketService } = require(path.join(distDir, 'services/inactive-ticket.service'));
const { env } = require(path.join(distDir, 'config/env'));
const { logger } = require(path.join(distDir, 'utils/logger'));

async function main() {
  const args = process.argv.slice(2);
  const isExecute = args.includes('--execute');
  const isDryRun = !isExecute || args.includes('--dry-run');
  const skipDm = args.includes('--skip-dm');

  console.log('═══════════════════════════════════════════════════════════');
  console.log('       AUTOMATED INACTIVE TICKET INITIAL CLEANUP          ');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Mode:            ${isExecute ? 'LIVE EXECUTION (DELETIONS ENABLED)' : 'DRY RUN (AUDIT ONLY)'}`);
  console.log(`Notify Admin DM: ${skipDm ? 'NO' : 'YES'}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  initializeDatabase();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.DirectMessages,
    ],
  });

  await client.login(env.DISCORD_TOKEN);
  await new Promise((resolve) => client.once('ready', resolve));
  logger.info(`Discord client ready as ${client.user?.tag}`);

  try {
    const notifyEach = args.includes('--notify-each');
    const result = await inactiveTicketService.runLifecycleSweep(client, {
      dryRun: isDryRun,
      deleteEligible: isExecute,
      sendWarnings: false, // Initial cleanup focuses on backlog deletion and audit
      concurrency: 4, // Safe pacing for downloads and Discord channel deletions
      notifyAdminOnDeletion: notifyEach, // Ongoing lifecycle notifies each; mass cleanup sends attached report
    });

    console.log('\n======================================================');
    console.log('             INITIAL CLEANUP AUDIT SUMMARY            ');
    console.log('======================================================');
    console.log(`• Total tickets scanned:                   ${result.scanned}`);
    console.log(`• Tickets inactive for 30+ days:           ${result.inactive30Plus}`);
    console.log(`• Tickets deleted successfully:            ${result.deleted}`);
    console.log(`• Tickets protected (pending payments):    ${result.protectedCount}`);
    console.log(`• Tickets skipped due to backup failures:  ${result.skippedBackupFailed}`);
    console.log(`• Tickets that remain active:              ${result.active}`);
    console.log(`• Day 15 warning candidates:               ${result.inactive15Plus}`);
    console.log(`• Day 25 warning candidates:               ${result.inactive25Plus}`);
    console.log('======================================================\n');

    if (result.protectedTickets.length > 0) {
      console.log('🔒 Protected Tickets (will NOT be deleted):');
      for (const p of result.protectedTickets.slice(0, 15)) {
        console.log(`  - #${p.channelName} (${p.channelId}): ${p.reasons.join('; ')}`);
      }
      if (result.protectedTickets.length > 15) {
        console.log(`  ... and ${result.protectedTickets.length - 15} more protected tickets`);
      }
      console.log('');
    }

    if (isExecute && !skipDm) {
      console.log('Sending Initial Cleanup Report to admin (mac)...');
      await inactiveTicketService.sendInitialCleanupReport(client, result);
      console.log('Report sent successfully!');
    } else if (isDryRun) {
      console.log('ℹ️  DRY RUN complete. No channels were deleted.');
      console.log('   To execute deletions with backups and send report to admin mac, run with --execute');
    }
  } catch (error) {
    logger.error('Initial cleanup failed', { error });
    console.error('Fatal cleanup error:', error);
    process.exit(1);
  } finally {
    setTimeout(() => process.exit(0), 1500);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
}
