import { Client, GatewayIntentBits } from 'discord.js';
import { initializeDatabase } from '../src/database/db';
import { inactiveTicketService } from '../src/services/inactive-ticket.service';
import { env } from '../src/config/env';
import { logger } from '../src/utils/logger';

interface CleanupCliOptions {
  dryRun: boolean;
  execute: boolean;
  concurrency: number;
  skipDm: boolean;
}

function parseCliArgs(): CleanupCliOptions {
  const args = process.argv.slice(2);
  const options: CleanupCliOptions = {
    dryRun: true, // Default to dry-run unless --execute is explicitly passed
    execute: false,
    concurrency: 6,
    skipDm: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--execute') {
      options.execute = true;
      options.dryRun = false;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
      options.execute = false;
    } else if (arg === '--skip-dm') {
      options.skipDm = true;
    } else if (arg === '--concurrency' && args[i + 1]) {
      options.concurrency = parseInt(args[i + 1], 10) || 6;
      i += 1;
    }
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseCliArgs();

  console.log('═══════════════════════════════════════════════════════════');
  console.log('       AUTOMATED INACTIVE TICKET INITIAL CLEANUP          ');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Mode:            ${options.execute ? 'LIVE EXECUTION (DELETIONS ENABLED)' : 'DRY RUN (AUDIT ONLY)'}`);
  console.log(`Concurrency:     ${options.concurrency}`);
  console.log(`Notify Admin DM: ${options.skipDm ? 'NO' : 'YES'}`);
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
  await new Promise<void>((resolve) => client.once('ready', () => resolve()));
  logger.info(`Discord client ready as ${client.user?.tag}`);

  try {
    const result = await inactiveTicketService.runLifecycleSweep(client, {
      dryRun: options.dryRun,
      deleteEligible: options.execute,
      sendWarnings: false, // Initial cleanup focuses on backlog deletion and audit
      concurrency: options.concurrency,
      notifyAdminOnDeletion: options.execute,
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
      for (const p of result.protectedTickets.slice(0, 10)) {
        console.log(`  - #${p.channelName} (${p.channelId}): ${p.reasons.join('; ')}`);
      }
      if (result.protectedTickets.length > 10) {
        console.log(`  ... and ${result.protectedTickets.length - 10} more protected tickets`);
      }
      console.log('');
    }

    if (options.execute && !options.skipDm) {
      console.log('Sending Initial Cleanup Report to admin (mac)...');
      await inactiveTicketService.sendInitialCleanupReport(client, result);
      console.log('Report sent successfully!');
    } else if (options.dryRun) {
      console.log('ℹ️  DRY RUN complete. No channels were deleted.');
      console.log('   To execute deletions with backups and send report to admin mac, run:');
      console.log('   npx tsx scripts/initial-ticket-cleanup.ts --execute');
    }
  } catch (error) {
    logger.error('Initial cleanup failed', { error });
    console.error('Fatal cleanup error:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

if (require.main === module) {
  void main();
}

